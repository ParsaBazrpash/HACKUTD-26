import { afterEach, describe, expect, test, vi } from "vitest";
import { CryptoNotImplementedError, createIncidentCrypto } from "@/lib/crypto";
import { findPlaintextColumns } from "@/spacetimedb/tables";
import { formatDuration, formatTimestamp } from "@/lib/time";

describe("crypto boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("refuses to seal on the server", async () => {
    await expect(createIncidentCrypto().seal(new Uint8Array([1]), "key-1")).rejects.toThrow(/browser/i);
  });

  test("does not invent ciphertext once a browser is present", async () => {
    vi.stubGlobal("window", globalThis);
    const crypto = createIncidentCrypto();
    await expect(crypto.seal(new Uint8Array([1, 2, 3]), "key-1")).rejects.toBeInstanceOf(
      CryptoNotImplementedError,
    );
    await expect(
      crypto.open({
        version: 1,
        algorithm: "AES-GCM",
        provenance: "fixture",
        keyId: "fixture-key",
        nonce: "fixture-nonce",
        ciphertext: "fixture:sample",
      }),
    ).rejects.toBeInstanceOf(CryptoNotImplementedError);
  });
});

describe("module outline and clocks", () => {
  test("SpacetimeDB columns have no plaintext class", () => {
    expect(findPlaintextColumns()).toEqual([]);
  });

  test("formats durations and UTC timestamps", () => {
    expect(formatDuration(0)).toBe("00:00:00");
    expect(formatDuration(90_000)).toBe("00:01:30");
    expect(formatDuration(-1000)).toBe("-00:00:01");
    expect(formatDuration(72 * 60 * 60 * 1000)).toBe("72:00:00");
    expect(formatTimestamp("2026-11-07T14:12:00.000Z")).toBe("07 Nov 14:12 UTC");
    expect(formatTimestamp(new Date("2026-11-07T14:12:00.000Z"))).toBe("07 Nov 14:12 UTC");
  });
});
