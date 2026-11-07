import assert from 'node:assert/strict';
import test from 'node:test';
import { castRay, createCat, createMaze, findPath, isWall, stunCat, updateCat, type Maze, type Vec } from './world';

function seeded(seed:number){return ()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/2**32;};}
function fixture():Maze {
  const size=9;
  const cells=Array.from({length:size},(_,y)=>Array.from({length:size},(_,x)=>x===0||y===0||x===size-1||y===size-1?1:0));
  return {size,cells,spawn:{x:1.5,y:4.5},catSpawn:{x:6.5,y:4.5},cheeseSpawn:{x:1.5,y:1.5},secret:{x:7.5,y:7.5}};
}
const stationary={x:0,y:0};

test('generated mazes keep every objective reachable with intact boundary walls',()=>{
  for(let seed=1;seed<=20;seed++){
    const maze=createMaze(seeded(seed));
    for(let n=0;n<maze.size;n++){
      assert.equal(maze.cells[0][n],1);assert.equal(maze.cells[maze.size-1][n],1);
      assert.equal(maze.cells[n][0],1);assert.equal(maze.cells[n][maze.size-1],1);
    }
    for(const target of [maze.secret,maze.catSpawn,maze.cheeseSpawn]){
      assert.ok(!isWall(maze.cells,target.x,target.y));
      assert.ok(findPath(maze.cells,maze.spawn,target).length>1);
    }
    let floors=0;
    for(let y=1;y<maze.size-1;y++)for(let x=1;x<maze.size-1;x++){
      if(maze.cells[y][x]===0){floors++;assert.ok(findPath(maze.cells,maze.spawn,{x:x+.5,y:y+.5}).length);}
    }
    assert.ok(floors>170);
  }
});

test('the blaster is visible a few walking steps down the initial corridor for 100 maze seeds',()=>{
  for(let seed=1;seed<=100;seed++){
    const maze=createMaze(seeded(seed));
    const steps=findPath(maze.cells,maze.spawn,maze.secret).length-1;
    assert.ok(steps>=2&&steps<=4,`seed ${seed}: pickup is ${steps} steps from spawn`);
    assert.notDeepEqual(maze.secret,maze.spawn);
    assert.notDeepEqual(maze.secret,maze.catSpawn);
    assert.notDeepEqual(maze.secret,maze.cheeseSpawn);
    const opening=[{x:1,y:0},{x:0,y:1},{x:-1,y:0},{x:0,y:-1}]
      .find(d=>!isWall(maze.cells,maze.spawn.x+d.x,maze.spawn.y+d.y))!;
    assert.deepEqual(maze.secret,{x:maze.spawn.x+opening.x*2,y:maze.spawn.y+opening.y*2});
    const dx=maze.secret.x-maze.spawn.x,dy=maze.secret.y-maze.spawn.y,distance=Math.hypot(dx,dy);
    assert.ok(castRay(maze.cells,maze.spawn.x,maze.spawn.y,dx/distance,dy/distance).distance>distance,
      `seed ${seed}: a wall hides the pickup from spawn`);
  }
});

test('camera-plane DDA returns perpendicular depth and stable world texture coordinate',()=>{
  const maze=fixture();
  const straight=castRay(maze.cells,4.5,4.5,1,0);
  const diagonal=castRay(maze.cells,4.5,4.5,1,.5);
  assert.equal(straight.distance,3.5);assert.equal(diagonal.distance,3.5);
  assert.equal(straight.cellX,8);assert.equal(diagonal.cellX,8);
  assert.equal(diagonal.wallX,.25);
  assert.equal(castRay(maze.cells,4.5,4.5,2,0).distance,1.75);
  assert.ok(isWall(maze.cells,-1,4));
});

test('five-second stun suspends movement and action through exactly five simulation seconds',()=>{
  const maze=fixture(),cat=createCat(maze.catSpawn);
  stunCat(cat,5);
  for(let i=0;i<49;i++)updateCat(cat,maze,maze.spawn,stationary,.1,i*.1,1);
  assert.equal(cat.state,'stunned');assert.equal(cat.x,maze.catSpawn.x);
  assert.ok(Math.abs(cat.stunRemaining-.1)<1e-8);
  updateCat(cat,maze,maze.spawn,stationary,.1,4.9,1);
  assert.equal(cat.stunRemaining,0);assert.equal(cat.x,maze.catSpawn.x);
  updateCat(cat,maze,maze.spawn,stationary,.1,5,1);
  assert.ok(cat.x<maze.catSpawn.x);
});

test('continuous chase speed is independent of refresh rate',()=>{
  const run=(fps:number)=>{
    const maze=fixture(),cat=createCat({x:1.5,y:4.5});
    for(let i=0;i<fps;i++)updateCat(cat,maze,{x:7.5,y:4.5},stationary,1/fps,i/fps,0);
    return cat.x;
  };
  assert.ok(Math.abs(run(30)-run(144))<.00001);
  assert.ok(Math.abs(run(60)-3.8)<.00001);
});

function wallFixture():Maze {
  const maze=fixture();
  for(let y=1;y<maze.size-1;y++)maze.cells[y][4]=2;
  maze.cells[1][4]=0; // Long detour around the one-cell barrier.
  maze.catSpawn={x:3.5,y:5.5};maze.spawn={x:5.5,y:5.5};
  return maze;
}
function simulate(maze:Maze,progress:number){
  const cat=createCat(maze.catSpawn),events:string[]=[];let peak=0;let demolitionTelegraphed=false;
  for(let i=0;i<180;i++){
    updateCat(cat,maze,maze.spawn,stationary,1/60,i/60,progress,event=>events.push(event));
    peak=Math.max(peak,cat.z);
    if(cat.state==='break'&&cat.actionProgress>.3&&maze.cells[5][4]===2)demolitionTelegraphed=true;
  }
  return {cat,events,peak,demolitionTelegraphed};
}

test('mid-stage predator visibly vaults a wall without deleting the maze',()=>{
  const maze=wallFixture(),result=simulate(maze,.35);
  assert.ok(result.events.includes('jump'));assert.ok(result.events.includes('land'));
  assert.ok(result.peak>1.3);assert.equal(maze.cells[5][4],2);
  assert.ok(result.cat.x>4.5);
});

test('late-stage predator telegraphs demolition then permanently opens a passage',()=>{
  const maze=wallFixture();
  const before=castRay(maze.cells,maze.catSpawn.x,maze.catSpawn.y,1,0);
  assert.equal(before.cellX,4);assert.equal(before.cellY,5);assert.equal(before.distance,.5);
  assert.ok(findPath(maze.cells,maze.catSpawn,maze.spawn).length>3);
  const result=simulate(maze,.8);
  assert.ok(result.demolitionTelegraphed);assert.ok(result.events.includes('break'));
  assert.equal(maze.cells[5][4],0);assert.ok(result.cat.x>4.5);
  assert.ok(!isWall(maze.cells,4.5,5.5));
  assert.deepEqual(findPath(maze.cells,maze.catSpawn,maze.spawn),[
    {x:3.5,y:5.5},{x:4.5,y:5.5},{x:5.5,y:5.5},
  ]);
  const after=castRay(maze.cells,maze.catSpawn.x,maze.catSpawn.y,1,0);
  assert.equal(after.cellX,8);assert.equal(after.cellY,5);assert.equal(after.distance,4.5);
  for(let n=0;n<maze.size;n++){
    assert.equal(maze.cells[0][n],1);assert.equal(maze.cells[maze.size-1][n],1);
    assert.equal(maze.cells[n][0],1);assert.equal(maze.cells[n][maze.size-1],1);
  }
});

test('stunning an airborne cat safely cancels the vault without opening its wall',()=>{
  const maze=wallFixture(),cat=createCat(maze.catSpawn);
  for(let i=0;i<35;i++)updateCat(cat,maze,maze.spawn,stationary,1/60,i/60,.35);
  assert.equal(cat.state,'leap');assert.ok(cat.z>0);
  stunCat(cat,5);assert.equal(cat.z,0);assert.equal(cat.action,null);
  assert.ok(!isWall(maze.cells,cat.x,cat.y));assert.equal(maze.cells[5][4],2);
});
