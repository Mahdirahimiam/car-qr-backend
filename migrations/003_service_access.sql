alter table shops
  add column if not exists service_password_hash text;

create table if not exists login_otps (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id),
  code text not null,
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'used', 'expired', 'revoked')),
  created_at timestamptz not null default now()
);

create index if not exists idx_login_otps_shop_active
  on login_otps(shop_id, status, expires_at desc);
