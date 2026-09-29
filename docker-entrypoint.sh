#!/bin/sh
set -e
# Apply migrations, then seed reference data + demo users (idempotent), then start.
npx tsx src/db/migrate.ts
npx tsx src/db/seed.ts
exec npx next start -p 3000 -H 0.0.0.0
