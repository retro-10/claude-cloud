import { asc } from "drizzle-orm";
import { db } from "@/db";
import { messageTemplates } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { Card, Icon } from "@/components/ui";
import { requirePageCan } from "@/lib/server-auth";
import { CATEGORIES, PLACEHOLDERS } from "@/lib/templates-render";
import { archiveMessageTemplateAction, saveMessageTemplateAction } from "../actions";

export const metadata = { title: "Templates · Settings" };

function TemplateFields({ t }: { t?: { id: number; name: string; category: string; language: string; body: string } }) {
  return (
    <>
      {t && <input type="hidden" name="id" value={t.id} />}
      <div className="grid gap-2 sm:grid-cols-[1fr_11rem_7rem]">
        <input name="name" required maxLength={80} defaultValue={t?.name} placeholder="Name" aria-label="Name" className="input" />
        <select name="category" defaultValue={t?.category ?? "first_reply"} aria-label="Category" className="input">
          {Object.entries(CATEGORIES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select name="language" defaultValue={t?.language ?? "ar"} aria-label="Language" className="input">
          <option value="ar">Arabic</option>
          <option value="en">English</option>
        </select>
      </div>
      <textarea name="body" required rows={3} defaultValue={t?.body} dir="auto" aria-label="Message" placeholder="أهلاً {first_name}…" className="input text-[15px]" />
    </>
  );
}

export default async function TemplateSettings(props: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const searchParams = await props.searchParams;
  await requirePageCan("settings:write");
  const list = await db.select().from(messageTemplates).orderBy(asc(messageTemplates.category), asc(messageTemplates.language), asc(messageTemplates.id));
  return (
    <>
      <Flash {...searchParams} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          {list.map((t) => (
            <section key={t.id} aria-label={`${t.name} (${t.language})`} className={`card p-4 ${t.active ? "" : "opacity-60"}`}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">{t.name}</h2>
                <span className="chip">{CATEGORIES[t.category] ?? t.category}</span>
                <span className="chip">{t.language === "ar" ? "العربية" : "English"}</span>
                <span className="num ml-auto text-xs text-muted">used {t.usageCount}×</span>
              </div>
              <p dir="auto" className="whitespace-pre-wrap rounded-lg bg-raised/60 px-3 py-2 text-sm">
                {t.body}
              </p>
              <details className="mt-2">
                <summary className="btn btn-ghost btn-sm w-fit cursor-pointer list-none">
                  <Icon name="edit" size={12} /> Edit
                </summary>
                <form action={saveMessageTemplateAction} className="mt-2 flex flex-col gap-2">
                  <TemplateFields t={t} />
                  <div className="flex gap-2">
                    <button className="btn btn-secondary btn-sm">Save</button>
                    <button formAction={archiveMessageTemplateAction} name="active" value={t.active ? "0" : "1"} className="btn btn-ghost btn-sm">
                      {t.active ? "Archive" : "Restore"}
                    </button>
                  </div>
                </form>
              </details>
            </section>
          ))}
        </div>
        <div className="flex flex-col gap-5">
          <Card title="New template" icon="plus">
            <form action={saveMessageTemplateAction} className="flex flex-col gap-2">
              <TemplateFields />
              <button className="btn btn-primary self-start">Add template</button>
            </form>
          </Card>
          <Card title="Placeholders" icon="template">
            <dl className="flex flex-col gap-2 text-sm">
              {Object.entries(PLACEHOLDERS).map(([k, v]) => (
                <div key={k}>
                  <dt>
                    <code className="text-accent">{`{${k}}`}</code>
                  </dt>
                  <dd className="text-xs text-muted">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted">
              Dates are never typed into a template: they always come from the cohort or the lead, so a deadline can’t drift. Prices, incentives and
              claims need Badr’s approval before they go into a template.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
