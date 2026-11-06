/**
 * Original feral tabby artwork. The bundled, generated fur asset replaces a
 * complete hand-painted fallback as soon as it loads. No remote assets or
 * third-party licences are required. Canvases retain their identity on load.
 * The transparent 384px frames share a ground line at y=359.
 */
export function createCatFrames(): HTMLCanvasElement[] {
  const frames = Array.from({ length: 8 }, (_, frame) => paintCat(frame));
  const image = new Image();
  image.onload = () => {
    const source = document.createElement("canvas");
    source.width = source.height = 384;
    const sourceCtx = source.getContext("2d")!;
    sourceCtx.drawImage(image, 4, -4, 376, 376);
    const pixels = sourceCtx.getImageData(0, 0, 384, 384).data;
    // A smooth deformation field articulates the opposing legs and subtly
    // shifts the shoulders. It avoids hard-edged cutouts through the fur.
    for (let frame = 0; frame < frames.length; frame++) {
      const phase = frame / frames.length * Math.PI * 2;
      const ctx = frames[frame].getContext("2d")!;
      const output = ctx.createImageData(384, 384);
      for (let y = 0; y < 384; y++) {
        const t = Math.max(0, Math.min(1, (y - 208) / 113));
        const legs = t * t * (3 - 2 * t);
        for (let x = 0; x < 384; x++) {
          const side = Math.tanh((x - 211) / 23);
          const swing = Math.sin(phase) * side;
          const sx = x - Math.sin(phase) * .65 * (1 - legs) - swing * 3.7 * legs;
          const sy = y + Math.max(0, swing) * 5.5 * legs - Math.cos(phase * 2) * 1.2 * (1 - legs);
          const ix = Math.floor(sx), iy = Math.floor(sy);
          if (ix < 0 || ix >= 383 || iy < 0 || iy >= 383) continue;
          const fx = sx - ix, fy = sy - iy;
          const a = (iy * 384 + ix) * 4, b = a + 4, c = a + 1536, d = c + 4;
          const dest = (y * 384 + x) * 4;
          for (let ch = 0; ch < 4; ch++) {
            output.data[dest + ch] =
              (pixels[a + ch] * (1 - fx) + pixels[b + ch] * fx) * (1 - fy) +
              (pixels[c + ch] * (1 - fx) + pixels[d + ch] * fx) * fy;
          }
        }
      }
      ctx.putImageData(output, 0, 0);
    }
  };
  image.src = "/cheese-doom/assets/feral-cat.png";
  return frames;
}

function paintCat(frame: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 384;
  const ctx = canvas.getContext("2d")!;
  const phase = frame / 8 * Math.PI * 2;
  const gait = Math.sin(phase);
  const bob = Math.cos(phase * 2) * 1.8;

  function shape(d: string, fill: string | CanvasGradient, stroke?: string, width = 1) {
    const p = new Path2D(d);
    ctx.fillStyle = fill;
    ctx.fill(p);
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.stroke(p);
    }
    return p;
  }
  function gradient(x: number, y: number, r: number, light: string, dark: string) {
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, light);
    grad.addColorStop(1, dark);
    return grad;
  }
  function ellipse(x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Fixed seed across the animation keeps the hairs anchored to the animal.
  let seed = 41591;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  function fur(mask: Path2D, x: number, y: number, w: number, h: number, count: number, head = false) {
    ctx.save();
    ctx.clip(mask);
    ctx.lineWidth = .65;
    for (let i = 0; i < count; i++) {
      const fx = x + random() * w;
      const fy = y + random() * h;
      const len = 2 + random() * 6;
      const dir = head ? (fx - 192) / 94 : (fx - 192) / 190;
      const bright = random();
      ctx.strokeStyle = bright > .9 ? "rgba(186,173,146,.28)" : bright > .35 ? "rgba(104,111,106,.27)" : "rgba(2,5,6,.47)";
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + dir * len, fy + len * (head && fy < 177 ? -.7 : .85));
      ctx.stroke();
    }
    ctx.restore();
  }

  // A low black silhouette and long hooked tail make the animal readable in fog.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.save();
  ctx.translate(0, bob * .5);
  ctx.strokeStyle = "#11191a";
  ctx.lineWidth = 24;
  ctx.beginPath();
  ctx.moveTo(261, 283);
  ctx.bezierCurveTo(313, 307, 329, 266, 317 + gait * 3, 218);
  ctx.bezierCurveTo(308, 180, 327, 167, 343, 184);
  ctx.stroke();
  ctx.strokeStyle = "#434944";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(267, 278);
  ctx.bezierCurveTo(305, 295, 323, 264, 312, 219);
  ctx.bezierCurveTo(304, 182, 329, 172, 341, 184);
  ctx.stroke();
  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = "#0b1012";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(310 + i * 1.2, 212 + i * 12);
    ctx.lineTo(326 + i * .2, 211 + i * 12);
    ctx.stroke();
  }
  ctx.restore();

  // Hindquarters stay lower than the high, tense shoulders.
  shape("M126 237 C101 251 77 278 77 310 L81 343 Q82 357 109 356 L143 349 L150 274 Z",
    gradient(106, 279, 83, "#52584f", "#101718"));
  shape("M258 237 C283 252 306 280 306 310 L302 343 Q300 357 275 356 L241 349 L235 274 Z",
    gradient(279, 280, 82, "#4b514a", "#101718"));
  ellipse(113, 349, 31, 10, "#111719");
  ellipse(273, 349, 31, 10, "#111719");

  ctx.save();
  ctx.translate(0, bob);
  const torso = shape("M113 283 C106 240 113 184 147 164 C171 148 215 149 241 167 C277 190 278 239 273 285 L255 326 C222 339 159 337 129 324 Z",
    gradient(171, 201, 142, "#73776a", "#161e1e"), "#111819", 1.5);
  fur(torso, 102, 155, 181, 180, 2000);
  // Shoulder blades and mackerel tabby markings.
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(192, 0);
    ctx.scale(side, 1);
    shape("M20 174 Q50 171 65 205 L47 198 L35 226 L29 213 L37 190 Z", "rgba(6,11,13,.75)");
    shape("M55 226 L80 218 L74 239 L45 249 L53 238 L30 234 Z", "rgba(4,9,11,.7)");
    shape("M59 259 L81 247 L78 268 L60 283 L64 269 L40 277 Z", "rgba(5,10,12,.76)");
    ctx.restore();
  }
  // A narrow breast, with long, rough guard hairs.
  shape("M163 237 Q190 248 220 237 L231 292 L216 317 L211 302 L199 326 L190 312 L179 327 L170 307 L159 315 L150 287 Z",
    gradient(185, 262, 73, "#828176", "#2a3330"));
  ctx.restore();

  // Opposed front paws articulate independently through the eight-frame walk.
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(192, 0);
    ctx.scale(side, 1);
    const reach = gait * side * 7;
    ctx.translate(0, reach);
    const leg = shape("M41 238 C57 230 72 244 70 268 L65 312 L68 335 Q78 348 66 357 L35 360 Q21 356 24 347 L30 313 L27 269 Z",
      gradient(41, 280, 80, "#6c7164", "#151e20"), "#121b1b", 1);
    // The mask is in local coordinates; own fur direction keeps the leg tapered.
    ctx.save();
    ctx.clip(leg);
    for (let i = 0; i < 300; i++) {
      const x = 25 + random() * 47, y = 239 + random() * 119;
      ctx.strokeStyle = i % 4 === 0 ? "rgba(166,164,139,.26)" : "rgba(1,6,8,.37)";
      ctx.lineWidth = .7;
      ctx.beginPath();ctx.moveTo(x, y);ctx.lineTo(x + 1, y + 5);ctx.stroke();
    }
    ctx.restore();
    shape("M27 276 L66 266 L63 277 L30 288 Z", "#172022");
    shape("M28 299 L65 291 L63 302 L29 312 Z", "#1c2424");
    ellipse(46, 347, 23, 12, gradient(41, 343, 27, "#71776b", "#1c2526"));
    for (let toe = 0; toe < 3; toe++) {
      const x = 31 + toe * 13;
      ctx.strokeStyle = "#151c1d";ctx.lineWidth = 1.5;
      ctx.beginPath();ctx.moveTo(x + 3, 344);ctx.lineTo(x + 1, 354);ctx.stroke();
      shape(`M${x} 353 Q${x - 3} 362 ${x + 1} 365 Q${x + 6} 360 ${x + 5} 354 Z`, "#c1b9a3", "#6c7063", .6);
    }
    ctx.restore();
  }

  ctx.save();
  ctx.translate(gait * 1.5, bob);
  // Tall jagged ears, with a torn outer edge and tufts, rather than rounded ears.
  for (const side of [-1, 1]) {
    ctx.save();ctx.translate(192, 0);ctx.scale(side, 1);
    shape("M35 155 L68 100 L71 111 L81 92 L85 145 L95 164 L68 184 Z",
      gradient(66, 141, 50, "#717568", "#172020"), "#0d1619", 2);
    shape("M53 153 L77 115 L79 149 L84 161 L67 168 Z", "#674b45");
    shape("M62 152 L75 127 L73 155 L68 160 Z", "#211e1d");
    ctx.strokeStyle = "#b1ac91";ctx.lineWidth = .8;
    for (let n = 0; n < 15; n++) {
      ctx.beginPath();ctx.moveTo(72 + n * .35, 139 + n);ctx.lineTo(56 + n * .9, 155 + n * .4);ctx.stroke();
    }
    ctx.restore();
  }

  const head = shape("M136 146 Q160 134 192 139 Q223 134 248 146 L261 177 L263 197 L279 216 L267 216 L274 228 L258 227 L261 239 L244 236 Q223 261 192 264 Q163 261 142 237 L124 240 L129 228 L113 229 L124 216 L111 216 L124 199 L124 179 Z",
    gradient(173, 172, 110, "#949383", "#202b2b"), "#11191b", 1.5);
  fur(head, 111, 137, 169, 128, 2600, true);

  // M marking, temple stripes and hard cheek planes establish a tabby's skull.
  shape("M164 141 L174 169 L181 151 L192 172 L202 151 L211 167 L221 140 L207 147 L201 137 L192 153 L181 137 L176 148 Z", "#152021");
  shape("M184 174 L192 163 L200 174 L197 190 L187 190 Z", "#37403a");
  for (const side of [-1, 1]) {
    ctx.save();ctx.translate(192, 0);ctx.scale(side, 1);
    shape("M37 158 L56 156 L65 173 L43 168 L54 178 L32 171 Z", "#172225");
    shape("M55 186 L69 178 L71 190 L50 202 L59 192 L42 195 Z", "#0b1417");
    shape("M57 209 L76 202 L69 216 L43 224 L54 215 L31 216 Z", "#192325");
    shape("M52 227 L66 221 L61 233 L35 241 L41 231 L21 239 Z", "#243130");
    // Tight brow casts a deep shadow over a shallow, predatory almond eye.
    shape("M10 184 Q29 174 51 187 L53 198 Q35 203 13 195 Z", "#080f12");
    shape("M13 189 Q29 183 48 191 Q36 205 19 198 Z",
      gradient(30, 191, 19, "#ffed85", "#bf8d18"));
    shape("M28 185 Q24 194 28 202 Q32 193 30 185 Z", "#040a0b");
    shape("M10 185 Q29 172 53 186 L49 190 Q29 181 13 191 Z", "#626b5d");
    ctx.strokeStyle = "#adb096";ctx.lineWidth = 1.4;
    ctx.beginPath();ctx.moveTo(15, 185);ctx.quadraticCurveTo(32, 179, 46, 185);ctx.stroke();
    ellipse(25, 190, 2.5, 1.4, "#fff6bf");
    // Dark tear line and forward-projecting nose bridge.
    shape("M13 197 L9 219 L21 224 L18 212 Z", "rgba(8,17,19,.75)");
    ctx.restore();
  }

  // Snarl: dark mouth cavity, cream canines, wet gums and layered muzzle pads.
  shape("M156 228 Q170 215 192 225 Q213 215 229 228 L224 248 Q209 263 192 259 Q174 262 160 248 Z", "#080c0e", "#152021", 1);
  shape("M165 232 Q192 223 219 232 L216 241 Q192 233 168 241 Z", "#8d5c58");
  shape("M180 253 Q192 245 205 253 L202 258 L183 258 Z", "#764346");
  for (const side of [-1, 1]) {
    ctx.save();ctx.translate(192, 0);ctx.scale(side, 1);
    shape("M15 230 L26 230 Q27 244 17 253 Q19 241 15 230 Z", "#e0d7b9", "#939383", .7);
    shape("M5 232 L12 231 L10 238 Z", "#bcb59e");
    shape("M26 245 L31 241 L30 249 Z", "#c3c1a8");
    const muzzle = shape("M0 217 Q11 208 24 211 Q38 216 38 228 Q29 241 13 234 L0 231 Z",
      gradient(17, 218, 33, "#a5a28f", "#4a554c"));
    ctx.save();ctx.clip(muzzle);
    for (let i = 0; i < 140; i++) {
      const x = random() * 38, y = 210 + random() * 27;
      ctx.strokeStyle = "rgba(207,197,165,.35)";ctx.lineWidth = .65;
      ctx.beginPath();ctx.moveTo(x, y);ctx.lineTo(x + 4, y + 1);ctx.stroke();
    }
    ctx.restore();
    for (let i = 0; i < 9; i++) ellipse(11 + (i % 3) * 7, 220 + Math.floor(i / 3) * 4, .9, .7, "#252f2b");
    ctx.restore();
  }
  shape("M178 211 Q192 207 206 211 L201 219 L192 224 L183 219 Z",
    gradient(188, 211, 18, "#9b726b", "#352c2d"), "#1c2423", 1);
  ctx.strokeStyle = "#171e1f";ctx.lineWidth = 2;
  ctx.beginPath();ctx.moveTo(192, 222);ctx.lineTo(192, 232);ctx.stroke();
  ctx.strokeStyle = "rgba(205,210,183,.7)";ctx.lineWidth = .75;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(192 + side * (19 + i % 2 * 5), 224 + i * 1.7);
      ctx.quadraticCurveTo(192 + side * 61, 214 + i * 5, 192 + side * (86 - i * 3), 212 + i * 6.5);
      ctx.stroke();
    }
  }
  // Highlight scars interrupt the brow and make the face asymmetrical.
  ctx.strokeStyle = "#b8a38a";ctx.lineWidth = 1.5;
  ctx.beginPath();ctx.moveTo(231, 170);ctx.lineTo(218, 183);ctx.stroke();
  ctx.strokeStyle = "#3f2928";ctx.lineWidth = 1;
  ctx.beginPath();ctx.moveTo(233, 171);ctx.lineTo(220, 185);ctx.stroke();
  ctx.restore();
  return canvas;
}
