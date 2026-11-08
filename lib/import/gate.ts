// The decisions the import panel makes before anything is sent. Kept pure so tests can prove them.

export interface HasHash {
  body: { sha256: string };
}

/** The evidence row already on the record with this file hash, if any. */
export function findDuplicate<T extends HasHash>(evidence: readonly T[], sha256: string): T | undefined {
  return evidence.find((e) => e.body.sha256 === sha256);
}

/** Flagged rows start unchecked; clean ones start checked. */
export function startsChecked(flags: readonly string[]): boolean {
  return flags.length === 0;
}

/** The send button is enabled only when something is selected, a duplicate is acknowledged, and nothing is running. */
export function canSend(s: { total: number; duplicate: boolean; again: boolean; sending: boolean; sent: boolean }): boolean {
  return s.total > 0 && !(s.duplicate && !s.again) && !s.sending && !s.sent;
}
