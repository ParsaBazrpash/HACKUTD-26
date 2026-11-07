import { defineConfig, devices } from "@playwright/test";

// Browser run against Maincloud through the real screens (no mock).
// Start with: npm run test:live:browser
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
    baseURL: "http://localhost:3100",
    trace: "off",
  },
  webServer: {
    command: "npx next dev -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 180_000,
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
