import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, forbidden } from '../utils/errors.js';
import { generateShopCode } from '../utils/crypto.js';
import { validate } from '../middleware/validate.js';
import { generateOtpCode } from '../utils/crypto.js';
import { queueSms } from '../services/smsService.js';

export const authRoutes = express.Router();

const loginSchema = z.object({
  body: z.object({
    mobile: z.string().min(5),
    password: z.string().min(6)
  })
});

const shopRegisterSchema = z.object({
  body: z.object({
    name: z.string().min(2),
    owner_name: z.string().min(2),
    mobile: z.string().min(5),
    password: z.string().min(6),
    phone: z.string().optional(),
    phone_secondary: z.string().optional(),
    address: z.string().optional(),
    postal_code: z.string().optional()
  })
});

authRoutes.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  const { mobile, password } = req.body;
  const result = await query(
    `select u.id, u.role, u.name, u.mobile, u.password_hash, u.status, s.id as shop_id
     from users u
     left join shops s on s.owner_user_id = u.id
     where u.mobile = $1 and u.deleted_at is null`,
    [mobile]
  );

  const user = result.rows[0];
  if (!user || !user.password_hash) {
    throw forbidden('Invalid mobile or password');
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok || user.status !== 'active') {
    throw forbidden('Invalid mobile or password');
  }

  const token = jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn
  });

  res.json({
    token,
    user: {
      id: user.id,
      role: user.role,
      name: user.name,
      mobile: user.mobile,
      shop_id: user.shop_id
    }
  });
}));

authRoutes.post('/shop-otp/request', validate(z.object({
  body: z.object({ mobile: z.string().min(5) })
})), asyncHandler(async (req, res) => {
  const result = await query(
    `select s.id, s.mobile
     from shops s
     join users u on u.id = s.owner_user_id
     where s.mobile = $1
       and s.status = 'active'
       and s.deleted_at is null
       and u.status = 'active'
       and u.deleted_at is null`,
    [req.body.mobile]
  );
  const shop = result.rows[0];
  if (!shop) throw forbidden('Active shop was not found for this mobile');

  await query(
    `update login_otps set status = 'revoked'
     where shop_id = $1 and status = 'active'`,
    [shop.id]
  );
  const code = generateOtpCode();
  const otp = await query(
    `insert into login_otps(shop_id, code, expires_at)
     values($1, $2, now() + ($3::text || ' minutes')::interval)
     returning id, expires_at`,
    [shop.id, code, env.loginOtpTtlMinutes]
  );
  await queueSms({
    recipient: shop.mobile,
    type: 'login_otp',
    body: `کد ورود شما: ${code}`
  });

  res.status(201).json({
    id: otp.rows[0].id,
    expires_at: otp.rows[0].expires_at,
    ...(env.nodeEnv !== 'production' ? { debug_code: code } : {})
  });
}));

authRoutes.post('/shop-otp/verify', validate(z.object({
  body: z.object({
    mobile: z.string().min(5),
    code: z.string().min(4)
  })
})), asyncHandler(async (req, res) => {
  const result = await query(
    `select lo.id as otp_id, lo.expires_at, s.id as shop_id,
            u.id, u.role, u.name, u.mobile, u.status
     from login_otps lo
     join shops s on s.id = lo.shop_id
     join users u on u.id = s.owner_user_id
     where s.mobile = $1
       and lo.code = $2
       and lo.status = 'active'
       and s.status = 'active'
       and s.deleted_at is null
       and u.status = 'active'
       and u.deleted_at is null
     order by lo.created_at desc
     limit 1`,
    [req.body.mobile, req.body.code]
  );
  const user = result.rows[0];
  if (!user || new Date(user.expires_at) < new Date()) {
    if (user) {
      await query(`update login_otps set status = 'expired' where id = $1`, [user.otp_id]);
    }
    throw forbidden('OTP is invalid or expired');
  }

  await query(`update login_otps set status = 'used' where id = $1`, [user.otp_id]);
  const token = jwt.sign(
    { sub: user.id, role: 'shop', session_type: 'full' },
    env.jwtSecret,
    { expiresIn: env.serviceSessionExpiresIn }
  );
  res.json({
    token,
    expires_in_hours: 24,
    user: {
      id: user.id,
      role: 'shop',
      name: user.name,
      mobile: user.mobile,
      shop_id: user.shop_id,
      access: 'full'
    }
  });
}));

authRoutes.post('/service-login', validate(z.object({
  body: z.object({
    dedicated_code: z.string().min(4),
    password: z.string().min(6)
  })
})), asyncHandler(async (req, res) => {
  const result = await query(
    `select s.id as shop_id, s.service_password_hash,
            u.id, u.name, u.mobile
     from shops s
     join users u on u.id = s.owner_user_id
     where upper(s.dedicated_code) = upper($1)
       and s.status = 'active'
       and s.deleted_at is null
       and u.status = 'active'
       and u.deleted_at is null`,
    [req.body.dedicated_code]
  );
  const user = result.rows[0];
  if (!user?.service_password_hash) {
    throw forbidden('Invalid service code or password');
  }
  const ok = await bcrypt.compare(req.body.password, user.service_password_hash);
  if (!ok) throw forbidden('Invalid service code or password');

  const token = jwt.sign(
    { sub: user.id, role: 'shop', session_type: 'service_write' },
    env.jwtSecret,
    { expiresIn: env.serviceSessionExpiresIn }
  );
  res.json({
    token,
    expires_in_hours: 24,
    user: {
      id: user.id,
      role: 'shop',
      name: user.name,
      mobile: user.mobile,
      shop_id: user.shop_id,
      access: 'service_write'
    }
  });
}));

authRoutes.post('/shops/register', validate(shopRegisterSchema), asyncHandler(async (req, res) => {
  const data = req.body;
  const exists = await query(`select 1 from users where mobile = $1`, [data.mobile]);
  if (exists.rowCount) {
    throw badRequest('Mobile already exists');
  }

  const passwordHash = await bcrypt.hash(data.password, 12);
  const userResult = await query(
    `insert into users(role, name, mobile, password_hash, status)
     values('shop', $1, $2, $3, 'active')
     returning id, role, name, mobile, status`,
    [data.owner_name, data.mobile, passwordHash]
  );

  const shopResult = await query(
    `insert into shops(owner_user_id, name, owner_name, mobile, phone, phone_secondary, address, postal_code, dedicated_code, status)
     values($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
     returning *`,
    [
      userResult.rows[0].id,
      data.name,
      data.owner_name,
      data.mobile,
      data.phone || null,
      data.phone_secondary || null,
      data.address || null,
      data.postal_code || null,
      generateShopCode()
    ]
  );

  const token = jwt.sign(
    { sub: userResult.rows[0].id, role: 'shop', session_type: 'full' },
    env.jwtSecret,
    { expiresIn: env.serviceSessionExpiresIn }
  );

  res.status(201).json({
    token,
    expires_in_hours: 24,
    user: {
      ...userResult.rows[0],
      shop_id: shopResult.rows[0].id,
      access: 'full'
    },
    shop: shopResult.rows[0]
  });
}));
