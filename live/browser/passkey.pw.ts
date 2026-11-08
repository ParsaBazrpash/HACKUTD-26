// Passkey lock, in a real browser against Maincloud, through the real screens.
// Chromium's virtual authenticator stands in for Touch ID / Windows Hello, with
// the PRF extension on. Run only this file:
//   PW_PROD=1 npx playwright test --config playwright.live.config.ts passkey

import { expect, test } from "@playwright/test";

test("lock on, create an incident, reload: nothing opens until the passkey unlocks it", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const title = `Passkey lock run ${stamp}`;

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (/content security policy|violates the following|permissions policy/i.test(message.text())) {
      pageErrors.push(message.text());
    }
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
    },
  });

  const card = page.locator('section[aria-labelledby="passkey-lock-heading"]');

  // 1. Turn the lock on, then create the incident.
  await page.goto("/incidents");
  await card.getByRole("button", { name: "Lock my keys with a passkey" }).click();
  await expect(card.getByText("Passkey lock is on")).toBeVisible();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Your display name").fill("Commander Passkey");
  await page.getByRole("button", { name: "Create incident" }).click();
  await expect(page).toHaveURL(/\/incidents\/[^/]+$/);
  await expect(page.getByText(title).first()).toBeVisible();
  const roomUrl = page.url();

  // 2. Reload: the keys are locked, the room does not open, the title is not shown.
  await page.goto(roomUrl);
  await expect(card.getByRole("button", { name: "Unlock with passkey" })).toBeVisible();
  await expect(page.getByText("Your keys for this incident are locked")).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);

  // 3. Unlock: the same room opens and verifies.
  await card.getByRole("button", { name: "Unlock with passkey" }).click();
  await expect(page.getByText(title).first()).toBeVisible();

  // 4. Turn the lock off so this browser profile is left as it was. A page load locks again first.
  await page.goto("/incidents");
  await card.getByRole("button", { name: "Unlock with passkey" }).click();
  await card.getByRole("button", { name: "Turn off" }).click();
  await card.getByRole("button", { name: "Turn off the passkey lock" }).click();
  await expect(card.getByRole("button", { name: "Lock my keys with a passkey" })).toBeVisible();

  expect(pageErrors).toEqual([]);
});
