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
