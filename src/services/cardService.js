import { env } from '../config/env.js';
import { withTransaction } from '../db/pool.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { randomToken } from '../utils/crypto.js';
import { validateOtp } from './otpService.js';
import { writeAudit } from './auditService.js';

export async function generateCards({ count, actorUserId }) {
  return withTransaction(async (client) => {
    const cards = [];
    for (let i = 0; i < count; i += 1) {
      const token = randomToken(24);
      const result = await client.query(
        `insert into cards(public_token, status)
         values($1, 'raw')
         returning id, public_token, status, shop_id, generated_at, assigned_at`,
        [token]
      );
      cards.push({
        ...result.rows[0],
        public_url: `${env.publicCardBaseUrl}/${token}`
      });
    }

    await writeAudit(client, actorUserId, 'cards.generate', 'card', null, { count });
    return cards;
  });
}

export async function listCards({ status, shopId, page = 1, pageSize = 20 }) {
  return withTransaction(async (client) => {
    const offset = (page - 1) * pageSize;
    const countResult = await client.query(
      `select count(*)::int as total
       from cards c
       where c.deleted_at is null
         and ($1::text is null or c.status = $1)
         and ($2::uuid is null or c.shop_id = $2)`,
      [status || null, shopId || null]
    );

    const result = await client.query(
      `select c.id, c.public_token, c.status, c.shop_id, c.vehicle_id,
              c.generated_at, c.assigned_at, c.activated_at,
              s.name as shop_name
       from cards c
       left join shops s on s.id = c.shop_id
       where c.deleted_at is null
         and ($1::text is null or c.status = $1)
         and ($2::uuid is null or c.shop_id = $2)
       order by c.generated_at desc
       limit $3 offset $4`,
      [status || null, shopId || null, pageSize, offset]
    );

    return {
      items: result.rows.map((card) => ({
        ...card,
        public_url: `${env.publicCardBaseUrl}/${card.public_token}`
      })),
      total: countResult.rows[0].total,
      page,
      page_size: pageSize
    };
  });
}

export async function activateCard({
  token,
  shopId,
  otpCode,
  customer,
  vehicle,
  service,
  actorUserId,
  skipOtp = false
}) {
  return withTransaction(async (client) => {
    if (!skipOtp) {
      await validateOtp(client, shopId, otpCode);
    }

    const shopResult = await client.query(
      `select id, credit_balance
       from shops
       where id = $1 and status = 'active' and deleted_at is null
       for update`,
      [shopId]
    );
    const shop = shopResult.rows[0];
    if (!shop) {
      throw forbidden('Shop is not active');
    }
    if (shop.credit_balance < env.serviceCreditCost) {
      throw badRequest('Shop credit is not enough');
    }

    const cardResult = await client.query(
      `select * from cards where public_token = $1 and deleted_at is null for update`,
      [token]
    );
    const card = cardResult.rows[0];
    if (!card) {
      throw notFound('Card not found');
    }
    if (card.shop_id && card.shop_id !== shopId) {
      throw forbidden('Card is already owned by another shop');
    }
    if (!['assigned', 'raw'].includes(card.status)) {
      throw badRequest('Card is not available for activation');
    }

    const customerResult = await client.query(
      `insert into customers(name, mobile)
       values($1, $2)
       returning *`,
      [customer.name || null, customer.mobile || null]
    );

    const vehicleResult = await client.query(
      `insert into vehicles(customer_id, type, plate, color, description)
       values($1, $2, $3, $4, $5)
       returning *`,
      [
        customerResult.rows[0].id,
        vehicle.type,
        vehicle.plate || null,
        vehicle.color || null,
        vehicle.description || null
      ]
    );

    await client.query(
      `update cards
       set status = 'active',
           shop_id = $1,
           vehicle_id = $2,
           assigned_at = coalesce(assigned_at, now()),
           activated_at = now(),
           updated_at = now()
       where id = $3`,
      [shopId, vehicleResult.rows[0].id, card.id]
    );

    await client.query(
      `update shops
       set credit_balance = credit_balance - $1,
           updated_at = now()
       where id = $2`,
      [env.serviceCreditCost, shopId]
    );
    const serviceRow = await insertService(client, {
      ...service,
      vehicleId: vehicleResult.rows[0].id,
      cardId: card.id,
      shopId,
      consumeCredit: false
    });

    await client.query(
      `insert into credit_transactions(shop_id, type, amount, description, service_id)
       values($1, 'consume', $2, $3, $4)`,
      [shopId, -env.serviceCreditCost, 'Card activation credit consumption', serviceRow.id]
    );

    await writeAudit(client, actorUserId, 'cards.activate', 'card', card.id, {
      customerId: customerResult.rows[0].id,
      vehicleId: vehicleResult.rows[0].id,
      serviceId: serviceRow.id
    });

    return {
      card: { ...card, status: 'active', shop_id: shopId, vehicle_id: vehicleResult.rows[0].id },
      customer: customerResult.rows[0],
      vehicle: vehicleResult.rows[0],
      service: serviceRow
    };
  });
}

export async function registerService({
  token,
  shopId,
  otpCode,
  service,
  actorUserId,
  skipOtp = false
}) {
  return withTransaction(async (client) => {
    if (!skipOtp) {
      await validateOtp(client, shopId, otpCode);
    }

    const cardResult = await client.query(
      `select * from cards where public_token = $1 and status = 'active' and deleted_at is null for update`,
      [token]
    );
    const card = cardResult.rows[0];
    if (!card) {
      throw notFound('Active card not found');
    }
    const shopResult = await client.query(
      `select id, credit_balance from shops where id = $1 and status = 'active' for update`,
      [shopId]
    );
    const shop = shopResult.rows[0];
    if (!shop || shop.credit_balance < env.serviceCreditCost) {
      throw badRequest('Shop credit is not enough');
    }

    const serviceRow = await insertService(client, {
      ...service,
      vehicleId: card.vehicle_id,
      cardId: card.id,
      shopId,
      consumeCredit: true
    });

    await client.query(
      `update shops set credit_balance = credit_balance - $1, updated_at = now() where id = $2`,
      [env.serviceCreditCost, shopId]
    );
    await client.query(
      `insert into credit_transactions(shop_id, type, amount, description, service_id)
       values($1, 'consume', $2, $3, $4)`,
      [shopId, -env.serviceCreditCost, 'Service registration credit consumption', serviceRow.id]
    );

    await writeAudit(client, actorUserId, 'services.create', 'service', serviceRow.id, { cardId: card.id });
    return serviceRow;
  });
}

export async function updateLatestService({ token, shopId, service, actorUserId }) {
  return withTransaction(async (client) => {
    const cardResult = await client.query(
      `select id, vehicle_id
       from cards
       where public_token = $1
         and status = 'active'
         and deleted_at is null
       for update`,
      [token]
    );
    const card = cardResult.rows[0];
    if (!card) throw notFound('Active card not found');

    const latestResult = await client.query(
      `select id, shop_id
       from services
       where vehicle_id = $1 and deleted_at is null
       order by service_date desc, created_at desc
       limit 1
       for update`,
      [card.vehicle_id]
    );
    const latest = latestResult.rows[0];
    if (!latest) throw notFound('Service not found');
    if (latest.shop_id !== shopId) {
      throw forbidden('Only the shop that registered the latest service can update it');
    }

    const nextMileage = service.next_service_mileage ?? (
      service.oil_life_km
        ? Number(service.current_mileage) + Number(service.oil_life_km)
        : null
    );
    const result = await client.query(
      `update services
       set service_date = $1,
           current_mileage = $2,
           oil_type = $3,
           oil_life_km = $4,
           next_service_mileage = $5,
           next_service_date = $6,
           replaced_filters = $7,
           description = $8
       where id = $9
       returning *`,
      [
        service.service_date,
        service.current_mileage,
        service.oil_type || null,
        service.oil_life_km || null,
        nextMileage,
        service.next_service_date || null,
        service.replaced_filters || [],
        service.description || null,
        latest.id
      ]
    );
    await writeAudit(client, actorUserId, 'services.update', 'service', latest.id, {
      cardId: card.id
    });
    return result.rows[0];
  });
}

async function insertService(client, data) {
  const nextMileage = data.next_service_mileage ?? (
    data.oil_life_km ? Number(data.current_mileage) + Number(data.oil_life_km) : null
  );

  const result = await client.query(
    `insert into services(
       vehicle_id, card_id, shop_id, service_date, current_mileage, oil_type,
       oil_life_km, next_service_mileage, next_service_date, replaced_filters, description
     )
     values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning *`,
    [
      data.vehicleId,
      data.cardId,
      data.shopId,
      data.service_date,
      data.current_mileage,
      data.oil_type || null,
      data.oil_life_km || null,
      nextMileage,
      data.next_service_date || null,
      data.replaced_filters || [],
      data.description || null
    ]
  );

  return result.rows[0];
}
