alter table shops
  add column if not exists otp_mobile text;

with raw_candidates as (
  select id,
         regexp_replace(translate(coalesce(phone, ''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), '[^0-9]', '', 'g') as phone_digits,
         regexp_replace(translate(coalesce(phone_secondary, ''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), '[^0-9]', '', 'g') as secondary_digits,
         regexp_replace(translate(coalesce(mobile, ''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), '[^0-9]', '', 'g') as username_digits
  from shops
  where deleted_at is null and otp_mobile is null
), normalized_candidates as (
  select id,
         coalesce(
           case
             when phone_digits ~ '^09[0-9]{9}$' then phone_digits
             when phone_digits ~ '^9[0-9]{9}$' then '0' || phone_digits
             when phone_digits ~ '^989[0-9]{9}$' then '0' || substring(phone_digits from 3)
             when phone_digits ~ '^00989[0-9]{9}$' then '0' || substring(phone_digits from 5)
           end,
           case
             when secondary_digits ~ '^09[0-9]{9}$' then secondary_digits
             when secondary_digits ~ '^9[0-9]{9}$' then '0' || secondary_digits
             when secondary_digits ~ '^989[0-9]{9}$' then '0' || substring(secondary_digits from 3)
             when secondary_digits ~ '^00989[0-9]{9}$' then '0' || substring(secondary_digits from 5)
           end,
           case
             when username_digits ~ '^09[0-9]{9}$' then username_digits
             when username_digits ~ '^9[0-9]{9}$' then '0' || username_digits
             when username_digits ~ '^989[0-9]{9}$' then '0' || substring(username_digits from 3)
             when username_digits ~ '^00989[0-9]{9}$' then '0' || substring(username_digits from 5)
           end
         ) as otp_mobile
  from raw_candidates
), unique_candidates as (
  select otp_mobile
  from normalized_candidates
  where otp_mobile is not null
  group by otp_mobile
  having count(*) = 1
)
update shops s
set otp_mobile = candidate.otp_mobile,
    updated_at = now()
from normalized_candidates candidate
join unique_candidates unique_candidate on unique_candidate.otp_mobile = candidate.otp_mobile
where s.id = candidate.id;

create unique index if not exists shops_active_otp_mobile_unique
  on shops(otp_mobile)
  where otp_mobile is not null and deleted_at is null;
