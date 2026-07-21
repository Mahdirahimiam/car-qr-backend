import { query } from '../db/pool.js';
import { notFound } from '../utils/errors.js';

export async function getPublicCard(token) {
  const cardResult = await query(
    `select c.id, c.public_token, c.status, c.activated_at,
            s.name as shop_name, s.phone as shop_phone,
            s.phone_secondary as shop_phone_secondary,
            s.address as shop_address, s.logo_url, s.promotional_text,
            v.id as vehicle_id, v.type as vehicle_type, v.plate, v.color, v.description as vehicle_description,
            cu.name as customer_name
     from cards c
     left join shops s on s.id = c.shop_id
     left join vehicles v on v.id = c.vehicle_id
     left join customers cu on cu.id = v.customer_id
     where c.public_token = $1 and c.deleted_at is null`,
    [token]
  );

  const card = cardResult.rows[0];
  if (!card) {
    throw notFound('Card not found');
  }

  const services = card.vehicle_id
    ? (await query(
        `select se.id, se.shop_id, se.service_date, se.current_mileage,
                se.oil_type, se.oil_life_km, se.next_service_mileage,
                se.next_service_date, se.replaced_filters, se.description,
                se.created_at, s.name as shop_name,
                s.phone as shop_phone, s.phone_secondary as shop_phone_secondary,
                s.address as shop_address,
                s.logo_url, s.promotional_text
         from services se
         join shops s on s.id = se.shop_id
         where se.vehicle_id = $1 and se.deleted_at is null
         order by se.service_date desc, se.created_at desc
         limit 12`,
        [card.vehicle_id]
      )).rows
    : [];

  const latestService = services[0] || null;

  return {
    card: {
      token: card.public_token,
      status: card.status,
      activated_at: card.activated_at
    },
    shop: {
      name: latestService?.shop_name || card.shop_name,
      phone: latestService?.shop_phone || card.shop_phone,
      phone_secondary: latestService?.shop_phone_secondary || card.shop_phone_secondary,
      address: latestService?.shop_address || card.shop_address,
      logo_url: latestService?.logo_url || card.logo_url,
      promotional_text: latestService?.promotional_text || card.promotional_text
    },
    customer: {
      name: card.customer_name
    },
    vehicle: card.vehicle_id
      ? {
          type: card.vehicle_type,
          plate: card.plate,
          color: card.color,
          description: card.vehicle_description
        }
      : null,
    latest_service: latestService,
    services
  };
}
