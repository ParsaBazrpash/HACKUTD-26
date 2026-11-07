<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ZeroHour agent guide

ZeroHour is a sealed incident-response war room. SpacetimeDB is the only application backend. The browser is the only place incident plaintext and channel keys may exist.

Read `docs/PLAN.md` before adding a feature. Phase 0 is the foundation. Do not skip ahead by faking later phases.

## Layout

| Path | Owns |
| --- | --- |
| `app/` | Routes, layouts, and route-level loading or error UI. No business logic. |
| `components/` | Visual shell and screens. |
| `hooks/` | Browser subscriptions to the incident client. |
| `types/common.ts` | Roles, integrity, ids, ciphertext envelopes. |
| `types/shells.ts` | Records the data client may store. |
| `types/domain.ts` | Decrypted shapes. Browser memory only, and only after real `open()`. |
| `types/legal.ts` | Notice-clock projections. Statute text is public. Counsel notes are sealed. |
| `lib/data/` | `IncidentDataClient`, prototype client, SpacetimeDB client, sensitive-field guard. |
| `lib/crypto/` | Web Crypto boundary. Throws until Phase 2. |
| `lib/legal/` | Public statute catalog and deadline projector. |
| `spacetimedb/` | Future module. `tables.ts` is a column classification, not a running module. |
| `tests/` | Vitest. |
| `e2e/` | Playwright. |

Import application code through the `@/` alias. Zod schemas are the source of truth. Export types with `z.infer`.

## Security invariants

These are hard rules. A demo, a judge walkthrough, or a "temporary" prototype does not waive them.

1. Never send incident plaintext or channel-key material to SpacetimeDB, a Next.js server, logs, or source.
2. Do not add a route handler, a server action, Prisma, Firebase, Supabase, or any second backend for incident data.
3. Sensitive screens render decrypted text only in the browser, and only after `lib/crypto` actually opens an envelope.
4. Do not invent a cipher, and do not return placeholder ciphertext from `seal` or `open`. A fixture uses `provenance: "fixture"` and a `fixture:` prefix. It is not encrypted.
5. Never put a private key, channel key, or raw key bytes in a field named `keyId`. `keyId` is a lookup id.
6. Integrity `verified`, `unverified`, or `failed` requires `source: "browser-verified"`. The server cannot claim that a signature checked out.
7. The legal channel key is not shared with executive members. Do not write counsel notes into a command or executive payload.
8. Say "fixture" and "not implemented" in the UI until the corresponding Web Crypto call exists. Do not describe Phase 0 as end-to-end encryption.

`lib/data/sensitive.ts` rejects narrative field names and PEM private keys on anything the prototype client holds. `assertPrototypeFixtures` rejects `browser-sealed` envelopes until sealing exists. Keep both checks on write paths.

Shell schemas are strict objects. A decrypted `Incident` must fail `incidentShellSchema`. Domain types stay out of `app/`, `components/`, `hooks/`, `lib/data/`, and `spacetimedb/` until a screen is actually decrypting.

## Data client

`IncidentDataClient` is the only incident API. The prototype and the SpacetimeDB client both implement it.

- `getIncidentList` and `getSnapshot` are synchronous reads of a local cache.
- `subscribe` wakes listeners after that cache changes.
- `joinIncident` accepts `JoinIncidentInput` only: incident id, role, optional public-key id.
- Display names stay in component state. They are not client fields.

`SpacetimeDbIncidentClient` refuses every call until the module is connected. An empty list would look like a quiet room. A thrown `SpacetimeModuleNotReadyError` is the honest state. Do not catch it and render seed data.

The future SpacetimeDB implementation subscribes, writes reducer arguments that already match shell schemas, and serves `getSnapshot` from the SDK cache. It does not decrypt.

## Crypto

`createIncidentCrypto()` is the only encryption entry point. It runs in the browser, uses `crypto.subtle`, and currently throws `CryptoNotImplementedError`.

Phase 2 algorithms, not yet implemented:

- AES-GCM with a 256-bit key for channel payloads.
- ECDSA on P-256 with SHA-256 for event signatures.
- Per-channel keys wrapped to the members who belong in that channel.

No hand-rolled stream cipher, no passphrase stored in `localStorage` as "the key", no ciphertext built from `btoa`.

## Next.js 16

This app enables Cache Components and Partial Prefetching. Dynamic `params` are a Promise. Await them inside `<Suspense>` so the static shell can still prerender.

Do not call `Date.now()`, `crypto.randomUUID()`, or `Math.random()` while a Server Component renders. Clocks that tick belong in client components and start after mount.

Client components may import the incident client. Server components may render the marketing page and the public statute catalog. They do not load incident shells.

## Code conventions

- TypeScript strict. Validate at the client boundary with Zod.
- Keep route files thin. Put screens in `components/`.
- Prefer named exports for shared modules. Route files use the framework's default export.
- Operational enums (status, role, channel kind) may be stored. Narratives, hostnames, and message bodies may not.
- Comments belong on security boundaries and non-obvious framework constraints, not on obvious JSX.
- Tests live in `tests/` for units and `e2e/` for browser flows. A new shell field needs a schema test and a sensitive-field test.
- Do not add incident content, keys, or credentials to `.env`, fixtures, or log calls.

## Commands

`npm run dev`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`. End-to-end tests need `npx playwright install chromium` once, then `npm run test:e2e`.
