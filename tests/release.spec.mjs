import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const allowedOrigin = "http://127.0.0.1:4173";

function watchRequests(page) {
  const external = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== allowedOrigin) {
      external.push(request.url());
    }
  });
  return external;
}

async function fillMinimumDraft(page) {
  await page.getByLabel("Goal").fill("Publish a clear landing page");
  await page.getByLabel("Binding constraint").fill("I have no polished copy and only a few minutes");
  await page.getByLabel("Make a tiny artifact").check();
  await expect(page.locator("#draft-status")).toContainText("Draft saved");
}

async function completeSprint(page) {
  await fillMinimumDraft(page);
  await page.getByRole("button", { name: "Compile one experiment" }).click();
  await page.getByRole("button", { name: /Freeze and start 5 minutes sprint/ }).click();
  await page.getByRole("button", { name: "Record result" }).click();
  await page.getByLabel("Action taken").check();
  await page.getByLabel("Completed").check();
  await page.locator("#verdict-observed").check();
  await page.getByLabel("Separate observation").fill(
    "The rough landing page opened and displayed one concrete offer.",
  );
  await page.getByLabel("Confidence after the test").fill("55");
  await page.getByRole("button", { name: "Save criterion-linked receipt" }).click();
  await expect(page.getByRole("heading", { name: "Receipt and next decision" })).toBeVisible();
}

test("main journey restores a draft and preserves the preregistered criterion", async ({ page }) => {
  const externalRequests = watchRequests(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What needs a real-world answer?" })).toBeVisible();

  await fillMinimumDraft(page);
  await page.reload();
  await expect(page.getByLabel("Goal")).toHaveValue("Publish a clear landing page");
  await expect(page.getByLabel("Binding constraint")).toHaveValue(
    "I have no polished copy and only a few minutes",
  );
  await expect(page.getByLabel("Make a tiny artifact")).toBeChecked();
  await expect(page.locator("#metric-ratio")).toHaveText(
    "0 evidence-bearing receipts / 0 sprints started",
  );

  await page.getByRole("button", { name: "Compile one experiment" }).click();
  const criterion = await page.getByLabel("Binary or explicit success criterion").inputValue();
  await page.getByLabel("Hard timebox").selectOption("1");
  await expect(page.getByLabel("Stop condition")).toHaveValue(/after 1 minute,/);
  await expect(page.getByRole("button", { name: "Freeze and start 1 minute sprint" })).toBeVisible();
  await page.getByRole("button", { name: "Freeze and start 1 minute sprint" }).click();

  await expect(page.locator("#active-success")).toHaveText(criterion);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Run only the frozen mission." })).toBeVisible();
  await expect(page.locator("#active-success")).toHaveText(criterion);
  await expect(page.locator("#frozen-at")).not.toBeEmpty();

  await page.getByRole("button", { name: "Record result" }).click();
  await expect(page.locator("#outcome-criterion")).toHaveText(criterion);
  await page.getByLabel("Action taken").check();
  await page.getByLabel("Completed").check();
  await page.locator("#verdict-observed").check();
  await page.getByLabel("Separate observation").fill(
    "The rough landing page opened and showed one concrete offer.",
  );
  await page.getByLabel("Confidence after the test").fill("55");
  await page.getByRole("button", { name: "Save criterion-linked receipt" }).click();

  await expect(page.locator("#receipt")).toContainText(criterion);
  await expect(page.locator("#receipt")).toContainText("Not independently verified");
  await expect(page.locator("#receipt")).toContainText("Action taken");
  await expect(page.locator("#metric-ratio")).toHaveText(
    "1 evidence-bearing receipt / 1 sprint started",
  );
  await expect(page.locator("#decision-title")).toHaveText("Stop: the criterion was observed.");
  expect(externalRequests).toEqual([]);
});

test("keyboard focus and 320px text reflow have no page-level horizontal overflow", async ({ page }) => {
  const externalRequests = watchRequests(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  const focusStyle = await page.locator(".skip-link").evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(focusStyle.outlineStyle).not.toBe("none");
  expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(3);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport);
  expect(externalRequests).toEqual([]);
});

test("export, delete, validated import, malformed import, and journal recovery are lossless", async ({ page }) => {
  const externalRequests = watchRequests(page);
  await page.goto("/");
  await completeSprint(page);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const download = await downloadPromise;
  const artifactDirectory = resolve("test-results");
  await mkdir(artifactDirectory, { recursive: true });
  const exportPath = resolve(artifactDirectory, "workspace-export.json");
  await download.saveAs(exportPath);

  await page.getByRole("button", { name: "Delete local workspace" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
  await expect(page.locator("#metric-ratio")).toHaveText(
    "0 evidence-bearing receipts / 0 sprints started",
  );
  await expect(page.locator("#history-empty")).toBeVisible();

  await page.locator("#import-file").setInputFiles(exportPath);
  await expect(page.locator("#import-status")).toContainText("Validated import merged successfully");
  await expect(page.locator("#metric-ratio")).toHaveText(
    "1 evidence-bearing receipt / 1 sprint started",
  );
  await expect(page.locator("#history-list")).toContainText("Publish a clear landing page");

  const beforeMalformed = await page.locator("#metric-ratio").textContent();
  await page.locator("#import-file").setInputFiles(
    resolve("tests/fixtures/malformed.json"),
  );
  await expect(page.locator("#import-status")).toContainText("Import rejected");
  await expect(page.locator("#metric-ratio")).toHaveText(beforeMalformed);
  await expect(page.locator("#history-list")).toContainText("Publish a clear landing page");

  await page.evaluate(() => {
    localStorage.setItem("proof-of-possible:workspace:v2", "{corrupt");
  });
  await page.reload();
  await expect(page.locator("#recovery-warning")).toBeVisible();
  await expect(page.locator("#metric-ratio")).toHaveText(
    "1 evidence-bearing receipt / 1 sprint started",
  );

  await page.getByRole("button", { name: "Delete local workspace" }).click();
  await page.getByRole("button", { name: "Delete everything" }).click();
  const storageKeys = await page.evaluate(() => ({
    primary: localStorage.getItem("proof-of-possible:workspace:v2"),
    journal: localStorage.getItem("proof-of-possible:journal:v2"),
  }));
  expect(storageKeys).toEqual({ primary: null, journal: null });
  expect(externalRequests).toEqual([]);
});
