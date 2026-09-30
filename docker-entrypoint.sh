#!/bin/sh
set -e
# Apply migrations, seed reference data (+ demo leads only if SEED_DEMO=true and the database is empty),
# then start. Every step is idempotent, so restarts are safe.
./node_modules/.bin/tsx src/db/migrate.ts
./node_modules/.bin/tsx src/db/seed.ts
exec ./node_modules/.bin/next start -p 3000 -H 0.0.0.0
