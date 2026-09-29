#!/usr/bin/env bash
# Shared helpers for backup.sh, restore.sh and verify-restore.sh.
#
# BACKUP_MODE=docker (default): run pg_dump/pg_restore/psql inside the `db` container of docker compose.
# BACKUP_MODE=direct          : run them on this machine against DATABASE_URL (needs the postgresql client tools).
#
# Backups contain students' personal data. Files are created 0600 in a 0700 directory.

MODE="${BACKUP_MODE:-docker}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' is not installed" >&2; exit 2; }; }

if [ "$MODE" = "direct" ]; then
  : "${DATABASE_URL:?set DATABASE_URL for BACKUP_MODE=direct}"
  need pg_dump; need pg_restore; need psql
  # same server, another database name (for the scratch database used by verify-restore.sh)
  url_for_db() { echo "${DATABASE_URL%/*}/$1"; }
  db_name() { local d="${DATABASE_URL##*/}"; echo "${d%%\?*}"; }
else
  need docker
  db_name() { docker compose exec -T db sh -c 'printf %s "$POSTGRES_DB"'; }
fi

# Custom-format dump of the whole database to stdout.
pg_dump_stdout() {
  if [ "$MODE" = "direct" ]; then
    pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL"
  else
    docker compose exec -T db sh -c 'pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"'
  fi
}

# Dump on stdin -> table of contents (used to check that a backup file is a readable archive).
pg_restore_list() {
  if [ "$MODE" = "direct" ]; then pg_restore --list; else docker compose exec -T db pg_restore --list; fi
}

# Restore the dump on stdin into database $1, replacing what is there. All or nothing.
pg_restore_into() {
  local target="$1"
  if [ "$MODE" = "direct" ]; then
    pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error -d "$(url_for_db "$target")"
  else
    docker compose exec -T db sh -c "pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error -U \"\$POSTGRES_USER\" -d '$target'"
  fi
}

# Run SQL against the maintenance database (create/drop databases).
psql_admin() {
  if [ "$MODE" = "direct" ]; then
    psql -v ON_ERROR_STOP=1 -qAt "${DATABASE_URL%/*}/postgres" -c "$1"
  else
    docker compose exec -T db sh -c "psql -v ON_ERROR_STOP=1 -qAt -U \"\$POSTGRES_USER\" -d postgres -c \"$1\""
  fi
}

# Run SQL against database $1 and print the bare result.
psql_db() {
  if [ "$MODE" = "direct" ]; then
    psql -v ON_ERROR_STOP=1 -qAt "$(url_for_db "$1")" -c "$2"
  else
    docker compose exec -T db sh -c "psql -v ON_ERROR_STOP=1 -qAt -U \"\$POSTGRES_USER\" -d '$1' -c \"$2\""
  fi
}
