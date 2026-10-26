import { beforeAll, describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hashRecovery, hotp, newRecoveryCodes, newSecret, openSecret, otpauthUri, sealSecret, stepAt, verifyTotp } from "@/lib/totp";

const RFC_SECRET = Buffer.from("12345678901234567890");

describe("one-time codes follow the RFCs", () => {
  it("HOTP matches RFC 4226 appendix D", () => {
    expect([0, 1, 2, 3, 9].map((c) => hotp(RFC_SECRET, c))).toEqual(["755224", "287082", "359152", "969429", "520489"]);
  });

  it("TOTP matches RFC 6238 appendix B (SHA-1, 8 digits)", () => {
    expect(hotp(RFC_SECRET, stepAt(59_000), 8)).toBe("94287082");
    expect(hotp(RFC_SECRET, stepAt(1_111_111_109_000), 8)).toBe("07081804");
    expect(hotp(RFC_SECRET, stepAt(1_234_567_890_000), 8)).toBe("89005924");
    expect(hotp(RFC_SECRET, stepAt(20_000_000_000_000), 8)).toBe("65353130");
  });

  it("base32 round-trips, ignoring case, spaces and padding", () => {
    expect(base32Encode(RFC_SECRET)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq==").equals(RFC_SECRET)).toBe(true);
    expect(newSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
});

describe("verifying a code", () => {
  const secret = base32Encode(RFC_SECRET);
  const now = 1_234_567_890_000;
  const code = (ms: number) => hotp(RFC_SECRET, stepAt(ms));

  it("accepts the current step and one either side, nothing further", () => {
    expect(verifyTotp(secret, code(now), now)).toBe(stepAt(now));
    expect(verifyTotp(secret, code(now - 30_000), now)).toBe(stepAt(now) - 1);
    expect(verifyTotp(secret, code(now + 30_000), now)).toBe(stepAt(now) + 1);
    expect(verifyTotp(secret, code(now - 90_000), now)).toBeNull();
    expect(verifyTotp(secret, "12345", now)).toBeNull();
    expect(verifyTotp(secret, "abcdef", now)).toBeNull();
  });

  it("a code cannot be used twice, nor an older one after it", () => {
    const used = verifyTotp(secret, code(now), now)!;
    expect(verifyTotp(secret, code(now), now, used)).toBeNull();
    expect(verifyTotp(secret, code(now - 30_000), now, used)).toBeNull();
    expect(verifyTotp(secret, code(now + 30_000), now + 30_000, used)).toBe(used + 1);
  });

  it("the authenticator link names the account and the issuer", () => {
    expect(otpauthUri("ABC", "retro@orladent.local")).toBe(
      "otpauth://totp/OrlaDent%20CRM%3Aretro%40orladent.local?secret=ABC&issuer=OrlaDent%20CRM&algorithm=SHA1&digits=6&period=30",
    );
  });
});

describe("secrets at rest and recovery codes", () => {
  beforeAll(() => {
    process.env.AUTH_SECRET ??= "test-secret-".padEnd(48, "x");
  });

  it("sealed secrets open with the same AUTH_SECRET and fail closed when tampered with or the key changes", () => {
    const sealed = sealSecret("JBSWY3DPEHPK3PXP");
    expect(sealed).not.toContain("JBSWY3DPEHPK3PXP");
    expect(openSecret(sealed)).toBe("JBSWY3DPEHPK3PXP");
    const parts = sealed.split(".");
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith("A") ? "BB" : "AA");
    expect(openSecret(parts.join("."))).toBeNull();
    const before = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "another-secret-".padEnd(48, "y");
    expect(openSecret(sealed)).toBeNull();
    process.env.AUTH_SECRET = before;
  });

  it("recovery codes are distinct, readable, and hashed ignoring case and spaces", () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
    expect(hashRecovery(" ABCDE-fghjk ")).toBe(hashRecovery("abcde-fghjk"));
  });
});
