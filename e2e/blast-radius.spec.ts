import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test("live blast radius: state clocks, quick status change, and live cards in chat", async ({ page }) => {
  await page.goto("/incidents");
  await page.getByRole("link", { name: /Lakeside Family Clinic/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("SEV1");

  const nav = page.getByRole("navigation", { name: "Incident sections" });
  await nav.getByRole("link", { name: "Affected Systems", exact: true }).click();
  await expect(page).toHaveURL(/\/systems$/);

  const map = page.locator('section[aria-labelledby="blast-heading"]');
  await expect(map.getByRole("heading", { name: "Live blast radius" })).toBeVisible();
  await expect(map.getByText("Demo data: no server round trip")).toBeVisible();

  // Texas residents on the exfiltrated HR database start both Texas clocks.
  await map.getByRole("button", { name: /^Texas:/ }).click();
  await expect(map.getByText("Texas notice to the attorney general")).toBeVisible();
  await expect(map.getByText("Texas notice to individuals")).toBeVisible();

  // Open the HR database, share it, then contain it from the map.
  await map.getByRole("button", { name: /^HR-SQL-01: Exfiltrated/ }).click();
  await map.getByRole("button", { name: "Share to chat", exact: true }).click();
  await expect(map.getByText("Shared to #command.")).toBeVisible();

  await map.getByLabel("Status", { exact: true }).selectOption("contained");
  await map.getByRole("button", { name: "Save status" }).click();
  await expect(map.getByText("Saved.", { exact: true })).toBeVisible();
  await expect(map.getByRole("button", { name: /^HR-SQL-01: Contained/ })).toBeVisible();

  await map.getByRole("button", { name: "Share the map to chat" }).click();
  await expect(map.getByText("Shared to #command.").last()).toBeVisible();

  // Both cards are drawn from the record and show the contained status.
  await nav.getByRole("link", { name: "Secure Channels", exact: true }).click();
  await expect(page).toHaveURL(/\/channels$/);
  const systemCard = page.locator('[data-live-card="system"]').last();
  await expect(systemCard).toContainText("HR-SQL-01");
  await expect(systemCard).toContainText("Contained");
  const blastCard = page.locator('[data-live-card="blast"]').last();
  await expect(blastCard).toContainText("3 of 6 systems in the blast radius");
  await expect(page.locator("body")).not.toContainText("[card:");
});

async function openIncident(page: import("@playwright/test").Page) {
  await page.goto("/incidents");
  await page.getByRole("link", { name: /Lakeside Family Clinic/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("SEV1");
  return page.getByRole("navigation", { name: "Incident sections" });
}

test("switching systems on the map resets the status picker and the notes", async ({ page }) => {
  const nav = await openIncident(page);
  await nav.getByRole("link", { name: "Affected Systems", exact: true }).click();
  const map = page.locator('section[aria-labelledby="blast-heading"]');

  await map.getByRole("button", { name: /^HR-SQL-01: Exfiltrated/ }).click();
  await map.getByRole("button", { name: "Share to chat", exact: true }).click();
  await expect(map.getByText("Shared to #command.")).toBeVisible();
  await map.getByLabel("Status", { exact: true }).selectOption("contained");
  await expect(map.getByRole("button", { name: "Save status" })).toBeEnabled();

  // Without saving, jump straight to another system. Its own status shows, nothing is armed.
  await map.getByRole("button", { name: /^FS-CLINIC-01: Encrypted/ }).click();
  await expect(map.getByLabel("Status", { exact: true })).toHaveValue("encrypted");
  await expect(map.getByRole("button", { name: "Save status" })).toBeDisabled();
  await expect(map.getByText("Shared to #command.")).toHaveCount(0);
  await expect(map.getByRole("button", { name: /^HR-SQL-01: Exfiltrated/ })).toBeVisible();
});

test("the paperclip attaches a live card to a chat message", async ({ page }) => {
  const nav = await openIncident(page);
  await nav.getByRole("link", { name: "Secure Channels", exact: true }).click();
  await expect(page).toHaveURL(/\/channels$/);

  const composer = page.getByRole("form", { name: "Message #command" });
  const attach = composer.getByRole("button", { name: "Attach a live card" });

  // Attach, then remove: nothing is sent.
  await attach.click();
  await page.getByRole("group", { name: "Attach a live card" }).getByRole("button", { name: /Live blast radius/ }).click();
  await expect(composer.getByText("Live card:")).toBeVisible();
  await expect(composer.getByRole("button", { name: "Send" })).toBeEnabled();
  await composer.getByRole("button", { name: "Remove the attached card" }).click();
  await expect(composer.getByText("Live card:")).toHaveCount(0);
  await expect(composer.getByRole("button", { name: "Send" })).toBeDisabled();

  // Escape closes the picker without attaching.
  await attach.click();
  await expect(page.getByRole("group", { name: "Attach a live card" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Attach a live card" })).toHaveCount(0);

  // Attach a system and send it with a message.
  await attach.click();
  await page.getByRole("group", { name: "Attach a live card" }).getByRole("button", { name: /HR-SQL-01/ }).click();
  await expect(composer.getByText("HR-SQL-01")).toBeVisible();
  await composer.getByRole("textbox").fill("Payroll box, check the Texas count.");
  await composer.getByRole("button", { name: "Send" }).click();
  await expect(composer.getByText("Live card:")).toHaveCount(0);

  const card = page.locator('[data-live-card="system"]').last();
  await expect(card).toContainText("HR-SQL-01");
  await expect(page.getByText("Payroll box, check the Texas count.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("[card:");
});

test("share from the map with a message, then open the channel from its link", async ({ page }) => {
  const nav = await openIncident(page);
  await nav.getByRole("link", { name: "Affected Systems", exact: true }).click();
  const map = page.locator('section[aria-labelledby="blast-heading"]');

  await map.getByRole("button", { name: /^HR-SQL-01: Exfiltrated/ }).click();
  const detail = map.getByRole("region", { name: "Selected details" });
  await detail.getByRole("button", { name: "Add a message" }).click();
  await detail.getByLabel("Message to send with the card").fill("Legal, this one has SSNs.");
  await detail.getByLabel("Channel to share to").selectOption("technical");
  await detail.getByRole("button", { name: "Share to chat", exact: true }).click();
  await expect(detail.getByText("Shared to #technical.")).toBeVisible();

  const link = detail.getByRole("link", { name: "Open #technical in a new tab" });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("href", /\/channels#technical$/);

  // The link opens the named channel.
  await page.goto((await link.getAttribute("href")) ?? "");
  await expect(page.getByRole("heading", { name: "#technical" })).toBeVisible();
  await expect(page.locator('[data-live-card="system"]').last()).toContainText("HR-SQL-01");
  await expect(page.getByText("Legal, this one has SSNs.")).toBeVisible();
});
