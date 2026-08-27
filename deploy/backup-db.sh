#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

APP_DIR="${ASTRAL_APP_DIR:-$(pwd)}"
PROJECT_NAME="${ASTRAL_COMPOSE_PROJECT:-astral-patch}"
BACKUP_DIR="${ASTRAL_BACKUP_DIR:-/var/backups/astral-patch}"
RETENTION_DAYS="${ASTRAL_BACKUP_RETENTION_DAYS:-14}"
R2_BACKUP_ENABLED="${ASTRAL_R2_BACKUP_ENABLED:-false}"

if [[ ! -f "$APP_DIR/docker-compose.yml" ]]; then
  echo "docker-compose.yml was not found in ASTRAL_APP_DIR: $APP_DIR" >&2
  exit 1
fi

if ! [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  echo "ASTRAL_BACKUP_RETENTION_DAYS must be a non-negative integer" >&2
  exit 1
fi

if [[ "$R2_BACKUP_ENABLED" != "true" && "$R2_BACKUP_ENABLED" != "false" ]]; then
  echo "ASTRAL_R2_BACKUP_ENABLED must be true or false" >&2
  exit 1
fi

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
chmod 0700 "$BACKUP_DIR"

compose=(docker compose --project-directory "$APP_DIR" -p "$PROJECT_NAME")
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_path="$BACKUP_DIR/astral-${timestamp}.dump"
globals_path="$BACKUP_DIR/astral-${timestamp}.globals.sql"
checksum_path="$BACKUP_DIR/astral-${timestamp}.sha256"
dump_tmp="${dump_path}.tmp"
globals_tmp="${globals_path}.tmp"
checksum_tmp="${checksum_path}.tmp"

cleanup() {
  rm -f "$dump_tmp" "$globals_tmp" "$checksum_tmp"
}
trap cleanup EXIT

"${compose[@]}" exec -T postgres-db sh -c \
  'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null

"${compose[@]}" exec -T postgres-db sh -c \
  'pg_dump --format=custom --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
  > "$dump_tmp"

"${compose[@]}" exec -T postgres-db sh -c \
  'pg_dumpall --globals-only --username="$POSTGRES_USER"' \
  > "$globals_tmp"

if [[ ! -s "$dump_tmp" || ! -s "$globals_tmp" ]]; then
  echo "database backup produced an empty output" >&2
  exit 1
fi

mv -- "$dump_tmp" "$dump_path"
mv -- "$globals_tmp" "$globals_path"
sha256sum "$dump_path" "$globals_path" > "$checksum_tmp"
mv -- "$checksum_tmp" "$checksum_path"

if [[ "$R2_BACKUP_ENABLED" == "true" ]]; then
  export ASTRAL_BACKUP_DIR="$BACKUP_DIR"
  "${compose[@]}" --profile backup run --rm r2-backup \
    --dump "/backup/$(basename -- "$dump_path")" \
    --globals "/backup/$(basename -- "$globals_path")" \
    --checksum "/backup/$(basename -- "$checksum_path")"
else
  echo "R2 backup upload is disabled. Set ASTRAL_R2_BACKUP_ENABLED=true to enable it."
fi

find "$BACKUP_DIR" -maxdepth 1 -type f \( \
  -name 'astral-*.dump' -o \
  -name 'astral-*.globals.sql' -o \
  -name 'astral-*.sha256' \
\) -mtime "+$RETENTION_DAYS" -delete

echo "Astral database backup created:"
echo "  dump:    $dump_path"
echo "  globals: $globals_path"
echo "  sha256:  $checksum_path"
