#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_DIR="${ASTRAL_APP_DIR:-$(pwd)}"
PROJECT_NAME="${ASTRAL_COMPOSE_PROJECT:-astral-patch}"
BACKUP_DIR="${ASTRAL_BACKUP_DIR:-/var/backups/astral-patch}"
RETENTION_DAYS="${ASTRAL_BACKUP_RETENTION_DAYS:-14}"

if [[ ! -f "$APP_DIR/docker-compose.yml" ]]; then
  echo "docker-compose.yml was not found in ASTRAL_APP_DIR: $APP_DIR" >&2
  exit 1
fi

if ! [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  echo "ASTRAL_BACKUP_RETENTION_DAYS must be a non-negative integer" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 0700 "$BACKUP_DIR"

compose=(docker compose --project-directory "$APP_DIR" -p "$PROJECT_NAME")
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_path="$BACKUP_DIR/astral-${timestamp}.dump"
checksum_path="$BACKUP_DIR/astral-${timestamp}.sha256"
dump_tmp="${dump_path}.tmp"
checksum_tmp="${checksum_path}.tmp"

cleanup() {
  rm -f "$dump_tmp" "$checksum_tmp"
}
trap cleanup EXIT

"${compose[@]}" exec -T postgres-db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null
"${compose[@]}" exec -T postgres-db sh -c \
  'pg_dump --format=custom --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
  > "$dump_tmp"

mv -- "$dump_tmp" "$dump_path"
sha256sum "$dump_path" > "$checksum_tmp"
mv -- "$checksum_tmp" "$checksum_path"

find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'astral-*.dump' -o -name 'astral-*.sha256' \) \
  -mtime "+$RETENTION_DAYS" -delete

echo "Astral database backup created: $dump_path"
