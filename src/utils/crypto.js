import crypto from 'crypto';

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function generateShopCode() {
  const suffix = crypto.randomInt(10000, 99999);
  return `SHOP_${suffix}`;
}

export function generateOtpCode(length = 6) {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return String(crypto.randomInt(min, max));
}

export function generateServicePassword() {
  return crypto.randomBytes(9).toString('base64url');
}
