import { defineConfig } from "@playwright/test";

// End-to-end tests drive the real, built app in a real browser against a scratch database (crm_e2e).
// Run:  npm run build && npm run test:e2e
//
// The scratch database is dropped and recreated on every run. Point E2E_DATABASE_URL at a Postgres
// server you can afford to lose a database on; never at real data.
const PORT = 3200;
const DB = process.env.E2E_DATABASE_URL ?? "postgres://postgres@localhost:5433/crm_e2e";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // in sandboxes where Playwright's own browser download is blocked, set E2E_CHROMIUM=/path/to/chrome
    launchOptions: process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {},
  },
  webServer: {
    // prepare the database first, then start the production server on it
    command: `npx tsx e2e/prepare-db.ts && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      E2E_DATABASE_URL: DB,
      DATABASE_URL: DB,
      AUTH_SECRET: "e2e-secret-".padEnd(48, "x"),
      SEED_PASSWORD: "e2e-password-1",
      SEED_DEMO: "true",
      AI_FAKE: "e2e",
      COOKIE_SECURE: "false",
    },
  },
});
