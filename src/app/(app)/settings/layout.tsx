import { SettingsNav } from "@/components/shell/SettingsNav";
import { PageHeader } from "@/components/ui";
import { requirePageCan } from "@/lib/server-auth";

// Owner only. Each page and every action behind it checks again on the server.
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requirePageCan("settings:write");
  return (
    <>
      <PageHeader eyebrow="Admin" title="Settings" subtitle="How the pipeline, rules and team work. Changes apply immediately and are recorded in the audit log." />
      <SettingsNav />
      {children}
    </>
  );
}
