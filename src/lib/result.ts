// Shared by the lib modules: the shape every save returns to its server action, and the one input trimmer.

export type Fail = { ok: false; error: string };
export type Result<T = object> = ({ ok: true } & T) | Fail;

/** Trimmed text, or null when blank; cut to `max` characters when given. */
export const clean = (s: string | null | undefined, max?: number) => (s?.trim() ? s.trim().slice(0, max) : null);
