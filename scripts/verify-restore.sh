#!/usr/bin/env bash
# Restore drill: proves a backup file can actually be restored, without touching live data.
# Restores into a throwaway database on the same server, compares row counts with the live database,
# then drops the throwaway database.
#
#   scripts/verify-restore.sh backups/crm-….dump
#
# Exit 0 = the backup restores and its key tables contain data. Row counts can legitimately differ
# from live (people kept working after the backup was taken); differences are printed, not failed.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
. scripts/lib.sh

file="${1:-}"
[ -n "$file" ] && [ -f "$file" ] || { echo "usage: $0 <backup.dump>" >&2; exit 2; }

live="$(db_name)"
scratch="crm_verify_$$"
cleanup() { psql_admin "drop database if exists $scratch" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql_admin "create database $scratch" >/dev/null
pg_restore_into "$scratch" < "$file" 2>/dev/null
echo "restored into scratch database $scratch"

fail=0
printf '%-16s %10s %10s\n' table restored live
for t in users leads activities stage_events follow_ups consults enrolments cohorts audit_log; do
  r="$(psql_db "$scratch" "select count(*) from public.$t")"
  l="$(psql_db "$live" "select count(*) from public.$t")"
  note=""
  [ "$r" != "$l" ] && note="  (live differs: changes since the backup)"
  printf '%-16s %10s %10s%s\n' "$t" "$r" "$l" "$note"
  # a backup with no users can never be logged into
  if [ "$t" = "users" ] && [ "$r" -eq 0 ]; then echo "FAIL: restored database has no users" >&2; fail=1; fi
  if [ "$t" = "leads" ] && [ "$r" -eq 0 ] && [ "$l" -gt 0 ]; then echo "FAIL: backup has no leads but live does" >&2; fail=1; fi
done

# migrations must be present so the app can start on the restored data
m="$(psql_db "$scratch" "select count(*) from drizzle.__drizzle_migrations")"
echo "migrations recorded: $m"
[ "$m" -gt 0 ] || { echo "FAIL: no migration history in the backup" >&2; fail=1; }

[ "$fail" -eq 0 ] && echo "RESTORE DRILL OK" || { echo "RESTORE DRILL FAILED" >&2; exit 1; }
