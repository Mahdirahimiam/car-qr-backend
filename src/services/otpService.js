import { env } from '../config/env.js';
import { query } from '../db/pool.js';
import { badRequest, forbidden } from '../utils/errors.js';
import { generateOtpCode } from '../utils/crypto.js';
import { queueSms } from './smsService.js';

export async function requestOtp(shopId) {
  const shopResult = await query(
    `select id, mobile, status from shops where id = $1 and deleted_at is null`,
    [shopId]
  );
  const shop = shopResult.rows[0];
  if (!shop || shop.status !== 'active') {
    throw forbidden('Shop is not active');
  }

  await query(`update otps set status = 'revoked' where shop_id = $1 and status = 'active'`, [shopId]);

  const code = generateOtpCode();
  const result = await query(
    `insert into otps(shop_id, code, max_uses, expires_at)
     values($1, $2, $3, now() + ($4::text || ' minutes')::interval)
     returning id, code, max_uses, used_count, expires_at, status, created_at`,
    [shopId, code, env.otpMaxUses, env.otpTtlMinutes]
  );

  await queueSms({
    recipient: shop.mobile,
    type: 'otp',
    body: `کد تایید شما: ${code}`
  });

  return result.rows[0];
}

export async function validateOtp(client, shopId, code) {
  const result = await client.query(
    `select * from otps
     where shop_id = $1 and code = $2 and status = 'active'
     order by created_at desc
     limit 1
     for update`,
    [shopId, code]
  );

  const otp = result.rows[0];
  if (!otp) {
    throw badRequest('OTP is invalid');
  }
  if (new Date(otp.expires_at) < new Date()) {
    await client.query(`update otps set status = 'expired' where id = $1`, [otp.id]);
    throw badRequest('OTP has expired');
  }
  if (otp.used_count >= otp.max_uses) {
    await client.query(`update otps set status = 'expired' where id = $1`, [otp.id]);
    throw badRequest('OTP usage limit is reached');
  }

  await client.query(
    `update otps
     set used_count = used_count + 1,
         status = case when used_count + 1 >= max_uses then 'expired' else status end
     where id = $1`,
    [otp.id]
  );
}
