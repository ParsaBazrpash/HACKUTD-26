# ZeroHour threat model

**Status legend:** Planned (designed, not built yet), Done (built and verified by the listed test or demo), Accepted (a known limit, stated openly), Downgraded (a fallback was taken; see note). Keep this table honest: never mark a row Done without the proof existing in the repo.

## Assumptions

- **Attacker capabilities (Winstead's rule):** full control of the victim's network, and full access to the ZeroHour server and database: they can read every table, run SQL as the owner, edit or delete rows, replay traffic, and publish a modified module.
- **What we trust:** each responder's own device and browser while it is not compromised; the incident commander's device as the root of trust; the out-of-band channel used to hand over an invite link (in person, phone call, Signal).
- **Security goal:** the server learns structure (ids, roles, timestamps, sizes) but never content, and cannot forge, reorder, roll back or silently delete anything without every client detecting it. Availability against a malicious server is out of scope (it can always go offline).

## Assets

Message and record content (including attorney-client privileged communications); the roster and roles; the integrity of the incident record (it may become evidence); legal deadlines; device private keys; invite links.

## Trust boundaries

1. Browser to Spacetime (reducer calls and view subscriptions over TLS). Everything crossing it is ciphertext, signatures, public keys, or structural metadata.
2. Static client host (Vercel) to browser. The client code itself is a trust dependency (T10).
3. Out-of-band invite delivery (commander to joiner).

## Threats and mitigations

### Attacker with full server access (insider or compromised host)

| # | Threat | Mitigation | Where | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| T1 | Reads messages or the record from tables, backups or logs | All content AES-256-GCM encrypted in the browser with per-channel keys that never leave devices; module logs ids only | `lib/crypto/seal.ts`, `spacetimedb/src/index.ts` | Demo: `spacetime sql "SELECT * FROM event"` shows bytes; test `seal.test.ts` ciphertext contains no plaintext | Done |
| T2 | Forges an entry as a responder | ECDSA P-256 signature by the author's non-extractable device key over every event; clients verify against the commander-certified roster; the module also verifies every event, admission and revocation signature | `lib/crypto/sign.ts`, `lib/crypto/verify.ts`, `append_event` | `verify.test.ts` forged and swapped signatures fail; `module.test.ts` unsigned and wrongly signed appends are rejected | Done |
| T3 | Edits, reorders or deletes past entries | Per-channel SHA-256 hash chain assigned in a transactional reducer and recomputed by every client; no update or delete reducer exists | `append_event`, `lib/crypto/chain.ts`, `verify.ts` | Demo: owner `UPDATE` turns screens red at that seq (scripted in `live/tamper.live.ts`, run with `npm run test:live` on a machine with the Spacetime CLI); `verify.test.ts` reorder and broken link cases; `real.test.ts` ciphertext tamper | Done |
| T4 | Rewrites the whole history consistently, or rolls it back | Clients pin the last verified `{seq, hash}` per channel in IndexedDB and re-check it; commander-signed checkpoints every 10 events, checked by every reader and by the module; head hashes printed in the report | `verify.ts` step 8, `post_checkpoint`, report | `verify.test.ts` rewritten-history, rollback and checkpoint cases; `real.test.ts` checkpoint truncation case | Done |
| T5 | Injects a fake member or swaps a member's public key to intercept channel keys | Commander-signed admission certificate binds identity, role, name and both public keys; joiner proves knowledge of the invite secret via HMAC; 12-digit safety code read aloud; commander key pinned from the invite fingerprint | `lib/crypto/invite.ts`, `keys.ts`, `admit_member` | `invite.test.ts` wrong tag; `verify.test.ts` uncertified author ignored; fingerprint mismatch screen | Done |
| T6 | Replays or duplicates an old message | Unique client event id and strictly increasing per-author counter, both inside the signed input; module and clients reject repeats | `append_event`, `verify.ts` step 7 | Module test duplicate id and stale counter; `verify.test.ts` replay | Done |
| T7 | Moves a ciphertext to another channel, epoch or incident | AES-GCM associated data binds incident, channel, epoch, author, event id and counter | `seal.ts` | `seal.test.ts` wrong-AAD cases fail | Done |
| T8 | Withholds rows or key envelopes | Cannot be prevented by an untrusted server; clients detect seq gaps and missing keys and show them | `verify.ts` steps 1 and 5 | `verify.test.ts` gap case | Accepted (detect only) |
| T9 | Publishes a malicious module version | Confidentiality and integrity never depend on module logic (all checks repeated client-side); publish rights limited to one owner identity whose token stays off the demo machine | Process | README note | Planned |
| T10 | Serves tampered client JavaScript | Client hosted separately from the database; every deploy is tied to a Git commit in the Vercel dashboard (the site itself does not show a build hash); lockfile and `npm ci`; production answer is a signed desktop build | `next.config.ts`, Vercel deployment record | Manual check | Accepted (documented) |

### Members and accounts

| # | Threat | Mitigation | Where | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| T11 | A member reads a channel their role does not allow | Views filter by role; the channel key is never wrapped for that role (module rejects such envelopes) | `my_events`, `my_envelopes`, `admit_member`, `policy.ts` | Module test: Technical gets no privileged rows or envelopes | Done |
| T12 | A member calls admin actions | Every reducer checks active membership and role; clients re-check payload kinds against the same policy | All reducers, `lib/protocol/events.ts` | Module test per reducer | Done |
| T13 | A revoked or compromised member keeps access | Revoke sets state immediately (views go empty, reducers reject) and rotates every readable channel to a new epoch; revocation signed and logged in #record; revoked client wipes local keys | `revoke_member`, `real.ts` | Demo: target locks (scripted in `live/revoke.live.ts` against Maincloud); module test old-epoch append rejected; `real.test.ts` revoke case | Done |
| T14 | An insider deletes or alters evidence | Append-only for every role including commander; corrections are new entries with `amends` | Module (no delete path), `events.ts` | Code review: no delete or update on `event` | Done |
| T15 | Display-name impersonation and look-alike Unicode | NFKC normalization, control and bidi characters stripped, unique per incident; role badge and fingerprint always shown | `limits.ts`, `create_incident`, `redeem_invite`, UI | `names.test.ts` | Done |

### Joining and sessions

| # | Threat | Mitigation | Where | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| T16 | Leaked invite link | Single use, 15 minute default expiry (60 max), role-bound, joiner stays pending until the commander verifies them by voice | `create_invite`, `redeem_invite`, UI | Module test used and expired invites fail; `tests/gate2-controls.test.ts`: the Admit button stays off until the commander also ticks "I confirmed this safety code" (the tick never overrides the link check or the role) | Done |
| T17 | Brute-forcing invite codes | 128-bit codes; only `SHA-256` stored; generic result; 5 attempts per 10 minutes per identity, recorded without throwing so the counter persists | `redeem_invite`, `join_attempt` | Module test: sixth attempt refused | Done |
| T18 | Server learns the invite secret | Secret only in the URL fragment (never sent); fragment stripped from the address bar on load; only the HMAC is sent | `/join`, `invite.ts`, `components/incidents/join-link.ts` | `applyInviteHash` unit test (fragment read once, address bar reset to `/join`); `live/browser/gate2.pw.ts` on Maincloud: after opening an invite link the address bar has no `#`, and `lib/client/real.test.ts` ("the invite secret stays in the browser") shows redeem sends only the public code and the HMAC join tag, and neither the invite nor member rows hold the secret | Done |
| T19 | Stolen Spacetime auth token | Token alone cannot decrypt or sign (device keys non-extractable); revoke from another device; CSP reduces XSS exposure | `store.ts`, headers | Manual | Accepted (residual) |
| T20 | Lost or seized device, or a copy of the browser profile | Opt-in passkey lock: device private keys stored only as AES-GCM ciphertext under a key derived from the passkey's WebAuthn PRF output (user verification required), never stored; channel keys not persisted while locked; every page load starts locked; a different passkey, another incident's record or any edited field fails to open. Plus revoke and rotate from another device; full-disk encryption advised. Limits: covers incidents created or joined after the lock is turned on; browsers without PRF keep browser-only protection; an unlocked, running device is not protected (see T36) | `lib/crypto/vault.ts`, `lib/client/passkey-lock.ts`, `store.ts`, `real.ts`, `components/security/passkey-lock-card.tsx` | `vault.test.ts` (wrong passkey, other incident, swapped and edited fields fail; unlocked keys non-extractable); `passkey-lock.test.ts` (wrong passkey refused, no-PRF passkey changes nothing, turning off restores plain keys); `real-passkey.test.ts` (locked commander stores no usable key and no channel key; after reload nothing opens until unlock; lock closes it again; locked joiner sends nothing). Chromium virtual authenticator with PRF under the production headers, 2026-11-07: on, reload locks, unlock, off all work, and a no-PRF passkey changes nothing. `live/browser/passkey.pw.ts` repeats it through the real screens against Maincloud on a production build (`PW_PROD=1`): passed 2026-11-07 on Mehrad's Mac | Done (opt-in) |

### Input and web attacks

| # | Threat | Mitigation | Where | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| T21 | Script injection via decrypted text | Text-only rendering, `react/no-danger` lint rule, http(s)-only links with `rel="noopener noreferrer"`, strict CSP | Components, `eslint.config.mjs`, `next.config.ts` | Test rendering `<img onerror>` and `javascript:` payloads as text (Lane B component test, still to do); `lib/security/static-scan.test.ts` already forbids innerHTML, dangerouslySetInnerHTML and `javascript:` literals | Planned |
| T22 | Malformed or oversized payloads | zod validation of every decrypted payload, unknown kinds flagged; 12 KB plaintext and 16 KB ciphertext caps in client and module | `events.ts`, `limits.ts`, `append_event` | `events.test.ts`, module size test | Done |
| T23 | SQL or command injection | Module uses typed table APIs only; subscriptions are fixed view names in code | Module, `real.ts` | `lib/security/static-scan.test.ts` (no raw SQL, eval, innerHTML sinks; fixed subscription handles) | Done |
| T24 | Spreadsheet formula injection in exports | Report is HTML/PDF; any CSV export escapes cells starting with `= + - @` | `lib/report/` | No CSV export exists, so there is no formula-injection sink. If one is added, cells starting with `= + - @` must be escaped and tested first | Accepted (no export to attack) |
| T25 | Clickjacking | `frame-ancestors 'none'` and `X-Frame-Options: DENY` | `lib/security/headers.ts`, `next.config.ts` | `headers.test.ts` | Done |
| T26 | Flooding or storage exhaustion | Token-bucket rate limit on accepted appends (burst 30, refill 3 per second per identity), size caps, member and invite caps, incident cap per identity; strangers can only redeem invites; the invite sweep removes dead invites and old join attempts. Limits: rejected calls roll back, so only accepted appends consume tokens; a stranger can create many throwaway identities and leave up to 5 failed-join rows each per 10 minutes, which the sweep deletes after an hour (invite codes are 128 bits, so guessing is infeasible) | `limits.ts`, `takeAppendToken`, reducers | Module tests: rate bucket, caps, sweep | Done |

### Platform and crypto pitfalls

| # | Threat | Mitigation | Where | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| T27 | Client calls a scheduled reducer directly | `ctx.senderAuth.isInternal` guard on every scheduled reducer | `sweep_invites` | Module test: member and commander calls refused, scheduler call runs | Done |
| T28 | Weak randomness | Module never generates secrets (`ctx.random` is seeded from the timestamp); all keys, IVs, codes from browser `crypto.getRandomValues` / Web Crypto | Module, `lib/crypto/` | `module.test.ts` asserts the module source contains no randomness calls | Done |
| T29 | Nonce reuse or homemade crypto | Fresh random 96-bit IV per encryption; keys rotate per epoch; Web Crypto plus audited `@noble` only; domain-separated canonical encoding for every hash, signature, HMAC and KDF | `encoding.ts`, `lib/crypto/` | Unit tests and shared vectors | Done |
| T30 | Server lies about time | Author-signed `sentAt` shown beside `serverTs`, drift over 5 minutes flagged; legal clocks start from signed human decisions (`legal.discovery`, `legal.materiality`) | `verify.ts`, `lib/legal/` | `tests/legal-deadlines.test.ts` uses the recorded determination, not server time; `verify.test.ts` clock-drift case (line 470) flags a signed time that differs from the server time by over 5 minutes, and the screens label it (`components/incidents/situation.ts`) | Done |
| T31 | Network eavesdropping or MITM | TLS (wss, https, HSTS on Vercel); E2EE as a second layer | Hosting, `lib/security/headers.ts` | `headers.test.ts` checks the HSTS header; the client connects over `wss` to Maincloud and is served over https from Vercel | Done |
| T32 | Secrets or vulnerable dependencies in the repo | No secrets required; `.env*` ignored; gitleaks and `npm audit` in CI; lockfile; short dependency allowlist | `.github/workflows/ci.yml`, `docs/PLAN.md` | CI run (workflow is Lane B). Checked by hand 2026-11-07: `npm audit --audit-level=high` clean, 0 production vulnerabilities (8 moderate, all dev-only lint tooling via minimatch); pattern scan of tracked files found no secrets | Planned |

### Legal and process

| # | Threat | Mitigation | Where | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| T33 | Privileged material leaks into a shared report | #privileged excluded from exports unless counsel opts in; watermark when included; channel banner | `lib/report/`, report page | `tests/report.test.ts`: privileged, command and technical chat are left out by default, with no secrets in the output; the privileged section is only offered, not included, until counsel opts in | Done |
| T34 | Missed or misstated legal deadline | Rules with citations and opened sources; tested date math including business days; applies, counsel review, or not in effect; a recorded status does not rewrite the computed instant; disclaimer on every result | `lib/legal/` | `tests/legal-deadlines.test.ts`, `tests/legal-calendar.test.ts` | Done |
| T35 | Metadata leakage | Payload kinds encrypted; still visible to the server: timestamps, channel, sizes, roles, display names, member count | Design | n/a | Accepted (documented) |
| T36 | Commander device compromise (root of trust) | Every commander action signed and logged in #record; the commander can passkey-lock its keys at rest (T20), so a copied or seized commander profile yields no usable key while locked; malware on the unlocked, running commander device can still use (not export) the keys; production: second commander (M-of-N) and keys held inside the authenticator | Design, `lib/crypto/vault.ts` | T20 tests | Accepted (documented) |

## Accepted risks, in plain words

- **T8 availability:** a malicious server can stop serving data. We detect gaps and missing keys; self-hosting gives the victim control of availability.
- **T10 client code:** like every web app with end-to-end encryption, users trust the JavaScript they are served. We separate the client host from the database host and show the build hash; the production fix is a signed desktop app.
- **T19 and T20 sessions and devices:** a stolen token or seized unlocked laptop is handled by revocation and key rotation, not prevented. With the passkey lock on, a seized locked laptop or a copied browser profile holds only wrapped keys. The lock protects keys at rest only: once unlocked, code running in the page can use the keys (they stay non-extractable, so it cannot copy them out). Losing the passkey loses the locked incidents on that device; the commander re-invites a responder, and a commander would start a new incident.
- **T35 metadata:** the server sees who is in an incident, their roles and handles, and when and how much they write.
- **T36 root of trust:** the commander's device is a single point of trust in v1.
- **Demo ledger:** when `NEXT_PUBLIC_ZH_MOCK=1`, the incident record and invite tokens are copied into this browser's localStorage so another tab can join. That copy is plaintext, stays on the device, and the live client does not read it. Clear site data to wipe it.

## Progress notes

- 2026-11-07 (Lane A): the client crypto library and its negative tests are in (`lib/crypto/*.test.ts`: seal, sign, wrap, invite, chain, verify, store). T7 is Done.
- 2026-11-07 (Lane A): the module and its 34 tests are in (`spacetimedb/src/module.test.ts`), including a test that the client verifier accepts the module's hash chain. T6, T11, T12, T14, T17 and T22 are Done. T13 waits for the revoke demo, T16 and T18 for the join UI, and T2 to T5 for the two-browser demo and module-side signature checks (P1).
- 2026-11-07 (Lane B): demo invites are stored in browser localStorage (`lib/client/demo-ledger.ts`) so a second tab can redeem them. Live mode does not use that store.
- 2026-11-07 (Lane B): the legal engine reads `IncidentState` only. CIRCIA has no countdown. CISA's CIRCIA page, read the same day, says covered-incident and ransom reports are not required until the final rule's effective date. A draft final rule was at OIRA as of October 1, 2026, which is not an effective date. T34 is Done. T30 stays Planned because the server-drift flag is still open.

- 2026-11-07 (Lane A): opt-in passkey lock (WebAuthn PRF) for device keys at rest. T20 is Done (opt-in). The lock card is mounted on the incidents page, the join page and the locked room. The PRF secret and the vault key are never stored or logged; there is no server step, so the WebAuthn challenge is random and unchecked on purpose (the passkey is not a login).

## Downgrades taken

None yet. If a fallback from `docs/PLAN.md` section 11 is used, record it here with the time and the affected rows.
