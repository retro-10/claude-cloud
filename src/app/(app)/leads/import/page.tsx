import Link from "next/link";
import { ImportClient } from "@/components/ImportClient";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";

export default async function ImportPage() {
  const user = await requirePageCan("lead:read");
  if (!can(user.role, "lead:write")) return <p className="text-sm text-muted">Your role cannot import leads.</p>;
  return (
    <>
      <h1 className="mb-1 font-display text-2xl">Import leads</h1>
      <p className="mb-4 text-sm text-muted">
        CSV from ClickUp, a scraped list, or a previous export. Existing people (same phone or email) are never
        duplicated. <Link href="/leads" className="underline">Back to leads</Link>
      </p>
      <ImportClient />
    </>
  );
}
