update shops
set phone = null,
    updated_at = now()
where nullif(btrim(phone), '') = nullif(btrim(mobile), '');

update shops
set phone_secondary = null,
    updated_at = now()
where nullif(btrim(phone_secondary), '') = nullif(btrim(mobile), '');
