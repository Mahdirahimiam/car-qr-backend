import express from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { forbidden } from '../utils/errors.js';
import { query } from '../db/pool.js';
import { activateCard, registerService } from '../services/cardService.js';
import { requestOtp } from '../services/otpService.js';

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

shopRoutes.get('/me', asyncHandler(async (req, res) => {
  const result = await query(
    `select id, owner_user_id, name, owner_name, mobile, phone, address,
            postal_code, dedicated_code, logo_url, promotional_text,
            credit_balance, card_quota_balance, status, created_at, updated_at
     from shops where id = $1 and deleted_at is null`,
    [ownShopId(req)]
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
            v.plate, c.public_token, max(se.service_date) as last_service_date
     from cards c
     join vehicles v on v.id = c.vehicle_id
     join customers cu on cu.id = v.customer_id
     left join services se on se.vehicle_id = v.id and se.deleted_at is null
     where c.shop_id = $1 and c.deleted_at is null
     group by cu.id, v.id, c.public_token
     order by max(se.created_at) desc nulls last`,
    [ownShopId(req)]
  );
  res.json(result.rows);
}));
