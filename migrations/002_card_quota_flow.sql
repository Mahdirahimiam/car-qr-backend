alter table shops
  add column if not exists card_quota_balance integer not null default 0 check (card_quota_balance >= 0);

create table if not exists card_quota_transactions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id),
  type text not null check (type in ('grant', 'consume', 'manual_adjustment', 'refund')),
  amount integer not null,
  description text,
  card_id uuid references cards(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_card_quota_transactions_shop
  on card_quota_transactions(shop_id, created_at desc);
