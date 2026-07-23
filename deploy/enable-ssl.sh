#!/bin/sh
set -eu

DOMAIN=carqrcode.ir
EXPECTED_IP=109.122.247.98
COMPOSE_DIR=/opt/apps/mysite/backend

RESOLVED_IPS=$(getent ahostsv4 "$DOMAIN" | awk '{print $1}' | sort -u || true)
if ! printf '%s\n' "$RESOLVED_IPS" | grep -Fxq "$EXPECTED_IP"; then
  echo "DNS is not ready: $DOMAIN must have an A record pointing to $EXPECTED_IP." >&2
  exit 1
fi

cd "$COMPOSE_DIR"
docker compose --profile tools run --rm certbot certonly \
  --webroot --webroot-path /var/www/certbot \
  --domain "$DOMAIN" \
  --email support@carqrcode.ir \
  --agree-tos --no-eff-email --non-interactive

mv deploy/nginx/conf.d/default.conf deploy/nginx/conf.d/default-http.conf.disabled
mv deploy/nginx/conf.d/default-ssl.conf.disabled deploy/nginx/conf.d/default.conf
docker compose exec -T nginx nginx -t
docker compose exec -T nginx nginx -s reload

install -m 0755 deploy/renew-ssl.sh /usr/local/sbin/carqrcode-renew-ssl
printf '%s\n' '17 3,15 * * * root /usr/local/sbin/carqrcode-renew-ssl >> /var/log/carqrcode-certbot.log 2>&1' > /etc/cron.d/carqrcode-certbot
chmod 0644 /etc/cron.d/carqrcode-certbot

echo "HTTPS is enabled for https://$DOMAIN"
