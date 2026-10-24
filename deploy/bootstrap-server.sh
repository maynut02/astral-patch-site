#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID:-0} -ne 0 ]]; then
  echo "Run as root, e.g. sudo env ASTRAL_DOMAIN=... ASTRAL_CERTBOT_EMAIL=... bash $0" >&2
  exit 1
fi

: "${ASTRAL_DOMAIN:?ASTRAL_DOMAIN is required}"
: "${ASTRAL_CERTBOT_EMAIL:?ASTRAL_CERTBOT_EMAIL is required}"

ASTRAL_APP_PORT="${ASTRAL_APP_PORT:-3001}"
ASTRAL_APP_DIR="${ASTRAL_APP_DIR:-/home/ubuntu/astral-patch-site}"
ASTRAL_BACKUP_DIR="${ASTRAL_BACKUP_DIR:-/var/backups/astral-patch}"
ASTRAL_BACKUP_RETENTION_DAYS="${ASTRAL_BACKUP_RETENTION_DAYS:-14}"
ASTRAL_R2_BACKUP_ENABLED="${ASTRAL_R2_BACKUP_ENABLED:-false}"
ASTRAL_NGINX_SITE_NAME="${ASTRAL_NGINX_SITE_NAME:-astral-patch-site}"
ACME_ROOT="/var/www/astral-patch-site-acme"
NGINX_SITE_PATH="/etc/nginx/conf.d/${ASTRAL_NGINX_SITE_NAME}.conf"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

for command_name in nginx certbot curl docker install systemctl; do
  command -v "$command_name" >/dev/null || {
    echo "$command_name is required" >&2
    exit 1
  }
done

if ! [[ "$ASTRAL_APP_PORT" =~ ^[0-9]+$ ]] || (( ASTRAL_APP_PORT < 1 || ASTRAL_APP_PORT > 65535 )); then
  echo "ASTRAL_APP_PORT must be a valid TCP port" >&2
  exit 1
fi

if [[ "$ASTRAL_R2_BACKUP_ENABLED" != "true" && "$ASTRAL_R2_BACKUP_ENABLED" != "false" ]]; then
  echo "ASTRAL_R2_BACKUP_ENABLED must be true or false" >&2
  exit 1
fi

mkdir -p "$ACME_ROOT/.well-known/acme-challenge"
chmod 0755 "$ACME_ROOT" "$ACME_ROOT/.well-known" "$ACME_ROOT/.well-known/acme-challenge"

render_template() {
  local source_path="$1"
  local target_path="$2"
  sh "$SCRIPT_DIR/render-nginx-config.sh" "$source_path" "$ASTRAL_DOMAIN" "$ASTRAL_APP_PORT" > "$target_path"
  chmod 0644 "$target_path"
}

render_template "$SCRIPT_DIR/nginx/astral-patch-site-bootstrap.conf.template" "$NGINX_SITE_PATH"
nginx -t
systemctl reload nginx

certificate_path="/etc/letsencrypt/live/${ASTRAL_DOMAIN}/fullchain.pem"
key_path="/etc/letsencrypt/live/${ASTRAL_DOMAIN}/privkey.pem"

if [[ ! -s "$certificate_path" || ! -s "$key_path" ]]; then
  certbot certonly \
    --webroot \
    --webroot-path "$ACME_ROOT" \
    --non-interactive \
    --agree-tos \
    --email "$ASTRAL_CERTBOT_EMAIL" \
    --keep-until-expiring \
    --domain "$ASTRAL_DOMAIN"
fi

render_template "$SCRIPT_DIR/nginx/astral-patch-site.conf.template" "$NGINX_SITE_PATH"
nginx -t
systemctl reload nginx

install -m 0755 "$SCRIPT_DIR/backup-db.sh" /usr/local/sbin/astral-patch-backup-db
install -m 0644 "$SCRIPT_DIR/systemd/astral-patch-db-backup.service" /etc/systemd/system/astral-patch-db-backup.service
install -m 0644 "$SCRIPT_DIR/systemd/astral-patch-db-backup.timer" /etc/systemd/system/astral-patch-db-backup.timer
install -d -m 0755 /etc/default
{
  printf 'ASTRAL_APP_DIR=%q\n' "$ASTRAL_APP_DIR"
  printf 'ASTRAL_COMPOSE_PROJECT=%q\n' "astral-patch"
  printf 'ASTRAL_BACKUP_DIR=%q\n' "$ASTRAL_BACKUP_DIR"
  printf 'ASTRAL_BACKUP_RETENTION_DAYS=%q\n' "$ASTRAL_BACKUP_RETENTION_DAYS"
  printf 'ASTRAL_R2_BACKUP_ENABLED=%q\n' "$ASTRAL_R2_BACKUP_ENABLED"
} > /etc/default/astral-patch
chmod 0644 /etc/default/astral-patch

systemctl daemon-reload
systemctl enable --now astral-patch-db-backup.timer

if [[ "$ASTRAL_R2_BACKUP_ENABLED" == "true" ]]; then
  docker compose --project-directory "$ASTRAL_APP_DIR" -p astral-patch --profile backup build r2-backup
fi

if systemctl list-unit-files certbot.timer 2>/dev/null | grep -q '^certbot.timer'; then
  systemctl enable --now certbot.timer
fi

echo "Astral Patch server bootstrap completed for $ASTRAL_DOMAIN."
