import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { AskForm, Suggestion } from "@/components/ai/AskForm";
import { Markdown } from "@/components/ai/Markdown";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Flash } from "@/components/Flash";
import { Card, PageHeader } from "@/components/ui";
import { Icon } from "@/components/ui/Icon";
import { listThreads, SUGGESTIONS, threadMessages, toolsFor } from "@/lib/ai/ask";
import { aiStatus } from "@/lib/ai/core";
import { can } from "@/lib/rbac";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { askAction, deleteThreadAction } from "./actions";

export const metadata = { title: "Ask OrlaDent" };

const TOOL_LABELS: Record<string, string> = {
  sales_numbers: "sales numbers",
  needs_attention: "what needs a person",
  batches: "batches",
  campaigns: "campaigns",
  find_leads: "leads",
  lead_history: "a lead's history",
  students: "students",
  money_month: "the books",
  production: "production",
};

// Ask OrlaDent: questions about the app's own data, answered by Claude from read-only lookups this person may see.
export default async function AskPage(props: { searchParams: Promise<{ t?: string; notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const user = await requirePageCan("ai:use");
  const [status, threads] = await Promise.all([aiStatus(db), listThreads(db, user.id)]);
  const tId = Number(sp.t) || 0;
  const current = tId ? await threadMessages(db, user.id, tId) : null;
  if (tId && !current) notFound();
  const sees = toolsFor(db, { id: user.id, name: user.name, role: user.role }, status.settings).map((d) => TOOL_LABELS[d.tool.name] ?? d.tool.name);

  return (
    <>
      <PageHeader
        eyebrow="OrlaDent OS"
        title="Ask OrlaDent"
        subtitle="Ask about your leads, batches, campaigns, students and money in plain words. Answers come only from what you can already see in the app, with links to the records."
        actions={
          current ? (
            <Link href="/ask" className="btn btn-secondary">
              <Icon name="plus" />
              New conversation
            </Link>
          ) : undefined
        }
      />
      <Flash notice={sp.notice} error={sp.error} />
      {!status.ok && (
        <p role="note" className="mb-6 flex max-w-3xl items-start gap-3 rounded-xl border border-warn/30 bg-warn/10 px-5 py-4 text-sm text-warn">
          <Icon name="alert" className="mt-0.5 shrink-0" />
          <span>
            {status.reason}
            {can(user.role, "settings:write") && (
              <>
                {" "}
                <Link href="/settings/ai" className="font-medium underline underline-offset-2">
                  Open AI settings
                </Link>
              </>
            )}
          </span>
        </p>
      )}

      <div className="grid gap-8 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="order-2 grid content-start gap-6 xl:order-1">
          <Card title="Your conversations" icon="history" bodyClass="p-0">
            {!threads.length ? (
              <p className="p-5 text-sm text-muted">None yet. Each question you ask starts one; only you can see yours.</p>
            ) : (
              <ul className="divide-y divide-line">
                {threads.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/ask?t=${t.id}`}
                      aria-current={t.id === tId ? "page" : undefined}
                      className={`block px-5 py-3.5 text-sm transition hover:bg-raised ${t.id === tId ? "bg-brand/10" : ""}`}
                    >
                      <span className="line-clamp-2 font-medium" dir="auto">
                        {t.title}
                      </span>
                      <span className="mt-1 block text-xs text-muted">{formatCairo(t.updatedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="What it can look up for you" icon="eye">
            {sees.length ? (
              <p className="text-sm text-muted">
                {sees.join(", ")}. Never phone numbers or email addresses{can(user.role, "finance:read") && status.settings.readMoney ? "" : ", and no money figures"}.
              </p>
            ) : (
              <p className="text-sm text-muted">Nothing from your role yet; ask an owner.</p>
            )}
          </Card>
        </div>

        <section aria-label="Conversation" className="order-1 grid content-start gap-6 xl:order-2">
          {current ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold" dir="auto">
                  {current.thread.title}
                </h2>
                <form action={deleteThreadAction}>
                  <input type="hidden" name="threadId" value={current.thread.id} />
                  <ConfirmButton className="btn btn-ghost btn-sm text-danger" message="Delete this conversation?">
                    <Icon name="trash" />
                    Delete
                  </ConfirmButton>
                </form>
              </div>
              <ol className="grid gap-5">
                {current.messages.map((m) =>
                  m.role === "user" ? (
                    <li key={m.id} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-brand px-5 py-3.5 text-[0.9375rem] text-onbrand" dir="auto">
                      <span className="sr-only">You asked: </span>
                      {m.content}
                    </li>
                  ) : (
                    <li key={m.id} className="rounded-2xl rounded-bl-md border border-line bg-surface px-5 py-4 shadow-soft">
                      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-accent">
                        <Icon name="sparkle" size={14} />
                        Ask OrlaDent
                      </div>
                      <Markdown text={m.content} />
                      {m.lookups?.length ? (
                        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-muted">
                          <span>Looked at:</span>
                          {m.lookups.map((l, k) => (
                            <span key={k} className="chip">
                              {l.summary}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ),
                )}
              </ol>
              <AskForm action={askAction} threadId={current.thread.id} disabled={!status.ok} />
            </>
          ) : (
            <>
              <AskForm action={askAction} disabled={!status.ok} />
              {status.ok && (
                <div>
                  <h2 className="mb-3 text-sm font-semibold text-muted">Try one of these</h2>
                  <ul className="grid gap-3 md:grid-cols-2">
                    {SUGGESTIONS.map((s) => (
                      <li key={s}>
                        <Suggestion action={askAction} text={s} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          <p className="text-xs text-muted">
            Answers are written by Claude (Anthropic) from the app&apos;s data and can be wrong: check the linked records before acting on a figure.
          </p>
        </section>
      </div>
    </>
  );
}
