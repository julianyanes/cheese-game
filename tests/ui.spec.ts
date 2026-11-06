import { test, expect } from "@playwright/test";

test("the rendered game starts, moves, mutes, pauses and resumes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect.poll(() => page.locator("canvas.world").evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(300);
  await expect(page.getByRole("heading", { name: "CHEESE." })).toBeVisible();
  await page.getByRole("button", { name: "ENTER THE MAZE" }).click();
  await expect(page.locator("main")).toHaveClass(/mode-playing/);
  const before = await page.locator("canvas.world").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(250);
  await page.keyboard.up("ArrowRight");
  const after = await page.locator("canvas.world").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  expect(after).not.toBe(before);
  await page.keyboard.press("KeyM");
  await expect(page.getByRole("button", { name: "Unmute audio" })).toBeVisible();
  await page.keyboard.press("KeyP");
  await expect(page.getByRole("heading", { name: "STILL BREATHING." })).toBeVisible();
  await page.getByRole("button", { name: "BACK TO THE HUNT" }).click();
  await expect(page.locator("main")).toHaveClass(/mode-playing/);
  await expect(page.getByRole("button", { name: "Pause game" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the play route supports touch controls and fits a phone", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto("/play");
  await expect.poll(() => page.locator("canvas.world").evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(300);
  await page.getByRole("button", { name: "ENTER THE MAZE" }).tap();
  await expect(page.locator("main")).toHaveClass(/mode-playing/);
  await expect(page.getByRole("button", { name: "Move forward", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sprint", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "FIRE", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "FIRE", exact: true }).tap();
  await expect(page.locator(".game-message")).toContainText("SOMETHING IS HIDDEN");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await page.getByRole("button", { name: "Pause game" }).tap();
  await expect(page.locator("main")).toHaveClass(/mode-paused/);
  await context.close();
});
