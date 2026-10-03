import Link from "next/link";
import { Icon, PageHeader, type IconName } from "@/components/ui";
import { can, type Action } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";

export const metadata = { title: "Tools" };

const TOOLS: { href: string; title: string; body: string; icon: IconName; need?: Action }[] = [
  { href: "/tools/offer", title: "Offer builder", body: "Tier, discount and payment plan: the schedule, the WhatsApp message, and the offer saved on the lead.", icon: "template" },
  { href: "/tools/roi", title: "Campaign ROI", body: "What a budget should bring at your rates, and the most a lead may cost before a campaign loses money.", icon: "trend" },
  { href: "/tools/links", title: "Tracked links", body: "A link and QR code for each post, story, ad or flyer, so every lead says where it came from.", icon: "send" },
  { href: "/tools/planner", title: "Batch planner", body: "Seats to fill, worked back to consults and leads per week, at your own conversion rates.", icon: "target" },
  { href: "/tools/pricing", title: "Pricing scenarios", body: "A batch at another price, discount, seat cap or cost: revenue, margin and the paying students that cover the costs.", icon: "gauge", need: "finance:read" },
  { href: "/production/quote", title: "Turnaround quote", body: "A production client's price and delivery date for a case, before you take it in.", icon: "clock", need: "production:manage" },
];

// Small tools that save repeated effort. More arrive with each phase of the OrlaDent OS plan.
export default async function ToolsPage() {
  const user = await requirePageCan("lead:read");
  return (
    <>
      <PageHeader eyebrow="OrlaDent OS" title="Tools" subtitle="Calculators and generators that use the CRM's own data." />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLS.filter((t) => !t.need || can(user.role, t.need)).map((t) => (
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
