import pg from 'pg';
import { env } from '../config/env.js';

function databaseConnectionString(databaseUrl) {
  const usesRequiredSsl = /[?&]sslmode=require(?:&|$)/i.test(databaseUrl);
  const hasLibpqCompatibility = /[?&]uselibpqcompat=/i.test(databaseUrl);

  if (!usesRequiredSsl || hasLibpqCompatibility) {
    return databaseUrl;
  }

  const separator = databaseUrl.includes('?') ? '&' : '?';
  return `${databaseUrl}${separator}uselibpqcompat=true`;
}

export const pool = new pg.Pool({
  // Managed databases may use a self-signed CA. With libpq-compatible
  // sslmode=require semantics, the connection stays encrypted without
  // requiring that CA to exist in the container trust store.
  connectionString: databaseConnectionString(env.databaseUrl)
});

export async function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
