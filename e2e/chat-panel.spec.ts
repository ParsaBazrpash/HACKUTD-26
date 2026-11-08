import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

async function openIncident(page: Page) {
  await page.goto("/incidents");
  await page.getByRole("link", { name: /Lakeside Family Clinic/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("SEV1");
  return page.getByRole("navigation", { name: "Incident sections" });
}

// The demo session says which seeded member this tab is.
async function viewAs(page: Page, incidentId: string, member: number) {
  await page.evaluate(
    ({ identity, currentId }) => window.sessionStorage.setItem("zh.demo.session.v1", JSON.stringify({ v: 1, identity, currentId })),
    { identity: member.toString(16).padStart(64, "0"), currentId: incidentId },
  );
}

test("side chat stays open across sections, and a shared card updates live as the map changes", async ({ page }) => {
  const nav = await openIncident(page);
  const launcher = page.getByRole("button", { name: /^Open chat/ });
  await launcher.click();

  const chat = page.getByRole("dialog", { name: "Chat" });
  await expect(chat).toBeVisible();
  await expect(chat.getByRole("heading", { level: 3, name: "#command" })).toBeVisible();
  await expect(chat.getByRole("textbox")).toBeFocused();

  // Attach a system card from the panel and send it.
  await chat.getByRole("button", { name: "Attach a live card" }).click();
  await chat.getByRole("group", { name: "Attach a live card" }).getByRole("button", { name: /HR-SQL-01/ }).click();
  await chat.getByRole("textbox").fill("Watch this one while I contain it.");
  await chat.getByRole("button", { name: "Send" }).click();
  const card = chat.locator('[data-live-card="system"]').last();
  await expect(card).toContainText("HR-SQL-01");
  await expect(card).toContainText("Exfiltrated");

  // Go to the map with the chat still open, contain the system, and the card follows.
  await nav.getByRole("link", { name: "Affected Systems", exact: true }).click();
  await expect(page).toHaveURL(/\/systems$/);
  await expect(chat).toBeVisible();
  const map = page.locator('section[aria-labelledby="blast-heading"]');
  await map.getByRole("button", { name: /^HR-SQL-01: Exfiltrated/ }).click();
  await map.getByLabel("Status", { exact: true }).selectOption("contained");
  await map.getByRole("button", { name: "Save status" }).click();
  await expect(card).toContainText("Contained");
  await expect(card).toContainText("Updated since it was shared");

  // Escape inside the paperclip picker closes only the picker.
  await chat.getByRole("button", { name: "Attach a live card" }).click();
  await page.keyboard.press("Escape");
  await expect(chat.getByRole("group", { name: "Attach a live card" })).toHaveCount(0);
  await expect(chat).toBeVisible();

  // Escape again closes the chat and gives focus back to the button.
  await page.keyboard.press("Escape");
  await expect(chat).toHaveCount(0);
  await expect(launcher).toBeFocused();

  // The Secure Channels page is the chat itself, so the button steps aside there.
  await nav.getByRole("link", { name: "Secure Channels", exact: true }).click();
  await expect(page).toHaveURL(/\/channels$/);
  await expect(page.getByRole("button", { name: /^Open chat/ })).toHaveCount(0);
});

test("a message from someone else shows a count and a preview, and the preview opens that channel", async ({ page, context }) => {
  await openIncident(page);
  const incidentPath = new URL(page.url()).pathname.replace(/\/$/, "");
  const incidentId = incidentPath.split("/").pop() ?? "";
  await expect(page.getByRole("button", { name: "Open chat" })).toBeVisible();

  // Sam, the technical lead, in another tab of the same demo.
  const sam = await context.newPage();
  await sam.goto("/incidents");
  await viewAs(sam, incidentId, 3);
  await sam.goto(`${incidentPath}/channels#technical`);
  const composer = sam.getByRole("form", { name: "Message #technical" });
  await composer.getByRole("textbox").fill("Firewall logs pulled for the HR subnet.");
  await composer.getByRole("button", { name: "Send" }).click();
  await expect(sam.getByText("Firewall logs pulled for the HR subnet.")).toBeVisible();

  // The commander's tab sees it live.
  await expect(page.getByRole("button", { name: "Open chat, 1 new message" })).toBeVisible();
  const preview = page.getByRole("button", { name: /Sam Okonkwo in #technical/ });
  await expect(preview).toContainText("Firewall logs pulled for the HR subnet.");
  await preview.click();

  const chat = page.getByRole("dialog", { name: "Chat" });
  await expect(chat.getByRole("heading", { level: 3, name: "#technical" })).toBeVisible();
  await expect(chat.getByText("Firewall logs pulled for the HR subnet.")).toBeVisible();

  // Closing marks it read.
  await chat.getByRole("button", { name: "Close chat" }).click();
  await expect(page.getByRole("button", { name: "Open chat" })).toBeVisible();
});

test("the side chat only offers the channels the member can read", async ({ page }) => {
  await openIncident(page);
  const incidentPath = new URL(page.url()).pathname.replace(/\/$/, "");
  const incidentId = incidentPath.split("/").pop() ?? "";

  // Riley, the executive: #command and #privileged, never #technical.
  await viewAs(page, incidentId, 4);
  await page.goto(`${incidentPath}/systems`);
  await page.getByRole("button", { name: /^Open chat/ }).click();
  const tabs = page.getByRole("dialog", { name: "Chat" }).getByRole("navigation", { name: "Chat channels" });
  await expect(tabs.getByRole("button")).toHaveText(["#command", "#privileged"]);
});
