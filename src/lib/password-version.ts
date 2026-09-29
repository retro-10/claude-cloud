import { createHash } from "node:crypto";

// Not a secret and not reversible: just enough to notice that the stored password hash has changed.
export const passwordVersion = (passwordHash: string) => createHash("sha256").update(passwordHash).digest("hex").slice(0, 16);
