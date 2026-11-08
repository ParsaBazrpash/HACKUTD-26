# HAVEN

Sealed incident-response war room for the first 72 hours after a ransomware attack. The Next.js app renders in the browser, and SpacetimeDB is the incident backend. The real client seals and signs incident content in the browser before it is stored, so the database holds ciphertext. A small server-side pager on Vercel places a phone call and sends a text to responders through Twilio; it handles phone numbers and call status only, never incident content. `NEXT_PUBLIC_ZH_MOCK=1` runs the in-browser demo instead.

## Commands

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest unit tests |
| `npm run test:watch` | Vitest in watch mode |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npx playwright install chromium` | Install the browser used by end-to-end tests |
| `npm run test:e2e` | Playwright against the dev server |
| `npm run spacetime:publish` | Publish the module to Maincloud (owner only) |
| `npm run spacetime:generate` | Regenerate `src/module_bindings` after a module change |
| `npm run test:live` | Real-crypto scripts against Maincloud in `live/` (needs the Spacetime CLI logged in as the owner) |

Without a published module, set `NEXT_PUBLIC_ZH_MOCK=1` in `.env.local`. The mock keeps everything in this browser and sends nothing. Any other value uses the real client against the database named in `NEXT_PUBLIC_SPACETIMEDB_HOST` and `NEXT_PUBLIC_SPACETIMEDB_DB_NAME`.

## Stack

Next.js 16.4.5, React 19.3.0, Tailwind CSS 4.3.5, TypeScript 5.9.3, Zod 4.6.7, Lucide React 1.70.0, Vitest 3.2.7, Playwright 1.65.0.

Read [docs/PLAN.md](docs/PLAN.md) for the build phases and [AGENTS.md](AGENTS.md) for the security rules.

## Publishing the module

Only the database owner publishes (`npm run spacetime:publish`, then `npm run spacetime:generate`). The owner login is needed only on the machine that publishes. Do not log the owner in on a machine that runs a responder's client. Every security check in the module is repeated in the browser, so a malicious module can stop service but cannot read or forge incident content (threat model T9). The module pins one pager identity (`PAGER_IDENTITY_HEX` in `spacetimedb/src/index.ts`); that identity may only write call status.

## Pager setup

The pager is three routes: `app/api/page` (a page request from the commander's browser), `app/api/twilio/voice` (call webhooks) and `app/api/twilio/sms` (replies to the text). Set these in Vercel for Production only. Names are listed with empty values in `.env.example`. Mark secrets as Secret, and never give a server value a `NEXT_PUBLIC_` name.

| Name | Kind | What it is |
| --- | --- | --- |
| `NEXT_PUBLIC_PAGER_PUB` | public | Pager public key. Browsers seal phone numbers to it |
| `PAGER_PRIVATE_KEY` | secret | Matching private key. Opens sealed phone numbers only |
| `TWILIO_ACCOUNT_SID` | secret | Twilio account id (`AC` plus 32 characters) |
| `TWILIO_AUTH_TOKEN` | secret | Places calls and checks webhook signatures |
| `TWILIO_FROM` | config | Twilio number that calls and texts, E.164 |
| `SPACETIME_PAGER_TOKEN` | secret | Token of the pager's Spacetime identity |
| `SPACETIME_HOST` | config | `https://` Spacetime host |
| `SPACETIME_DB` | config | Database name |
| `ORG_ADMIN_SIGN_PUB` | config | Org admin signing public keys the pager trusts, comma-separated, no spaces |
| `PUBLIC_BASE_URL` | config | Production URL, `https://`, no trailing slash. Twilio webhooks and signatures use it |
| `PAGER_ALLOWED_NUMBERS` | secret, optional | If set, the only numbers the pager will call or text, E.164, comma-separated |

Setup steps:

1. `node scripts/pager-keys.mjs` prints `NEXT_PUBLIC_PAGER_PUB` and `PAGER_PRIVATE_KEY`. It writes no file. Put both into Vercel and nowhere else.
2. Create a Spacetime identity for the pager and keep the answer out of your terminal history: `curl -sS -X POST https://maincloud.spacetimedb.com/v1/identity > /tmp/pager-identity.json`. The file (kept outside the repo) holds the identity hex and the token. Copy the token into `SPACETIME_PAGER_TOKEN` in Vercel, put the hex into `PAGER_IDENTITY_HEX` in `spacetimedb/src/index.ts`, publish the module, then delete the file.
3. In Twilio, buy one number that can call and text, and allow voice calls to the United States only. Set the account values above. Calls carry their own webhook URLs under `PUBLIC_BASE_URL`. For replies to the text, set the number's messaging webhook (HTTP POST) to `<PUBLIC_BASE_URL>/api/twilio/sms`.
4. After the org exists, read its admin key as the database owner. `spacetime sql` prints bytes as `0x` followed by 130 hex digits, so convert only the digits (the filter below ignores anything else). Use your org's name:

   ```
   spacetime sql --server maincloud zerohour-hackutd26 "SELECT admin_sign_pub FROM org WHERE name = 'YOUR ORG NAME'" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{for(const m of s.matchAll(/0x([0-9a-fA-F]{130})/g))console.log(Buffer.from(m[1],'hex').toString('base64url'))})"
   ```

   The output is one line of 87 characters starting with `BA`. Add it to `ORG_ADMIN_SIGN_PUB` (append with a comma to keep older keys) and redeploy.
5. Check the pager with one test page to your own phone. It rings. The text arrives only once the number's A2P 10DLC registration is approved; until then Twilio refuses it with error 30034 and the call still goes through. A half-configured deploy refuses to page and names the missing settings in the server log (names only).

A page is a phone call and, at the same time, a text from the same number. Both say to open HAVEN on your personal phone and that HAVEN never asks for a code; pressing 4 on the call, or replying `4` to the text, marks the page acknowledged. That is all it does. A person counts as joined only after they act in the room with their own keys. Page status is reported by the server and by Twilio, not signed by the person.

### Key rotation

- **Pager key pair** (for example if `PAGER_PRIVATE_KEY` was shared): run `node scripts/pager-keys.mjs`, set both new lines in Vercel, redeploy. Phone numbers are sealed to the public key at enrollment, so everyone already on the roster must enroll again. Do this before people enroll, or accept the re-enrollment.
- **Spacetime pager identity:** make a new identity (step 2), change `PAGER_IDENTITY_HEX`, publish the module, set the new token in Vercel, redeploy.
- **Twilio token:** rotate it in the Twilio console, update `TWILIO_AUTH_TOKEN`, redeploy. Webhook binding tags are derived from this token, so calls in flight at that moment stop working. The account token gives full access to the whole Twilio account, so rotate it at once if it leaks.
- **Org admin key:** there is no rotation. Every roster certificate is signed by it, so a new admin key means a new org and everyone enrolls again. Keep older keys in `ORG_ADMIN_SIGN_PUB` only while an old org is still in use.
