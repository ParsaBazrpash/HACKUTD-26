import { parseEnrollFragment } from "@/lib/protocol/org";

/**
 * The QR holds the HAVEN address as an origin and nothing else: no path, query or
 * fragment. Returns null when the address is not http(s) or cannot be parsed.
 */
export function cardQrText(address: string): string | null {
  try {
    const url = new URL(address);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Same format as formatFingerprint in lib/crypto/keys (first 16 bytes, hex, groups of 4).
 * Kept local because the UI may not import lib/crypto; a test pins the two together.
 */
function formatAdminFingerprint(fp: Uint8Array): string {
  const hex = Array.from(fp.subarray(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  return (hex.match(/.{4}/g) ?? []).join(" ");
}

/** Returns only the formatted admin fingerprint from an enroll fragment, or null. */
export function fingerprintFromEnrollFragment(fragment: string | null): string | null {
  if (!fragment) return null;
  try {
    const parsed = parseEnrollFragment(fragment);
    return parsed ? formatAdminFingerprint(parsed.adminFingerprint) : null;
  } catch {
    return null;
  }
}

export const CARD_PURPOSE = "Use it when company email, chat or laptops are down or hacked.";
export const CARD_FOOTER = "HAVEN never asks for a code. This card cannot sign you in or let anyone in.";
export const CARD_REPLACE = "Lost or damaged? Ask IT or your admin for a new one.";
export const CARD_NO_FINGERPRINT = "Shown on the Org page after your admin approves you.";

export const CARD_HOW_TO = {
  handyTitle: "WHEN IT COMES IN HANDY",
  handy: [
    "Company email, chat or laptops are down, or may be in the attacker's hands, and you still need to reach the response team.",
    "HAVEN calls or texts you, and you want to open it without trusting a link someone sent.",
    "You want to check that the admin in HAVEN is really your admin.",
  ],
  whenTitle: "WHEN TO SAVE IT",
  when: "Now, while HAVEN is working. On the day you need this card, company systems may not be there to look it up. You can save it again any time from the Org page.",
  whereTitle: "WHERE TO KEEP IT",
  where:
    "Print it and keep it in your wallet, or save the image to Photos on your personal phone. Do not keep it only on a work laptop or in work email: those may be the systems under attack. If you lose it or it gets damaged, tell IT or your admin and save a new one. Nothing on it lets anyone in, so a lost card is not a break-in.",
  howTitle: "HOW TO USE IT",
  how: [
    "You get a call or text from HAVEN, or hear about an incident. Do not use links from company email or chat.",
    "On your personal phone, scan the QR or type the address, in the browser you enrolled with. Check that the address bar matches the card exactly.",
    "Open Org in HAVEN and check that the admin fingerprint matches this card. If it does not, stop and call your admin on a number you already know.",
    "HAVEN never asks for a code and never asks you to enroll again out of the blue. If a page does, it is not HAVEN. Only trust a card you saved yourself.",
  ],
} as const;
