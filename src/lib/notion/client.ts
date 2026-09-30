// A small Notion REST client (no SDK). Notion allows about 3 requests per second per integration, so
// every call goes through one queue spaced 340 ms apart, and 429 / 5xx answers are retried with backoff
// (honouring Retry-After). The token only ever comes from the environment.

export type Page = {
  id: string;
  last_edited_time: string;
  archived?: boolean;
  in_trash?: boolean;
  properties: Record<string, PropValue>;
};
// what the API returns for one property; only the shapes we read are typed
export type PropValue = {
  type: string;
  title?: { plain_text: string }[];
  rich_text?: { plain_text: string }[];
  number?: number | null;
  select?: { name: string } | null;
  date?: { start: string } | null;
  checkbox?: boolean;
  relation?: { id: string }[];
  email?: string | null;
  phone_number?: string | null;
  url?: string | null;
};
export type Props = Record<string, unknown>; // properties in the write format

export interface NotionApi {
  /** Pages of a database edited at or after `since` (all when null), oldest edits first. */
  query(databaseId: string, since: Date | null): Promise<Page[]>;
  create(databaseId: string, properties: Props): Promise<Page>;
  update(pageId: string, properties: Props): Promise<Page>;
  archive(pageId: string): Promise<void>;
  createDatabase(parentPageId: string, title: string, properties: Record<string, unknown>): Promise<{ id: string }>;
}

export class NotionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const VERSION = "2022-06-28";
const GAP_MS = 340;

export class NotionHttp implements NotionApi {
  private last = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly token: string,
    private readonly base = "https://api.notion.com/v1",
    private readonly sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  private call<T>(method: string, path: string, body?: unknown): Promise<T> {
    // serialise every request through one queue, spaced for the rate limit
    const run = async (): Promise<T> => {
      for (let attempt = 0; ; attempt++) {
        const wait = this.last + GAP_MS - Date.now();
        if (wait > 0) await this.sleep(wait);
        this.last = Date.now();
        let res: Response;
        try {
          res = await fetch(this.base + path, {
            method,
            headers: { Authorization: `Bearer ${this.token}`, "Notion-Version": VERSION, "Content-Type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(30_000),
          });
        } catch (e) {
          if (attempt < 4) {
            await this.sleep(1000 * 2 ** attempt);
            continue;
          }
          throw new NotionError(0, "network", `Notion could not be reached (${(e as Error).name})`);
        }
        if (res.ok) return (await res.json()) as T;
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < 4) {
          const after = Number(res.headers.get("retry-after"));
          await this.sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * 2 ** attempt);
          continue;
        }
        const err = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
        throw new NotionError(res.status, err.code ?? "error", err.message ?? `Notion answered ${res.status}`);
      }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  async query(databaseId: string, since: Date | null) {
    const out: Page[] = [];
    let cursor: string | undefined;
    do {
      const r = await this.call<{ results: Page[]; has_more: boolean; next_cursor: string | null }>("POST", `/databases/${databaseId}/query`, {
        page_size: 100,
        start_cursor: cursor,
        sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
        filter: since ? { timestamp: "last_edited_time", last_edited_time: { on_or_after: since.toISOString() } } : undefined,
      });
      out.push(...r.results);
      cursor = r.has_more ? (r.next_cursor ?? undefined) : undefined;
    } while (cursor);
    return out;
  }

  create(databaseId: string, properties: Props) {
    return this.call<Page>("POST", "/pages", { parent: { database_id: databaseId }, properties });
  }

  update(pageId: string, properties: Props) {
    return this.call<Page>("PATCH", `/pages/${pageId}`, { properties });
  }

  async archive(pageId: string) {
    await this.call("PATCH", `/pages/${pageId}`, { archived: true });
  }

  createDatabase(parentPageId: string, title: string, properties: Record<string, unknown>) {
    return this.call<{ id: string }>("POST", "/databases", {
      parent: { type: "page_id", page_id: parentPageId },
      title: [{ type: "text", text: { content: title } }],
      properties,
    });
  }
}

// ---------------- property helpers (write format / read format) ----------------

const chunks = (s: string) => (s.match(/[\s\S]{1,2000}/g) ?? []).slice(0, 50).map((c) => ({ type: "text", text: { content: c } }));

export const put = {
  title: (s: string | null | undefined) => ({ title: chunks(s ?? "") }),
  text: (s: string | null | undefined) => ({ rich_text: chunks(s ?? "") }),
  number: (n: number | null | undefined) => ({ number: n ?? null }),
  select: (s: string | null | undefined) => ({ select: s ? { name: s.replace(/,/g, " ") } : null }),
  date: (ymd: string | null | undefined) => ({ date: ymd ? { start: ymd } : null }),
  checkbox: (b: boolean) => ({ checkbox: b }),
  relation: (ids: (string | null | undefined)[]) => ({ relation: ids.filter(Boolean).map((id) => ({ id })) }),
  email: (s: string | null | undefined) => ({ email: s || null }),
  phone: (s: string | null | undefined) => ({ phone_number: s || null }),
  url: (s: string | null | undefined) => ({ url: s || null }),
};

const plain = (xs: { plain_text: string }[] | undefined) => (xs ?? []).map((x) => x.plain_text).join("");

export const get = {
  text: (p: PropValue | undefined): string | null => {
    const s = p ? plain(p.title ?? p.rich_text) : "";
    return s.trim() ? s : null;
  },
  number: (p: PropValue | undefined): number | null => (typeof p?.number === "number" ? p.number : null),
  select: (p: PropValue | undefined): string | null => p?.select?.name ?? null,
  date: (p: PropValue | undefined): string | null => p?.date?.start?.slice(0, 10) ?? null,
  checkbox: (p: PropValue | undefined): boolean => !!p?.checkbox,
  relation: (p: PropValue | undefined): string[] => (p?.relation ?? []).map((r) => r.id),
  email: (p: PropValue | undefined): string | null => p?.email ?? null,
  phone: (p: PropValue | undefined): string | null => p?.phone_number ?? null,
};

/** Notion ids come with or without dashes; compare them in one form. */
export const pid = (id: string) => id.replace(/-/g, "").toLowerCase();
