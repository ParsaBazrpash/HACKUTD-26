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
