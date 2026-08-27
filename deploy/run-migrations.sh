#!/usr/bin/env sh
set -eu

MIGRATION_DIR="${MIGRATION_DIR:-/migrations}"
MODE="${1:-run}"

: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"

psql_base() {
  psql \
    --host="$PGHOST" \
    --port="${PGPORT:-5432}" \
    --username="$PGUSER" \
    --dbname="$PGDATABASE" \
    --set=ON_ERROR_STOP=1 \
    "$@"
}

wait_for_database() {
  attempts=0
  until pg_isready \
    --host="$PGHOST" \
    --port="${PGPORT:-5432}" \
    --username="$PGUSER" \
    --dbname="$PGDATABASE" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 60 ]; then
      echo "[migrate] database did not become ready" >&2
      exit 1
    fi
    sleep 1
  done
}

ensure_history_table() {
  psql_base <<'SQL'
CREATE TABLE IF NOT EXISTS astral_schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL
}

migration_files() {
  find "$MIGRATION_DIR" -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]_*.sql' -print | sort
}

adopt_existing_schema() {
  if [ "${ASTRAL_MIGRATION_ADOPT_CONFIRM:-}" != "YES" ]; then
    echo "[migrate] refusing to adopt migration history without ASTRAL_MIGRATION_ADOPT_CONFIRM=YES" >&2
    exit 1
  fi

  for file in $(migration_files); do
    name="$(basename "$file")"
    psql_base --set=name="$name" <<'SQL'
INSERT INTO astral_schema_migrations (name)
VALUES (:'name')
ON CONFLICT (name) DO NOTHING;
SQL
    echo "[migrate] adopted $name"
  done
}

run_migrations() {
  for file in $(migration_files); do
    name="$(basename "$file")"
    applied="$(
      psql_base --tuples-only --no-align --set=name="$name" <<'SQL'
SELECT 1
FROM astral_schema_migrations
WHERE name = :'name'
LIMIT 1;
SQL
    )"

    if [ "$applied" = "1" ]; then
      echo "[migrate] skipped $name"
      continue
    fi

    tmp="$(mktemp)"
    {
      echo 'BEGIN;'
      cat "$file"
      printf '\nINSERT INTO astral_schema_migrations (name) VALUES ('
      printf "'%s'" "$(printf '%s' "$name" | sed "s/'/''/g")"
      echo ');'
      echo 'COMMIT;'
    } > "$tmp"

    if psql_base --file="$tmp"; then
      echo "[migrate] applied $name"
    else
      rm -f "$tmp"
      exit 1
    fi
    rm -f "$tmp"
  done
}

if [ ! -d "$MIGRATION_DIR" ]; then
  echo "[migrate] migration directory not found: $MIGRATION_DIR" >&2
  exit 1
fi

wait_for_database
ensure_history_table

case "$MODE" in
  run)
    run_migrations
    ;;
  adopt)
    adopt_existing_schema
    ;;
  *)
    echo "usage: $0 [run|adopt]" >&2
    exit 2
    ;;
esac
