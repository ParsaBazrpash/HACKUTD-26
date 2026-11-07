// Gate 2, in a real browser against Maincloud, through Parsa's screens.
// Two isolated browser contexts (separate IndexedDB, so separate keys):
// a commander and a counsel member.

import { expect, test } from "@playwright/test";

test("commander invites counsel, counsel joins, commander admits, they exchange a privileged message", async ({
  browser,
}) => {
  const stamp = Date.now().toString(36);
  const title = `Gate 2 browser run ${stamp}`;
  const secret = `privileged-text-${stamp}`;

  const commanderCtx = await browser.newContext();
  const counselCtx = await browser.newContext();
  const commander = await commanderCtx.newPage();
  const counsel = await counselCtx.newPage();

  // Page errors, and any Content-Security-Policy refusal (the production CSP forbids eval).
  const pageErrors: string[] = [];
  for (const page of [commander, counsel]) {
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (/content security policy|violates the following/i.test(message.text())) pageErrors.push(message.text());
    });
  }

  // 1. Commander creates the incident.
  await commander.goto("/incidents");
  await commander.getByLabel("Title").fill(title);
  await commander.getByLabel("Your display name").fill("Commander Test");
  await commander.getByRole("button", { name: "Create incident" }).click();
  await expect(commander).toHaveURL(/\/incidents\/[^/]+$/);
  await expect(commander.getByRole("heading", { level: 1 })).toContainText(title);

  // 2. Commander makes a counsel invite.
  await commander.getByLabel("Role").selectOption("counsel");
  await commander.getByRole("button", { name: "Create invite" }).click();
  const inviteUrl = (await commander.locator("#invite-url").innerText()).trim();
  expect(inviteUrl).toContain("/join#");
  await expect(commander.getByAltText("Invite QR code")).toBeVisible();

  // 3. Counsel opens the link. The fragment must leave the address bar (T18).
  await counsel.goto(inviteUrl);
  await expect(counsel.getByText("Role from the invite: Counsel")).toBeVisible();
  expect(new URL(counsel.url()).hash).toBe("");
  expect(await counsel.evaluate(() => window.location.href)).not.toContain("#");

  await counsel.getByLabel("Display name").fill("Counsel Test");
  await counsel.getByRole("button", { name: "Redeem invite" }).click();
  await expect(counsel.getByText(/Waiting for admission as Counsel/)).toBeVisible();

  // 4. Commander sees the pending member, the link check passes, and admits.
  await expect(commander.getByText("Counsel Test").first()).toBeVisible();
  const waiting = commander.getByRole("region", { name: "WAITING FOR ADMISSION" });
  await expect(waiting.getByText("Link verified", { exact: true })).toBeVisible();
  const admit = waiting.getByRole("button", { name: "Admit" });
  await expect(admit).toBeEnabled();
  await admit.click();
  await expect(commander.getByText("Admitted Counsel Test.")).toBeVisible();

  // 5. Counsel opens the room, posts to #privileged, the commander reads it.
  await counsel.goto("/incidents");
  await counsel.getByRole("link", { name: new RegExp(title) }).click();
  await expect(counsel.getByRole("heading", { level: 1 })).toContainText(title);
  const composer = counsel.getByRole("form", { name: /Message .*privileged/i });
  await composer.getByRole("textbox").fill(secret);
  await composer.getByRole("button", { name: "Send" }).click();
  await expect(counsel.getByText(secret).first()).toBeVisible();
  await expect(commander.getByText(secret).first()).toBeVisible();

  // 6. Both screens report integrity, and the invite is gone from the page.
  await expect(commander.getByText("Integrity checked").first()).toBeVisible();
  await expect(counsel.getByText("Integrity checked").first()).toBeVisible();
  expect(pageErrors).toEqual([]);

  await commanderCtx.close();
  await counselCtx.close();
});
