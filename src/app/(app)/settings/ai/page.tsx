import { db } from "@/db";
import { Flash } from "@/components/Flash";
import { Card, Stat } from "@/components/ui";
import { getSettings } from "@/lib/app-settings";
import { AI_MODEL, aiStatus, usageSummary } from "@/lib/ai/core";
import { requirePageCan } from "@/lib/server-auth";
import { cairoLocalToDate, cairoYmd } from "@/lib/time";
import { saveAiSettingsAction } from "./actions";

export const metadata = { title: "AI assistant · Settings" };

const FEATURES: Record<string, string> = { ask: "Ask OrlaDent", reply: "Reply drafts", followup: "Follow-up drafts", caption: "Captions and hooks", script: "Masterclass scripts", weekly: "Weekly report drafts", brief: "Consult briefs" };

// Owners decide whether the assistant is on, what it may read, how drafts sound, and see what it costs.
export default async function AiSettingsPage(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const sp = await props.searchParams;
  await requirePageCan("settings:write");
  const [{ ai }, status] = await Promise.all([getSettings(db), aiStatus(db)]);
  const now = new Date();
  const monthStart = cairoLocalToDate(`${cairoYmd(now).slice(0, 7)}-01T00:00`)!;
  const usage = await usageSummary(db, monthStart);
  const usd = usage.reduce((a, u) => a + u.usd, 0);
  const calls = usage.reduce((a, u) => a + u.calls, 0);
  const keyMissing = !status.ok && status.reason.includes("API key");
  const box = (name: keyof typeof ai, label: string, hint: string) => (
    <label className="flex items-start gap-3 rounded-xl border border-line p-4">
      <input type="checkbox" name={name} defaultChecked={ai[name] as boolean} className="check mt-1" />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-sm text-muted">{hint}</span>
      </span>
    </label>
  );

  return (
    <>
      <Flash notice={sp.notice} error={sp.error} />
      {keyMissing && (
        <p role="note" className="mb-6 max-w-3xl rounded-xl border border-warn/30 bg-warn/10 px-5 py-4 text-sm text-warn">
          The server has no Anthropic API key yet, so the assistant cannot run even when switched on. Whoever runs the server adds <code>ANTHROPIC_API_KEY</code> to the
          environment (.env) and restarts it.
        </p>
      )}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat label="Status" value={status.ok ? "On" : "Off"} icon="sparkle" hint={status.ok ? `model ${AI_MODEL}` : keyMissing ? "no API key on the server" : "switched off"} />
        <Stat label="Requests this month" value={calls.toLocaleString("en-US")} icon="send" />
        <Stat label="Estimated cost this month" value={`$${usd.toFixed(2)}`} icon="trend" hint="at Anthropic's list prices" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card title="The assistant" icon="sparkle">
          <form action={saveAiSettingsAction} className="grid gap-5">
            <label className="flex items-start gap-3 rounded-xl border border-brand/40 bg-brand/5 p-4">
              <input type="checkbox" name="enabled" defaultChecked={ai.enabled} className="check mt-1" />
              <span>
                <span className="block text-sm font-semibold">Switch the AI assistant on</span>
                <span className="block text-sm text-muted">
                  Ask OrlaDent, drafts and consult briefs. What it reads is sent to Anthropic (Claude) to write the answer; under Anthropic&apos;s commercial terms, data sent through the API is
                  not used to train its models. Phone numbers and email addresses are never sent.
                </span>
              </span>
            </label>
            <fieldset className="grid gap-3">
              <legend className="mb-1 text-sm font-semibold">What Ask OrlaDent may look up</legend>
              {box("readLeads", "Leads and conversations", "Names, stages, sources, notes and the messages logged on a lead.")}
              {box("readMoney", "Money", "Revenue, payments, costs and invoices. Only ever for people who may see money in the app.")}
              {box("readStudents", "Students", "Attendance, assignments, QC scores and graduation.")}
              {box("readProduction", "Production", "Clients, cases and designers' figures.")}
            </fieldset>
            <label className="field">
              Brand voice (how drafts should sound)
              <textarea name="brandVoice" rows={5} maxLength={2000} defaultValue={ai.brandVoice} dir="auto" className="input" />
            </label>
            <label className="field max-w-xs">
              Requests per person per day
              <input name="dailyLimit" type="number" min={1} max={2000} required defaultValue={ai.dailyLimit} className="input num" />
            </label>
            <div>
              <button className="btn btn-primary">Save</button>
            </div>
          </form>
        </Card>
        <Card title="Use this month" icon="history" bodyClass="p-0">
          {!usage.length ? (
            <p className="p-5 text-sm text-muted">Nothing yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  <th scope="col" className="text-right">
                    Requests
                  </th>
                  <th scope="col" className="text-right">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u) => (
                  <tr key={u.feature}>
                    <th scope="row" className="font-normal">
                      {FEATURES[u.feature] ?? u.feature}
                      {u.failed ? <div className="text-xs text-muted">{u.failed} did not complete</div> : null}
                    </th>
                    <td className="num text-right">{u.calls}</td>
                    <td className="num text-right">${u.usd.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="border-t border-line px-5 py-4 text-xs text-muted">Only the number of tokens is recorded, never what was asked or answered (Ask OrlaDent keeps each person&apos;s own conversations).</p>
        </Card>
      </div>
    </>
  );
}
