import { defineConfig, devices } from "@playwright/test";

// Browser run against Maincloud through the real screens (no mock).
// Start with: npm run test:live:browser
// Production CSP (no 'unsafe-eval'), as served on Vercel:
//   PW_PROD=1 npm run test:live:browser
// Against an already deployed site (no local server), for example the Vercel URL:
//   BASE_URL=https://your-deployment.vercel.app npm run test:live:browser
// The default runs `next dev`, whose CSP allows eval and so cannot catch code
// that needs it. The page-error check in the test fails on any CSP violation.
export default defineConfig({
  testDir: "./live/browser",
  testMatch: "**/*.pw.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3100",
    trace: "off",
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: process.env.PW_PROD ? "npm run build && npx next start -p 3100" : "npx next dev -p 3100",
        url: "http://localhost:3100",
        reuseExistingServer: false,
        timeout: process.env.PW_PROD ? 420_000 : 180_000,
        env: {
          NEXT_PUBLIC_ZH_MOCK: "0",
        },
      },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Optional: point at an already installed Chromium (PW_CHROMIUM=/path).
        launchOptions: process.env.PW_CHROMIUM
          ? { executablePath: process.env.PW_CHROMIUM, args: ["--no-sandbox"] }
          : {},
      },
    },
  ],
});
