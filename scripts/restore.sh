#!/usr/bin/env bash
# Restore a backup made by scripts/backup.sh. THIS REPLACES ALL DATA in the target database.
#
#   scripts/restore.sh backups/crm-20260929T020000Z.dump            # asks you to type RESTORE
#   scripts/restore.sh backups/crm-….dump --yes                      # no prompt (scripts)
#   scripts/restore.sh backups/crm-….dump --into crm_scratch --yes   # restore into another database
#
# It is all-or-nothing (one transaction): if anything fails, the database is left as it was.
# In docker mode the app container is stopped during the restore and started again afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
. scripts/lib.sh

file="${1:-}"
[ -n "$file" ] && [ -f "$file" ] || { echo "usage: $0 <backup.dump> [--into <database>] [--yes]" >&2; exit 2; }
shift
target=""; yes=0
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) yes=1 ;;
    --into) target="${2:?--into needs a database name}"; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
target="${target:-$(db_name)}"

# make sure the file is a readable archive before touching anything
# Read the whole table of contents first, then search it. Piping straight into `grep -q` makes grep quit at
# the first match, the writer gets SIGPIPE, and `set -o pipefail` reports a valid backup as invalid.
toc="$(pg_restore_list < "$file" 2>/dev/null)" || toc=""
grep -q "TABLE public users " <<<"$toc" || { echo "error: '$file' is not a valid CRM backup" >&2; exit 1; }

if [ "$yes" -ne 1 ]; then
  echo "This will REPLACE ALL DATA in database '$target' with the contents of $file."
  read -r -p "Type RESTORE to continue: " answer
  [ "$answer" = "RESTORE" ] || { echo "cancelled"; exit 1; }
fi

restart_app=0
if [ "$MODE" != "direct" ] && [ "$target" = "$(db_name)" ]; then
  docker compose stop app >/dev/null && restart_app=1
fi

pg_restore_into "$target" < "$file"
echo "restored $file into '$target'"

if [ "$restart_app" -eq 1 ]; then docker compose start app >/dev/null && echo "app restarted"; fi
