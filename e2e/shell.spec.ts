import { expect, test } from "@playwright/test";

test("shell routes render the clinic incident", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("held in this browser");

  await page.getByRole("link", { name: "Open incidents" }).click();
  await expect(page).toHaveURL("/incidents");
  await page.getByRole("link", { name: /Lakeside Family Clinic/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Lakeside Family Clinic");
  await expect(page.getByText("Commander").first()).toBeVisible();
  await expect(page.getByText("Counsel").first()).toBeVisible();
  await expect(page.getByText("Technical").first()).toBeVisible();
  await expect(page.getByText("Executive").first()).toBeVisible();
  await expect(page.getByText("#command")).toBeVisible();
  await expect(page.getByText("#privileged")).toBeVisible();
  await expect(page.getByText("#technical")).toBeVisible();
  await expect(page.getByText("#record")).toBeVisible();
  await expect(page.getByText("Demo data").first()).toBeVisible();
  await expect(page.getByText("structured event log")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("PRIVATE KEY");

  await page.goto("/join");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Join with an invite link");
  await expect(page.getByLabel("Role")).toHaveCount(0);
  await expect(page.getByText("This page cannot assign a role.")).toBeVisible();
});
