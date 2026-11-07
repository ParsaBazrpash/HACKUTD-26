import { afterEach, describe, expect, test, vi } from "vitest";
import type { IncidentClient } from "@/lib/client/types";

const calls = vi.hoisted(() => ({ mock: 0, real: 0 }));

vi.mock("@/lib/client/mock", () => ({
  createMockIncidentClient: () => {
    calls.mock += 1;
    return { kind: "mock" } as unknown as IncidentClient;
  },
}));

vi.mock("@/lib/client/real", () => ({
  createRealIncidentClient: () => {
    calls.real += 1;
    return { kind: "real" } as unknown as IncidentClient;
  },
}));

async function load(flag: string | undefined) {
  vi.resetModules();
  if (flag === undefined) vi.stubEnv("NEXT_PUBLIC_ZH_MOCK", "");
  else vi.stubEnv("NEXT_PUBLIC_ZH_MOCK", flag);
  return import("@/lib/client");
}

describe("getIncidentClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    calls.mock = 0;
    calls.real = 0;
  });

  test("does not construct a client on the server", async () => {
    const { getIncidentClient } = await load("1");
    expect(() => getIncidentClient()).toThrow(/browser/i);
    expect(calls.mock).toBe(0);
    expect(calls.real).toBe(0);
  });

  test("returns one mock client when demo mode is on", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:3001" } });
    const { getIncidentClient } = await load("1");
    const first = getIncidentClient();
    const second = getIncidentClient();
    expect(first).toBe(second);
    expect(calls.mock).toBe(1);
    expect(calls.real).toBe(0);
  });

  test("returns one real client when demo mode is off", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost:3001" } });
    const { getIncidentClient } = await load(undefined);
    const first = getIncidentClient();
    expect(getIncidentClient()).toBe(first);
    expect(calls.real).toBe(1);
    expect(calls.mock).toBe(0);
  });

  test.each(["0", "true", "false", "yes"])(
    "returns the real client when NEXT_PUBLIC_ZH_MOCK is %s",
    async (flag) => {
      vi.stubGlobal("window", { location: { origin: "http://localhost:3001" } });
      const { getIncidentClient, isMockIncidentClient } = await load(flag);
      expect(isMockIncidentClient()).toBe(false);
      getIncidentClient();
      expect(calls.real).toBe(1);
      expect(calls.mock).toBe(0);
    },
  );
});
