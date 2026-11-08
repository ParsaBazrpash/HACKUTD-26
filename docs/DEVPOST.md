# HAVEN: Devpost project description

> Checked against the repo on 2026-11-08. Every claim below is backed by a merged test or one of the live scripts in `live/`. Keep it consistent with `docs/THREAT_MODEL.md`.

**Name:** HAVEN

**Tagline:** The incident war room that still works when the attacker owns everything else.

**Elevator pitch (under 200 characters):** Encrypted, tamper-evident ransomware war room that calls responders' personal phones when company systems are down. Built on SpacetimeDB.

**Tracks:** Winstead Cyber Incident Response, Build on Spacetime, Best Design (plus General).

## Inspiration

Winstead's scenario: the attacker can see normal company communications, ransomware has locked much of the data, company phones are down and email is sporadic. In that situation the first casualty is communication. Email, Slack and single sign-on may be in the attacker's hands, so responders fall back to personal phones and group texts. Meanwhile legal clocks start running (GDPR's 72 hours, the SEC's four business days after a materiality call, state attorney general deadlines), and the record of who knew what, and when, becomes evidence. We built the room responders walk into at hour zero, and the way to get them there.

## How HAVEN answers the scenario

- **It runs outside the company network.** The client is hosted on Vercel and the data lives on SpacetimeDB Maincloud. Nothing depends on the victim's servers, directory or mail.
- **It pages personal phones.** The incident commander picks people from the organization's roster and HAVEN places a phone call to each personal mobile number. The call says to open HAVEN on your own phone and to press 4 to acknowledge.
- **It needs no company email at incident time.** Enrollment happens ahead of time with a link and a safety code, and the roster, the keys and the phone numbers are already in place when the incident starts.
- **The attacker watching normal channels learns nothing useful.** The call carries no code, no link and no secret. Pressing 4 only records that the call was answered; a person counts as joined only when they act in the room with their own keys.

## What it does

- **A standing org roster.** An org admin sets up the organization before any incident. People enroll with a one-time link, their name and their personal phone number, and the admin approves each one after comparing a safety code. The admin signs a certificate over every enrollment, and the phone number is sealed so the database cannot read it.
- **Spin up in seconds.** The incident commander creates an incident and adds responders straight from the roster, or invites them by one-time link or QR code, each with a role: Commander, Counsel, Technical or Executive. Nobody gets in until the commander confirms them with a 12-digit safety code or adds them from the verified roster.
- **Phone paging with status.** One tap rings the chosen people through Twilio. The roster shows each person as requested, ringing, acknowledged, no answer, busy or failed, and the commander can retry the ones who did not pick up. Acknowledged is reported by the phone call; joined appears only after a signed action in the room.
- **One live incident record,** organized by NIST SP 800-61 phases and tagged with NIST CSF 2.0 response categories: timeline, status, severity and tasks, updated on every screen in real time.
- **A status board** of what we know, who owns what, the open tasks and the decisions, built from signed room entries. Only the commander's lines count as decisions.
- **A blast-radius board** for every affected system and data store: suspected, encrypted, exfiltrated, contained or restored, with data types, record counts and affected states.
- **A legal clock.** When counsel records the discovery time and the scope shows whose data was exposed, HAVEN lists the notification deadlines that apply, each with its statute citation, and counts them down with an owner.
- **Encrypted channels:** #command for everyone, #technical for the forensics work, and an attorney-client #privileged channel that technical staff cannot decrypt even with database access.
- **One-click revoke.** A compromised account is cut off instantly and every channel it could read gets a new key. A revoked person can come back only under fresh keys that the admin or commander approves again.
- **Proof, not promises.** An integrity panel re-verifies every signature and the full hash chain, and the after-action report ends with a cryptographic attestation of the record.

## Security model

We assume the attacker controls the network and has full access to our server and database, because that is Winstead's rule. Everything a responder writes is encrypted and signed on their own device before it leaves the browser. The server stores ciphertext and enforces roles, but every client independently verifies who wrote each entry and that nothing was edited, reordered or deleted. Running `SELECT * FROM event` as the database owner returns only ciphertext. The pager is the only server-side part. It holds the Twilio credentials and a private key that opens phone numbers and nothing else; it never sees incident content or channel keys. It dials only numbers that sit inside an admin-signed roster record, only for a page the commander signed, and Twilio's webhooks are verified before they can change a status. The full threat model (45 threats, each mapped to a mitigation and a test, with the accepted limits) is in `docs/THREAT_MODEL.md`. Phone-network risks (a stolen number, a fake caller) are listed as accepted, with why they cannot reach the room.

## How we built it

- **SpacetimeDB is the entire incident backend:** a TypeScript module with private tables, reducers that enforce every role check inside a transaction, per-user views so each client only ever receives the rows it may see, and scheduled reducers for invite expiry and page timeouts. The roster, enrollments and page status are tables and views too. Hosted on Maincloud, and self-hostable for fully isolated deployments.
- **A small pager on Vercel** (two routes) that verifies a signed page request, opens the sealed phone numbers of the people being paged, places Twilio calls and writes call status back through a reducer only its own Spacetime identity may call.
- **Next.js 16, React 19 and Tailwind 4** for the client, installable as an app whose service worker never caches incident data.
- **Web Crypto only:** non-extractable ECDSA P-256 and ECDH P-256 device keys, AES-256-GCM channel keys wrapped individually for each member, and a SHA-256 hash chain computed by the module and re-verified by every browser.
- **Tested:** Vitest suites for the crypto, the hash chain, the legal rules, the module's authorization, the roster and the pager (signature checks, replay, edited target lists, forged webhooks), a mock end-to-end story of the roster and paging (`tests/roster-scenario.test.ts`), a Playwright shell test, and live scripts in `live/` that run real crypto against Maincloud and ring a real phone.

## Challenges we ran into

Learning Spacetime's TypeScript modules in an afternoon. Designing key distribution so a malicious server cannot slip in a fake member or swap someone's key, and then doing the same for phone numbers, so a swapped number in the database cannot make the pager call a stranger. Making a phone call, which anyone can imitate or take over, useful without letting it carry any trust. Keeping strong cryptography invisible, so the app stays calm and obvious for people under stress.

## Accomplishments that we're proud of

God mode on our own production database shows nothing but ciphertext. Changing a single row behind the app's back turns every screen red and points to the exact entry. Swapping a roster member's key with owner SQL makes the commander's client refuse to add that person.

## What we learned

Spacetime's views make row-level authorization feel natural. An end-to-end encrypted web app has to treat its own server as an untrusted mailbox. And lawyers think in deadlines, so the product should too.

## What's next for HAVEN

Hardware-backed keys inside the authenticator, a second commander so the root of trust can't be lost, a signed desktop build so the client code itself is verifiable, more jurisdictions in the rules engine, an offline evidence-bundle verifier, and a pilot with Winstead.

## Built with

spacetimedb, typescript, next.js, react, tailwindcss, web-crypto, webauthn, noble-hashes, noble-curves, zod, twilio, vitest, playwright, vercel
