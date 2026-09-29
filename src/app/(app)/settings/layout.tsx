import Link from "next/link";
import { requirePageCan } from "@/lib/server-auth";

const tabs = [
  { href: "/settings/users", label: "Users" },
  { href: "/settings/pipeline", label: "Pipeline stages" },
  { href: "/settings/lists", label: "Sources & reasons" },
  { href: "/settings/cadences", label: "Cadences" },
  { href: "/settings/audit", label: "Audit log" },
];

// Owner only. Each page and every action behind it checks again on the server.
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requirePageCan("settings:write");
  return (
    <>
      <h1 className="mb-3 font-display text-2xl">Settings</h1>
      <nav aria-label="Settings sections" className="mb-5 flex flex-wrap gap-x-4 gap-y-1 border-b border-line pb-2 text-sm">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className="hover:text-accent">
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
