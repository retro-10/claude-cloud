import { asc } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { Flash } from "@/components/Flash";
import { MIN_PASSWORD } from "@/lib/settings";
import { requirePageCan } from "@/lib/server-auth";
import { formatCairo } from "@/lib/time";
import { createUserAction, resetPasswordAction, updateUserAction } from "../actions";

export const metadata = { title: "Users · Settings" };
const box = "rounded border border-line bg-bg px-2 py-1.5 text-sm";
const ROLES = [
  ["owner", "owner (full access, admin)"],
  ["sales", "sales (edit leads, no settings)"],
  ["viewer", "viewer (read only)"],
  ["finance", "finance (payments, revenue export)"],
] as const;

export default async function UsersPage({ searchParams }: { searchParams: { notice?: string; error?: string } }) {
  const me = await requirePageCan("users:manage");
  const list = await db.select().from(users).orderBy(asc(users.id));
  return (
    <>
      <Flash {...searchParams} />
      <ul className="mb-8 flex flex-col gap-3">
        {list.map((u) => (
          <li key={u.id} className="rounded border border-line bg-surface p-3">
            <form action={updateUserAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="id" value={u.id} />
              <label className="flex flex-col gap-1 text-xs text-muted">
                Name
                <input name="name" defaultValue={u.name} required dir="auto" className={box} />
              </label>
              <div className="flex flex-col gap-1 text-xs text-muted">
                Email
                <span className="py-1.5 text-sm text-fg" dir="ltr">
                  {u.email}
                </span>
              </div>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Role
                <select name="role" defaultValue={u.role} className={box}>
                  {ROLES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 py-1.5 text-sm">
                <input type="checkbox" name="active" defaultChecked={u.active} /> Active
              </label>
              <button className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink">Save</button>
              {u.id === me.id && <span className="text-xs text-muted">(you)</span>}
              {!u.passwordChangedAt && <span className="text-xs text-warn">still on the initial password</span>}
            </form>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted hover:text-fg">Reset password</summary>
              <form action={resetPasswordAction} className="mt-2 flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={u.id} />
                <label className="flex flex-col gap-1 text-xs text-muted">
                  New password (min {MIN_PASSWORD} characters)
                  <input name="password" type="password" minLength={MIN_PASSWORD} required autoComplete="new-password" className={box} />
                </label>
                <button className="rounded border border-line px-3 py-1.5 text-sm hover:border-gold">Reset</button>
                <span className="text-xs text-muted">Signs them out everywhere. Created {formatCairo(u.createdAt, false)}.</span>
              </form>
            </details>
          </li>
        ))}
      </ul>

      <form action={createUserAction} className="grid max-w-2xl grid-cols-1 gap-3 rounded border border-line bg-surface p-3 sm:grid-cols-2">
        <h2 className="font-display text-lg sm:col-span-2">Add a user</h2>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Name
          <input name="name" required dir="auto" className={box} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Email
          <input name="email" type="email" required autoComplete="off" dir="ltr" className={box} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Role
          <select name="role" defaultValue="sales" className={box}>
            {ROLES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Initial password (min {MIN_PASSWORD} characters)
          <input name="password" type="password" minLength={MIN_PASSWORD} required autoComplete="new-password" className={box} />
        </label>
        <div className="sm:col-span-2">
          <button className="rounded bg-gold px-3 py-1.5 text-sm font-medium text-ink">Create user</button>
          <span className="ml-3 text-xs text-muted">They are asked to set their own password after signing in.</span>
        </div>
      </form>
    </>
  );
}
