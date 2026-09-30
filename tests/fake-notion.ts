import { NotionError, pid, type NotionApi, type Page, type PropValue, type Props } from "@/lib/notion/client";

// An in-memory Notion with the same read and write shapes as the REST API, for the sync tests.
type Stored = { id: string; db: string; props: Props; edited: string; archived: boolean };

function read(v: Record<string, unknown>): PropValue {
  const text = (xs: { text: { content: string } }[]) => xs.map((x) => ({ plain_text: x.text.content }));
  if ("title" in v) return { type: "title", title: text(v.title as never) };
  if ("rich_text" in v) return { type: "rich_text", rich_text: text(v.rich_text as never) };
  if ("number" in v) return { type: "number", number: v.number as number | null };
  if ("select" in v) return { type: "select", select: v.select as { name: string } | null };
  if ("multi_select" in v) return { type: "multi_select", multi_select: v.multi_select as { name: string }[] };
  if ("date" in v) return { type: "date", date: v.date as { start: string } | null };
  if ("checkbox" in v) return { type: "checkbox", checkbox: v.checkbox as boolean };
  if ("relation" in v) return { type: "relation", relation: (v.relation as { id: string }[]).map((r) => ({ id: r.id })) };
  if ("email" in v) return { type: "email", email: v.email as string | null };
  if ("phone_number" in v) return { type: "phone_number", phone_number: v.phone_number as string | null };
  if ("url" in v) return { type: "url", url: v.url as string | null };
  throw new Error("unknown property shape " + JSON.stringify(v));
}

let n = 0;
const uuid = () => {
  const h = (++n).toString(16).padStart(32, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export class FakeNotion implements NotionApi {
  pages = new Map<string, Stored>();
  databases = new Map<string, { parent: string; title: string }>();
  calls = 0;
  private clock = Date.now();

  private tick() {
    // strictly increasing edit times, never behind the real clock
    this.clock = Math.max(this.clock + 1, Date.now());
    return new Date(this.clock).toISOString();
  }
  private view(p: Stored): Page {
    return { id: p.id, last_edited_time: p.edited, archived: p.archived, properties: Object.fromEntries(Object.entries(p.props).map(([k, v]) => [k, read(v as never)])) };
  }

  async query(databaseId: string, since: Date | null) {
    this.calls++;
    return [...this.pages.values()]
      .filter((p) => pid(p.db) === pid(databaseId) && !p.archived && (!since || p.edited >= since.toISOString()))
      .sort((a, b) => a.edited.localeCompare(b.edited))
      .map((p) => this.view(p));
  }
  async create(databaseId: string, properties: Props) {
    this.calls++;
    const p: Stored = { id: uuid(), db: databaseId, props: { ...properties }, edited: this.tick(), archived: false };
    this.pages.set(pid(p.id), p);
    return this.view(p);
  }
  async update(pageId: string, properties: Props) {
    this.calls++;
    const p = this.pages.get(pid(pageId));
    if (!p) throw new NotionError(404, "object_not_found", "Could not find page");
    if (p.archived) throw new NotionError(400, "validation_error", "Can't edit block that is archived.");
    p.props = { ...p.props, ...properties };
    p.edited = this.tick();
    return this.view(p);
  }
  async archive(pageId: string) {
    this.calls++;
    const p = this.pages.get(pid(pageId));
    if (!p) throw new NotionError(404, "object_not_found", "Could not find page");
    p.archived = true;
    p.edited = this.tick();
  }
  async createDatabase(parentPageId: string, title: string) {
    this.calls++;
    const id = uuid();
    this.databases.set(pid(id), { parent: parentPageId, title });
    return { id };
  }

  // ---- what a person does in Notion ----
  edit(pageId: string, properties: Props) {
    const p = this.pages.get(pid(pageId))!;
    p.props = { ...p.props, ...properties };
    p.edited = this.tick();
  }
  add(databaseId: string, properties: Props) {
    const p: Stored = { id: uuid(), db: databaseId, props: properties, edited: this.tick(), archived: false };
    this.pages.set(pid(p.id), p);
    return p.id;
  }
  remove(pageId: string) {
    const p = this.pages.get(pid(pageId))!;
    p.archived = true;
    p.edited = this.tick();
  }
  inDb(databaseId: string) {
    return [...this.pages.values()].filter((p) => pid(p.db) === pid(databaseId) && !p.archived);
  }
  prop(pageId: string, name: string) {
    return read(this.pages.get(pid(pageId))!.props[name] as never);
  }
}
