import express from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound } from '../utils/errors.js';
import { query, withTransaction } from '../db/pool.js';
import { generateServicePassword, generateShopCode } from '../utils/crypto.js';
import { generateCards, listCards } from '../services/cardService.js';
import { writeAudit } from '../services/auditService.js';

export const adminRoutes = express.Router();

adminRoutes.use(authenticate, requireRole('admin'));

function safeShop(shop) {
  if (!shop) return shop;
  const { service_password_hash: _servicePasswordHash, ...result } = shop;
  return {
    ...result,
    has_service_password: Boolean(_servicePasswordHash)
  };
}

const createShopSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    owner_name: z.string().min(2),
    mobile: z.string().min(5),
    password: z.string().min(6).optional(),
    phone: z.string().optional(),
    phone_secondary: z.string().optional(),
    address: z.string().optional(),
    postal_code: z.string().optional(),
    credit_balance: z.number().int().min(0).optional(),
    card_quota_balance: z.number().int().min(0).optional(),
    status: z.enum(['pending', 'active', 'inactive', 'rejected', 'archived']).default('active')
  })
});

const updateShopSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    name: z.string().min(2).optional(),
    owner_name: z.string().min(2).optional(),
    mobile: z.string().min(5).optional(),
    phone: z.string().optional().nullable(),
    phone_secondary: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    postal_code: z.string().optional().nullable(),
    logo_url: z.string().optional().nullable(),
    promotional_text: z.string().optional().nullable(),
    password: z.string().min(6).optional()
  })
});

adminRoutes.get('/dashboard', asyncHandler(async (_req, res) => {
  const result = await query(`
    select
      (select count(*)::int from shops where deleted_at is null) as shops_count,
      (select count(*)::int from shops where status = 'active' and deleted_at is null) as active_shops_count,
      (select count(*)::int from cards where deleted_at is null) as cards_count,
      (select count(*)::int from cards where status = 'raw' and deleted_at is null) as raw_cards_count,
      (select count(*)::int from cards where status = 'active' and deleted_at is null) as active_cards_count,
      (select coalesce(sum(card_quota_balance), 0)::int from shops where deleted_at is null) as total_card_quota_balance,
      (select count(*)::int from customers where deleted_at is null) as customers_count,
      (select count(*)::int from services where deleted_at is null) as services_count,
      (select coalesce(sum(amount), 0)::int from credit_transactions where type = 'charge') as purchased_credit,
      (select coalesce(abs(sum(amount)), 0)::int from credit_transactions where type = 'consume') as consumed_credit
  `);

  res.json(result.rows[0]);
}));

adminRoutes.get('/shops', asyncHandler(async (req, res) => {
  const result = await query(
    `select s.*,
            coalesce(activity.service_count, 0)::int as service_count,
            activity.latest_service_at
     from shops s
     left join lateral (
       select count(*)::int as service_count, max(se.created_at) as latest_service_at
       from services se
       where se.shop_id = s.id and se.deleted_at is null
     ) activity on true
     where s.deleted_at is null and ($1::text is null or s.status = $1)
     order by s.created_at desc`,
    [req.query.status || null]
  );
  res.json(result.rows.map(safeShop));
}));

adminRoutes.get('/customers', asyncHandler(async (_req, res) => {
  const result = await query(`
    select c.id, c.name, c.mobile, c.status, c.created_at,
           coalesce(activity.vehicle_count, 0)::int as vehicle_count,
           coalesce(activity.service_count, 0)::int as service_count,
           activity.latest_service_at,
           activity.latest_shop_name,
           coalesce(activity.vehicle_types, '{}') as vehicle_types
    from customers c
    left join lateral (
      select
        count(distinct v.id)::int as vehicle_count,
        count(se.id)::int as service_count,
        max(se.created_at) as latest_service_at,
        (array_agg(sh.name order by se.created_at desc) filter (where se.id is not null))[1] as latest_shop_name,
        array_agg(distinct v.type) filter (where v.type is not null) as vehicle_types
      from vehicles v
      left join services se on se.vehicle_id = v.id and se.deleted_at is null
      left join shops sh on sh.id = se.shop_id
      where v.customer_id = c.id and v.deleted_at is null
    ) activity on true
    where c.deleted_at is null
    order by activity.latest_service_at desc nulls last, c.created_at desc
  `);
  res.json(result.rows);
}));

adminRoutes.post('/shops', validate(createShopSchema), asyncHandler(async (req, res) => {
  const shop = await withTransaction(async (client) => {
    const passwordHash = req.body.password ? await bcrypt.hash(req.body.password, 12) : null;
    const userResult = await client.query(
      `insert into users(role, name, mobile, password_hash, status)
       values('shop', $1, $2, $3, $4)
       returning id, role, name, mobile, status`,
      [req.body.owner_name, req.body.mobile, passwordHash, req.body.status === 'active' ? 'active' : 'pending']
    );

    const shopResult = await client.query(
      `insert into shops(owner_user_id, name, owner_name, mobile, phone, phone_secondary, address, postal_code,
                         dedicated_code, credit_balance, card_quota_balance, status)
       values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning *`,
      [
        userResult.rows[0].id,
        req.body.name,
        req.body.owner_name,
        req.body.mobile,
        req.body.phone || null,
        req.body.phone_secondary || null,
        req.body.address || null,
        req.body.postal_code || null,
        generateShopCode(),
        req.body.credit_balance || 0,
        req.body.card_quota_balance || 0,
        req.body.status
      ]
    );

    await writeAudit(client, req.user.id, 'shops.create', 'shop', shopResult.rows[0].id);
    return shopResult.rows[0];
  });

  res.status(201).json(safeShop(shop));
}));

adminRoutes.patch('/shops/:id', validate(updateShopSchema), asyncHandler(async (req, res) => {
  const shop = await withTransaction(async (client) => {
    const currentResult = await client.query(
      `select s.*, u.id as user_id
       from shops s
       join users u on u.id = s.owner_user_id
       where s.id = $1 and s.deleted_at is null
       for update`,
      [req.params.id]
    );
    const current = currentResult.rows[0];
    if (!current) throw notFound('Shop not found');

    const next = {
      name: req.body.name ?? current.name,
      owner_name: req.body.owner_name ?? current.owner_name,
      mobile: req.body.mobile ?? current.mobile,
      phone: req.body.phone === undefined ? current.phone : req.body.phone,
      phone_secondary: req.body.phone_secondary === undefined
        ? current.phone_secondary
        : req.body.phone_secondary,
      address: req.body.address ?? current.address,
      postal_code: req.body.postal_code ?? current.postal_code,
      logo_url: req.body.logo_url ?? current.logo_url,
      promotional_text: req.body.promotional_text ?? current.promotional_text
    };

    const shopResult = await client.query(
      `update shops
       set name = $1,
           owner_name = $2,
           mobile = $3,
           phone = $4,
           phone_secondary = $5,
           address = $6,
           postal_code = $7,
           logo_url = $8,
           promotional_text = $9,
           updated_at = now()
       where id = $10
       returning *`,
      [
        next.name,
        next.owner_name,
        next.mobile,
        next.phone,
        next.phone_secondary,
        next.address,
        next.postal_code,
        next.logo_url,
        next.promotional_text,
        req.params.id
      ]
    );

    const passwordHash = req.body.password ? await bcrypt.hash(req.body.password, 12) : null;
    await client.query(
      `update users
       set name = $1,
           mobile = $2,
           password_hash = coalesce($3, password_hash),
           updated_at = now()
       where id = $4`,
      [next.owner_name, next.mobile, passwordHash, current.user_id]
    );

    await writeAudit(client, req.user.id, 'shops.update', 'shop', req.params.id, {
      fields: Object.keys(req.body)
    });
    return shopResult.rows[0];
  });

  res.json(safeShop(shop));
}));

adminRoutes.post('/shops/:id/service-credentials', validate(z.object({
  params: z.object({ id: z.string().uuid() })
})), asyncHandler(async (req, res) => {
  const password = generateServicePassword();
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await withTransaction(async (client) => {
    const updated = await client.query(
      `update shops
       set service_password_hash = $1, updated_at = now()
       where id = $2 and deleted_at is null
       returning id, dedicated_code`,
      [passwordHash, req.params.id]
    );
    if (!updated.rowCount) throw notFound('Shop not found');
    await writeAudit(
      client,
      req.user.id,
      'shops.service_credentials.rotate',
      'shop',
      req.params.id
    );
    return updated.rows[0];
  });

  res.json({
    dedicated_code: result.dedicated_code,
    password
  });
}));

adminRoutes.post('/shops/:id/card-quota', validate(z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    amount: z.number().int(),
    description: z.string().optional()
  })
})), asyncHandler(async (req, res) => {
  if (req.body.amount === 0) {
    throw badRequest('Amount cannot be zero');
  }

  const result = await withTransaction(async (client) => {
    const updated = await client.query(
      `update shops
       set card_quota_balance = card_quota_balance + $1,
           updated_at = now()
       where id = $2 and deleted_at is null and card_quota_balance + $1 >= 0
       returning id, card_quota_balance`,
      [req.body.amount, req.params.id]
    );
    if (!updated.rowCount) throw badRequest('Shop not found or card quota would become negative');

    await client.query(
      `insert into card_quota_transactions(shop_id, type, amount, description)
       values($1, $2, $3, $4)`,
      [
        req.params.id,
        req.body.amount > 0 ? 'grant' : 'manual_adjustment',
        req.body.amount,
        req.body.description || 'Admin card quota adjustment'
      ]
    );
    await writeAudit(client, req.user.id, 'shops.card_quota', 'shop', req.params.id, { amount: req.body.amount });
    return updated.rows[0];
  });

  res.json(result);
}));

adminRoutes.patch('/shops/:id/status', validate(z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({ status: z.enum(['pending', 'active', 'inactive', 'rejected', 'archived']) })
})), asyncHandler(async (req, res) => {
  const shop = await withTransaction(async (client) => {
    const result = await client.query(
      `update shops set status = $1, updated_at = now()
       where id = $2 and deleted_at is null
       returning *`,
      [req.body.status, req.params.id]
    );
    if (!result.rowCount) throw notFound('Shop not found');

    await client.query(
      `update users set status = $1, updated_at = now()
       where id = $2`,
      [req.body.status === 'active' ? 'active' : req.body.status, result.rows[0].owner_user_id]
    );
    await writeAudit(client, req.user.id, 'shops.status', 'shop', req.params.id, { status: req.body.status });
    return result.rows[0];
  });

  res.json(safeShop(shop));
}));

adminRoutes.post('/shops/:id/credit', validate(z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    amount: z.number().int(),
    description: z.string().optional()
  })
})), asyncHandler(async (req, res) => {
  if (req.body.amount === 0) {
    throw badRequest('Amount cannot be zero');
  }

  const result = await withTransaction(async (client) => {
    const updated = await client.query(
      `update shops set credit_balance = credit_balance + $1, updated_at = now()
       where id = $2 and deleted_at is null and credit_balance + $1 >= 0
       returning id, credit_balance`,
      [req.body.amount, req.params.id]
    );
    if (!updated.rowCount) throw badRequest('Shop not found or credit would become negative');

    await client.query(
      `insert into credit_transactions(shop_id, type, amount, description)
       values($1, $2, $3, $4)`,
      [
        req.params.id,
        req.body.amount > 0 ? 'charge' : 'manual_adjustment',
        req.body.amount,
        req.body.description || 'Admin credit adjustment'
      ]
    );
    await writeAudit(client, req.user.id, 'shops.credit', 'shop', req.params.id, { amount: req.body.amount });
    return updated.rows[0];
  });

  res.json(result);
}));

adminRoutes.post('/cards/generate', validate(z.object({
  body: z.object({
    count: z.number().int().min(1).max(5000)
  })
})), asyncHandler(async (req, res) => {
  const cards = await generateCards({
    count: req.body.count,
    actorUserId: req.user.id
  });
  res.status(201).json(cards);
}));

adminRoutes.get('/cards', validate(z.object({
  query: z.object({
    status: z.enum(['raw', 'assigned', 'active', 'voided', 'lost', 'archived']).optional(),
    shop_id: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).optional(),
    page_size: z.coerce.number().int().min(5).max(100).optional()
  })
})), asyncHandler(async (req, res) => {
  const cards = await listCards({
    status: req.query.status,
    shopId: req.query.shop_id,
    page: req.query.page || 1,
    pageSize: req.query.page_size || 20
  });
  res.json(cards);
}));
