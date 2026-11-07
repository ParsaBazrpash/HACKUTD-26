# Lane B plan: Person B (Parsa), product

For Parsa and his coding agents. Read it with `AGENTS.md` and `docs/PLAN.md`. Mehrad's plan is `docs/lanes/PERSON_A.md`; the sections on rules, ownership, timeline and stop points are word for word the same in both files. Times are US Central, Saturday Nov 7 to Sunday Nov 8, 2026.

**Your job:** make the security visible and the product usable: the war room, the legal clock, the join and admit ceremony, the report, the README, Devpost and the video. You build on a mock that speaks the real `IncidentClient`, so you never wait for the backend.

**Mehrad's job, in parallel:** the server that cannot read anything and the browser code that proves it: the Spacetime module, the crypto library, the real client, revoke and rekey, and the hardening. At Gate 2 his real client replaces your mock with one environment variable.

**If you are a coding agent working for Parsa:** touch only Lane B files, never push to `main`, never merge, and stop for Parsa at every stop point (S1 to S9).

## Where we are (Saturday 3:55 pm)

- **Gate 1 passed at 3:32 pm.** Live sync works on the Maincloud database `zerohour-hackutd26`.
- **PR #2 merged at 3:47 pm.** `main` now has the Sync 1 contract, the crypto library, the real Spacetime module (published, bindings regenerated), the pure fold, a stub `createRealIncidentClient()`, `qrcode`, and the restored `AGENTS.md` and `docs/PLAN.md`.
- **Decision (Mehrad, 3:35 pm): the agreed plan and contract win.** That means 4 roles, 4 channels, `IncidentClient`, invite then admit, a signed hash chain, and rekey on revoke.
- **Parsa's UI shell, routes, legal clock and Playwright tests stay.** They still use the older model (5 roles, `IncidentDataClient`, `types/`, `lib/data/`). Step B2a moves them onto the contract.
- **`npm run build` is red on `main`.** The site header needs a `<Suspense>` boundary. Parsa fixes it first (B1b).
- **The repo is private.** It must be public to win. The history was scanned at 3:55 pm and holds no secrets.

## Rules we both follow

1. **Nobody pushes to `main`.** Every change is a pull request from your own branch. The other person approves, then the reviewer merges (or the author, right after the approval). Parsa turns on a ruleset that enforces this at S1.
2. **Your own branches only.** Mehrad uses `a/<topic>` or his Claude thread branches; Parsa uses `b/<topic>` or his. Never commit to the other person's branch.
3. **Stay inside your files** (table below). If you need a change in the other person's file, ask. They make it, or they say "go ahead" for that one PR.
4. **The contract is frozen after S1:** `lib/client/types.ts`, `lib/protocol/**`, `spacetimedb/src/shared/**`. A change needs a yes from both of you, and waits for the next stop point unless it blocks you.
5. **Shared config is Mehrad's:** `package.json`, the lockfile, tsconfigs, eslint, vitest, `.env.example`, `next.config.ts`, `proxy.ts`. Dependencies come only from the allowlist in `docs/PLAN.md` section 3.
6. **Small PRs, merged within the hour.** After anything merges, pull `main` into your branch.
7. **Only Mehrad publishes the module** and regenerates `src/module_bindings`, in the same PR as the module change. `--delete-data` wipes the demo database: only with Parsa's OK, and never after 10:00 am.
8. **Before you open a PR:** `npm run lint && npm run typecheck && npm test && npm run build` pass. Security logic comes with a negative test.
9. **Coding agents** get `AGENTS.md`, `docs/PLAN.md` and their own lane file, and follow these same rules. An agent never merges, never pushes to `main`, and stops for its human at every stop point.
10. **No em dashes** in docs or UI copy (team style).
11. **The repo goes public before judging.** Parsa does it at S1 if possible, at S4 at the latest.
12. **Commits carry the human's identity, every single time.** Mehrad's agents commit and push as `theMehrad <98144748+theMehrad@users.noreply.github.com>`; Parsa's agents use Parsa's own GitHub identity. Never an AI author or co-author: no `Co-Authored-By` or `Claude-Session` trailers in any commit.

## Who owns which files

| Area | Paths | Owner |
| --- | --- | --- |
| Spacetime module and its tests | `spacetimedb/**` | Mehrad |
| Module test harness and live Maincloud tests | `tests/support/**`, `live/**`, `vitest.live.config.mts` | Mehrad |
| Generated bindings | `src/module_bindings/**` (only after a publish, same PR) | Mehrad |
| Crypto | `lib/crypto/**` | Mehrad |
| Real client and the shared fold | `lib/client/real.ts`, `lib/client/backend.ts`, `lib/client/fold.ts` | Mehrad (Parsa reviews `fold.ts` changes) |
| Rules, plan, threat model | `AGENTS.md`, `docs/PLAN.md`, `docs/THREAT_MODEL.md` | Mehrad (Parsa lists the threat rows his PR affects in the PR description) |
| Shared config | `package.json`, `package-lock.json`, `tsconfig.json`, `spacetimedb/tsconfig.json`, `eslint.config.mjs`, `vitest.config.mts`, `.env.example`, `.gitignore`, `next.config.ts`, `proxy.ts` | Mehrad |
| **Contract (frozen after S1)** | `lib/client/types.ts`, `lib/protocol/**`, `spacetimedb/src/shared/**` | **Both must agree** |
| Routes and styles | `app/**` | Parsa |
| Screens and hooks | `components/**`, `hooks/**` | Parsa |
| Mock side of the client | `lib/client/index.ts`, `lib/client/mock.ts`, `lib/scenario/**` | Parsa |
| Legal clock, report, time helpers | `lib/legal/**`, `lib/report/**`, `lib/time.ts` | Parsa |
| Parsa's tests | `tests/**` (except `tests/support/**`), `e2e/**`, `playwright.config.ts` | Parsa |
| Judge-facing docs and assets | `README.md`, `docs/DEVPOST.md`, `docs/PRODUCT.md`, `public/**` | Parsa |
| CI | `.github/workflows/**` | Parsa |
| Lane plans and code owners | `docs/lanes/**`, `.github/CODEOWNERS` | Both, changed only at a stop point |

**One-time exception (step B2a):** Parsa deletes his old model in one PR: `lib/data/**`, `types/**`, `hooks/use-incident-data.ts`, `lib/crypto/index.ts`, `lib/crypto/boundary.ts`, `spacetimedb/tables.ts`, the legacy lines in `.env.example`, and the tests that import them. Two of those paths sit in Mehrad's folders; he agrees to this at S1.

**Second exception, only if S2 fails:** Mehrad may add a temporary `app/lab/page.tsx` to test the real client, and deletes it before S3.

`.github/CODEOWNERS` mirrors this table, so GitHub asks the owner to review whenever the other person touches their files.

### The seams (the only places our code meets)

1. **`IncidentClient` and `IncidentState`** in `lib/client/types.ts` (contract).
2. **`foldEvents(events, roster, readable)`** returns `FoldedState`, in `lib/client/fold.ts` (Mehrad's, pure). The mock builds `VerifiedEvent`s from the scenario and calls it, so mock and real produce the same state.
3. **`createMockIncidentClient(): IncidentClient`** in `lib/client/mock.ts` (Parsa) and **`createRealIncidentClient(): IncidentClient`** in `lib/client/real.ts` (Mehrad, a stub until A4).
4. **`getIncidentClient()`** in `lib/client/index.ts` (Parsa) returns the mock when `NEXT_PUBLIC_ZH_MOCK === '1'`, otherwise the real client, one instance per tab. Screens import only this and the hook, never `lib/crypto` or `src/module_bindings`.
5. **Public env names:** `NEXT_PUBLIC_SPACETIMEDB_HOST`, `NEXT_PUBLIC_SPACETIMEDB_DB_NAME`, `NEXT_PUBLIC_ZH_MOCK`.
6. **Invite link** `/join#i=...&c=...&s=...&f=...&r=...` comes from `createInvite`. The `/join` page reads `location.hash` once, passes it to `redeemInvite`, then strips it with `history.replaceState`. The role comes from the invite and the commander's admission, never from a form field.
7. **`computeDeadlines(state, now)`** in `lib/legal` (Parsa) reads only `IncidentState`.

## Timeline at a glance

All times US Central. Stop points are in bold; both of us stop for them.

| Time | Mehrad (Lane A) | Parsa (Lane B) | Stop |
| --- | --- | --- | --- |
| 3:55 to 4:20 pm | Sync 1 | Sync 1 | **S1 Contract and ownership** |
| 4:20 to 5:00 pm | A2b module check, unblockers | B1b fix the build, connect Vercel | |
| 5:00 to 7:00 pm | A4 part 1: connect, create, invite, redeem | B2a move onto the contract (by 6:00), B3 legal engine (agent), B2b war room on the mock | |
| 7:00 to 7:15 pm | Check-in | Check-in | **S2 Check-in** |
| 7:15 to 9:00 pm | A4 part 2: admit, messages, record actions | B4 join, admit, integrity and lock screens | |
| 9:00 to 9:30 pm | Gate 2 | Gate 2 | **S3 Gate 2** |
| 9:30 to 11:00 pm | A5 revoke, rekey, tamper alarms | B5 legal clock panel and report | |
| 11:00 to 11:30 pm | Run-through | Run-through | **S4 P0 freeze** |
| 11:30 pm to 1:00 am | A6 second-layer defenses | B6 README, Devpost, PRODUCT.md | |
| 1:00 am | Handoff | Handoff, sleep 1:00 to 4:00 | **S5 Handoff** |
| 1:00 to 4:00 am | A6, then A7 self-audit | Asleep | |
| 4:00 am | Handoff, sleep 4:15 to 7:00 | Review Mehrad's PRs | **S6 Handoff** |
| 4:15 to 7:00 am | Asleep | B7 polish, e2e, CI | |
| 7:00 to 7:20 am | Morning sync | Morning sync | **S7 Morning** |
| 7:20 to 10:00 am | A8 fixes, 8:30 reset (needs Parsa's yes), final deploy | B8 screenshots, video after the reset, Devpost | |
| 10:00 am | Freeze | Freeze | **S8 Code freeze** |
| 10:00 to 11:00 am | Two rehearsals | Two rehearsals | |
| 11:00 to 11:30 am | Check the submission | Submit | **S9 Submit** |
| 1:00 to 4:00 pm | Judging | Judging | |

## Your steps

Each step says what to do, why it matters, what Mehrad is doing at the same moment, and how you know it is done.

### B1b. Fix the build, connect Vercel (4:20 to 5:00 pm, P0)

- **Do:** wrap the part of `components/shell/site-header.tsx` that calls `usePathname()` in `<Suspense>` (Next 16 Cache Components; read `node_modules/next/dist/docs/` first) so `npm run build` passes. Connect the repo to Vercel. Set `NEXT_PUBLIC_SPACETIMEDB_HOST=wss://maincloud.spacetimedb.com` and `NEXT_PUBLIC_SPACETIMEDB_DB_NAME=zerohour-hackutd26` for all environments, and `NEXT_PUBLIC_ZH_MOCK=1` for Preview only until S3. Never set it on Production.
- **Why:** a red build blocks every PR and every deploy. Web Crypto only runs over HTTPS, so phones need Vercel URLs for Gate 2.
- **Meanwhile Mehrad:** checking the live module and bindings. Nothing he does touches your files.
- **Files:** `components/shell/site-header.tsx` (and `app/layout.tsx` if needed).
- **Done when:** the build is green on `main`, and a PR preview opens on your phone.

### B2a. Move onto the contract (5:00 to 6:00 pm, P0, one PR)

- **Do:**
    - `lib/scenario/clinic.ts`: the Lakeside Family Clinic scenario from PLAN 6.3, as `VerifiedEvent`s with an ok verdict.
    - `lib/client/mock.ts`: `createMockIncidentClient(): IncidentClient`, which builds state with Mehrad's `foldEvents`; actions append events and notify listeners. Show a visible "Demo data" label while the mock is on.
    - `lib/client/index.ts`: `getIncidentClient()` (seam 4). `hooks/use-incident.ts`: `useSyncExternalStore` over `subscribe` and `getState`.
    - Port the screens to `IncidentState`: 4 roles labeled Commander, Counsel, Technical, Executive, and 4 channels. Remove the self-chosen role from the join form.
    - In the same PR, delete the old model (the one-time exception): `lib/data/**`, `types/**` (move anything `lib/legal` still needs into `lib/legal/types.ts`), `hooks/use-incident-data.ts`, `lib/crypto/index.ts`, `lib/crypto/boundary.ts`, `spacetimedb/tables.ts`, the legacy lines in `.env.example`, and the tests that import them.
    - Rewrite `tests/architecture.test.ts` to guard the new layout: `app/` and `components/` never import `lib/crypto` or `src/module_bindings`, and nothing uses `dangerouslySetInnerHTML`.
- **Why:** one interface for both clients turns Gate 2 into a switch, not a rewrite. Leaving the 5-role model in the repo would also contradict the threat model in front of the AI judges.
- **Meanwhile Mehrad:** writing the real client against the same interface and fold. Ask him to review this PR right away; it is the only place your lanes touch.
- **Done when:** all checks are green, a search for `lib/data` or `@/types` in `app`, `components`, `hooks` and `lib` finds nothing, and Mehrad approved.

### B3. Legal engine (5:00 to 6:30 pm, P0, a parallel agent)

- **Do:** extend `lib/legal` to PLAN section 8: every rule with its citation and source URL, the 2026 holiday calendar, and `computeDeadlines(state, now)` reading only `IncidentState` (discovery, materiality, profile, deadline updates). Required test vectors: GDPR from Sat Nov 7 14:00 to Tue Nov 10 14:00; SEC 8-K from Wed Nov 25 2026 to Wed Dec 2 2026 (Thanksgiving skipped). Keep your honest rules: SEC waits for a materiality date, and unclear duties get a "check with counsel" badge.
- **Why:** the legal clock is the Winstead moment that needs nothing from Lane A, so it can be finished and polished early.
- **Meanwhile Mehrad:** the real client. No overlap.
- **Files:** `lib/legal/**`, `tests/legal-*.test.ts`.
- **Done when:** the required vectors pass, and a human has opened each rule's source URL once.

### B2b. War room on the mock (6:00 to 7:00 pm, P0)

- **Do:** the panels from PLAN section 7: status bar (severity, phase, hours since detection, next deadline, integrity, connection), blast-radius board, timeline with CSF tags, tasks, channels (only the readable ones, with the privileged banner on #privileged) and people. Three columns on desktop, tabs on a 375 px phone. Render text as text; allow only http(s) links.
- **Why:** these are exactly the screens the real client will feed at 9:00.
- **Meanwhile Mehrad:** finishing create, invite and redeem on Maincloud.
- **Done when:** the whole demo story clicks through on mock data at desktop and phone widths.

### B4. Join, admit, integrity, lock (7:15 to 9:00 pm, P0)

- **Do:** `/join`: read the fragment once, strip it with `history.replaceState`, show the role from the invite as read-only, ask for a display name, show the safety code and a waiting state, and handle expired or used links. For the commander: an invite modal with a QR code (`qrcode`, rendered as an image), a copy button and the expiry; a pending member card with "Link verified", the safety code and Admit; revoke with a confirm that names the member. An integrity panel with per-channel verdicts and the red banner ("Integrity failure: #record seq 7"). A lock screen ("Your access to this incident was revoked.").
- **Why:** the admission ceremony and the red banner are the security story judges can see, and Mehrad's client drives these exact states at Gate 2.
- **Meanwhile Mehrad:** admit, key wrapping and encrypted messages in the real client.
- **Done when:** every state is reachable on the mock through `IncidentClient`.

### B5. Legal clock panel and report (9:30 to 11:00 pm, P0)

- **Do:** the legal clock panel on `computeDeadlines`, and `/incidents/[incidentId]/report` as a printable page (PLAN section 9) without checkpoints. #privileged stays out unless counsel ticks "include privileged", which adds a watermark.
- **Why:** the report is what a real response team hands to its insurer and regulators, and it carries the integrity attestation (chain head hashes).
- **Meanwhile Mehrad:** revoke, rekey and tamper alarms. Ask him for the exact failure reasons your banner must show.
- **Done when:** the report saves to PDF with no clipped tables.

### B6. Docs for judges (11:30 pm to 1:00 am, P1)

- **Do:** `README.md` (pitch, live link, screenshot, the architecture diagram from PLAN section 3, a security summary with the accepted risks, how to run it, tests). Update `docs/DEVPOST.md` to what actually works. Rewrite `docs/PRODUCT.md` to match PLAN.md or delete it: it still describes 5 roles and says executives cannot read the legal channel, which contradicts the locked policy.
- **Why:** AI judges read the repo first, and contradictions between docs cost more than missing features.
- **Meanwhile Mehrad:** second-layer defenses. Ask him for one line per defense for the README.
- **Done when:** every README claim matches the code and `docs/THREAT_MODEL.md`.

### B7. Polish, e2e, CI (4:15 to 7:00 am, P1)

- **Do:** empty, loading and error states; aria labels; focus order; contrast; a phone pass. `e2e/join-and-message.spec.ts` on the mock: two browser contexts run create, invite, redeem, admit and message, and the integrity indicator stays green. `.github/workflows/ci.yml`: `npm ci`, lint, typecheck, test, build and gitleaks, plus Playwright if it is stable.
- **Why:** a green CI badge and an e2e test show judges it works without them running it.
- **Meanwhile Mehrad:** asleep until 7:00. `main` does not change; your PRs wait for S7.
- **Done when:** CI is green on your PR.

### B8. Video and Devpost (7:20 to 10:00 am, P0)

- **Do:** screenshots; record the 2 to 3 minute video right after the 8:30 reset (8:45 to 9:30), following the demo script; edit; fill Devpost from `docs/DEVPOST.md` and remove any claim that did not ship.
- **Why:** the video is often the first thing judges see.
- **Meanwhile Mehrad:** final fixes and production rehearsals.
- **Done when:** the video is uploaded (unlisted is fine) and linked, and the Devpost draft is complete.

## Stop points (the same in both plans)

At each stop, both of you stop coding, run the checks, and confirm by typing the phrase in the team chat. Nobody moves on until both have confirmed.

### S1. Contract and ownership (3:55 to 4:20 pm, together)

- [x] PR #2 merged (Parsa, 3:47 pm).
- [ ] Both read both lane plans and agree on the ownership table and the seams. Change them now, not later.
- [ ] Parsa skims the contract files now on `main`: `lib/client/types.ts`, `lib/protocol/events.ts`, `spacetimedb/src/shared/policy.ts` and `limits.ts`, plus `lib/client/fold.ts`. Any objection is raised here.
- [ ] Say it out loud: 4 roles (commander, counsel, technical, executive). #record: all read, commander, counsel and technical write. #command: everyone. #privileged: commander, counsel, executive. #technical: commander, counsel, technical. The role comes from the invite and the admission.
- [ ] Mehrad agrees to the one-time deletion exception for B2a.
- [ ] Parsa turns on the `main` ruleset (steps below). If GitHub refuses on a private repo, do it the minute the repo is public.
- [ ] Parsa makes the repo public (Settings, General, Danger Zone, Change visibility), or schedules it for S4 at the latest.
- [ ] Both redeem HACKUTD2026 on your own GitHub account at spacetimedb.com/redeem.
- [ ] Parsa creates the Devpost project and adds Mehrad (team registration closes 11:00 pm).
- **Confirm:** both type `S1 go`.
- **If it fails:** a contract disagreement is settled inside these 25 minutes. If it is not settled by 4:20 pm, the merged contract stands and the point goes on the S2 list.

**Ruleset steps (Parsa):** Settings, Rules, Rulesets, New branch ruleset. Target the default branch. Turn on Restrict deletions, Block force pushes, and Require a pull request before merging with 1 required approval. Leave "Require review from Code Owners" off (an owner cannot approve their own PR, so it would block you). Keep the bypass list empty. At S7, add the CI check as required.

### S2. Check-in (7:00 to 7:15 pm)

- [ ] Mehrad shows: from localhost, the real client creates an incident and an invite on Maincloud, and a redeemed invite shows up as pending with matching safety codes.
- [ ] Parsa shows: the war room on the mock through `IncidentClient`, with 4 roles and 4 channels; legal tests green; the old model deleted.
- [ ] `main` is green: `npm ci && npm run lint && npm run typecheck && npm test && npm run build`.
- [ ] B2a is merged, so Mehrad can test his client through Parsa's real screens.
- [ ] A Vercel preview opens on a phone over HTTPS.
- [ ] Any contract change? This is the last cheap moment. Write it down; both approve the PR.
- **Confirm:** both type `S2 go`.
- **If it fails:** if Parsa's screens are not merged, Mehrad tests on a temporary `app/lab/page.tsx` (deleted before S3). If the real client is behind, Parsa keeps building on the mock; nothing else changes.

### S3. Gate 2: integration (9:00 to 9:30 pm)

- [ ] Parsa removes `NEXT_PUBLIC_ZH_MOCK` from Vercel Preview and shares the preview URL.
- [ ] On two laptops and a phone over HTTPS: the commander creates an incident and invites counsel and technical; both redeem; the safety codes read aloud match; the commander admits both.
- [ ] Counsel posts in #privileged. The technical browser shows no #privileged channel and holds no key for it.
- [ ] Mehrad (database owner) runs `spacetime sql --server maincloud zerohour-hackutd26 "SELECT * FROM event"` and sees only bytes, no readable words.
- [ ] The integrity indicator is green on every screen.
- [ ] No plaintext, keys or invite secrets in the browser console or the Vercel logs.
- **Confirm:** both type `Gate 2 go`.
- **If it fails by 9:30 pm:** stop debugging and take the next rung of the fallback ladder in `docs/PLAN.md` section 11. Mehrad logs it under "Downgrades taken" in `docs/THREAT_MODEL.md`. Then run this list again.

### S4. Run-through and P0 freeze (11:00 to 11:30 pm)

- [ ] Run the full demo script on the Vercel URL, timed. Target: under 3 minutes.
- [ ] Every stumble becomes a GitHub issue labeled `lane-a` or `lane-b`.
- [ ] Parsa: the repo is public, the ruleset is on, the Devpost team is registered.
- [ ] Mehrad: the status column in `docs/THREAT_MODEL.md` matches what actually works.
- [ ] Agree on the overnight list: which P1 items each of you takes.
- **Confirm:** both type `S4 go`. From here, P0 features get fixed, not redesigned.

### S5. Handoff (1:00 am): Parsa sleeps 1:00 to 4:00

- [ ] Parsa posts a handoff note: what merged, what is open (PR links), anything Mehrad must know. Nothing is left half-merged.
- [ ] Mehrad confirms `main` is green before Parsa leaves.
- While Parsa sleeps, `main` does not change (the ruleset needs his approval). Mehrad stacks PRs for S6.
- **Confirm:** both type `S5 go`.

### S6. Handoff (4:00 am): Mehrad sleeps 4:15 to 7:00

- [ ] Parsa reviews and merges Mehrad's overnight PRs while Mehrad is still awake to answer questions.
- [ ] Mehrad posts a handoff note.
- While Mehrad sleeps, `main` does not change. Parsa stacks PRs for S7.
- If a partner is 15 minutes late from a sleep window, call them.
- **Confirm:** both type `S6 go`.

### S7. Morning sync (7:00 to 7:20 am)

- [ ] Mehrad reviews and merges Parsa's overnight PRs. Both pull `main` and run all checks.
- [ ] Run the demo once and assign open issues by lane.
- [ ] Parsa adds the CI check as required in the ruleset.
- [ ] Agree the demo database reset for 8:30 am.
- **Confirm:** both type `S7 go`.

**8:30 am reset (a mini stop):** Mehrad asks "reset now?" and waits for Parsa's "yes". Then he publishes with `--delete-data`, both recreate the Lakeside clinic incident through the UI on the production URL, and both check that the room looks right. Parsa records the video right after.

### S8. Code freeze (10:00 am)

- [ ] `main` green, e2e green, the production URL works on a phone.
- [ ] Mehrad: `docs/THREAT_MODEL.md` final. Parsa: `README.md` and `docs/DEVPOST.md` final.
- [ ] No open PRs except fixes for issues found in rehearsal.
- **Confirm:** both type `S8 go`. After this: fixes only, each approved by the other; no dependency changes, no module schema changes, no `--delete-data`.
- Two full rehearsals from 10:00 to 11:00, swapping who drives once.

### S9. Submission check (11:00 to 11:30 am)

- [ ] The repo link opens in a private browser window.
- [ ] README links work; the live URL works.
- [ ] Devpost lists both teammates, both tracks (Winstead and Build on Spacetime), a video link that plays, and text that matches what shipped.
- [ ] Parsa submits by 11:30 am. Mehrad checks the public Devpost page in a private window.
- **Confirm:** both type `submitted`. Hacking ends at 12:00 pm.

## Emergency stop

- Either of you can call it at any time by typing `STOP: <reason>` in the team chat. Typical reasons: `main` is red, a security bug, the demo database is broken, a contract mismatch, a missed gate.
- Both stop merging. The owner of the broken part fixes it or opens a revert PR within 15 minutes, and the other approves.
- Work resumes when the other person replies `clear`.
- Stuck on one thing for more than 30 minutes? Say so at once. The fallback ladder in `docs/PLAN.md` section 11 exists for exactly that.

## Judging roles (1:00 to 4:00 pm)

- **Parsa** opens with the 30-second problem, drives the counsel laptop and the phone, and shows the legal clock and the report.
- **Mehrad** drives the commander laptop: invite, safety code, admit, revoke, and the tamper demo with `spacetime sql` (only his CLI is the database owner). He takes the crypto and threat-model questions.
- **Both** can name the accepted risks in `docs/THREAT_MODEL.md`, such as the metadata the server can see and the commander's device as the root of trust.
