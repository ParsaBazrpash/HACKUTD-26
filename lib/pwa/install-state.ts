export type InstallSurface = "standalone" | "prompt" | "ios" | "unavailable";

export function installSurface(input: {
  standalone: boolean;
  ios: boolean;
  promptAvailable: boolean;
}): InstallSurface {
  if (input.standalone) return "standalone";
  if (input.promptAvailable) return "prompt";
  if (input.ios) return "ios";
  return "unavailable";
}

/** iPhone, iPod, and iPad, including iPadOS desktop user agents. */
export function isIosDevice(ua: string, platform: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1;
}

/** Chrome, Firefox, and Edge on iOS cannot add a Home Screen app themselves. */
export function isIosOtherBrowser(ua: string): boolean {
  return /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
}
