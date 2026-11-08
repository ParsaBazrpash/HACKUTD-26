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
  await map.getByLabel("Choose a state").selectOption("TX");
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

// The demo session says which seeded member this tab is. Point it at another one, then load a page fresh.
async function viewAs(page: import("@playwright/test").Page, incidentId: string, member: number) {
  await page.evaluate(
    ({ identity, currentId }) => window.sessionStorage.setItem("zh.demo.session.v1", JSON.stringify({ v: 1, identity, currentId })),
    { identity: member.toString(16).padStart(64, "0"), currentId: incidentId },
  );
}

test("a channel link the member cannot read lands on #command, and posts go there", async ({ page }) => {
  await openIncident(page);
  const incidentPath = new URL(page.url()).pathname.replace(/\/$/, "");
  const incidentId = incidentPath.split("/").pop() ?? "";
  const channelsNav = page.getByRole("navigation", { name: "Channels" });

  // Sam is the technical lead: no #privileged.
  await viewAs(page, incidentId, 3);
  await page.goto(`${incidentPath}/channels#privileged`);
  await expect(page.getByRole("heading", { level: 3, name: "#command" })).toBeVisible();
  await expect(channelsNav.getByRole("button", { name: "#privileged" })).toHaveCount(0);
  await expect(page.getByRole("form", { name: "Message #privileged" })).toHaveCount(0);
  const techComposer = page.getByRole("form", { name: "Message #command" });
  await techComposer.getByRole("textbox").fill("Sam, from a #privileged link.");
  await techComposer.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("region", { name: "#command" }).getByText("Sam, from a #privileged link.")).toBeVisible();

  // Riley is the executive: no #technical. Leave the channels page first so the next load is a fresh one.
  await page.goto(incidentPath);
  await viewAs(page, incidentId, 4);
  await page.goto(`${incidentPath}/channels#technical`);
  await expect(page.getByRole("heading", { level: 3, name: "#command" })).toBeVisible();
  await expect(channelsNav.getByRole("button", { name: "#technical" })).toHaveCount(0);
  await expect(page.getByRole("form", { name: "Message #technical" })).toHaveCount(0);
  const execComposer = page.getByRole("form", { name: "Message #command" });
  await execComposer.getByRole("textbox").fill("Riley, from a #technical link.");
  await execComposer.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("region", { name: "#command" }).getByText("Riley, from a #technical link.")).toBeVisible();

  // #record is not a chat channel, so a link to it lands on #command too (a hash change on the same page).
  await page.goto(`${incidentPath}/channels#record`);
  await expect(page.getByRole("heading", { level: 3, name: "#command" })).toBeVisible();
});

test("an attached card does not follow the member to another channel", async ({ page }) => {
  const nav = await openIncident(page);
  await nav.getByRole("link", { name: "Secure Channels", exact: true }).click();
  const command = page.getByRole("form", { name: "Message #command" });
  await command.getByRole("button", { name: "Attach a live card" }).click();
  await page.getByRole("group", { name: "Attach a live card" }).getByRole("button", { name: /Live blast radius/ }).click();
  await expect(command.getByText("Live card:")).toBeVisible();

  await page.getByRole("navigation", { name: "Channels" }).getByRole("button", { name: "#technical" }).click();
  const technical = page.getByRole("form", { name: "Message #technical" });
  await expect(technical).toBeVisible();
  await expect(technical.getByText("Live card:")).toHaveCount(0);
  await expect(technical.getByRole("button", { name: "Send" })).toBeDisabled();
});
