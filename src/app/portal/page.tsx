import Link from "next/link";
import { db } from "@/db";
import { SUBMISSION_STATUS } from "@/lib/assignments";
import { ALLOWED_EXT } from "@/lib/attachments";
import { PAYMENT_PLAN_LABEL } from "@/lib/finance";
import { portalOverview } from "@/lib/portal-data";
import { TIER_LABEL } from "@/lib/pricing";
import { requireStudent } from "@/lib/student-auth";
import { formatCairo } from "@/lib/time";
import { portalLogout } from "./actions";
import { SubmitWork } from "./forms";
import { PortalShell } from "./Shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Student portal · OrlaDent Camp", robots: { index: false } };

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const ACCEPT = Object.keys(ALLOWED_EXT).map((e) => `.${e}`).join(",");
const CHIP = { submitted: "chip chip-warn", rework: "chip chip-danger", passed: "chip chip-ok" } as const;

function H({ en, ar }: { en: string; ar: string }) {
  return (
    <h2 className="mb-3 flex items-baseline justify-between gap-2 text-base font-semibold">
      <span>{en}</span>
      <span dir="rtl" lang="ar" className="text-sm font-normal text-muted">
        {ar}
      </span>
    </h2>
  );
}

export default async function PortalHome() {
  const me = await requireStudent();
  const mine = await portalOverview(db, me.leadId);
  return (
    <PortalShell
      name={me.fullName}
      signOut={
        <form action={portalLogout}>
          <button className="btn btn-ghost btn-sm">Sign out · خروج</button>
        </form>
      }
    >
      {mine.length === 0 && <p className="card p-5 text-sm">You are not enrolled in a batch right now. · لست مسجلًا في دفعة حاليًا.</p>}
      {mine.map(({ enrolment: e, upcoming, past, attendance, work, certificate, payments }) => (
        <div key={e.enrolmentId} className="mb-10 flex flex-col gap-6">
          <div>
            <div className="eyebrow">{e.cohort}</div>
            <h1 className="page-title">{TIER_LABEL[e.tier] ?? e.tier}</h1>
          </div>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="card p-3">
              <dt className="text-xs text-muted">Attendance · الحضور</dt>
              <dd className="num font-display text-2xl font-semibold">{attendance?.rate == null ? "—" : `${Math.round(attendance.rate * 100)}%`}</dd>
            </div>
            <div className="card p-3">
              <dt className="text-xs text-muted">QC score · التقييم</dt>
              <dd className="num font-display text-2xl font-semibold">{e.qcScore ?? "—"}</dd>
            </div>
            <div className="card p-3">
              <dt className="text-xs text-muted">Leaderboard · الترتيب</dt>
              <dd className="num font-display text-2xl font-semibold">{e.leaderboardRank ? `#${e.leaderboardRank}` : "—"}</dd>
            </div>
            <div className="card p-3">
              <dt className="text-xs text-muted">Left to pay · المتبقي</dt>
              <dd className="num font-display text-2xl font-semibold">{e.remaining ? `${fmt(e.remaining)} EGP` : "0"}</dd>
            </div>
          </dl>

          {certificate && (
            <section className="card border-ok/40 p-5">
              <H en="Your certificate" ar="شهادتك" />
              <p className="text-sm">
                Congratulations! Certificate {certificate.code}, issued {formatCairo(certificate.issuedAt, false)}.
              </p>
              <Link href={`/portal/certificate/${certificate.code}`} className="btn btn-primary btn-sm mt-3">
                Open, print or save as PDF
              </Link>
            </section>
          )}

          <section className="card p-5">
            <H en="Next classes" ar="الحصص القادمة" />
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted">None scheduled yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {upcoming.map((c) => (
                  <li key={c.id} className="py-2.5 text-sm">
                    <div className="font-medium" dir="auto">
                      {c.title}
                    </div>
                    <div className="text-xs text-muted">
                      {formatCairo(c.startsAt)} (Cairo) · {c.durationMin} min{c.location ? ` · ${c.location}` : ""}
                    </div>
                    {c.materialsUrl && (
                      <a href={c.materialsUrl} target="_blank" rel="noreferrer" className="link text-xs">
                        Materials
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <H en="Assignments" ar="الواجبات" />
            {work.length === 0 ? (
              <p className="text-sm text-muted">No assignments yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {work.map(({ a, sub }) => (
                  <li key={a.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium" dir="auto">
                        {a.title}
                      </span>
                      {sub ? <span className={CHIP[sub.status]}>{SUBMISSION_STATUS[sub.status]}</span> : <span className="chip">To send</span>}
                      {sub?.totalPct != null && <span className="num text-sm">{sub.totalPct}%</span>}
                    </div>
                    <div className="text-xs text-muted">
                      {a.dueAt ? `Due ${formatCairo(a.dueAt)} · ` : ""}pass mark {a.passPct}%
                    </div>
                    {a.brief && (
                      <p className="mt-1 whitespace-pre-line text-sm" dir="auto">
                        {a.brief}
                      </p>
                    )}
                    {sub?.scores && (
                      <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                        {sub.scores.map((x) => (
                          <li key={x.name} className="chip">
                            {x.name}: {x.score}/{x.max}
                          </li>
                        ))}
                      </ul>
                    )}
                    {sub?.feedback && sub.status !== "submitted" && (
                      <p className="mt-2 whitespace-pre-line rounded-lg bg-raised p-2 text-sm" dir="auto">
                        {sub.feedback}
                      </p>
                    )}
                    {(!sub || sub.status === "rework") && <SubmitWork assignmentId={a.id} accept={ACCEPT} />}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {past.some((c) => c.recordingUrl) && (
            <section className="card p-5">
              <H en="Recordings" ar="التسجيلات" />
              <ul className="flex flex-col gap-1 text-sm">
                {past
                  .filter((c) => c.recordingUrl)
                  .map((c) => (
                    <li key={c.id}>
                      <a href={c.recordingUrl!} target="_blank" rel="noreferrer" className="link" dir="auto">
                        {c.title}
                      </a>{" "}
                      <span className="text-xs text-muted">{formatCairo(c.startsAt, false)}</span>
                    </li>
                  ))}
              </ul>
            </section>
          )}

          <section className="card p-5">
            <H en="Payments" ar="المدفوعات" />
            <p className="mb-2 text-sm">
              {fmt(e.due)} EGP · {PAYMENT_PLAN_LABEL[e.paymentPlan]} · paid {fmt(e.paid)} EGP{e.nextDue ? ` · next due ${formatCairo(e.nextDue, false)}` : ""}
            </p>
            {payments.length > 0 && (
              <ul className="divide-y divide-line text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="flex justify-between py-1.5">
                    <span>
                      {p.category === "Refund" ? "Refund" : p.status === "expected" ? "Expected" : "Received"} · {formatCairo(new Date(p.date), false)}
                    </span>
                    <span className="num">{fmt(p.amountEgp)} EGP</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ))}
    </PortalShell>
  );
}
