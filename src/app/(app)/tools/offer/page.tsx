import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { OfferBuilder } from "@/components/tools/OfferBuilder";
import { Icon, PageHeader } from "@/components/ui";
import { LIST_PRICE_EGP, TIER_LABEL } from "@/lib/pricing";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { cairoYmd } from "@/lib/time";
import type { Tier } from "@/lib/tools";

export const metadata = { title: "Offer builder · Tools" };

const TIERS = new Set(["foundation", "freelance_ready", "production_partner"]);

// Opened from a lead (?lead=ID) it knows the name and phone, starts from their tier, and can save the offer on them.
export default async function OfferPage(props: { searchParams: Promise<{ lead?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("lead:read");
  const leadId = Number(sp.lead);
  const [row] = Number.isInteger(leadId) && leadId > 0 ? await db.select().from(leads).where(eq(leads.id, leadId)) : [];
  const lead =
    row && !row.deletedAt
      ? {
          id: row.id,
          fullName: row.fullName,
          phone: row.phoneWhatsapp,
          doNotContact: row.doNotContact,
          tier: (row.offerTier ?? (TIERS.has(row.tierInterest) ? row.tierInterest : null)) as Tier | null,
          link: row.offerPaymentLink,
        }
      : null;

  return (
    <>
      <PageHeader
        eyebrow="Tools"
        title="Offer builder"
        titleDir="auto"
        subtitle={lead ? `An offer for ${lead.fullName}: price, schedule and the message, in one place.` : "Price, discount and payment schedule, and the message to send. Open it from a lead to save the offer on them."}
        actions={
          lead ? (
            <Link href={`/leads/${lead.id}`} className="btn btn-ghost btn-sm">
              <Icon name="chevronLeft" size={14} /> Back to {lead.fullName.split(/\s+/)[0]}
            </Link>
          ) : undefined
        }
      />
      <Flash error={sp.error} />
      <OfferBuilder lead={lead} prices={LIST_PRICE_EGP} labels={TIER_LABEL} today={cairoYmd(new Date())} canSave={can(user.role, "lead:write")} />
    </>
  );
}
