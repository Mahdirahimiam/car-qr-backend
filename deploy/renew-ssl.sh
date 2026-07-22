#!/bin/sh
set -eu

cd /opt/apps/mysite/backend
docker compose --profile tools run --rm certbot renew --webroot --webroot-path /var/www/certbot --quiet
docker compose exec -T nginx nginx -t
docker compose exec -T nginx nginx -s reload
