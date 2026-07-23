create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('admin', 'shop', 'customer')),
  name text not null,
  mobile text not null unique,
  password_hash text,
  status text not null default 'active' check (status in ('pending', 'active', 'inactive', 'rejected', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists shops (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references users(id),
  name text not null,
  owner_name text not null,
  mobile text not null,
  phone text,
  address text,
  postal_code text,
  dedicated_code text not null unique,
  logo_url text,
  promotional_text text,
  service_password_hash text,
  credit_balance integer not null default 0 check (credit_balance >= 0),
  card_quota_balance integer not null default 0 check (card_quota_balance >= 0),
  status text not null default 'pending' check (status in ('pending', 'active', 'inactive', 'rejected', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text,
  mobile text,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id),
  type text not null,
  plate text,
  color text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists cards (
  id uuid primary key default gen_random_uuid(),
  public_token text not null unique,
  status text not null default 'raw' check (status in ('raw', 'assigned', 'active', 'voided', 'lost', 'archived')),
  shop_id uuid references shops(id),
  vehicle_id uuid references vehicles(id),
  previous_card_id uuid references cards(id),
  generated_at timestamptz not null default now(),
  assigned_at timestamptz,
  activated_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id),
  card_id uuid not null references cards(id),
  shop_id uuid not null references shops(id),
  service_date date not null,
  current_mileage integer not null check (current_mileage >= 0),
  oil_type text,
  oil_life_km integer check (oil_life_km is null or oil_life_km >= 0),
  next_service_mileage integer check (next_service_mileage is null or next_service_mileage >= 0),
  next_service_date date,
  replaced_filters text[] not null default '{}',
  description text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists otps (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id),
  code text not null,
  max_uses integer not null default 10,
  used_count integer not null default 0,
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  created_at timestamptz not null default now()
);

create table if not exists login_otps (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id),
  code text not null,
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'used', 'expired', 'revoked')),
  created_at timestamptz not null default now()
);

create table if not exists credit_transactions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id),
  type text not null check (type in ('charge', 'consume', 'manual_adjustment', 'refund')),
  amount integer not null,
  description text,
  service_id uuid references services(id),
  payment_status text not null default 'confirmed' check (payment_status in ('pending', 'confirmed', 'failed')),
  created_at timestamptz not null default now()
);

create table if not exists card_quota_transactions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id),
  type text not null check (type in ('grant', 'consume', 'manual_adjustment', 'refund')),
  amount integer not null,
  description text,
  card_id uuid references cards(id),
  created_at timestamptz not null default now()
);

create table if not exists sms_messages (
  id uuid primary key default gen_random_uuid(),
  recipient text not null,
  type text not null,
  body text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  provider_response jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id),
  title text not null,
  body text not null,
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  admin_response text,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create index if not exists idx_cards_shop_status on cards(shop_id, status);
create index if not exists idx_cards_vehicle on cards(vehicle_id);
create index if not exists idx_services_vehicle_created on services(vehicle_id, created_at desc);
create index if not exists idx_services_shop_created on services(shop_id, created_at desc);
create index if not exists idx_otps_shop_active on otps(shop_id, status, expires_at);
create index if not exists idx_login_otps_shop_active on login_otps(shop_id, status, expires_at desc);
create index if not exists idx_credit_transactions_shop on credit_transactions(shop_id, created_at desc);
create index if not exists idx_card_quota_transactions_shop on card_quota_transactions(shop_id, created_at desc);
