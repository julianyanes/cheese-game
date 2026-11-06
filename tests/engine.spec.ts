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
  await page.setContent('<canvas id="world"></canvas><canvas id="map" width="128" height="128"></canvas>');
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
    g.maze = { size, cells, spawn: { x: 2.5, y: 2.5 }, catSpawn: { x: 10.5, y: 10.5 }, cheeseSpawn: { x: 10.5, y: 1.5 }, secret: { x: 2.5, y: 3.5 } };
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

test('secret requires proximity; a single blast stuns for exactly five seconds', async ({ page }) => {
  const result = await page.evaluate(() => {
    const w = window as unknown as HarnessWindow, g = w.game;
    g.maze.secret = { x: 10.5, y: 10.5 }; g.interact();
    const distant = w.hud.weapon;
    g.maze.secret = { x: 2.5, y: 3.5 }; g.interact();
    const equipped = w.hud.weapon;
    g.fire(); const fired = { weapon: w.hud.weapon, stun: w.hud.stun, score: w.hud.score };
    g.fire(); const repeated = { weapon: w.hud.weapon, stun: w.hud.stun, score: w.hud.score };
    const x = g.cat.x; w.step(4.9);
    const before = { stun: g.cat.stunRemaining, x: g.cat.x, lives: g.lives };
    w.step(.1); const expired = g.cat.stunRemaining;
    w.step(.1); const resumed = g.cat.x;
    return { distant, equipped, fired, repeated, x, before, expired, resumed };
  });
  expect(result.distant).toBe('hidden'); expect(result.equipped).toBe('ready');
  expect(result.fired).toEqual({ weapon: 'spent', stun: 5, score: 550 });
  expect(result.repeated).toEqual(result.fired);
  expect(result.before.stun).toBeCloseTo(.1, 6); expect(result.before.x).toBe(result.x); expect(result.before.lives).toBe(3);
  expect(result.expired).toBe(0); expect(result.resumed).toBeLessThan(result.x);
});

test('missing or hitting solid cover consumes the only shot', async ({ page }) => {
  const result = await page.evaluate(() => {
    const w = window as unknown as HarnessWindow, g = w.game;
    g.interact(); g.player.angle = Math.PI; g.fire();
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
    g.interact(); g.fire();
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
    g.interact(); g.fire(); g.pause();
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
    g.maze.secret = { x: 7.5, y: 6.5 }; g.interact();
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
