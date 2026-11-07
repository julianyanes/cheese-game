import { test, expect, type Page } from '@playwright/test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Run the actual game modules inside Chromium. Private state is arranged here only;
// the shipped game exposes no cheats, debug hooks, or alternate simulation paths.
const names = ['world', 'cat-art', 'renderer', 'audio', 'engine'];
const modules = names.map(name => {
  const source = readFileSync(resolve(process.cwd(), 'game', `${name}.ts`), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  return `${JSON.stringify(name)}: function(module, exports, require) { ${output}\n }`;
});
const bundle = `(() => {
  const modules = {${modules.join(',\n')}};
  const cache = {};
  function require(name) {
    name = name.replace(/^.\\//, '');
    if (cache[name]) return cache[name].exports;
    const module = { exports: {} }; cache[name] = module;
    modules[name](module, module.exports, require); return module.exports;
  }
  window.TestGame = require('engine').CheeseGame;
  window.TestWorld = require('world');
})();`;

type HarnessWindow = Window & {
  TestGame: new(canvas: HTMLCanvasElement, map: HTMLCanvasElement, onHUD: (hud: any) => void) => any;
  TestWorld: any;
  game: any;
  hud: any;
  step: (seconds: number, fps?: number) => void;
  frame: (seconds: number) => void;
};

async function prepare(page: Page) {
  await page.setViewportSize({ width: 480, height: 320 });
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><canvas id="world"></canvas><canvas id="map" width="128" height="128"></canvas>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => {
    const w = window as unknown as HarnessWindow;
    const g = new w.TestGame(document.querySelector('#world')!, document.querySelector('#map')!, hud => { w.hud = hud; });
    w.game = g;
    cancelAnimationFrame(g.raf);
    // Pointer lock needs a physical click; keyboard controls remain usable without it.
    g.start(); cancelAnimationFrame(g.raf);
    g.audio.setMuted(true);
    const size = 13;
    const cells = Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => x === 0 || y === 0 || x === size - 1 || y === size - 1 ? 1 : 0));
    g.maze = { size, cells, spawn: { x: 2.5, y: 2.5 }, catSpawn: { x: 10.5, y: 10.5 }, cheeseSpawn: { x: 10.5, y: 1.5 }, secret: { x: 10.5, y: 10.5 } };
    g.player = { ...g.maze.spawn, angle: 0, bob: 0, speed: 0 };
    g.cat = w.TestWorld.createCat({ x: 7.5, y: 2.5 });
    g.cheese = { ...g.maze.cheeseSpawn };
    g.publish();
    w.step = (seconds, fps = 60) => {
      const frames = Math.round(seconds * fps);
      for (let n = 0; n < frames; n++) if (g.mode === 'playing') g.tick(1 / fps);
      g.publish();
    };
    w.frame = seconds => {
      g.frame(g.lastTime + seconds * 1000); cancelAnimationFrame(g.raf);
    };
  });
}

test.beforeEach(async ({ page }) => { await prepare(page); });
test.afterEach(async ({ page }) => { await page.evaluate(() => (window as unknown as HarnessWindow).game?.dispose()); });

test('the visible blaster collects automatically in reach; one blast stuns for five seconds', async ({ page }) => {
  const result = await page.evaluate(() => {
    const w = window as unknown as HarnessWindow, g = w.game;
    const state = () => ({ weapon: g.weapon, message: g.message, score: g.score, recoil: g.recoil, particles: g.particles.length });
    const unarmed = state(); g.fire(); const ignored = state();
    g.maze.secret = { x: 3.151, y: 2.5 }; w.step(1 / 60);
    const distant = w.hud.weapon;
    g.maze.secret = { x: 3.15, y: 2.5 }; w.step(1 / 60);
    const equipped = w.hud.weapon;
    g.fire(); const fired = { weapon: w.hud.weapon, stun: w.hud.stun, score: w.hud.score };
    const spent = state(); g.fire(); const repeated = state();
    const x = g.cat.x; w.step(4.9);
    const before = { stun: g.cat.stunRemaining, x: g.cat.x, lives: g.lives };
    w.step(.1); const expired = g.cat.stunRemaining;
    w.step(.1); const resumed = g.cat.x;
    return { unarmed, ignored, distant, equipped, fired, spent, repeated, x, before, expired, resumed };
  });
  expect(result.ignored).toEqual(result.unarmed);
  expect(result.distant).toBe('hidden'); expect(result.equipped).toBe('ready');
  expect(result.fired).toEqual({ weapon: 'spent', stun: 5, score: 550 });
  expect(result.repeated).toEqual(result.spent);
  expect(result.before.stun).toBeCloseTo(.1, 6); expect(result.before.x).toBe(result.x); expect(result.before.lives).toBe(3);
  expect(result.expired).toBe(0); expect(result.resumed).toBeLessThan(result.x);
});

test('a nearby blaster cannot be collected through a solid corner', async ({ page }) => {
  const result = await page.evaluate(() => {
    const w = window as unknown as HarnessWindow, g = w.game;
    // Both positions are floor cells and within reach, but masonry clips the sight line.
    g.player.x = 2.8; g.player.y = 2.75;
    g.maze.secret = { x: 3.2, y: 3.2 }; g.maze.cells[2][3] = 2;
    w.step(1 / 60); const covered = { weapon: g.weapon, score: g.score };
    g.maze.cells[2][3] = 0; w.step(1 / 60);
    return { covered, clear: { weapon: g.weapon, score: g.score } };
  });
  expect(result.covered).toEqual({ weapon: 'hidden', score: 0 });
  expect(result.clear).toEqual({ weapon: 'ready', score: 250 });
});

test('missing or hitting solid cover consumes the only shot', async ({ page }) => {
  const result = await page.evaluate(() => {
    const w = window as unknown as HarnessWindow, g = w.game;
    g.maze.secret = { x: 3, y: 2.5 }; w.step(1 / 60); g.player.angle = Math.PI; g.fire();
    const miss = { weapon: g.weapon, stun: g.cat.stunRemaining, score: g.score };
    g.weapon = 'ready'; g.player.angle = 0; g.maze.cells[2][5] = 2; g.fire();
    return { miss, covered: { weapon: g.weapon, stun: g.cat.stunRemaining, score: g.score } };
  });
  expect(result.miss).toEqual({ weapon: 'spent', stun: 0, score: 250 });
  expect(result.covered).toEqual(result.miss);
});

test('spent ammo and broken passages persist through respawn; a new run resets them', async ({ page }) => {
  const result = await page.evaluate(() => {
    const w = window as unknown as HarnessWindow, g = w.game;
    g.maze.secret = { x: 3, y: 2.5 }; w.step(1 / 60); g.fire();
    g.maze.cells[5][5] = 0;
    const maze = g.maze;
    g.cat = w.TestWorld.createCat({ x: g.player.x, y: g.player.y });
    w.step(1 / 60); const caught = g.lives;
    w.step(1.3);
    const respawn = { lives: g.lives, weapon: g.weapon, sameMaze: g.maze === maze, cell: g.maze.cells[5][5], x: g.player.x, y: g.player.y };
    g.mode = 'dead'; g.start(); cancelAnimationFrame(g.raf);
    return { caught, respawn, reset: { weapon: g.weapon, lives: g.lives, score: g.score, elapsed: g.elapsed, newMaze: g.maze !== maze } };
  });
  expect(result.caught).toBe(2);
  expect(result.respawn).toEqual({ lives: 2, weapon: 'spent', sameMaze: true, cell: 0, x: 2.5, y: 2.5 });
  expect(result.reset).toEqual({ weapon: 'hidden', lives: 3, score: 0, elapsed: 0, newMaze: true });
});

test('pause freezes player, predator, stun countdown, and progression until resumed', async ({ page }) => {
  const result = await page.evaluate(() => {
    const w = window as unknown as HarnessWindow, g = w.game;
    g.maze.secret = { x: 3, y: 2.5 }; w.step(1 / 60); g.fire(); g.pause();
    const snapshot = () => ({ x: g.player.x, catX: g.cat.x, stun: g.cat.stunRemaining, elapsed: g.elapsed, progress: g.progress });
    const before = snapshot();
    for (let n = 0; n < 10; n++) w.frame(.05);
    const during = snapshot();
    g.start(); cancelAnimationFrame(g.raf); w.frame(.05);
    return { before, during, after: snapshot(), mode: g.mode };
  });
  expect(result.during).toEqual(result.before); expect(result.mode).toBe('playing');
  expect(result.after.elapsed).toBeGreaterThan(result.before.elapsed); expect(result.after.stun).toBeLessThan(result.before.stun);
});

test('keyboard sprint slides along solid walls without tunnelling outside the maze', async ({ page }) => {
  await page.keyboard.down('w'); await page.keyboard.down('Shift');
  const result = await page.evaluate(() => {
    const w = window as unknown as HarnessWindow, g = w.game;
    g.cat = w.TestWorld.createCat({ x: 1.5, y: 10.5 });
    w.TestWorld.stunCat(g.cat, 30);
    // A long sprint toward the border must stop with the circular body outside masonry.
    w.step(2);
    const stopped = { x: g.player.x, y: g.player.y };
    // Continue diagonally into the wall: the free component should still slide.
    g.player.angle = Math.PI / 4; w.step(.5);
    return { stopped, slide: { x: g.player.x, y: g.player.y }, occupied: w.TestWorld.isWall(g.maze.cells, g.player.x, g.player.y), lives: g.lives };
  });
  await page.keyboard.up('w'); await page.keyboard.up('Shift');
  expect(result.stopped.x).toBeGreaterThan(11.7); expect(result.stopped.x).toBeLessThanOrEqual(11.83);
  expect(result.slide.x).toBeLessThanOrEqual(11.83); expect(result.slide.y).toBeGreaterThan(result.stopped.y + 1);
  expect(result.occupied).toBe(false); expect(result.lives).toBe(3);
});

test('analog movement preserves stick strength and normalizes diagonal speed', async ({ page }) => {
  const result = await page.evaluate(() => {
    const w = window as unknown as HarnessWindow, g = w.game;
    w.TestWorld.stunCat(g.cat, 30);
    const travel = (strafe: number, forward: number) => {
      g.player.x = 5.5; g.player.y = 5.5; g.player.angle = 0;
      g.velocity = { x: 0, y: 0 }; g.setMoveInput(strafe, forward); w.step(.5);
      return { x: g.player.x - 5.5, y: g.player.y - 5.5 };
    };
    const full = travel(0, 1), half = travel(0, .5), diagonal = travel(1, 1), reverse = travel(-.5, -.5);
    g.setMoveInput(0, 0); w.step(.5); const stopped = { x: g.player.x, y: g.player.y };
    w.step(.5); const resting = { x: g.player.x, y: g.player.y };
    return { full, half, diagonal, reverse, stopped, resting };
  });
  expect(result.full.x).toBeGreaterThan(2);
  expect(result.half.x).toBeCloseTo(result.full.x / 2, 6);
  expect(result.half.y).toBe(0);
  expect(Math.hypot(result.diagonal.x, result.diagonal.y)).toBeCloseTo(result.full.x, 6);
  expect(result.diagonal.x).toBeCloseTo(result.diagonal.y, 6);
  expect(result.reverse.x).toBeCloseTo(-result.half.x, 6);
  expect(result.reverse.y).toBeCloseTo(-result.half.x, 6);
  expect(Math.hypot(result.resting.x - result.stopped.x, result.resting.y - result.stopped.y)).toBeLessThan(.001);
});

test('pause and being caught clear held analog movement before play resumes', async ({ page }) => {
  const result = await page.evaluate(() => {
    const w = window as unknown as HarnessWindow, g = w.game;
    w.TestWorld.stunCat(g.cat, 30);
    g.setMoveInput(1, 1); g.pause(); g.start(); cancelAnimationFrame(g.raf);
    const paused = { x: g.player.x, y: g.player.y }; w.step(.3);
    const resumed = { x: g.player.x, y: g.player.y };
    g.cat = w.TestWorld.createCat({ x: g.player.x, y: g.player.y });
    g.setMoveInput(0, 1); w.step(1 / 60);
    const lives = g.lives; w.step(1.3);
    const respawned = { x: g.player.x, y: g.player.y }; w.step(.3);
    return { paused, resumed, lives, respawned, afterRespawn: { x: g.player.x, y: g.player.y } };
  });
  expect(result.resumed).toEqual(result.paused);
  expect(result.lives).toBe(2);
  expect(result.respawned).toEqual({ x: 2.5, y: 2.5 });
  expect(result.afterRespawn).toEqual(result.respawned);
});

test('a cat-demolished wall becomes a permanent passage the player can traverse', async ({ page }) => {
  const result = await page.evaluate(() => {
    const w = window as unknown as HarnessWindow, g = w.game;
    // The intact barrier has a detour along the top. Crossing this exact cell is blocked.
    for (let y = 2; y < g.maze.size - 1; y++) g.maze.cells[y][4] = 2;
    g.player.x = 5.5; g.player.y = 5.5; g.player.angle = Math.PI;
    w.TestWorld.stunCat(g.cat, 30); g.setMoveInput(0, 1); w.step(.4);
    const blockedX = g.player.x;
    g.setMoveInput(0, 0); g.velocity = { x: 0, y: 0 };
    g.player.x = 5.5; g.player.y = 5.5;
    g.cat = w.TestWorld.createCat({ x: 3.5, y: 5.5 });
    for (let n = 0; n < 61; n++) w.TestWorld.updateCat(g.cat, g.maze, g.player, { x: 0, y: 0 }, 1 / 60, n / 60, .6, g.catEvent);
    const demolished = { wall: g.maze.cells[5][4], openings: [...g.openedWalls], message: g.message };
    // Freeze the predator after its real demolition, then walk through the new opening.
    w.TestWorld.stunCat(g.cat, 30); g.setMoveInput(0, 1); w.step(.45); g.setMoveInput(0, 0);
    const crossed = { x: g.player.x, y: g.player.y, occupied: w.TestWorld.isWall(g.maze.cells, g.player.x, g.player.y) };
    g.cat = w.TestWorld.createCat({ x: g.player.x, y: g.player.y }); w.step(1 / 60); w.step(1.3);
    const respawn = { wall: g.maze.cells[5][4], openings: [...g.openedWalls], lives: g.lives };
    g.mode = 'dead'; g.start(); cancelAnimationFrame(g.raf);
    return { blockedX, demolished, crossed, respawn, newRunOpenings: g.openedWalls };
  });
  expect(result.blockedX).toBeGreaterThanOrEqual(5.16);
  expect(result.demolished.wall).toBe(0);
  expect(result.demolished.openings).toContainEqual({ x: 4.5, y: 5.5 });
  expect(result.demolished.message).toContain('PASSAGE');
  expect(result.crossed.x).toBeLessThan(4); expect(result.crossed.y).toBeCloseTo(5.5, 6); expect(result.crossed.occupied).toBe(false);
  expect(result.respawn.wall).toBe(0); expect(result.respawn.openings).toEqual(result.demolished.openings); expect(result.respawn.lives).toBe(2);
  expect(result.newRunOpenings).toEqual([]);
});

test('mouse look and eased arrow-key turning respond without abrupt cell movement', async ({ page }) => {
  const initial = await page.evaluate(() => (window as unknown as HarnessWindow).game.player.angle);
  await page.keyboard.down('ArrowRight');
  const turned = await page.evaluate(() => {
    const w = window as unknown as HarnessWindow, g = w.game;
    w.step(.2); const angle = g.player.angle;
    g.look(.2); w.step(.1);
    return { angle, looked: g.player.angle };
  });
  await page.keyboard.up('ArrowRight');
  expect(turned.angle).toBeGreaterThan(initial + .3); expect(turned.angle).toBeLessThan(initial + .6);
  expect(turned.looked).toBeGreaterThan(turned.angle + .2);
});

test.describe('touch camera', () => {
  test.use({ hasTouch: true, isMobile: true });
  test('touch look follows one finger and resets after release or cancellation', async ({ page }) => {
    await page.evaluate(() => {
      document.body.style.margin = '0';
      const canvas = document.querySelector<HTMLCanvasElement>('#world')!;
      canvas.style.cssText = 'width:480px;height:320px;touch-action:none;display:block';
      document.querySelector<HTMLCanvasElement>('#map')!.style.display = 'none';
      const w = window as unknown as HarnessWindow;
      w.TestWorld.stunCat(w.game.cat, 30);
    });
    const cdp = await page.context().newCDPSession(page);
    const finger = (id: number, x: number) => ({ id, x, y: 120, radiusX: 3, radiusY: 3, force: 1 });
    const angle = () => page.evaluate(async () => {
      // Chromium coalesces touch moves until the next browser animation frame.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const w = window as unknown as HarnessWindow; w.step(.3); return w.game.player.angle;
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger(1, 250)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger(1, 250), finger(2, 350)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [finger(1, 250), finger(2, 410)] });
    expect(await angle()).toBeCloseTo(0, 6);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [finger(1, 270), finger(2, 410)] });
    expect(await angle()).toBeCloseTo(.12, 5);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger(3, 300)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [finger(3, 320)] });
    expect(await angle()).toBeCloseTo(.24, 5);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger(4, 350)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [finger(4, 370)] });
    expect(await angle()).toBeCloseTo(.36, 5);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  });
});

test('predator travel is consistent at 30 and 144 simulation updates per second', async ({ page }) => {
  const result = await page.evaluate(() => {
    const w = window as unknown as HarnessWindow, g = w.game;
    const run = (fps: number) => {
      const cat = w.TestWorld.createCat({ x: 2.5, y: 6.5 });
      for (let n = 0; n < fps; n++) w.TestWorld.updateCat(cat, g.maze, { x: 10.5, y: 6.5 }, { x: 0, y: 0 }, 1 / fps, n / fps, 0);
      return cat.x;
    };
    return { slow: run(30), fast: run(144) };
  });
  expect(result.slow).toBeCloseTo(result.fast, 6); expect(result.slow).toBeCloseTo(4.8, 6);
});

test('a complete run progresses through vaults, demolition, all lives, and a clean restart', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const evolved = await page.evaluate(() => {
    const w = window as unknown as HarnessWindow, g = w.game;
    const events: string[] = [];
    const originalEvent = g.catEvent;
    g.catEvent = (event: string, at: { x: number; y: number }) => { events.push(event); originalEvent(event, at); };
    // Existing corridors have one short masonry barrier and a long way around it.
    for (let y = 2; y < g.maze.size - 1; y++) g.maze.cells[y][4] = 2;
    g.player.x = 7.5; g.player.y = 5.5; g.player.angle = Math.PI;
    g.cat = w.TestWorld.createCat({ x: 1.5, y: 10.5 });
    const collect = () => { g.cheese = { x: g.player.x, y: g.player.y }; w.step(1 / 60); };
    for (let n = 0; n < 3; n++) collect();
    w.step(1 / 60); const midProgress = g.progress;
    g.maze.secret = { x: 7.5, y: 6 }; w.step(1 / 60);
    g.cat = w.TestWorld.createCat({ x: 3.5, y: 5.5 });
    w.step(1.1);
    const vaulted = { events: [...events], wall: g.maze.cells[5][4], catX: g.cat.x, lives: g.lives };
    for (let n = 0; n < 3; n++) collect();
    w.step(1 / 60); const lateProgress = g.progress;
    g.cat = w.TestWorld.createCat({ x: 3.5, y: 5.5 });
    w.step(1.1);
    const demolished = { events: [...events], wall: g.maze.cells[5][4], catX: g.cat.x, lives: g.lives };
    g.cat = w.TestWorld.createCat({ x: 5.5, y: 5.5 });
    w.frame(0);
    return { midProgress, lateProgress, vaulted, demolished, weapon: g.weapon, cheese: g.cheeseCount };
  });
  expect(evolved.midProgress).toBeGreaterThanOrEqual(.25); expect(evolved.midProgress).toBeLessThan(.55);
  expect(evolved.vaulted.events).toEqual(expect.arrayContaining(['jump', 'land']));
  expect(evolved.vaulted.wall).toBe(2); expect(evolved.vaulted.lives).toBe(3);
  expect(evolved.lateProgress).toBeGreaterThanOrEqual(.55);
  expect(evolved.demolished.events).toContain('break'); expect(evolved.demolished.wall).toBe(0); expect(evolved.demolished.lives).toBe(3);
  expect(evolved.weapon).toBe('ready'); expect(evolved.cheese).toBe(6);
  await page.locator('#world').screenshot({ path: '/tmp/cheese-combat-qa.png' });
  const completed = await page.evaluate(() => {
    const w = window as unknown as HarnessWindow, g = w.game;
    g.fire(); const shot = { weapon: g.weapon, stun: g.cat.stunRemaining };
    w.step(5.05); const recovered = g.cat.stunRemaining;
    const lives: number[] = [];
    for (let life = 0; life < 3; life++) {
      g.cat = w.TestWorld.createCat({ x: g.player.x, y: g.player.y });
      w.step(1 / 60); lives.push(g.lives); w.step(1.3);
    }
    const dead = { mode: g.mode, lives: g.lives, weapon: g.weapon, score: g.score, best: g.best };
    g.start(); cancelAnimationFrame(g.raf);
    return { shot, recovered, lives, dead, restart: { mode: g.mode, lives: g.lives, weapon: g.weapon, elapsed: g.elapsed, cheese: g.cheeseCount, score: g.score, best: g.best } };
  });
  expect(completed.shot).toEqual({ weapon: 'spent', stun: 5 }); expect(completed.recovered).toBe(0);
  expect(completed.lives).toEqual([2, 1, 0]); expect(completed.dead.mode).toBe('dead'); expect(completed.dead.weapon).toBe('spent');
  expect(completed.dead.score).toBe(1150); expect(completed.dead.best).toBe(1150);
  expect(completed.restart).toEqual({ mode: 'playing', lives: 3, weapon: 'hidden', elapsed: 0, cheese: 0, score: 0, best: 1150 });
  expect(errors).toEqual([]);
});
