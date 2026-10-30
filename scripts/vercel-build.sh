#!/usr/bin/env sh
# Vercel's build: on production deploys, apply migrations and reference data first (there is no "start" on Vercel
# to do it), then build. Preview deploys never touch the database. Migrations use the session pooler
# (MIGRATE_DATABASE_URL, port 5432) when set; the app itself runs on the transaction pooler (port 6543).
set -e
if [ "$VERCEL_ENV" = "production" ]; then
  DATABASE_URL="${MIGRATE_DATABASE_URL:-$DATABASE_URL}" npm run db:setup
fi
npm run build
