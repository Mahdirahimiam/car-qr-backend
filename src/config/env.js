import dotenv from 'dotenv';

dotenv.config();

const required = ['DATABASE_URL', 'JWT_SECRET'];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

function publicCardBaseUrl() {
  const configuredBaseUrl = process.env.PUBLIC_CARD_BASE_URL || 'https://car-qr-backend.runsite.app/';
  const shouldUseProductionDefault = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(configuredBaseUrl);
  const baseUrl = (shouldUseProductionDefault
    ? 'https://car-qr-backend.runsite.app/'
    : configuredBaseUrl
  ).replace(/\/$/, '');
  return baseUrl.endsWith('/public/cards') ? baseUrl : `${baseUrl}/public/cards`;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  publicCardBaseUrl: publicCardBaseUrl(),
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES || 1440),
  otpMaxUses: Number(process.env.OTP_MAX_USES || 10),
  loginOtpTtlMinutes: Number(process.env.LOGIN_OTP_TTL_MINUTES || 10),
  serviceSessionExpiresIn: process.env.SERVICE_SESSION_EXPIRES_IN || '24h',
  serviceCreditCost: Number(process.env.SERVICE_CREDIT_COST || 1),
  adminName: process.env.ADMIN_NAME || 'System Admin',
  adminMobile: process.env.ADMIN_MOBILE || '09120000000',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123456'
};
