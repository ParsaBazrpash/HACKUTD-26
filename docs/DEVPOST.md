# ZeroHour: Devpost project description

> Draft written before the build. Before submitting, delete or soften every line that did not ship, and keep it consistent with `docs/THREAT_MODEL.md`.

**Name:** ZeroHour

**Tagline:** The incident war room that still works when the attacker owns everything else.

**Elevator pitch (under 200 characters):** An end-to-end encrypted, tamper-evident command center for ransomware response, with a live legal deadline clock, built entirely on SpacetimeDB.

**Tracks:** Winstead Cyber Incident Response, Build on Spacetime, Best Design (plus General).

## Inspiration

When ransomware hits, communication is the first casualty. Email, Slack and single sign-on may be in the attacker's hands, so responders fall back to personal phones and group texts. Meanwhile legal clocks start running (GDPR's 72 hours, the SEC's four business days after a materiality call, state attorney general deadlines), and the record of who knew what, and when, becomes evidence. We built the room responders walk into at hour zero.

## What it does

- **Spin up in seconds.** The incident commander creates an incident and invites responders by one-time link or QR code, each with a role: Commander, Counsel, Technical or Executive. Nobody gets in until the commander confirms them with a 12-digit safety code.
- **One live incident record,** organized by NIST SP 800-61 phases and tagged with NIST CSF 2.0 response categories: timeline, status, severity and tasks, updated on every screen in real time.
- **A blast-radius board** for every affected system and data store: suspected, encrypted, exfiltrated, contained or restored, with data types, record counts and affected states.
- **A legal clock.** When counsel records the discovery time and the scope shows whose data was exposed, ZeroHour lists the notification deadlines that apply, each with its statute citation, and counts them down with an owner.
- **Encrypted channels:** #command for everyone, #technical for the forensics work, and an attorney-client #privileged channel that technical staff cannot decrypt even with database access.
- **One-click revoke.** A compromised account is cut off instantly and every channel it could read gets a new key.
- **Proof, not promises.** An integrity panel re-verifies every signature and the full hash chain, and the after-action report ends with a cryptographic attestation of the record.

## Security model

We assume the attacker controls the network and has full access to our server and database, because that is Winstead's rule. Everything a responder writes is encrypted and signed on their own device before it leaves the browser. The server stores ciphertext and enforces roles, but every client independently verifies who wrote each entry and that nothing was edited, reordered or deleted. Running `SELECT * FROM event` as the database owner returns only ciphertext. The full threat model (36 threats, each mapped to a mitigation and a test) is in `docs/THREAT_MODEL.md`, including the limits we accept and why.

## How we built it

- **SpacetimeDB is the entire backend:** a TypeScript module with private tables, reducers that enforce every role check inside a transaction, per-user views so each client only ever receives the rows it may see, scheduled reducers for invite expiry, and connection hooks for presence. No other server, API or database. Hosted on Maincloud, and self-hostable for fully isolated deployments.
- **Next.js 16, React 19 and Tailwind 4** for the client, using the `spacetimedb/react` hooks.
- **Web Crypto only:** non-extractable ECDSA P-256 and ECDH P-256 device keys, AES-256-GCM channel keys wrapped individually for each member, and a SHA-256 hash chain computed by the module and re-verified by every browser.
- **Tested:** Vitest suites for the crypto, the hash chain, the legal rules and the module's authorization, a Playwright end-to-end test, and GitHub Actions CI.

## Challenges we ran into

Learning Spacetime's TypeScript modules in an afternoon. Designing key distribution so a malicious server cannot slip in a fake member or swap someone's key. Keeping strong cryptography invisible, so the app stays calm and obvious for people under stress.

## Accomplishments that we're proud of

God mode on our own production database shows nothing but ciphertext. Changing a single row behind the app's back turns every screen red and points to the exact entry.

## What we learned

Spacetime's views make row-level authorization feel natural. An end-to-end encrypted web app has to treat its own server as an untrusted mailbox. And lawyers think in deadlines, so the product should too.

## What's next for ZeroHour

Hardware-backed keys with passkeys, a second commander so the root of trust can't be lost, a signed desktop build so the client code itself is verifiable, more jurisdictions in the rules engine, an offline evidence-bundle verifier, and a pilot with Winstead.

## Built with

spacetimedb, typescript, next.js, react, tailwindcss, web-crypto, noble-hashes, noble-curves, zod, vitest, playwright, vercel
