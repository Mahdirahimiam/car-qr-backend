import express from 'express';
import { z } from 'zod';
import { authenticateServiceAccess } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { query } from '../db/pool.js';
import { activateCard, registerService, updateLatestService } from '../services/cardService.js';
import { getPublicCard } from '../services/publicService.js';

export const serviceRoutes = express.Router();

serviceRoutes.use(authenticateServiceAccess);

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

serviceRoutes.get('/cards/:token', validate(z.object({
  params: z.object({ token: z.string().min(10) })
})), asyncHandler(async (req, res) => {
  const [card, shopResult, optionsResult] = await Promise.all([
    getPublicCard(req.params.token),
    query(
      `select id, name, mobile, phone
       from shops where id = $1 and deleted_at is null`,
      [req.user.shop_id]
    ),
    query(
      `select distinct option
       from services s
       cross join lateral unnest(s.replaced_filters) as service_option(option)
       where s.shop_id = $1 and s.deleted_at is null and btrim(option) <> ''
       order by option`,
      [req.user.shop_id]
    )
  ]);
  res.json({
    ...card,
    current_shop: shopResult.rows[0] || null,
    service_options: optionsResult.rows.map((row) => row.option),
    access: {
      shop_id: req.user.shop_id,
      service_only: req.auth.serviceOnly,
      can_update_latest: card.latest_service?.shop_id === req.user.shop_id
    }
  });
}));

serviceRoutes.post('/cards/:token/activate', validate(z.object({
  params: z.object({ token: z.string().min(10) }),
  body: z.object({
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
    shopId: req.user.shop_id,
    customer: req.body.customer,
    vehicle: req.body.vehicle,
    service: req.body.service,
    actorUserId: req.user.id,
    skipOtp: true
  });
  res.status(201).json(result);
}));

serviceRoutes.post('/cards/:token/services', validate(z.object({
  params: z.object({ token: z.string().min(10) }),
  body: z.object({ service: serviceSchema })
})), asyncHandler(async (req, res) => {
  const service = await registerService({
    token: req.params.token,
    shopId: req.user.shop_id,
    service: req.body.service,
    actorUserId: req.user.id,
    skipOtp: true
  });
  res.status(201).json(service);
}));

serviceRoutes.patch('/cards/:token/services/latest', validate(z.object({
  params: z.object({ token: z.string().min(10) }),
  body: z.object({ service: serviceSchema })
})), asyncHandler(async (req, res) => {
  const service = await updateLatestService({
    token: req.params.token,
    shopId: req.user.shop_id,
    service: req.body.service,
    actorUserId: req.user.id
  });
  res.json(service);
}));
