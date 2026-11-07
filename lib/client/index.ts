// One incident client per browser tab (docs/PLAN.md seam 4).
//
// NEXT_PUBLIC_ZH_MOCK=1 selects the browser demo. Any other value selects
// the real client. This module does not construct either client on the server.

import { createMockIncidentClient } from "@/lib/client/mock";
import { createRealIncidentClient } from "@/lib/client/real";
import type { IncidentClient } from "@/lib/client/types";

let singleton: IncidentClient | undefined;

export function isMockIncidentClient(): boolean {
  return process.env.NEXT_PUBLIC_ZH_MOCK === "1";
}

export function getIncidentClient(): IncidentClient {
  if (typeof window === "undefined") {
    throw new Error("The incident client is only available in the browser.");
  }
  if (!singleton) {
    singleton = isMockIncidentClient() ? createMockIncidentClient() : createRealIncidentClient();
  }
  return singleton;
}
