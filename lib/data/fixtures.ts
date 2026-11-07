import { ciphertextEnvelopeSchema, type CiphertextEnvelope } from "@/types/common";

/** A labeled placeholder slot. This is not encrypted data. */
export function fixtureEnvelope(keyId: string, label: string): CiphertextEnvelope {
  return ciphertextEnvelopeSchema.parse({
    version: 1,
    algorithm: "AES-GCM",
    provenance: "fixture",
    keyId,
    nonce: "fixture-nonce",
    ciphertext: `fixture:${label}`,
  });
}
