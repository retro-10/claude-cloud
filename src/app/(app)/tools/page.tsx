import Link from "next/link";
import { Icon, PageHeader, type IconName } from "@/components/ui";
import { requireUser } from "@/lib/server-auth";

export const metadata = { title: "Tools" };

const TOOLS: { href: string; title: string; body: string; icon: IconName }[] = [
  { href: "/tools/offer", title: "Offer builder", body: "Tier, discount and payment plan: the schedule, the WhatsApp message, and the offer saved on the lead.", icon: "template" },
  { href: "/tools/planner", title: "Batch planner", body: "Seats to fill, worked back to consults and leads per week, at your own conversion rates.", icon: "target" },
];

// Small tools that save repeated effort. More arrive with each phase of the OrlaDent OS plan.
export default async function ToolsPage() {
  await requireUser();
  return (
    <>
      <PageHeader eyebrow="OrlaDent OS" title="Tools" subtitle="Calculators and generators that use the CRM's own data." />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLS.map((t) => (
          <li key={t.href}>
            <Link href={t.href} className="card flex h-full flex-col gap-2 p-4 hover:border-brand/50">
              <span className="flex items-center gap-2 font-medium">
                <Icon name={t.icon} className="text-accent" /> {t.title}
              </span>
              <span className="text-sm text-muted">{t.body}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
