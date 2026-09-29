#!/usr/bin/env bash
# Logical backup of the whole database (custom-format pg_dump), safe to run nightly from cron.
#
#   scripts/backup.sh                       # docker compose deployment (default)
#   BACKUP_MODE=direct DATABASE_URL=postgres://… scripts/backup.sh
#
# Env: BACKUP_DIR (default ./backups), BACKUP_KEEP (how many to keep, default 14).
# A backup only counts if the archive can be read back; a failed or empty dump never replaces a good one.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
. scripts/lib.sh

DIR="${BACKUP_DIR:-./backups}"
KEEP="${BACKUP_KEEP:-14}"
umask 077
mkdir -p "$DIR"
chmod 700 "$DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$DIR/crm-$stamp.dump"
tmp="$out.partial"
trap 'rm -f "$tmp"' EXIT

pg_dump_stdout > "$tmp"

# The archive must list the users and leads tables, otherwise something went wrong silently.
toc="$(pg_restore_list < "$tmp")"
for t in users leads stage_events; do
  echo "$toc" | grep -q "TABLE public $t " || { echo "error: backup is missing table '$t'; not keeping it" >&2; exit 1; }
done

mv "$tmp" "$out"
chmod 600 "$out"

# keep the newest $KEEP files
ls -1t "$DIR"/crm-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f -- "$old"; done

echo "backup ok: $out ($(wc -c < "$out" | tr -d ' ') bytes)"
