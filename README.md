# HAVEN

Sealed incident-response war room for the first 72 hours after a ransomware attack. The Next.js app renders in the browser, and SpacetimeDB is the only backend. The real client seals and signs incident content in the browser before storage. The screens in this tree still show the in-memory prototype: fixture slots are labels, and integrity on those screens stays unknown.

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

Leave `NEXT_PUBLIC_DATA_CLIENT=mock` until a SpacetimeDB module is published. The mock keeps sealed shells in browser memory. Setting `spacetimedb` constructs the client and then refuses every call, so no incident data is sent.

## Stack

Next.js 16.4.5, React 19.3.0, Tailwind CSS 4.3.5, TypeScript 5.9.3, Zod 4.6.7, Lucide React 1.70.0, Vitest 3.2.7, Playwright 1.65.0.

Read [docs/PLAN.md](docs/PLAN.md) for the build phases and [AGENTS.md](AGENTS.md) for the security rules.
