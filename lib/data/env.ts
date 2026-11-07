import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_DATA_CLIENT: z.enum(["mock", "spacetimedb"]).default("mock"),
  NEXT_PUBLIC_SPACETIMEDB_URI: z.string().default(""),
  NEXT_PUBLIC_SPACETIMEDB_DATABASE: z.string().default(""),
});

export interface PublicEnv {
  dataClient: "mock" | "spacetimedb";
  spacetimedbUri: string;
  spacetimedbDatabase: string;
}

export function readPublicEnv(
  source: Record<string, string | undefined> = process.env,
): PublicEnv {
  const parsed = publicEnvSchema.parse({
    NEXT_PUBLIC_DATA_CLIENT: source.NEXT_PUBLIC_DATA_CLIENT || undefined,
    NEXT_PUBLIC_SPACETIMEDB_URI: source.NEXT_PUBLIC_SPACETIMEDB_URI ?? "",
    NEXT_PUBLIC_SPACETIMEDB_DATABASE: source.NEXT_PUBLIC_SPACETIMEDB_DATABASE ?? "",
  });

  return {
    dataClient: parsed.NEXT_PUBLIC_DATA_CLIENT,
    spacetimedbUri: parsed.NEXT_PUBLIC_SPACETIMEDB_URI,
    spacetimedbDatabase: parsed.NEXT_PUBLIC_SPACETIMEDB_DATABASE,
  };
}
