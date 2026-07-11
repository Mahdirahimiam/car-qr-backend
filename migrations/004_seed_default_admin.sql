insert into users(role, name, mobile, password_hash, status, deleted_at)
values(
  'admin',
  'System Admin',
  '09045800415',
  '$2a$12$5WKPvL/nuf.ByGfFvE5dnu8KS4O7hdqvtjiU9uVGpi3ziVEAVjfiS',
  'active',
  null
)
on conflict (mobile) do update
  set role = 'admin',
      name = excluded.name,
      password_hash = excluded.password_hash,
      status = 'active',
      deleted_at = null,
      updated_at = now();
