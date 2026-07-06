import { query } from '../db/pool.js';

export async function queueSms({ recipient, type, body }) {
  const result = await query(
    `insert into sms_messages(recipient, type, body, status)
     values($1, $2, $3, 'queued')
     returning *`,
    [recipient, type, body]
  );

  return result.rows[0];
}
