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

test("the play route supports a joystick, an accessible blaster, and simultaneous touch look", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/play");
  await expect.poll(() => page.locator("canvas.world").evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(300);
  await page.getByRole("button", { name: "ENTER THE MAZE" }).tap();
  await expect(page.locator("main")).toHaveClass(/mode-playing/);
  const joystick = page.getByRole("button", { name: "Movement joystick", exact: true });
  const sprint = page.getByRole("button", { name: "Toggle sprint", exact: true });
  const fire = page.getByRole("button", { name: "Fire blaster", exact: true });
  await expect(joystick).toBeVisible();
  await expect(sprint).toHaveAttribute("aria-pressed", "false");
  await expect(fire).toHaveCount(0);
  await expect(page.getByRole("button", { name: "USE", exact: true })).toHaveCount(0);
  await sprint.tap(); await expect(sprint).toHaveAttribute("aria-pressed", "true");
  await sprint.tap(); await expect(sprint).toHaveAttribute("aria-pressed", "false");

  const bounds = (await joystick.boundingBox())!;
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const radius = bounds.width * .34;
  const cdp = await context.newCDPSession(page);
  const finger = (id: number, x: number, y: number) => ({ id, x, y, radiusX: 3, radiusY: 3, force: 1 });
  const flushTouch = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  // The visible pickup is directly ahead of spawn. Walking toward it equips it
  // without a search button, and only then does a fire control enter the DOM.
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [finger(1, center.x, center.y)] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [finger(1, center.x, center.y - radius)] });
  await expect(fire).toBeVisible({ timeout: 3_000 });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await flushTouch();
  await page.screenshot({ path: "/tmp/cheese-mobile-joystick-portrait.png" });
  await fire.tap();
  await expect(fire).toHaveCount(0);
  await expect(page.locator(".ammo .hud-detail")).toHaveText("CHAMBER EMPTY");

  const thumb = page.locator(".joystick-thumb");
  const stickY = center.y - radius * .6;
  const look = { x: 255, y: 350 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [finger(2, center.x, center.y)] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [finger(2, center.x, stickY)] });
  const displaced = await thumb.getAttribute("style");
  expect(displaced).not.toContain("translate(0px, 0px)");
  const beforeLook = await page.locator("canvas.world").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [finger(2, center.x, stickY), finger(3, look.x, look.y)] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [finger(2, center.x, stickY), finger(3, look.x + 55, look.y)] });
  await expect(joystick).toHaveClass(/active/);
  await expect(thumb).toHaveAttribute("style", displaced!);
  await expect.poll(() => page.locator("canvas.world").evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(beforeLook);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await flushTouch();
  await expect(thumb).toHaveAttribute("style", "transform: translate(0px, 0px);");
  await expect(joystick).not.toHaveClass(/active/);

  // A released/cancelled stick accepts the next gesture. Action buttons must
  // respond to non-primary fingers while movement and look remain held.
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [finger(4, center.x, center.y)] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [finger(4, center.x, stickY)] });
  await expect(joystick).toHaveClass(/active/);
  const sprintBounds = (await sprint.boundingBox())!;
  const sprintPoint = finger(5, sprintBounds.x + sprintBounds.width / 2, sprintBounds.y + sprintBounds.height / 2);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [finger(4, center.x, stickY), sprintPoint] });
  await expect(sprint).toHaveAttribute("aria-pressed", "true");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [sprintPoint] });
  await flushTouch();
  await expect(joystick).toHaveClass(/active/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  const pauseBounds = (await page.getByRole("button", { name: "Pause game" }).boundingBox())!;
  const pausePoint = finger(7, pauseBounds.x + pauseBounds.width / 2, pauseBounds.y + pauseBounds.height / 2);
  const lookPoint = finger(6, look.x, look.y);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [finger(4, center.x, stickY), lookPoint] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [finger(4, center.x, stickY), lookPoint, pausePoint] });
  await expect(page.locator("main")).toHaveClass(/mode-paused/);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await flushTouch();
  await expect(fire).toHaveCount(0);
  await expect(joystick).toHaveCount(0);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole("button", { name: "BACK TO THE HUNT" }).tap();
  await expect(joystick).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: "/tmp/cheese-mobile-joystick-landscape.png" });
  await cdp.detach();
  expect(errors).toEqual([]);
  await context.close();
});
