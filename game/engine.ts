import { GameAudio } from "./audio";
import { Renderer, type Particle } from "./renderer";
import { createMaze, createCat, updateCat, stunCat, isWall, castRay, findPath, type Vec, type CatEvent } from "./world";

export type Mode = "start" | "playing" | "paused" | "dead";
export interface HUD {
  mode: Mode; score: number; best: number; cheese: number; lives: number;
  progress: number; threat: number; weapon: "hidden" | "ready" | "spent";
  stun: number; message: string; hint: string; elapsed: number; muted: boolean;
}

export class CheeseGame {
  private maze = createMaze();
  private player = { ...this.maze.spawn, angle: 0, bob: 0, speed: 0 };
  private cat = createCat(this.maze.catSpawn);
  private cheese = { ...this.maze.cheeseSpawn };
  private velocity = { x: 0, y: 0 };
  private renderer: Renderer;
  private audio = new GameAudio();
  private keys = new Set<string>();
  private touches = new Set<string>();
  private mouseDelta = 0;
  private turnVelocity = 0;
  private particles: Particle[] = [];
  private elapsed = 0;
  private progress = 0;
  private score = 0;
  private best = 0;
  private cheeseCount = 0;
  private lives = 3;
  private mode: Mode = "start";
  private weapon: HUD["weapon"] = "hidden";
  private message = "FIND THE CHEESE. STAY ALIVE.";
  private hint = "";
  private messageUntil = 0;
  private recoil = 0;
  private hurt = 0;
  private shake = 0;
  private deathTimer = 0;
  private stepTimer = 0;
  private lastHUD = 0;
  private muted = false;
  private raf = 0;
  private lastTime = 0;
  private disposed = false;
  private listeners: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement, map: HTMLCanvasElement, private onHUD: (hud: HUD) => void) {
    this.renderer = new Renderer(canvas, map);
    try { this.best = Number(localStorage.getItem("cheese-v2-best")) || 0; } catch { /* storage optional */ }
    this.faceOpening();
    this.listen(window, "resize", () => this.renderer.resize());
    this.listen(window, "blur", () => this.pause());
    this.listen(document, "visibilitychange", () => { if (document.hidden) this.pause(); });
    this.listen(window, "keydown", this.onKeyDown as EventListener);
    this.listen(window, "keyup", ((e: KeyboardEvent) => { this.keys.delete(e.code); }) as EventListener);
    this.listen(document, "mousemove", ((e: MouseEvent) => {
      if (document.pointerLockElement === canvas && this.mode === "playing") this.mouseDelta += e.movementX * 0.0023;
    }) as EventListener);
    this.listen(canvas, "mousedown", ((e: MouseEvent) => {
      if (e.button !== 0 || this.mode !== "playing") return;
      if (document.pointerLockElement !== canvas) this.lockPointer();
      else this.fire();
    }) as EventListener);
    this.listen(document, "pointerlockchange", () => {
      if (document.pointerLockElement !== canvas) this.pause();
    });
    this.listen(canvas, "contextmenu", e => e.preventDefault());
    this.listen(canvas, "pointerdown", ((e: PointerEvent) => {
      if (e.pointerType === "touch") { this.touchX = e.clientX; canvas.setPointerCapture(e.pointerId); }
    }) as EventListener);
    this.listen(canvas, "pointermove", ((e: PointerEvent) => {
      if (e.pointerType === "touch" && e.buttons && this.mode === "playing") { this.mouseDelta += (e.clientX - this.touchX) * 0.006; this.touchX = e.clientX; }
    }) as EventListener);
    this.publish();
    this.raf = requestAnimationFrame(this.frame);
  }
  private touchX = 0;
  private listen(target: EventTarget, type: string, fn: EventListener) {
    target.addEventListener(type, fn); this.listeners.push(() => target.removeEventListener(type, fn));
  }
  private lockPointer() {
    if (matchMedia("(pointer: coarse)").matches) return;
    try { const result = this.canvas.requestPointerLock(); if (result) result.catch(() => {}); } catch { /* keyboard look remains available */ }
  }
  private onKeyDown = (e: KeyboardEvent) => {
    if (this.mode === "playing" && ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    if (e.code === "Escape" || e.code === "KeyP") { if (!e.repeat) this.pause(); return; }
    if (e.code === "KeyM" && !e.repeat) { this.toggleMute(); return; }
    if (this.mode !== "playing") return;
    this.keys.add(e.code);
    if (e.repeat) return;
    if (e.code === "Space") this.fire();
    if (e.code === "KeyE") this.interact();
  };
  start = () => {
    if (this.mode === "dead") this.reset();
    this.mode = "playing"; this.keys.clear(); this.touches.clear(); this.mouseDelta = 0; this.lastTime = performance.now();
    void this.audio.start(); this.lockPointer(); this.publish();
  };
  pause = () => {
    if (this.mode !== "playing") return;
    this.mode = "paused"; this.keys.clear(); this.touches.clear(); this.mouseDelta = 0; this.velocity = {x:0,y:0}; this.player.speed = 0;
    this.turnVelocity = 0;
    this.audio.setPaused(true);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.publish();
  };
  toggleMute = () => { this.muted = !this.muted; this.audio.setMuted(this.muted); this.publish(); };
  touch = (key: string, pressed: boolean) => { if (pressed) this.touches.add(key); else this.touches.delete(key); };
  look = (delta: number) => { this.mouseDelta += delta; };
  private down(key: string) { return this.keys.has(key) || this.touches.has(key); }
  private faceOpening() {
    const choices = [[1,0], [0,1], [-1,0], [0,-1]];
    const dir = choices.find(([dx,dy]) => !isWall(this.maze.cells, this.player.x + dx, this.player.y + dy))!;
    this.player.angle = Math.atan2(dir[1], dir[0]);
  }
  private reset() {
    this.maze = createMaze(); this.player = {...this.maze.spawn, angle:0, bob:0, speed:0}; this.faceOpening();
    this.cat = createCat(this.maze.catSpawn); this.cheese = {...this.maze.cheeseSpawn};
    this.velocity = {x:0,y:0}; this.turnVelocity = 0; this.elapsed = 0; this.progress = 0; this.score = 0; this.cheeseCount = 0;
    this.lives = 3; this.weapon = "hidden"; this.particles = []; this.deathTimer = 0; this.hurt = 0; this.recoil = 0; this.shake = 0;
    this.announce("FIND THE CHEESE. STAY ALIVE.", 4);
  }
  private announce(message: string, seconds = 3) { this.message = message; this.messageUntil = this.elapsed + seconds; }
  interact = () => {
    if (this.mode !== "playing" || this.deathTimer > 0 || this.weapon !== "hidden") return;
    if (Math.hypot(this.player.x - this.maze.secret.x, this.player.y - this.maze.secret.y) < 1.15) {
      this.weapon = "ready"; this.score += 250; this.audio.effect("secret");
      this.announce("SECRET FOUND // M-01 BLASTER. ONE SHOT. MAKE IT COUNT.", 6); this.publish();
    }
  };
  fire = () => {
    if (this.mode !== "playing" || this.deathTimer > 0) return;
    if (this.weapon !== "ready") { this.announce(this.weapon === "hidden" ? "SOMETHING IS HIDDEN IN THESE WALLS." : "CHAMBER EMPTY. RUN.", 2); return; }
    this.weapon = "spent"; this.recoil = 1; this.shake = 2; this.audio.effect("blast");
    const dx = this.cat.x - this.player.x, dy = this.cat.y - this.player.y, distance = Math.hypot(dx, dy);
    const forward = dx * Math.cos(this.player.angle) + dy * Math.sin(this.player.angle);
    const side = Math.abs(-dx * Math.sin(this.player.angle) + dy * Math.cos(this.player.angle));
    const wall = castRay(this.maze.cells, this.player.x, this.player.y, dx / (distance || 1), dy / (distance || 1));
    const clear = wall.distance >= distance - 0.18;
    if (forward > 0 && distance < 10 && side < 0.35 + forward * 0.13 && clear) {
      const impact = {x:this.cat.x,y:this.cat.y};
      stunCat(this.cat, 5); this.burst(impact, 65, "#b6412c", 0.5); this.burst(impact, 30, "#b4aa86", 0.65);
      this.score += 300; this.announce("DIRECT HIT // FIVE SECONDS. GET OUT.", 5);
    } else this.announce("SHOT SPENT // KEEP MOVING.", 3);
    this.publish();
  };
  private burst(at: Vec, count: number, color: string, height = 0.5) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, speed = 0.5 + Math.random() * 2.8;
      this.particles.push({ x:at.x, y:at.y, z:height, vx:Math.cos(a)*speed, vy:Math.sin(a)*speed, vz:1+Math.random()*2, life:0.4+Math.random()*0.8, color, size:0.015+Math.random()*0.04 });
    }
  }
  private catEvent = (event: CatEvent, at: Vec) => {
    const distance = Math.hypot(at.x - this.player.x, at.y - this.player.y);
    if (distance < 11) this.audio.effect(event);
    if (event === "break") { this.burst(at, 35, "#a59371", 0.65); if (distance < 8) this.shake = 1.3; this.announce("IT IS TEARING THE MAZE APART.", 3); }
    if (event === "jump" && distance < 8) this.announce("IT CAN CLEAR THE WALLS.", 2.5);
    if (event === "land" && distance < 6) this.shake = 0.6;
  };
  private move(dt: number) {
    const forward = Number(this.down("KeyW") || this.down("ArrowUp")) - Number(this.down("KeyS") || this.down("ArrowDown"));
    const strafe = Number(this.down("KeyD")) - Number(this.down("KeyA"));
    const turn = Number(this.down("ArrowRight")) - Number(this.down("ArrowLeft") || this.down("KeyQ"));
    this.turnVelocity += (turn * 3.6 - this.turnVelocity) * (1 - Math.exp(-18 * dt));
    const look = this.mouseDelta * (1 - Math.exp(-55 * dt)); this.mouseDelta -= look;
    this.player.angle = (this.player.angle + this.turnVelocity * dt + look) % (Math.PI * 2);
    const sprint = this.down("ShiftLeft") || this.down("ShiftRight");
    const speed = sprint ? 7.2 : 5.2, norm = Math.hypot(forward, strafe) || 1;
    const dirX = Math.cos(this.player.angle), dirY = Math.sin(this.player.angle);
    const targetX = (dirX * forward - dirY * strafe) / norm * speed;
    const targetY = (dirY * forward + dirX * strafe) / norm * speed;
    const response = 1 - Math.exp(-22 * dt);
    this.velocity.x += (targetX - this.velocity.x) * response; this.velocity.y += (targetY - this.velocity.y) * response;
    // Small substeps and a circular body prevent tunnelling and allow smooth wall sliding.
    const steps = Math.max(1, Math.ceil(Math.hypot(this.velocity.x, this.velocity.y) * dt / 0.08));
    for (let i = 0; i < steps; i++) {
      const nx = this.player.x + this.velocity.x * dt / steps;
      if (this.canOccupy(nx, this.player.y)) this.player.x = nx;
      const ny = this.player.y + this.velocity.y * dt / steps;
      if (this.canOccupy(this.player.x, ny)) this.player.y = ny;
    }
    this.player.speed = Math.hypot(this.velocity.x, this.velocity.y);
    this.player.bob += this.player.speed * dt * 2.4;
    this.stepTimer -= dt;
    if (this.player.speed > 0.7 && this.stepTimer <= 0) { this.audio.effect("step"); this.stepTimer = sprint ? 0.2 : 0.29; }
  }
  private canOccupy(x: number, y: number) {
    const r = 0.17;
    for (let cy = Math.floor(y-r); cy <= Math.floor(y+r); cy++) for (let cx = Math.floor(x-r); cx <= Math.floor(x+r); cx++) {
      if (!isWall(this.maze.cells, cx, cy)) continue;
      const dx = x - Math.max(cx, Math.min(x, cx+1)), dy = y - Math.max(cy, Math.min(y, cy+1));
      if (dx*dx + dy*dy < r*r) return false;
    }
    return true;
  }
  private tick(dt: number) {
    this.elapsed += dt;
    this.recoil = Math.max(0, this.recoil - dt * 3.4); this.shake = Math.max(0, this.shake - dt * 4);
    this.hurt = Math.max(0, this.hurt - dt * 1.1);
    if (this.deathTimer > 0) {
      this.deathTimer -= dt; this.player.angle += dt * 0.5;
      if (this.deathTimer <= 0) {
        if (this.lives === 0) {
          this.mode = "dead"; this.audio.setPaused(true); if (document.pointerLockElement === this.canvas) document.exitPointerLock();
          this.best = Math.max(this.best, this.score); try { localStorage.setItem("cheese-v2-best", String(this.best)); } catch { /* optional */ }
        } else {
          // Keep the altered maze and the one-shot ammo state across all three lives.
          this.player.x = this.maze.spawn.x; this.player.y = this.maze.spawn.y; this.velocity = {x:0,y:0}; this.faceOpening();
          this.cat = createCat(this.maze.catSpawn); this.announce("BACK IN THE MAZE // IT REMEMBERS.", 3);
        }
      }
    } else {
      this.move(dt);
      const previous = this.progress;
      this.progress = Math.min(1, this.elapsed / 180 + this.cheeseCount * 0.1 + (3-this.lives)*0.08);
      if (previous < 0.25 && this.progress >= 0.25) this.announce("PREDATOR ADAPTING // WALLS ARE NO LONGER SAFE.", 5);
      if (previous < 0.55 && this.progress >= 0.55) this.announce("PREDATOR EVOLVED // LISTEN FOR CRACKING MASONRY.", 5);
      updateCat(this.cat, this.maze, this.player, this.velocity, dt, this.elapsed, this.progress, this.catEvent);
      if (Math.hypot(this.player.x - this.cheese.x, this.player.y - this.cheese.y) < 0.46) this.pickup();
      if (this.cat.stunRemaining <= 0 && this.cat.z < 0.4 && Math.hypot(this.player.x - this.cat.x, this.player.y - this.cat.y) < 0.43) {
        this.lives--; this.hurt = 1; this.shake = 3; this.deathTimer = 1.25; this.audio.effect("hurt"); this.announce("CAUGHT // " + this.lives + " LIVES REMAIN", 3);
      }
      this.hint = this.weapon === "hidden" && Math.hypot(this.player.x-this.maze.secret.x,this.player.y-this.maze.secret.y) < 1.15 ? "[ E ] SEARCH THE HOLLOW WALL" : "";
    }
    for (const p of this.particles) { p.life -= dt; p.x += p.vx*dt; p.y += p.vy*dt; p.z += p.vz*dt; p.vz -= dt*6; if (p.z < 0.02) { p.z=0.02; p.vz *= -0.25; p.vx *= 0.8; p.vy *= 0.8; } }
    this.particles = this.particles.filter(p=>p.life>0);
    this.audio.setThreat(this.threat());
    if (this.elapsed > this.messageUntil) this.message = "FIND THE CHEESE. STAY ALIVE.";
  }
  private pickup() {
    this.cheeseCount++; this.score += 100; this.burst(this.cheese, 16, "#efc35c", 0.2); this.audio.effect("pickup");
    this.announce("+100 // IT HEARD THAT.", 2.5);
    const candidates: Vec[] = [];
    for (let y=1;y<this.maze.size-1;y++) for(let x=1;x<this.maze.size-1;x++) if (!isWall(this.maze.cells,x,y) && Math.hypot(x+.5-this.player.x,y+.5-this.player.y)>5) candidates.push({x:x+.5,y:y+.5});
    const pick = candidates[Math.floor(Math.random()*candidates.length)] || this.maze.cheeseSpawn;
    // Maze remains connected after demolition; only reachable pickups are chosen.
    this.cheese = findPath(this.maze.cells, this.player, pick).length ? pick : {...this.maze.cheeseSpawn};
  }
  private threat() { return this.cat.stunRemaining > 0 ? 0 : Math.max(0, 1-Math.hypot(this.cat.x-this.player.x,this.cat.y-this.player.y)/8); }
  private publish() {
    if (this.disposed) return;
    this.onHUD({mode:this.mode,score:this.score,best:this.best,cheese:this.cheeseCount,lives:this.lives,progress:this.progress,threat:this.threat(),weapon:this.weapon,stun:this.cat.stunRemaining,message:this.message,hint:this.hint,elapsed:this.elapsed,muted:this.muted});
  }
  private frame = (now: number) => {
    if (this.disposed) return;
    const dt = this.lastTime ? Math.min(0.05, (now-this.lastTime)/1000) : 0; this.lastTime = now;
    if (this.mode === "playing") this.tick(dt);
    this.renderer.render({cells:this.maze.cells,player:this.player,cat:this.cat,cheese:this.cheese,secret:this.maze.secret,secretFound:this.weapon!=="hidden",weapon:this.weapon,elapsed:this.elapsed,recoil:this.recoil,hurt:this.hurt,shake:this.shake,threat:this.threat(),particles:this.particles});
    if (now-this.lastHUD > 80) { this.publish(); this.lastHUD=now; }
    this.raf = requestAnimationFrame(this.frame);
  };
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.raf); this.listeners.forEach(remove=>remove()); this.audio.dispose();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
}
