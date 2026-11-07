import type { IncidentDataClient } from "@/lib/data/client";
import { readPublicEnv, type PublicEnv } from "@/lib/data/env";
import { createMockIncidentDataClient } from "@/lib/data/mock-client";
import { SpacetimeDbIncidentClient } from "@/lib/data/spacetimedb-client";

export function createIncidentDataClient(env: PublicEnv = readPublicEnv()): IncidentDataClient {
  if (env.dataClient === "spacetimedb") {
    return new SpacetimeDbIncidentClient({
      uri: env.spacetimedbUri,
      database: env.spacetimedbDatabase,
    });
  }
  return createMockIncidentDataClient();
}

export { UnknownIncidentError, SpacetimeModuleNotReadyError, InvalidSpacetimeTargetError } from "@/lib/data/client";
export type { IncidentDataClient, IncidentSnapshot } from "@/lib/data/client";
export { readPublicEnv } from "@/lib/data/env";
export type { PublicEnv } from "@/lib/data/env";
export { createMockIncidentDataClient } from "@/lib/data/mock-client";
export { SpacetimeDbIncidentClient } from "@/lib/data/spacetimedb-client";
