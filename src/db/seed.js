import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { pool } from './pool.js';

async function seed() {
  const passwordHash = await bcrypt.hash(env.adminPassword, 12);
  await pool.query(
    `insert into users(role, name, mobile, password_hash, status)
     values('admin', $1, $2, $3, 'active')
     on conflict (mobile) do update
       set role = 'admin',
           name = excluded.name,
           password_hash = excluded.password_hash,
           status = 'active',
           updated_at = now()`,
    [env.adminName, env.adminMobile, passwordHash]
  );

  console.log(`Admin user is ready: ${env.adminMobile}`);
}

seed()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error);
    pool.end().finally(() => process.exit(1));
  });
