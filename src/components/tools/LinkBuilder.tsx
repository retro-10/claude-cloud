"use client";

import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../ui/Icon";

type Form = { slug: string; title: string };
type Campaign = { slug: string; label: string };

const SOURCES = ["instagram", "facebook", "tiktok", "whatsapp", "youtube", "linkedin", "email", "partner"];
const MEDIUMS = ["bio", "story", "post", "reel", "paid", "broadcast", "dm", "qr"];

/** A link to a form (or any page) with utm tags, so every lead says where it came from. */
export function LinkBuilder({ base, forms, campaigns }: { base: string; forms: Form[]; campaigns: Campaign[] }) {
  const [target, setTarget] = useState(forms[0] ? `${base}/f/${forms[0].slug}` : "");
  const [source, setSource] = useState("instagram");
  const [medium, setMedium] = useState("bio");
  const [campaign, setCampaign] = useState(campaigns[0]?.slug ?? "");
  const [content, setContent] = useState("");
  const [svg, setSvg] = useState("");
  const [copied, setCopied] = useState(false);

  const link = useMemo(() => {
    try {
      const u = new URL(target);
      const set = (k: string, v: string) => (v.trim() ? u.searchParams.set(k, v.trim().toLowerCase().replace(/\s+/g, "-")) : u.searchParams.delete(k));
      set("utm_source", source);
      set("utm_medium", medium);
      set("utm_campaign", campaign);
      set("utm_content", content);
      return u.toString();
    } catch {
      return "";
    }
  }, [target, source, medium, campaign, content]);

  useEffect(() => {
    if (!link) return setSvg("");
    QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then(setSvg, () => setSvg(""));
  }, [link]);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card grid gap-3 p-4 sm:grid-cols-2">
        <label className="field sm:col-span-2">
          Where the link goes
          <select className="input" value={forms.some((f) => `${base}/f/${f.slug}` === target) ? target : "custom"} onChange={(e) => e.target.value !== "custom" && setTarget(e.target.value)}>
            {forms.map((f) => (
              <option key={f.slug} value={`${base}/f/${f.slug}`}>
                Form: {f.title}
              </option>
            ))}
            <option value="custom">Another address (type it below)</option>
          </select>
        </label>
        <label className="field sm:col-span-2">
          Address
          <input className="input num" dir="ltr" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="https://" />
        </label>
        <label className="field">
          Platform (utm_source)
          <input className="input" list="utm-sources" value={source} onChange={(e) => setSource(e.target.value)} />
          <datalist id="utm-sources">
            {SOURCES.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label className="field">
          Placement (utm_medium)
          <input className="input" list="utm-mediums" value={medium} onChange={(e) => setMedium(e.target.value)} />
          <datalist id="utm-mediums">
            {MEDIUMS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label className="field">
          Campaign (utm_campaign)
          <select className="input" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
            <option value="">None</option>
            {campaigns.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Which post or ad (utm_content)
          <input className="input" value={content} onChange={(e) => setContent(e.target.value)} placeholder="e.g. reel-crown-design" />
        </label>
        <p className="text-xs text-muted sm:col-span-2">A campaign in the link files the lead under that campaign even when the form has none. Only campaigns with a link name are listed.</p>
      </div>
      <div className="card flex flex-col gap-3 p-4" aria-live="polite">
        {link ? (
          <>
            <label className="field">
              Your link
              <textarea readOnly rows={3} value={link} className="input num" dir="ltr" />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  navigator.clipboard?.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                <Icon name="copy" size={14} /> {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            {svg && <div className="w-48 rounded-lg bg-white p-2" role="img" aria-label="QR code for the link" dangerouslySetInnerHTML={{ __html: svg }} />}
            <p className="text-xs text-muted">Print the QR code on flyers and slides at events (use placement &ldquo;qr&rdquo;).</p>
          </>
        ) : (
          <p role="alert" className="text-sm text-danger">
            Type a full address starting with https://
          </p>
        )}
      </div>
    </div>
  );
}
