import express from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, forbidden } from '../utils/errors.js';
import { query } from '../db/pool.js';
import { activateCard, registerService } from '../services/cardService.js';
import { requestOtp } from '../services/otpService.js';
import { normalizeIranianMobile } from '../utils/mobile.js';

export const shopRoutes = express.Router();

shopRoutes.use(authenticate, requireRole('shop'));

function ownShopId(req) {
  if (!req.user.shop_id) {
    throw forbidden('Shop profile is missing');
  }
  return req.user.shop_id;
}

const serviceSchema = z.object({
  service_date: z.string().date(),
  current_mileage: z.number().int().min(0),
  oil_type: z.string().optional(),
  oil_life_km: z.number().int().min(0).optional(),
  next_service_mileage: z.number().int().min(0).optional(),
  next_service_date: z.string().date().optional(),
  replaced_filters: z.array(z.string()).default([]),
  description: z.string().optional()
});

const updateShopSchema = z.object({
  body: z.object({
    name: z.string().min(2).optional(),
    owner_name: z.string().min(2).optional(),
    otp_mobile: z.string().min(5).optional(),
    phone: z.string().optional().nullable(),
    phone_secondary: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    postal_code: z.string().optional().nullable(),
    logo_url: z.string().optional().nullable(),
    promotional_text: z.string().optional().nullable()
  })
});

shopRoutes.get('/me', asyncHandler(async (req, res) => {
  const result = await query(
    `select id, owner_user_id, name, owner_name, mobile, otp_mobile, phone, phone_secondary, address,
            postal_code, dedicated_code, logo_url, promotional_text,
            credit_balance, card_quota_balance, status, created_at, updated_at
     from shops where id = $1 and deleted_at is null`,
    [ownShopId(req)]
  );
  res.json(result.rows[0]);
}));

shopRoutes.patch('/me', validate(updateShopSchema), asyncHandler(async (req, res) => {
  const currentResult = await query(
    `select s.*, u.id as user_id
     from shops s
     join users u on u.id = s.owner_user_id
     where s.id = $1 and s.deleted_at is null`,
    [ownShopId(req)]
  );
  const current = currentResult.rows[0];
  if (!current) {
    throw forbidden('Shop profile is missing');
  }

  let otpMobile = current.otp_mobile;
  if (req.body.otp_mobile !== undefined) {
    otpMobile = normalizeIranianMobile(req.body.otp_mobile);
    if (!otpMobile) throw badRequest('Invalid OTP mobile number');

    const duplicate = await query(
      `select 1 from shops
       where otp_mobile = $1 and id <> $2 and deleted_at is null`,
      [otpMobile, current.id]
    );
    if (duplicate.rowCount) throw badRequest('OTP mobile already exists');
  }

  const next = {
    name: req.body.name ?? current.name,
    owner_name: req.body.owner_name ?? current.owner_name,
    otp_mobile: otpMobile,
    phone: req.body.phone === undefined ? current.phone : req.body.phone,
    phone_secondary: req.body.phone_secondary === undefined
      ? current.phone_secondary
      : req.body.phone_secondary,
    address: req.body.address ?? current.address,
    postal_code: req.body.postal_code ?? current.postal_code,
    logo_url: req.body.logo_url ?? current.logo_url,
    promotional_text: req.body.promotional_text ?? current.promotional_text
  };

  const result = await query(
    `update shops
     set name = $1,
         owner_name = $2,
         otp_mobile = $3,
         phone = $4,
         phone_secondary = $5,
         address = $6,
         postal_code = $7,
         logo_url = $8,
         promotional_text = $9,
         updated_at = now()
     where id = $10
     returning id, owner_user_id, name, owner_name, mobile, otp_mobile, phone, phone_secondary, address,
               postal_code, dedicated_code, logo_url, promotional_text,
               credit_balance, card_quota_balance, status, created_at, updated_at`,
    [
      next.name,
      next.owner_name,
      next.otp_mobile,
      next.phone,
      next.phone_secondary,
      next.address,
      next.postal_code,
      next.logo_url,
      next.promotional_text,
      ownShopId(req)
    ]
  );

  await query(
    `update users set name = $1, updated_at = now() where id = $2`,
    [next.owner_name, current.user_id]
  );

  res.json(result.rows[0]);
}));

shopRoutes.post('/otp', asyncHandler(async (req, res) => {
  const otp = await requestOtp(ownShopId(req));
  res.status(201).json(otp);
}));

shopRoutes.get('/cards', asyncHandler(async (req, res) => {
  const result = await query(
    `select id, public_token, status, vehicle_id, generated_at, assigned_at, activated_at
     from cards
     where shop_id = $1 and deleted_at is null
     order by generated_at desc`,
    [ownShopId(req)]
  );
  res.json(result.rows);
}));

shopRoutes.post('/cards/:token/activate', validate(z.object({
  params: z.object({ token: z.string().min(10) }),
  body: z.object({
    otp_code: z.string().min(4),
    customer: z.object({
      name: z.string().optional(),
      mobile: z.string().optional()
    }),
    vehicle: z.object({
      type: z.string().min(1),
      plate: z.string().optional(),
      color: z.string().optional(),
      description: z.string().optional()
    }),
    service: serviceSchema
  })
})), asyncHandler(async (req, res) => {
  const result = await activateCard({
    token: req.params.token,
    shopId: ownShopId(req),
    otpCode: req.body.otp_code,
    customer: req.body.customer,
    vehicle: req.body.vehicle,
    service: req.body.service,
    actorUserId: req.user.id
  });
  res.status(201).json(result);
}));

shopRoutes.post('/cards/:token/services', validate(z.object({
  params: z.object({ token: z.string().min(10) }),
  body: z.object({
    otp_code: z.string().min(4),
    service: serviceSchema
  })
})), asyncHandler(async (req, res) => {
  const service = await registerService({
    token: req.params.token,
    shopId: ownShopId(req),
    otpCode: req.body.otp_code,
    service: req.body.service,
    actorUserId: req.user.id
  });
  res.status(201).json(service);
}));

shopRoutes.get('/customers', asyncHandler(async (req, res) => {
  const result = await query(
    `select cu.id, cu.name, cu.mobile, v.id as vehicle_id, v.type as vehicle_type,
            v.plate,
            (array_agg(c.public_token order by se.service_date desc, se.created_at desc))[1] as public_token,
            max(se.service_date) as last_service_date
     from services se
     join vehicles v on v.id = se.vehicle_id and v.deleted_at is null
     join customers cu on cu.id = v.customer_id
     join cards c on c.id = se.card_id and c.deleted_at is null
     where se.shop_id = $1
       and se.deleted_at is null
       and cu.deleted_at is null
     group by cu.id, v.id
     order by max(se.created_at) desc`,
    [ownShopId(req)]
  );
  res.json(result.rows);
}));
