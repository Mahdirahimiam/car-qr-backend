import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { forbidden } from '../utils/errors.js';

export async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const [, token] = header.match(/^Bearer (.+)$/) || [];
    if (!token) {
      throw forbidden('Authentication token is required');
    }

    const payload = jwt.verify(token, env.jwtSecret);
    if (payload.session_type === 'service_write') {
      throw forbidden('This session cannot access the shop panel');
    }
    const result = await query(
      `select u.id, u.role, u.name, u.mobile, u.status, s.id as shop_id
       from users u
       left join shops s on s.owner_user_id = u.id
       where u.id = $1 and u.deleted_at is null`,
      [payload.sub]
    );

    const user = result.rows[0];
    if (!user || user.status !== 'active') {
      throw forbidden('User is inactive or not found');
    }

    req.user = user;
    next();
  } catch (error) {
    next(error.status ? error : forbidden('Invalid or expired token'));
  }
}

export async function authenticateServiceAccess(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const [, token] = header.match(/^Bearer (.+)$/) || [];
    if (!token) {
      throw forbidden('Authentication token is required');
    }

    const payload = jwt.verify(token, env.jwtSecret);
    if (payload.role !== 'shop') {
      throw forbidden('Shop access is required');
    }

    const result = await query(
      `select u.id, u.role, u.name, u.mobile, u.status, s.id as shop_id
       from users u
       join shops s on s.owner_user_id = u.id
       where u.id = $1
         and u.deleted_at is null
         and s.deleted_at is null
         and s.status = 'active'`,
      [payload.sub]
    );
    const user = result.rows[0];
    if (!user || user.status !== 'active') {
      throw forbidden('Shop is inactive or not found');
    }

    req.user = user;
    req.auth = {
      sessionType: payload.session_type || 'full',
      serviceOnly: payload.session_type === 'service_write'
    };
    next();
  } catch (error) {
    next(error.status ? error : forbidden('Invalid or expired token'));
  }
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(forbidden('Insufficient permissions'));
    }
    next();
  };
}
