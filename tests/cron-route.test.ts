import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
const runTick = vi.fn(async () => ({ rules: "ok" }));
vi.mock("@/lib/tick", () => ({ runTick }));

const call = async (auth?: string) => {
  const { GET } = await import("@/app/api/cron/tick/route");
  return GET(new NextRequest("http://x/api/cron/tick", { headers: auth ? { authorization: auth } : {} }));
};

describe("/api/cron/tick", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    runTick.mockClear();
  });
  it("is off without CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer anything")).status).toBe(404);
    expect(runTick).not.toHaveBeenCalled();
  });
  it("refuses a wrong or missing token, and runs the round with the right one", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-token");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect(runTick).not.toHaveBeenCalled();
    const ok = await call("Bearer s3cret-token");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, steps: { rules: "ok" } });
    expect(runTick).toHaveBeenCalledWith({}, { backup: true, notion: true });
  });
  it("leaves the backup to the GitHub Action when BACKUP_IN_APP=false", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-token");
    vi.stubEnv("BACKUP_IN_APP", "false");
    await call("Bearer s3cret-token");
    expect(runTick).toHaveBeenCalledWith({}, { backup: false, notion: true });
  });
});
