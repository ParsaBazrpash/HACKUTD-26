# HAVEN plan

HAVEN is a real-time war room for the first 72 hours of a ransomware response. Commanders, counsel, forensic investigators, and executives need one room when mail, chat, and identity may already be compromised.

SpacetimeDB is the only application backend. The browser is the only place incident plaintext and channel keys exist. This document separates the foundation that exists now from the product still to build.

## MVP

A judge can open two browsers, join the same incident, and watch a sealed event appear in both without the server ever seeing the message.

1. Publish a SpacetimeDB module whose tables match `spacetimedb/tables.ts`.
2. Subscribe from the browser and drive `SpacetimeDbIncidentClient` from that local cache.
3. Implement `lib/crypto` with Web Crypto: P-256 identity keys, AES-GCM channel payloads, ECDSA signatures.
4. Decrypt only in client components, then validate with the domain schemas in `types/domain.ts`.
5. Show one live path: join, post into the command channel, confirm the second browser can read it.
6. Keep the notice clocks tied to awareness time, with counsel confirmation still explicit.

The legal channel key is not wrapped for executive members. Privilege separation is part of the MVP, not a later polish pass.

## Phase 0 — foundation (this tree)

- App routes: `/`, `/incidents`, `/incidents/[incidentId]`, `/join`.
- Design tokens, shell, and prototype incident screens.
- Zod contracts for sealed shells and decrypted domain types.
- One `IncidentDataClient` interface, an in-memory prototype, and a SpacetimeDB client that refuses calls.
- Legal-clock projector over public statutes.
- Crypto boundary that throws instead of returning fake ciphertext.
- Vitest coverage for those boundaries. Playwright covers the shell routes.

The prototype shells are labeled fixtures. Integrity stays `unknown`. Nothing in Phase 0 is a verified security property.

## Phase 1 — SpacetimeDB module

Build the TypeScript module in `spacetimedb/` from the column classification already checked in. Tables hold ids, roles, timestamps, operational enums, public-key ids, and ciphertext envelopes.

Reducers accept the same shapes as `types/shells.ts`. They reject extra fields. They never take a private key, a channel key, or a narrative column.

Publish to SpacetimeDB Maincloud. Point `.env.local` at the websocket URI and database name, set `NEXT_PUBLIC_DATA_CLIENT=spacetimedb`, and replace the refusals in `lib/data/spacetimedb-client.ts` with a subscription cache. `getSnapshot` stays synchronous and reads that cache.

Do not add a Next.js route handler, server action, or second database beside it.

## Phase 2 — browser cryptography

Implement `createIncidentCrypto()` with `crypto.subtle` only.

- Generate a P-256 key pair on join. Persist the private key in the browser, not in SpacetimeDB and not in logs.
- Upload a public-key id plus the public key bytes the room needs for verification.
- Create a random AES-GCM key per channel. Wrap it to members of that channel.
- Seal and open version-1 envelopes. Set `provenance` to `browser-sealed` only after `subtle.encrypt` succeeds.
- Sign events and set integrity to `verified`, `unverified`, or `failed` with `source: "browser-verified"`.

Tests must use known Web Crypto vectors. A fixture envelope must never take the `browser-sealed` provenance. The UI must not say "encrypted" for a fixture.

## Phase 3 — war room

- Composer that seals an event into the selected channel and appends the envelope through the data client.
- Task and asset panels that render domain objects only after `open()` succeeds.
- Counsel notes sealed to the legal channel key.
- Deadline board already projected in `lib/legal`, with a manual "counsel confirmed" mark stored as metadata, not as a claim that the statute applies.
- Second-browser demo script for the MVP path.

## Phase 4 — harden the demo

- Playwright covers join, live update, and a failed signature.
- Threat-model page in the app: what the server can see, what a stolen laptop can see, what is not claimed.
- Remove the in-memory prototype from the default production env. Keep it for tests.

## Not in the MVP

Malware detonation, ransom payment flow, e-discovery review, SSO, email ingestion, native apps, and any sentence that says the deployment is legally compliant. Statute text in the catalog is a planning aid. Counsel decides whether a duty applies.

SEC Item 1.05 is four business days from a materiality determination. The projector refuses to invent that due time. HIPAA and state notice clocks can be added the same way, with the same honesty about when the clock starts.

## Track fit

SpacetimeDB: the module is the realtime system of record for shells, membership, and ciphertext. Two browsers stay in sync because they share a subscription, not because a Next.js server fans out messages.

Winstead: the room separates legal, command, forensics, and executive channels, and it puts notice clocks next to the work without storing case narrative next to them.
