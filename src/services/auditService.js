export async function writeAudit(client, actorUserId, action, entityType, entityId, metadata = {}) {
  await client.query(
    `insert into audit_logs(actor_user_id, action, entity_type, entity_id, metadata)
     values($1, $2, $3, $4, $5)`,
    [actorUserId || null, action, entityType, entityId || null, metadata]
  );
}
