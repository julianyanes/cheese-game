import { castRay } from "./world";
import { createCatFrames } from "./cat-art";

export interface Scene {
  cells: number[][];
  player: { x: number; y: number; angle: number; bob: number; speed: number };
  cat: { x: number; y: number; z: number; animTime: number; stunRemaining: number; state: string; actionProgress: number; action: {wall?: {x:number;y:number}} | null };
  cheese: { x: number; y: number };
  secret: { x: number; y: number };
  secretFound: boolean;
  weapon: "hidden" | "ready" | "spent";
  elapsed: number;
  recoil: number;
  hurt: number;
  shake: number;
  threat: number;
  particles: Particle[];
}
export interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; color: string; size: number }

const TEX = 64;
const FOV = Math.tan(Math.PI * 0.38 / 2);
const EYE = 0.43;
const WALL = 1.2;

function texture(kind: number) {
  const data = new Uint8ClampedArray(TEX * TEX * 3);
  for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
    const noise = ((Math.sin(x * 127.1 + y * 311.7) * 43758.5453) % 1 + 1) % 1;
    let r = 0, g = 0, b = 0;
    if (kind <= 1) {
      const row = Math.floor(y / 16), bx = (x + (row % 2) * 16) % 32;
      const seam = y % 16 < 1 || bx < 1;
      const edge = y % 16 === 1 || bx === 1;
      const v = seam ? 16 : 58 + noise * 20 + (edge ? 14 : 0);
      r = v * (kind ? 1.12 : 0.9); g = v * (kind ? 0.9 : 0.98); b = v * (kind ? 0.74 : 1.02);
      // Broken plaster seams give destructible masonry a distinct surface.
      if (kind && (Math.abs(x - 25 - Math.sin(y * 0.2) * 7) < 1 || (y > 32 && Math.abs(x - 41 + (y - 32) * 0.38) < 1))) { r = 22; g = 16; b = 13; }
    } else if (kind === 2) {
      const seam = x % 32 < 1 || y % 32 < 1;
      const check = (Math.floor(x / 32) + Math.floor(y / 32)) % 2;
      r = seam ? 13 : 37 + check * 7 + noise * 10; g = r * 0.94; b = r * 0.86;
      if (y > 26 && y < 30 && x > 4 && x < 22) { r += 8; g += 8; b += 7; }
    } else {
      const seam = x % 32 < 2 || y % 32 < 2;
      r = seam ? 10 : 29 + noise * 7; g = r * 1.04; b = r * 1.08;
    }
    const i = (y * TEX + x) * 3; data[i] = r; data[i + 1] = g; data[i + 2] = b;
  }
  return data;
}

function makeCheese(): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const p = c.getContext("2d")!;
  p.shadowBlur = 20; p.shadowColor = "#eaae27";
  p.fillStyle = "#b56b13"; p.beginPath(); p.moveTo(16, 60); p.lineTo(107, 49); p.lineTo(107, 92); p.lineTo(16, 108); p.closePath(); p.fill();
  p.fillStyle = "#ffd361"; p.beginPath(); p.moveTo(16, 60); p.lineTo(54, 24); p.lineTo(107, 49); p.closePath(); p.fill();
  p.shadowBlur = 0; p.fillStyle = "#e8a12b"; p.beginPath(); p.moveTo(16, 60); p.lineTo(107, 49); p.lineTo(107, 85); p.lineTo(16, 101); p.closePath(); p.fill();
  [[35, 74, 6], [72, 68, 7], [94, 78, 4], [50, 90, 3], [54, 44, 5], [76, 48, 3]].forEach(([x, y, r]) => {
    p.fillStyle = "#8c4e15"; p.beginPath(); p.ellipse(x, y, r, r * 0.65, -0.15, 0, Math.PI * 2); p.fill();
    p.strokeStyle = "#ffdf76"; p.lineWidth = 1; p.stroke();
  });
  return c;
}

function makeSecret() {
  const c = document.createElement("canvas"); c.width = c.height = 128; const p = c.getContext("2d")!;
  p.strokeStyle = "#c38c42"; p.lineWidth = 3; p.globalAlpha = 0.7;
  p.beginPath(); p.moveTo(39, 85); p.lineTo(52, 49); p.lineTo(83, 49); p.lineTo(89, 62); p.lineTo(60, 64); p.lineTo(54, 85); p.closePath(); p.stroke();
  p.beginPath(); p.moveTo(32, 98); p.lineTo(96, 30); p.moveTo(29, 96); p.lineTo(35, 101); p.stroke();
  return c;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private mapCtx: CanvasRenderingContext2D;
  private image!: ImageData;
  private depth!: Float32Array;
  private tops!: Float32Array;
  private bottoms!: Float32Array;
  private floorLight!: Float32Array;
  private width = 0;
  private height = 0;
  private textures = [texture(0), texture(1), texture(2), texture(3)];
  private cats = createCatFrames();
  private cheese = makeCheese();
  private secret = makeSecret();
  constructor(private canvas: HTMLCanvasElement, map: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.mapCtx = map.getContext("2d")!;
    this.resize();
  }
  resize() {
    const ratio = window.innerWidth / window.innerHeight;
    this.width = Math.round(Math.min(800, Math.max(400, window.innerWidth * 0.65)) / 2) * 2;
    this.height = Math.round(this.width / ratio / 2) * 2;
    this.canvas.width = this.width; this.canvas.height = this.height;
    this.image = this.ctx.createImageData(this.width, this.height);
    this.depth = new Float32Array(this.width); this.tops = new Float32Array(this.width); this.bottoms = new Float32Array(this.width);
    this.floorLight = Float32Array.from({length:this.width}, (_,x) => 0.48 + 0.7 * Math.pow(1 - Math.abs(x / this.width * 2 - 1), 2));
    this.ctx.imageSmoothingEnabled = false;
  }
  render(s: Scene) {
    const w = this.width, h = this.height, p = this.image.data;
    const dirX = Math.cos(s.player.angle), dirY = Math.sin(s.player.angle);
    const planeX = -dirY * FOV, planeY = dirX * FOV;
    const projection = w / (2 * FOV);
    const shake = s.shake * Math.sin(s.elapsed * 81) * h * 0.006;
    const horizon = h * 0.48 + Math.sin(s.player.bob) * Math.min(1, s.player.speed / 4) * h * 0.006 + shake;

    // Linear camera-plane floor casting: all samples stay anchored to world coordinates.
    for (let y = 0; y < h; y++) {
      const floor = y > horizon;
      const distance = (floor ? EYE : WALL - EYE) * projection / Math.max(0.5, Math.abs(y - horizon));
      const stepX = distance * 2 * planeX / w, stepY = distance * 2 * planeY / w;
      let wx = s.player.x + distance * (dirX - planeX), wy = s.player.y + distance * (dirY - planeY);
      const tex = this.textures[floor ? 2 : 3];
      const fog = Math.max(0.025, 1 / (1 + distance * distance * 0.09));
      for (let x = 0; x < w; x++, wx += stepX, wy += stepY) {
        const tx = (Math.floor(wx * TEX) & 63), ty = (Math.floor(wy * TEX) & 63);
        const ti = (ty * TEX + tx) * 3, i = (y * w + x) * 4;
        const cone = this.floorLight[x];
        p[i] = tex[ti] * fog * cone; p[i + 1] = tex[ti + 1] * fog * cone; p[i + 2] = tex[ti + 2] * fog * cone; p[i + 3] = 255;
      }
    }
    for (let x = 0; x < w; x++) {
      const cameraX = 2 * (x + 0.5) / w - 1;
      const rayX = dirX + planeX * cameraX, rayY = dirY + planeY * cameraX;
      const hit = castRay(s.cells, s.player.x, s.player.y, rayX, rayY);
      const d = Math.max(0.025, hit.distance);
      this.depth[x] = d;
      const top = horizon - (WALL - EYE) * projection / d;
      const bottom = horizon + EYE * projection / d;
      this.tops[x] = top; this.bottoms[x] = bottom;
      const tex = this.textures[hit.material === 2 ? 1 : 0];
      let tx = Math.floor(hit.wallX * TEX) & 63;
      if ((hit.side === 0 && rayX > 0) || (hit.side === 1 && rayY < 0)) tx = 63 - tx;
      const flashlight = 0.55 + 0.62 * Math.pow(1 - Math.abs(cameraX), 1.6);
      const light = Math.max(0.035, flashlight / (1 + d * d * 0.065)) * (hit.side ? 0.77 : 1);
      const emergency = (hit.cellX * 7 + hit.cellY * 13) % 11 === 0;
      const breaking = s.cat.state === "break" && s.cat.action?.wall?.x === hit.cellX && s.cat.action.wall.y === hit.cellY;
      for (let y = Math.max(0, Math.floor(top)); y < Math.min(h, bottom); y++) {
        // Use the *unclipped* wall bounds: no texture stretching when close or turning.
        const v = (y - top) / (bottom - top), ty = Math.floor(v * TEX) & 63;
        const ti = (ty * TEX + tx) * 3, i = (y * w + x) * 4;
        const ao = 0.68 + 0.32 * Math.sin(v * Math.PI);
        const stripe = emergency && v > 0.21 && v < 0.245;
        p[i] = stripe ? 160 / (1 + d * 0.2) : tex[ti] * light * ao + (emergency ? 9 * light : 0);
        p[i + 1] = stripe ? 25 : tex[ti + 1] * light * ao;
        p[i + 2] = stripe ? 12 : tex[ti + 2] * light * ao;
        if (breaking) {
          const growth = s.cat.actionProgress;
          const crack = Math.abs(hit.wallX - 0.49 - Math.sin(v * 31) * 0.06) < 0.009;
          const branch = Math.abs(hit.wallX - 0.49 - (v - 0.4) * 0.65) < 0.006;
          if ((crack || branch) && Math.abs(v - 0.45) < growth * 0.48) { p[i] = 145 * light; p[i+1] = 100 * light; p[i+2] = 54 * light; }
        }
      }
    }
    this.ctx.putImageData(this.image, 0, 0);
    const sprites = [
      { x: s.cheese.x, y: s.cheese.y, z: 0.12 + Math.sin(s.elapsed * 3) * 0.035, size: 0.37, image: this.cheese, cat: false },
      ...(!s.secretFound ? [{ x: s.secret.x, y: s.secret.y, z: 0.18, size: 0.36, image: this.secret, cat: false }] : []),
      { x: s.cat.x, y: s.cat.y, z: s.cat.z, size: 1.12, image: this.cats[s.cat.stunRemaining > 0 ? 0 : Math.floor(s.cat.animTime * 10) % this.cats.length], cat: true },
    ].sort((a, b) => Math.hypot(b.x - s.player.x, b.y - s.player.y) - Math.hypot(a.x - s.player.x, a.y - s.player.y));
    for (const sprite of sprites) {
      if (sprite.cat && s.cat.stunRemaining > 4.55) continue;
      const dx = sprite.x - s.player.x, dy = sprite.y - s.player.y;
      const depth = dx * dirX + dy * dirY;
      if (depth < 0.06) continue;
      const lateral = -dx * dirY + dy * dirX;
      const size = sprite.size * projection / depth;
      const left = w / 2 + lateral * projection / depth - size / 2;
      const height = sprite.cat && s.cat.stunRemaining > 0 ? size * 0.36 : size;
      const top = horizon + (EYE - sprite.z) * projection / depth - height * 0.94;
      const ctx = this.ctx;
      ctx.globalAlpha = Math.max(0.18, 1 / (1 + depth * 0.045));
      for (let x = Math.max(0, Math.floor(left)); x < Math.min(w, left + size); x++) {
        const sourceX = Math.min(sprite.image.width - 1, Math.max(0, Math.floor((x - left) / size * sprite.image.width)));
        if (depth < this.depth[x]) {
          ctx.drawImage(sprite.image, sourceX, 0, 1, sprite.image.height, x, top, 1, height);
        } else if (sprite.cat && sprite.z > 0) {
          // A vault clears the top of a wall, but the lower body stays occluded.
          const visibleH = Math.min(height, this.tops[x] - top);
          if (visibleH > 0) ctx.drawImage(sprite.image, sourceX, 0, 1, sprite.image.height * visibleH / height, x, top, 1, visibleH);
        }
      }
      ctx.globalAlpha = 1;
    }
    for (const part of s.particles) {
      const dx = part.x - s.player.x, dy = part.y - s.player.y;
      const d = dx * dirX + dy * dirY;
      if (d < 0.1) continue;
      const x = w / 2 + (-dx * dirY + dy * dirX) * projection / d;
      const y = horizon + (EYE - part.z) * projection / d;
      if (x < 0 || x >= w || (d > this.depth[Math.floor(x)] && y >= this.tops[Math.floor(x)])) continue;
      this.ctx.globalAlpha = Math.min(1, part.life * 2); this.ctx.fillStyle = part.color;
      const size = Math.max(1, part.size * projection / d); this.ctx.fillRect(x, y, size, size);
    }
    this.ctx.globalAlpha = 1;
    this.drawWeapon(s);
    // Soft permanent peripheral darkness; threat intensifies the crimson edges.
    const vignette = this.ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, Math.max(w, h) * 0.65);
    vignette.addColorStop(0, "transparent"); vignette.addColorStop(1, `rgba(${s.threat > 0.65 ? "85,0,0" : "0,0,0"},0.8)`);
    this.ctx.fillStyle = vignette; this.ctx.fillRect(0, 0, w, h);
    if (s.hurt > 0) { this.ctx.fillStyle = `rgba(190,18,8,${s.hurt * 0.6})`; this.ctx.fillRect(0, 0, w, h); }
    if (s.recoil > 0.85) { this.ctx.fillStyle = `rgba(255,205,110,${(s.recoil - 0.85) * 2})`; this.ctx.fillRect(0, 0, w, h); }
    this.drawMap(s);
  }
  private drawWeapon(s: Scene) {
    const c = this.ctx, w = this.width, h = this.height;
    const bob = Math.sin(s.player.bob) * 2 * Math.min(1, s.player.speed / 4);
    c.save(); c.translate(w * 0.5 + bob, h + s.recoil * h * 0.08); c.scale(h / 400, h / 400);
    if (s.weapon === "hidden") {
      // Small mouse paws keep the camera grounded in the character.
      c.fillStyle = "#52433d";
      [-1, 1].forEach(side => { c.save(); c.scale(side, 1); c.beginPath(); c.ellipse(63, 3 - bob * 0.2, 22, 19, -0.5, 0, Math.PI * 2); c.fill(); c.strokeStyle = "#b7997f"; c.lineWidth = 2; for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(50 + i * 8, -9); c.lineTo(53 + i * 8, -3); c.stroke(); } c.restore(); });
    } else {
      c.fillStyle = "#514438"; c.beginPath(); c.moveTo(-76, 0); c.lineTo(-47, -58); c.lineTo(-19, -55); c.lineTo(-9, 0); c.fill();
      c.beginPath(); c.moveTo(76, 0); c.lineTo(47, -58); c.lineTo(19, -55); c.lineTo(9, 0); c.fill();
      const metal = c.createLinearGradient(-27, 0, 27, 0); metal.addColorStop(0, "#20282a"); metal.addColorStop(0.36, "#788582"); metal.addColorStop(0.52, "#3b4745"); metal.addColorStop(1, "#141a1b");
      c.fillStyle = metal; c.beginPath(); c.moveTo(-40, 0); c.lineTo(-30, -68); c.lineTo(-18, -100); c.lineTo(18, -100); c.lineTo(30, -68); c.lineTo(40, 0); c.closePath(); c.fill();
      c.fillStyle = "#111719"; c.fillRect(-13, -107, 26, 41); c.strokeStyle = "#a0aba1"; c.lineWidth = 2; c.strokeRect(-14, -107, 28, 41);
      c.fillStyle = s.weapon === "ready" ? "#ddaf4b" : "#5b3824"; c.fillRect(-9, -99, 18, 9);
      c.fillStyle = "#171c1c"; for (let i = 0; i < 4; i++) { c.fillRect(-28, -55 + i * 11, 12, 5); c.fillRect(16, -55 + i * 11, 12, 5); }
      c.fillStyle = "#c6a14a"; c.font = "bold 9px monospace"; c.textAlign = "center"; c.fillText("M-01", 0, -31);
      if (s.recoil > 0.55) {
        c.fillStyle = "#fff1b5"; c.beginPath();
        for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, r = i % 2 ? 18 : 40 + s.recoil * 17; const x = Math.cos(a) * r, y = -117 + Math.sin(a) * r; i ? c.lineTo(x, y) : c.moveTo(x, y); } c.closePath(); c.fill();
      }
    }
    c.restore();
  }
  private drawMap(s: Scene) {
    const c = this.mapCtx, size = c.canvas.width, unit = size / s.cells.length;
    c.fillStyle = "#111514"; c.fillRect(0, 0, size, size);
    for (let y = 0; y < s.cells.length; y++) for (let x = 0; x < s.cells.length; x++) {
      c.fillStyle = s.cells[y][x] === 1 ? "#39403a" : s.cells[y][x] === 2 ? "#3d3d32" : "#171d18";
      c.fillRect(x * unit, y * unit, unit - 0.4, unit - 0.4);
    }
    c.fillStyle = "#edc260"; c.beginPath(); c.arc(s.cheese.x * unit, s.cheese.y * unit, 2.4, 0, Math.PI * 2); c.fill();
    if (Math.hypot(s.cat.x - s.player.x, s.cat.y - s.player.y) < 5 || s.cat.stunRemaining > 0) {
      c.fillStyle = s.cat.stunRemaining > 0 ? "#68cbd0" : "#f25138"; c.beginPath(); c.arc(s.cat.x * unit, s.cat.y * unit, 2.2, 0, Math.PI * 2); c.fill();
    }
    c.save(); c.translate(s.player.x * unit, s.player.y * unit); c.rotate(s.player.angle);
    c.fillStyle = "#f4f0db"; c.beginPath(); c.moveTo(5, 0); c.lineTo(-3, -3); c.lineTo(-2, 0); c.lineTo(-3, 3); c.closePath(); c.fill(); c.restore();
  }
}
