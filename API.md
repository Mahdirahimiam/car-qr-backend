# Smart Oil Change Backend API

## Setup

1. Copy `.env.example` to `.env` and set `DATABASE_URL` and `JWT_SECRET`.
2. Install packages with `npm install`.
3. Run migrations with `npm run migrate`.
4. Seed the first admin with `npm run seed`.
5. Start the API with `npm run dev` or `npm start`.

## Main Endpoints

### Auth

- `POST /auth/login`
- `POST /auth/shop-otp/request`
- `POST /auth/shop-otp/verify`
- `POST /auth/service-login`
- `POST /auth/shops/register`

### Admin

All admin endpoints require `Authorization: Bearer <token>`.

- `GET /admin/dashboard`
- `GET /admin/shops`
- `POST /admin/shops`
- `PATCH /admin/shops/:id/status`
- `POST /admin/shops/:id/credit`
- `POST /admin/shops/:id/card-quota`
- `POST /admin/shops/:id/service-credentials`
- `POST /admin/cards/generate`
- `GET /admin/cards`

### Shop

All shop endpoints require `Authorization: Bearer <token>`.

- `GET /shop/me`
- `POST /shop/otp`
- `GET /shop/cards`
- `POST /shop/cards/:token/activate`
- `POST /shop/cards/:token/services`
- `GET /shop/customers`

### Public

- `GET /public/cards/:token`

The public response contains only `latest_service`. Full service history is not
returned to QR visitors.

### Service Registration

These endpoints accept either a full shop token or a 24-hour
`service_write` token:

- `GET /service/cards/:token`
- `POST /service/cards/:token/activate`
- `POST /service/cards/:token/services`
- `PATCH /service/cards/:token/services/latest`

A `service_write` token cannot access `/shop` dashboard endpoints. Updating the
latest service is allowed only for the shop that created that service record.

## Request Examples

### Login

```json
{
  "mobile": "09120000000",
  "password": "admin123456"
}
```

### Request Shop Login OTP

```json
{
  "mobile": "09120000000"
}
```

### Verify Shop Login OTP

```json
{
  "mobile": "09120000000",
  "code": "123456"
}
```

The returned full shop session expires after 24 hours.

### Limited Service Login

```json
{
  "dedicated_code": "SHOP_12345",
  "password": "generated-password"
}
```

The returned session expires after 24 hours and can only read a scanned card
and activate, create, or update service information.

### Generate Limited Service Credentials

`POST /admin/shops/:id/service-credentials` returns:

```json
{
  "dedicated_code": "SHOP_12345",
  "password": "generated-password"
}
```

The plain password is returned only when it is generated or rotated.

### Generate Cards

```json
{
  "count": 10
}
```

### Grant Shop Card Quota

```json
{
  "amount": 10,
  "description": "Initial QR card quota"
}
```

Cards are no longer assigned to a shop before printing. Admin generates and prints raw QR cards. A shop receives a numeric quota, and each successful activation consumes one quota unit.

### Activate Card

```json
{
  "otp_code": "123456",
  "customer": {
    "name": "Customer name",
    "mobile": "09121111111"
  },
  "vehicle": {
    "type": "Peugeot 206",
    "plate": "12A345-67",
    "color": "white"
  },
  "service": {
    "service_date": "2026-05-17",
    "current_mileage": 85000,
    "oil_type": "10W-40",
    "oil_life_km": 5000,
    "replaced_filters": ["oil", "air"]
  }
}
```

### Register New Service

```json
{
  "otp_code": "123456",
  "service": {
    "service_date": "2026-05-17",
    "current_mileage": 90000,
    "oil_type": "10W-40",
    "oil_life_km": 5000,
    "next_service_date": "2026-11-17",
    "replaced_filters": ["oil"]
  }
}
```
