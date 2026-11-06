import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const installer = path.resolve("scripts/integrate-site.mjs");
async function files(dir: string, prefix = ""): Promise<string[]> {
  const output: string[] = [];
  for (const item of await readdir(path.join(dir,prefix),{withFileTypes:true})) {
    const name = path.join(prefix,item.name);
    if(item.isDirectory()) output.push(...await files(dir,name)); else output.push(name);
  }
  return output;
}

for (const {app,play} of [
  {app:"app",play:"app/play"},
  {app:"src/app",play:"src/app/play"},
  {app:"src/app",play:"src/app/(pro)/play"},
  {app:"src/app",play:"src/app/(outer)/(pro)/play"},
]) test(`portfolio integration in ${play} preserves every unrelated file`, async () => {
  const target = await mkdtemp(path.join(tmpdir(),"cheese-portfolio-"));
  try {
    const originals: Record<string,string> = {
      [`${app}/layout.tsx`]: 'export default function Layout({children}) { return <html><body className="original">{children}</body></html> }',
      [`${app}/page.tsx`]: 'export default function Home() { return <a href="/play">Board Ride</a> }',
      [`${app}/globals.css`]: ':root { --brand: red } body { color: white } button { background: blue }',
      [`${play}/page.tsx`]: 'export default function OldGame() { return <p>Original game</p> }',
      [`${app}/projects/play/page.tsx`]: 'export default function UnrelatedPlayPage() { return <p>Leave this route alone</p> }',
      "public/logo.svg": '<svg>original portfolio branding</svg>',
      "package.json": '{"name":"julian-portfolio","scripts":{"build":"next build"}}',
      "next.config.ts": 'export default { poweredByHeader: false };',
      ".vercel/project.json": '{"projectId":"preserve-this-deployment"}',
    };
    let group = path.dirname(play);
    while (group !== app) {
      originals[`${group}/layout.tsx`] = 'export default function GroupLayout({children}) { return <div className="preserved-layout">{children}</div> }';
      group = path.dirname(group);
    }
    for(const [name,content] of Object.entries(originals)) {
      await mkdir(path.dirname(path.join(target,name)),{recursive:true}); await writeFile(path.join(target,name),content);
    }
    execFileSync(process.execPath,[installer,target]);
    for(const [name,content] of Object.entries(originals)) if(name!==`${play}/page.tsx`) assert.equal(await readFile(path.join(target,name),"utf8"),content, name);
    assert.match(await readFile(path.join(target,play,"page.tsx"),"utf8"), /redirect\("\/play\/cheese-doom"\)/);
    assert.match(await readFile(path.join(target,play,"cheese-doom/_game/PlayPage.tsx"),"utf8"), /from "\.\/engine"/);
    assert.match(await readFile(path.join(target,play,"cheese-doom/_game/fonts.css"),"utf8"), /\/cheese-doom\/fonts\//);
    assert.ok((await readFile(path.join(target,"public/cheese-doom/assets/feral-cat.png"))).length>100000);
    for(const name of await files(target)) if(!(name in originals)) assert.ok(name.startsWith(`${play}/cheese-doom/`) || name.startsWith("public/cheese-doom/"),`Unexpected addition ${name}`);
    // Reapplying an update remains scoped to the same route and assets.
    execFileSync(process.execPath,[installer,target]);
    assert.equal(await readFile(path.join(target,app,"page.tsx"),"utf8"), originals[`${app}/page.tsx`]);
  } finally { await rm(target,{recursive:true,force:true}); }
});

test("ambiguous /play directories across route groups stop integration before writes",async()=>{
  const target=await mkdtemp(path.join(tmpdir(),"cheese-route-groups-"));
  try {
    await mkdir(path.join(target,"app/(one)/play"),{recursive:true});
    await mkdir(path.join(target,"app/(two)/play"),{recursive:true});
    await writeFile(path.join(target,"app/layout.tsx"),"original layout");
    await writeFile(path.join(target,"app/(one)/play/page.tsx"),"first existing game");
    await writeFile(path.join(target,"app/(two)/play/page.tsx"),"second existing game");
    const before = await files(target);
    assert.throws(()=>execFileSync(process.execPath,[installer,target],{stdio:"pipe"}));
    assert.deepEqual(await files(target),before);
    assert.equal(await readFile(path.join(target,"app/(one)/play/page.tsx"),"utf8"),"first existing game");
    assert.equal(await readFile(path.join(target,"app/(two)/play/page.tsx"),"utf8"),"second existing game");
  } finally { await rm(target,{recursive:true,force:true}); }
});

test("an occupied new route stops integration before any existing file is changed",async()=>{
  const target=await mkdtemp(path.join(tmpdir(),"cheese-route-collision-"));
  try {
    await mkdir(path.join(target,"app/play/cheese-doom"),{recursive:true});
    await writeFile(path.join(target,"app/layout.tsx"),"original layout");
    await writeFile(path.join(target,"app/play/page.tsx"),"original game");
    await writeFile(path.join(target,"app/play/cheese-doom/page.tsx"),"another existing application");
    assert.throws(()=>execFileSync(process.execPath,[installer,target],{stdio:"pipe"}));
    assert.equal(await readFile(path.join(target,"app/play/page.tsx"),"utf8"),"original game");
    assert.equal(await readFile(path.join(target,"app/play/cheese-doom/page.tsx"),"utf8"),"another existing application");
  } finally { await rm(target,{recursive:true,force:true}); }
});
