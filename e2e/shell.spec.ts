import { expect, test } from "@playwright/test";

test("shell routes render sealed incident data", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("held in this browser");

  await page.getByRole("link", { name: "Open incidents" }).click();
  await expect(page).toHaveURL("/incidents");
  await page.getByRole("link", { name: /inc_harbor/ }).click();
  await expect(page).toHaveURL("/incidents/inc_harbor");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("inc_harbor");
  await expect(page.getByText("Fixture slot").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("fixture:");
  await expect(page.locator("body")).not.toContainText("PRIVATE KEY");

  await page.goto("/join?incident=inc_harbor");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Join a sealed room");
  await page.getByLabel("Incident").selectOption("inc_harbor");
  await page.getByLabel("Role").selectOption("responder");
  await page.getByLabel("Local label").fill("A. Counsel");
  await page.getByRole("button", { name: "Join room" }).click();
  await expect(page.getByRole("status")).toContainText("Joined as Responder. Member mem_join_001.");
  await expect(page.getByRole("status")).toContainText("A. Counsel");
  await page.getByRole("link", { name: "Open this room" }).click();
  await expect(page.getByText("mem_join_001")).toBeVisible();
  await expect(page.getByText("A. Counsel")).toHaveCount(0);
});
