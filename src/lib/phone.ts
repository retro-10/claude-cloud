const ARABIC_INDIC = /[٠-٩۰-۹]/g;

function westernDigits(s: string) {
  return s.replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) & 0xf));
}

// Normalise to E.164 (+201001234567). Numbers without a country code are assumed Egyptian.
// Returns null when the input can't be a phone number.
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = westernDigits(raw.trim());
  let digits = s.replace(/\D/g, "");
  if (!digits) return null;

  if (s.startsWith("+")) {
    // "+2001001234567": stray trunk 0 after the country code
    if (digits.startsWith("200")) digits = "20" + digits.slice(3);
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = "20" + digits.slice(1); // local format 010...
  } else if (digits.length === 10 && digits.startsWith("1")) {
    digits = "20" + digits; // Egyptian mobile typed without the leading 0
  }
  if (digits.length < 8 || digits.length > 15) return null;
  if (digits.startsWith("20") && !validEgyptian(digits.slice(2))) return null;
  return "+" + digits;
}

// Egyptian numbers after the +20: mobiles are 10 digits starting 10, 11, 12 or 15;
// landlines are 9 digits (Cairo 2 + 8 digits, other areas 2-digit code + 7 digits).
function validEgyptian(national: string): boolean {
  if (national.startsWith("1")) return /^1[0125]\d{8}$/.test(national);
  return /^[2-9]\d{7,8}$/.test(national);
}

/** Why a number was rejected, in words the user can act on. */
export function phoneProblem(raw: string | null | undefined): string | null {
  if (!raw?.trim() || normalizePhone(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8) return "That number is too short. Egyptian mobiles look like 010 1234 5678.";
  return "That doesn't look like a valid number. Egyptian mobiles are 11 digits starting 010, 011, 012 or 015; other countries need a + and country code.";
}

export function whatsappUrl(e164: string | null | undefined): string | null {
  return e164 ? `https://wa.me/${e164.replace(/\D/g, "")}` : null;
}
