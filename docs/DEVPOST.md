# HAVEN: Devpost project description

> Checked against the repo on 2026-11-08. Security claims match the test named in each threat row of `docs/THREAT_MODEL.md`; hosting and Twilio settings are checked by hand. Keep it consistent with that file.

**Name:** HAVEN

**Tagline:** The incident war room that still works when the attacker owns everything else.

**Elevator pitch (under 200 characters):** Encrypted, tamper-evident ransomware war room that calls responders' personal phones when company systems are down. Built on SpacetimeDB.

**Tracks:** Winstead Cyber Incident Response, Build on Spacetime, Best Design (plus General).

## Inspiration

Winstead's scenario: the attacker can see normal company communications, ransomware has locked much of the data, company phones are down and email is sporadic. In that situation the first casualty is communication. Email, Slack and single sign-on may be in the attacker's hands, so responders fall back to personal phones and group texts. Meanwhile legal clocks start running (the Texas attorney general's 30 days, HIPAA's 60 days, the SEC's four business days after a materiality call), and the record of who knew what, and when, becomes evidence. We built the room responders walk into at hour zero, and the way to get them there.

## How HAVEN answers the scenario

- **It runs outside the company network.** The client is hosted on Vercel and the data lives on SpacetimeDB Maincloud. Nothing depends on the victim's servers, directory or mail.
- **It pages personal phones.** The incident commander picks people from the organization's roster and HAVEN places a phone call to each personal mobile number and sends a text to it at the same time. Both say to open HAVEN on your own phone, and that HAVEN never asks for a code. Pressing 4 on the call, or replying 4 to the text, acknowledges. In our demo only the call goes through: US carriers block texts from a new Twilio number until its A2P 10DLC registration is approved (Twilio error 30034), so the text path is built and tested but not yet delivered.
- **It needs no company email at incident time.** Enrollment happens ahead of time with a link and a safety code, and the roster, the keys and the phone numbers are already in place when the incident starts.
- **The attacker watching normal channels learns nothing useful.** The call and the text carry no code, no link and no secret. Acknowledging only records that the page was answered; a person counts as joined only when they act in the room with their own keys.

## What it does

- **A standing org roster.** An org admin sets up the organization before any incident. People enroll with a one-time link, their name and their personal phone number, and the admin approves each one after comparing a safety code. The admin signs a certificate over every enrollment, and the phone number is sealed so the database cannot read it.
- **Spin up in seconds.** The incident commander creates an incident and adds responders straight from the roster, or invites them by one-time link or QR code, each with a role: Commander, Counsel, Technical or Executive. Nobody gets in until the commander confirms them with a 12-digit safety code or adds them from the verified roster.
- **Phone paging with status.** One tap rings the chosen people through Twilio (the text that goes with it waits on carrier registration, see above). The roster shows each person as requested, ringing, acknowledged, no answer or failed, and the commander can retry the ones who did not pick up. Acknowledged is reported by the phone network and is not signed; joined appears only after a signed action in the room.
- **One live incident record,** organized by NIST SP 800-61 phases and tagged with NIST CSF 2.0 response categories: timeline, status, severity and tasks, updated on every screen in real time.
- **A status board** of what we know, who owns what, the open tasks and the decisions, built from signed room entries. Only the commander's lines count as decisions.
- **A live blast-radius map.** Every affected system sits on a ring by status, worst at the center, next to a US state map shaded by how many residents are exposed. Open a state to see the legal clocks it starts. When anyone marks a system contained, it glides outward on every screen at once, and the map shows how long your own change took to go live through Spacetime, measured on your device.
- **Live cards in chat.** Share the map, one system or one legal clock into a channel. The message carries only a pointer, so each reader draws the card from their own verified record and it updates in place when the record changes. Nobody can paste a fake number into a card.
- **A legal clock.** When counsel records the discovery time and the scope shows whose data was exposed, HAVEN lists the notification deadlines that apply, each with its statute citation, and counts them down with an owner.
- **Encrypted channels:** #command for everyone, #technical for the forensics work, and an attorney-client #privileged channel that technical staff cannot decrypt even with database access.
- **Revoke from the People page.** The commander types the person's name to confirm, the account is cut off at once and every channel it could read gets a new key. A revoked person can come back only under fresh keys that the admin or commander approves again.
- **Proof, not promises.** An integrity panel re-verifies every signature and the full hash chain, and the after-action report ends with a cryptographic attestation of the record.

## Security model

We assume the attacker controls the network and has full access to our server and database, because that is Winstead's rule. Everything a responder writes is encrypted and signed on their own device before it leaves the browser. The server stores ciphertext and enforces roles, but every client independently verifies who wrote each entry and that nothing was edited, reordered or deleted. Running `SELECT * FROM event` as the database owner returns only ciphertext. The pager is the only server-side part. It holds the Twilio credentials and a private key that opens phone numbers and nothing else; it never sees incident content or channel keys. It dials only numbers that sit inside an admin-signed roster record, only for a page requested by a roster member that Spacetime records as the incident commander, and Twilio's webhooks and text replies must carry a valid Twilio signature before they can change a status (text acknowledgements are weaker than keypresses, T36a). The full threat model (47 threats, each with a mitigation and how it is checked, plus the accepted limits) is in `docs/THREAT_MODEL.md`. Phone-network risks (a stolen number, a fake caller) are listed as accepted, with why they cannot reach the room.

## How we built it

- **SpacetimeDB is the entire incident backend:** a TypeScript module with private tables, reducers that enforce every role check inside a transaction, per-user views so each client only ever receives the rows it may see, and scheduled reducers for invite expiry and page timeouts. A reducer call returns with its committed rows already applied, so the room measures and shows the real round trip of each change. The roster, enrollments and page status are tables and views too. Hosted on Maincloud, and self-hostable for fully isolated deployments.
- **A small pager on Vercel** (three routes) that verifies a signed page request, opens the sealed phone numbers of the people being paged, places Twilio calls and sends a text with each, takes the Twilio webhooks and text replies, and writes status back through a reducer only its own Spacetime identity may call.
- **Next.js 16, React 19 and Tailwind 4** for the client, installable as an app whose service worker never caches incident data.
- **Web Crypto only:** non-extractable ECDSA P-256 and ECDH P-256 device keys, AES-256-GCM channel keys wrapped individually for each member, and a SHA-256 hash chain computed by the module and re-verified by every browser.
- **Tested:** Vitest suites for the crypto, the hash chain, the legal rules, the module's authorization, the roster and the pager (signature checks, replay, edited target lists, forged webhooks), a mock end-to-end story of the roster and paging (`tests/roster-scenario.test.ts`), a Playwright shell test, and a live script in `live/` that runs real crypto against Maincloud. A real call from the production screens to a real phone has been tested by hand.

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
