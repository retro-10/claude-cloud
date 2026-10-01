import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { campaignBySlug } from "@/lib/campaigns";
import { cleanAttribution, hashIp, intake } from "@/lib/lead-forms";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Leads from outside (Meta lead ads through Zapier or Make, a website, a partner): POST JSON with
//   Authorization: Bearer <INBOUND_LEADS_TOKEN>
//   { "name": "...", "phone": "...", "email"?, "city"?, "campaign"?: "<link name>", "source"?: "Instagram ads",
//     "consent"?: true, "utm_source"?, "utm_medium"?, "utm_campaign"?, "utm_content"?, "utm_term"? }
// Off (404) until the token is set. The answer says only whether it was taken in, never who the person is.
const body = z.object({
  name: z.string().min(1).max(300),
  phone: z.string().min(1).max(40),
  email: z.string().max(300).nullish(),
  city: z.string().max(200).nullish(),
  campaign: z.string().max(60).nullish(),
  source: z.string().max(80).nullish(),
  consent: z.boolean().nullish(),
});

const digest = (s: string) => createHash("sha256").update(s).digest();

export async function POST(req: NextRequest) {
  const token = process.env.INBOUND_LEADS_TOKEN;
  if (!token || token.length < 24) return new NextResponse("Not found", { status: 404 });
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!timingSafeEqual(digest(given), digest(token))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit("inbound-leads", 120, 60_000).ok) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const p = body.safeParse(raw);
  if (!p.success) return NextResponse.json({ ok: false, error: "invalid_body", fields: p.error.issues.map((i) => i.path.join(".")) }, { status: 400 });

  const campaign = p.data.campaign ? await campaignBySlug(db, p.data.campaign) : null;
  const r = await intake(db, {
    name: p.data.name,
    phone: p.data.phone,
    email: p.data.email ?? null,
    city: p.data.city ?? null,
    consent: p.data.consent === true,
    attribution: cleanAttribution(raw as Record<string, unknown>),
    campaignId: campaign?.id ?? null,
    sourceId: campaign?.sourceId ?? null,
    sourceLabel: p.data.source ?? null,
    channel: "webhook",
    ipHash: hashIp(ip),
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: `invalid_${r.error}` }, { status: 422 });
  return NextResponse.json({ ok: true, id: r.leadId, existing: r.existing }, { status: r.existing ? 200 : 201 });
}
