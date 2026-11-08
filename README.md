# HAVEN

Sealed incident-response war room for the first 72 hours after a ransomware attack. The Next.js app renders in the browser, and SpacetimeDB is the incident backend. The real client seals and signs incident content in the browser before it is stored, so the database holds ciphertext. A small server-side pager on Vercel places phone calls to responders through Twilio; it handles phone numbers and call status only, never incident content. `NEXT_PUBLIC_ZH_MOCK=1` runs the in-browser demo instead.

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
| `PW_PAGER_LIVE=1 npm run test:live -- live/page.live.ts` | Rings a real phone; set `PUBLIC_BASE_URL` first |

Without a published module, set `NEXT_PUBLIC_ZH_MOCK=1` in `.env.local`. The mock keeps everything in this browser and sends nothing. Any other value uses the real client against the database named in `NEXT_PUBLIC_SPACETIMEDB_HOST` and `NEXT_PUBLIC_SPACETIMEDB_DB_NAME`.

## Stack

Next.js 16.4.5, React 19.3.0, Tailwind CSS 4.3.5, TypeScript 5.9.3, Zod 4.6.7, Lucide React 1.70.0, Vitest 3.2.7, Playwright 1.65.0.

Read [docs/PLAN.md](docs/PLAN.md) for the build phases and [AGENTS.md](AGENTS.md) for the security rules.

## Publishing the module

Only the database owner publishes (`npm run spacetime:publish`, then `npm run spacetime:generate`). Keep the owner's Spacetime login off shared and demo machines. Every security check in the module is repeated in the browser, so a malicious module can stop service but cannot read or forge incident content (threat model T9). The module pins one pager identity (`PAGER_IDENTITY_HEX` in `spacetimedb/src/index.ts`); that identity may only write call status.

## Pager setup

The pager is two routes: `app/api/page` (a page request from the commander's browser) and `app/api/twilio/voice` (Twilio webhooks). Set these in Vercel for Production only. Names are listed with empty values in `.env.example`. Mark secrets as Secret, and never give a server value a `NEXT_PUBLIC_` name.

| Name | Kind | What it is |
| --- | --- | --- |
| `NEXT_PUBLIC_PAGER_PUB` | public | Pager public key. Browsers seal phone numbers to it |
| `PAGER_PRIVATE_KEY` | secret | Matching private key. Opens sealed phone numbers only |
| `TWILIO_ACCOUNT_SID` | secret | Twilio account id (`AC` plus 32 characters) |
| `TWILIO_AUTH_TOKEN` | secret | Places calls and checks webhook signatures |
| `TWILIO_FROM` | config | Twilio voice number, E.164 |
| `SPACETIME_PAGER_TOKEN` | secret | Token of the pager's Spacetime identity |
| `SPACETIME_HOST` | config | `https://` Spacetime host |
| `SPACETIME_DB` | config | Database name |
| `ORG_ADMIN_SIGN_PUB` | config | Org admin signing public keys the pager trusts, comma-separated, no spaces |
| `PUBLIC_BASE_URL` | config | Production URL, `https://`, no trailing slash. Twilio webhooks and signatures use it |
| `PAGER_ALLOWED_NUMBERS` | secret, optional | If set, the only numbers the pager will call, E.164, comma-separated |

Setup steps:

1. `node scripts/pager-keys.mjs` prints `NEXT_PUBLIC_PAGER_PUB` and `PAGER_PRIVATE_KEY`. It writes no file. Put both into Vercel and nowhere else.
2. Create a Spacetime identity for the pager: `curl -sS -X POST https://maincloud.spacetimedb.com/v1/identity`. Put the token into `SPACETIME_PAGER_TOKEN`. Put the identity hex into `PAGER_IDENTITY_HEX` in `spacetimedb/src/index.ts`, then publish the module.
3. In Twilio, buy one voice number and allow voice calls to the United States only. Set the account values above. Point nothing at Twilio by hand: each call carries its own webhook URLs under `PUBLIC_BASE_URL`.
4. After the org exists, read `admin_sign_pub` of the org with `spacetime sql zerohour-hackutd26 --server maincloud "SELECT name, admin_sign_pub FROM org"` as the database owner. It prints hex; convert it with `node -e "console.log(Buffer.from(process.argv[1],'hex').toString('base64url'))" <hex>` and add the result to `ORG_ADMIN_SIGN_PUB`. Redeploy.
5. Check the pager with one test page to your own phone. A half-configured deploy refuses to page and names the missing settings in the server log (names only).

A page is a phone call that says to open HAVEN on your personal phone and press 4 to acknowledge. Pressing 4 only marks the call acknowledged. A person counts as joined only after they act in the room with their own keys.

### Key rotation

- **Pager key pair** (for example if `PAGER_PRIVATE_KEY` was shared): run `node scripts/pager-keys.mjs`, set both new lines in Vercel, redeploy. Phone numbers are sealed to the public key at enrollment, so everyone already on the roster must enroll again. Do this before people enroll, or accept the re-enrollment.
- **Spacetime pager identity:** make a new identity (step 2), change `PAGER_IDENTITY_HEX`, publish the module, set the new token in Vercel, redeploy.
- **Twilio token:** rotate it in the Twilio console, update `TWILIO_AUTH_TOKEN`, redeploy. Webhook binding tags are derived from this token, so calls in flight at that moment stop working.
- **Org admin key:** add the new public key to `ORG_ADMIN_SIGN_PUB` before the old one is removed.
