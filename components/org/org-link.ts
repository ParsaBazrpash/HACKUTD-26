// Enrollment fragment handling for /enroll. The fragment is read once, then
// removed from the address bar before enroll runs.

export const ENROLL_PATH = "/enroll";

/** Reads the fragment and, when one is present, removes it from the address bar. */
export function applyEnrollHash(hash: string, replace: (url: string) => void): string {
  if (hash.length > 1) {
    replace(ENROLL_PATH);
    return hash;
  }
  return "";
}

/** Same rule the client enforces: "+" then 8 to 15 digits, no leading zero. */
export function looksLikePhone(value: string): boolean {
  return /^\+[1-9][0-9]{7,14}$/.test(value);
}

export const PHONE_HINT = "Use your personal phone. Company phones may be down during an incident.";

export const PHONE_PREFIX = "+1";

/** Digits only, with a pasted leading +1 dropped. Extra digits are kept (not cut) so toUsE164 refuses them. */
export function usPhoneDigits(raw: string): string {
  return stripCountryCode(raw).slice(0, 15);
}

/** A US or Canadian number: area code and exchange both start with 2 to 9. */
const NANP = /^[2-9][0-9]{2}[2-9][0-9]{6}$/;

function stripCountryCode(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

/** The typed digits as E.164 (+1XXXXXXXXXX), or null unless they are a valid 10 digit US or Canadian number. */
export function toUsE164(raw: string): string | null {
  const digits = stripCountryCode(raw);
  if (!NANP.test(digits)) return null;
  const e164 = `${PHONE_PREFIX}${digits}`;
  return looksLikePhone(e164) ? e164 : null;
}

export const PHONE_ERROR = "Enter the 10 digit phone number, with no country code.";
