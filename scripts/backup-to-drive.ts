// The daily database backup, run outside the app: by the nightly GitHub Action when the app is on a host without
// pg_dump (Vercel). Same backup as the in-app one: pg_dump to the Drive "Backups" folder, newest 14 kept.
// Needs DATABASE_URL, AUTH_SECRET (to open the stored Drive sign-in) and the Google credentials the app uses.
import { db } from "@/db";
import { runBackup } from "@/lib/backup";

(async () => {
  const r = await runBackup(db, null);
  if (!r.ok) {
    console.error(`Backup failed: ${r.error}`);
    process.exit(1);
  }
  console.log(`Backup saved: ${r.name} (${Math.round(r.size / 1024)} KB), ${r.removed} old one(s) removed`);
  process.exit(0);
})();
