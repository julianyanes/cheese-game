import { access, cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supplied = process.argv[2];
if (!supplied) {
  console.error("Usage: node scripts/integrate-site.mjs /absolute/path/to/portfolio-repository");
  process.exit(1);
}
const target = path.resolve(supplied);
if (target === source) throw new Error("Use the portfolio checkout as the target, not the game repository.");
const exists = async p => { try { await access(p); return true; } catch { return false; } };
const sourceApp = path.join(target,"src/app");
const app = ((await exists(path.join(sourceApp,"layout.tsx"))) || (await exists(path.join(sourceApp,"layout.js")))) ? sourceApp : path.join(target,"app");
if (!(await exists(path.join(app,"layout.tsx"))) && !(await exists(path.join(app,"layout.js")))) {
  throw new Error("Target must contain an existing Next.js App Router layout. No files were changed.");
}
// Route groups do not contribute URL segments. Follow only group directories,
// so an unrelated /projects/play page never becomes a candidate for /play.
async function findPlayDirectories(directory) {
  const found = [];
  for (const item of await readdir(directory,{withFileTypes:true})) {
    if (!item.isDirectory()) continue;
    const child = path.join(directory,item.name);
    if (item.name === "play") found.push(child);
    else if (/^\([^()]+\)$/.test(item.name) && !/^\(\.{1,3}\)$/.test(item.name)) {
      found.push(...await findPlayDirectories(child));
    }
  }
  return found;
}
const playDirectories = await findPlayDirectories(app);
if (playDirectories.length > 1) throw new Error("More than one /play directory exists across route groups. Resolve the route ambiguity before integration. No files were changed.");
const play = playDirectories[0] ?? path.join(app,"play");
const route = path.join(play,"cheese-doom");
const runtime = path.join(route,"_game");
if (await exists(path.join(route,"page.tsx"))) {
  const current = await readFile(path.join(route,"page.tsx"),"utf8");
  if (!current.includes('"./_game/PlayPage"')) throw new Error("The new route already exists and is not managed by this installer. No files were changed.");
}
if (await exists(path.join(route,"page.js"))) throw new Error("The new route already has a JavaScript page. No files were changed.");
if (await exists(path.join(play,"page.js"))) throw new Error("The old route uses JavaScript. Integrate its redirect manually to avoid conflicting page files. No files were changed.");

// Keep all code and CSS below the new route. No site layout, homepage, package,
// deployment, DNS or existing asset files are changed.
await mkdir(runtime,{recursive:true});
for (const name of ["audio.ts","cat-art.ts","engine.ts","renderer.ts","world.ts","game.css","fonts.css"]) {
  await cp(path.join(source,"game",name),path.join(runtime,name));
}
const component = (await readFile(path.join(source,"page.tsx"),"utf8")).replace('from "./game/engine"','from "./engine"');
await writeFile(path.join(runtime,"PlayPage.tsx"),component);
await writeFile(path.join(route,"page.tsx"),`import type { Metadata } from "next";
import "./_game/game.css";

export const metadata: Metadata = {
  title: "CHEESE // No Safe Corners",
  description: "A fast first-person survival maze. Find the cheese. Fear what learns."
};

export { default } from "./_game/PlayPage";
`);
await mkdir(path.join(target,"public"),{recursive:true});
await cp(path.join(source,"public/cheese-doom"),path.join(target,"public/cheese-doom"),{recursive:true});
await writeFile(path.join(play,"page.tsx"),`import { redirect } from "next/navigation";

export default function LegacyPlayPage() {
  redirect("/play/cheese-doom");
}
`);
console.log("Installed /play/cheese-doom and redirected /play. Existing homepage links keep working.");
const relativePlay = path.relative(target,play);
console.log(`Changed only ${relativePlay}/page.tsx, ${relativePlay}/cheese-doom/, and public/cheese-doom/.`);
console.log("Run the portfolio's checks/build, review its Git diff, then push its deployment branch.");
