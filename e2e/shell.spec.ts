import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

async function noHorizontalOverflow(page: import("@playwright/test").Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("shell routes render the clinic incident", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("ransomware response");

  await page.getByRole("main").getByRole("link", { name: "Get Started" }).click();
  await expect(page).toHaveURL("/incidents");
  await expect(page.getByRole("button", { name: "Create incident" })).toBeVisible();
  await expect(page.getByText("Demo data").first()).toBeVisible();

  await page.getByRole("link", { name: /Lakeside Family Clinic/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("SEV1");
  await expect(page.getByText("Lakeside Family Clinic").first()).toBeVisible();
  await expect(page.getByText("Demo data").first()).toBeVisible();
  await expect(page.getByText("structured event log")).toBeVisible();
  await expect(page.getByText("Demo sequence check passed").first()).toBeVisible();
  await expect(page.getByText("Still suspected, encrypted, or exfiltrated")).toBeVisible();
  await expect(page.getByText("#privileged").first()).toBeVisible();
  await expect(page.getByText("Privileged communication").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("PRIVATE KEY");

  await page.getByLabel("Summary").fill("E2E status summary for the clinic.");
  await page.getByRole("button", { name: "Update status" }).click();
  await expect(page.getByText("E2E status summary for the clinic.").first()).toBeVisible();

  const composer = page.getByRole("form", { name: "Message #command" });
  await composer.getByRole("textbox").fill("E2E command note: clinics remain on paper.");
  await composer.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("E2E command note: clinics remain on paper.")).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Incident sections" });

  await nav.getByRole("link", { name: "Timeline", exact: true }).click();
  await expect(page).toHaveURL(/\/timeline$/);
  await page.getByRole("textbox", { name: "Entry", exact: true }).fill("E2E timeline note from the commander.");
  await page.getByRole("button", { name: "Add entry" }).click();
  await expect(page.getByText("E2E timeline note from the commander.", { exact: true })).toBeVisible();

  await nav.getByRole("link", { name: "Affected Systems", exact: true }).click();
  await expect(page).toHaveURL(/\/systems$/);
  await expect(page.getByRole("listitem").filter({ hasText: "FS-CLINIC-01" }).first()).toBeVisible();
  await page.getByRole("textbox", { name: "System", exact: true }).fill("E2E-WORKSTATION");
  await page.getByRole("button", { name: "Save system" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "E2E-WORKSTATION" }).first()).toBeVisible();

  await nav.getByRole("link", { name: "Tasks", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("E2E confirm the downtime roster");
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "E2E confirm the downtime roster" }).first()).toBeVisible();

  await nav.getByRole("link", { name: "Secure Channels", exact: true }).click();
  await expect(page).toHaveURL(/\/channels$/);
  await expect(page.getByText("#command").first()).toBeVisible();
  await expect(page.getByText("#privileged").first()).toBeVisible();
  await expect(page.getByText("#technical").first()).toBeVisible();
  await expect(page.getByText("Privileged communication").first()).toBeVisible();
  await expect(page.getByText("structured event log")).toBeVisible();

  await nav.getByRole("link", { name: "People & Access" }).click();
  await expect(page).toHaveURL(/\/people$/);
  // The People filters list every role as a hidden <option>, so look only at visible text.
  for (const role of ["Commander", "Counsel", "Technical", "Executive"]) {
    await expect(page.getByText(role, { exact: true }).filter({ visible: true }).first()).toBeVisible();
  }
  await expect(page.getByText("Noah Ellis").first()).toBeVisible();

  await nav.getByRole("link", { name: "Legal Deadlines" }).click();
  await expect(page).toHaveURL(/\/legal$/);
  await expect(page.getByRole("heading", { name: "Legal deadlines" })).toBeVisible();
  await expect(page.getByText("Texas notice to the attorney general").first()).toBeVisible();

  await nav.getByRole("link", { name: "Report", exact: true }).click();
  await expect(page).toHaveURL(/\/report$/);
  await expect(page.getByRole("heading", { name: "Incident Report", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Incident Summary", exact: true })).toContainText("E2E status summary for the clinic.");
  await expect(page.getByText("E2E command note: clinics remain on paper.")).toHaveCount(0);
  await expect(page.getByText("Do not forward")).toHaveCount(0);

  await page.goto("/join");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Join with an invite link");
  await expect(page.getByLabel("Role")).toHaveCount(0);
  await expect(page.getByText("This page cannot assign a role.")).toBeVisible();
});

test("incident sections fit a 375px screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/incidents");
  await noHorizontalOverflow(page);
  await page.getByRole("link", { name: /Lakeside Family Clinic/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("SEV1");
  await expect(page.getByText("Lakeside Family Clinic").first()).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Incident sections" });
  for (const name of ["Overview", "Timeline", "Affected Systems", "Tasks", "Secure Channels", "People & Access", "Legal Deadlines", "Report"]) {
    await nav.getByRole("link", { name, exact: true }).click();
    await noHorizontalOverflow(page);
  }
});

test("the commander revokes an active member after typing their name", async ({ page }) => {
  await page.goto("/incidents");
  await page.getByRole("link", { name: /Lakeside Family Clinic/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("SEV1");
  await page.getByRole("navigation", { name: "Incident sections" }).getByRole("link", { name: "People & Access" }).click();
  await expect(page).toHaveURL(/\/people$/);

  // The commander's own row offers no revoke.
  await page.getByRole("button", { name: "Details for Avery Chen" }).filter({ visible: true }).first().click();
  await expect(page.getByRole("button", { name: "Revoke access" })).toHaveCount(0);

  await page.getByRole("button", { name: "Details for Riley Patel" }).filter({ visible: true }).first().click();
  await page.getByRole("button", { name: "Revoke access" }).filter({ visible: true }).first().click();
  const form = page.getByRole("form", { name: "Revoke Riley Patel" }).filter({ visible: true }).first();
  const submit = form.getByRole("button", { name: "Revoke and rotate keys" });
  await expect(submit).toBeDisabled();
  await form.getByLabel(/to confirm/).fill("riley patel");
  await expect(submit).toBeDisabled();
  await form.getByLabel(/to confirm/).fill("Riley Patel");
  await form.getByLabel(/Reason/).fill("Laptop seized.");
  await submit.click();
  await expect(page.getByText("Revoked Riley Patel in the demo.").first()).toBeVisible();
  await expect(page.getByRole("row", { name: /Riley Patel/ }).first()).toContainText("Revoked");
});
