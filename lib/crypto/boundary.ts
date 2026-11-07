/** Shape kept local so this obsolete stub does not depend on the deleted types model. */
interface CiphertextEnvelope {
  version: 1;
  algorithm: "AES-GCM";
  provenance: "fixture" | "browser-sealed";
  keyId: string;
  nonce: string;
  ciphertext: string;
}

/**
 * Browser sealing boundary.
 *
 * Intended design, not implemented and not verified:
 * - AES-GCM 256-bit for channel payloads
 * - ECDSA P-256 with SHA-256 for event signatures
 * - Web Crypto only. No hand-rolled cipher.
 *
 * These methods throw. They do not return placeholder ciphertext.
 */

export class CryptoNotImplementedError extends Error {
  constructor(operation: string) {
    super(
      `Refusing to ${operation}. Browser crypto is not implemented, and no placeholder ciphertext was produced.`,
    );
    this.name = "CryptoNotImplementedError";
  }
}

export interface IncidentCrypto {
  seal(plaintext: Uint8Array, keyId: string): Promise<CiphertextEnvelope>;
  open(envelope: CiphertextEnvelope): Promise<Uint8Array>;
}

function assertBrowser(): void {
  if (typeof window === "undefined") {
    throw new Error("Incident crypto runs in the browser. Refusing to seal or open on the server.");
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto SubtleCrypto is unavailable in this browser.");
  }
}

export function createIncidentCrypto(): IncidentCrypto {
  return {
    async seal(): Promise<CiphertextEnvelope> {
      assertBrowser();
      throw new CryptoNotImplementedError("seal incident plaintext");
    },
    async open(): Promise<Uint8Array> {
      assertBrowser();
      throw new CryptoNotImplementedError("open a sealed envelope");
    },
  };
}
