/** Pure maze, raycasting and predator simulation. Distances are world cells; time is seconds. */
export interface Vec { x: number; y: number }
export interface Maze {
  cells: number[][];
  size: number;
  spawn: Vec;
  catSpawn: Vec;
  cheeseSpawn: Vec;
  secret: Vec;
}
export type CatState = 'stalk' | 'chase' | 'windup' | 'leap' | 'break' | 'stunned';
export type CatEvent = 'jump' | 'break' | 'land' | 'growl';
interface RouteStep extends Vec { kind: 'walk' | 'leap' | 'break'; wall?: Vec }
interface CatAction { from: Vec; to: Vec; wall?: Vec; kind: 'leap' | 'break'; time: number }
export interface Cat extends Vec {
  z: number;
  state: CatState;
  stunRemaining: number;
  animTime: number;
  facing: number;
  /** 0..1 windup / leap / demolition progress, suitable for pose animation. */
  actionProgress: number;
  route: RouteStep[];
  action: CatAction | null;
  repath: number;
  actionNumber: number;
  growlTimer: number;
}
const DIRECTIONS: Vec[] = [{x:1,y:0},{x:0,y:1},{x:-1,y:0},{x:0,y:-1}];
const key = (x: number, y: number) => `${x},${y}`;
const center = (x: number, y: number): Vec => ({x:x+.5,y:y+.5});
const distance = (a: Vec, b: Vec) => Math.hypot(a.x-b.x,a.y-b.y);
const cell = (cells: number[][], x: number, y: number) => cells[y]?.[x] ?? 1;
/** World coordinates are floored internally. Out-of-bounds is always solid. */
export function isWall(cells: number[][], x: number, y: number): boolean {
  return cell(cells,Math.floor(x),Math.floor(y)) !== 0;
}

export function createMaze(random: () => number = Math.random): Maze {
  const size = 21;
  const cells: number[][] = Array.from({length:size}, (_,y) => Array.from({length:size}, (_,x) =>
    x===0 || y===0 || x===size-1 || y===size-1 ? 1 : 2));
  const shuffle = <T>(values:T[]):T[] => {
    for(let i=values.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[values[i],values[j]]=[values[j],values[i]];}
    return values;
  };
  const stack: Vec[] = [{x:1,y:1}];
  cells[1][1] = 0;
  while(stack.length){
    const current=stack[stack.length-1];
    const candidates=shuffle(DIRECTIONS.map(d=>({x:current.x+d.x*2,y:current.y+d.y*2})))
      .filter(p=>p.x>0&&p.y>0&&p.x<size-1&&p.y<size-1&&cells[p.y][p.x]===2);
    if(!candidates.length){stack.pop();continue;}
    const next=candidates[0];
    cells[(current.y+next.y)/2][(current.x+next.x)/2]=0;
    cells[next.y][next.x]=0;
    stack.push(next);
  }
  // Sparse loops allow racing and evasion while preserving recognisable corridors.
  for(let y=1;y<size-1;y++)for(let x=1;x<size-1;x++){
    if(cells[y][x]!==2||random()>.065)continue;
    const acrossX=cells[y][x-1]===0&&cells[y][x+1]===0;
    const acrossY=cells[y-1][x]===0&&cells[y+1][x]===0;
    if(acrossX!==acrossY)cells[y][x]=0;
  }
  const distances = new Map<string,number>();
  const queue:Vec[]=[{x:1,y:1}];distances.set('1,1',0);
  for(let i=0;i<queue.length;i++)for(const d of DIRECTIONS){
    const p={x:queue[i].x+d.x,y:queue[i].y+d.y};
    if(cell(cells,p.x,p.y)===0&&!distances.has(key(p.x,p.y))){
      distances.set(key(p.x,p.y),distances.get(key(queue[i].x,queue[i].y))!+1);queue.push(p);
    }
  }
  const ranked=[...queue].sort((a,b)=>distances.get(key(b.x,b.y))!-distances.get(key(a.x,a.y))!);
  const catCell=ranked[0];
  const maxDistance=distances.get(key(catCell.x,catCell.y))!;
  const cheeseCell=ranked.find(p=>{
    const d=distances.get(key(p.x,p.y))!;
    return d>Math.min(12,maxDistance*.4)&&d<maxDistance*.65&&distance(p,catCell)>5;
  })??ranked[Math.floor(ranked.length/2)];
  const deadEnds=ranked.filter(p=>DIRECTIONS.filter(d=>cell(cells,p.x+d.x,p.y+d.y)===0).length===1
    &&distance(p,catCell)>3&&distance(p,cheeseCell)>2&&distances.get(key(p.x,p.y))!>8);
  const secretCell=deadEnds[0]??ranked.find(p=>distance(p,catCell)>4&&distance(p,cheeseCell)>3)??ranked[1];
  return {cells,size,spawn:center(1,1),catSpawn:center(catCell.x,catCell.y),
    cheeseSpawn:center(cheeseCell.x,cheeseCell.y),secret:center(secretCell.x,secretCell.y)};
}

export interface RayHit {
  distance: number;
  side: number;
  wallX: number;
  cellX: number;
  cellY: number;
  material: number;
}
/** Unnormalised camera-plane direction preserves perpendicular depth (no fisheye). */
export function castRay(cells:number[][],px:number,py:number,dx:number,dy:number):RayHit {
  let x=Math.floor(px),y=Math.floor(py),side=0,depth=.001;
  const deltaX=dx===0?Infinity:Math.abs(1/dx),deltaY=dy===0?Infinity:Math.abs(1/dy);
  const stepX=dx<0?-1:1,stepY=dy<0?-1:1;
  let sideX=(dx<0?px-x:x+1-px)*deltaX;
  let sideY=(dy<0?py-y:y+1-py)*deltaY;
  for(let i=0;i<256;i++){
    if(sideX<sideY){depth=sideX;sideX+=deltaX;x+=stepX;side=0;}
    else{depth=sideY;sideY+=deltaY;y+=stepY;side=1;}
    if(cell(cells,x,y)!==0)break;
  }
  if(!Number.isFinite(depth))depth=64;
  const hit=side===0?py+depth*dy:px+depth*dx;
  const wallX=hit-Math.floor(hit);
  return {distance:Math.max(.001,depth),side,wallX,cellX:x,cellY:y,material:cell(cells,x,y)};
}

/** Shortest walk-only path, including start and end, returned at cell centres. */
export function findPath(cells:number[][],start:Vec,end:Vec):Vec[] {
  return route(cells,start,end,0,false).map(p=>({x:p.x,y:p.y}));
}

function route(cells:number[][],start:Vec,end:Vec,progress:number,preferBreak:boolean):RouteStep[] {
  const sx=Math.floor(start.x),sy=Math.floor(start.y),ex=Math.floor(end.x),ey=Math.floor(end.y);
  if(cell(cells,sx,sy)!==0||cell(cells,ex,ey)!==0)return [];
  interface Node {x:number;y:number;g:number;f:number;parent:Node|null;kind:RouteStep['kind'];wall?:Vec}
  const heuristic=(x:number,y:number)=>Math.abs(x-ex)+Math.abs(y-ey);
  const open:Node[]=[{x:sx,y:sy,g:0,f:heuristic(sx,sy),parent:null,kind:'walk'}];
  const costs=new Map<string,number>([[key(sx,sy),0]]);
  while(open.length){
    open.sort((a,b)=>a.f-b.f);
    const n=open.shift()!;
    if(n.g>costs.get(key(n.x,n.y))!)continue;
    if(n.x===ex&&n.y===ey){
      const path:RouteStep[]=[];let at:Node|null=n;
      while(at){path.push({...center(at.x,at.y),kind:at.kind,wall:at.wall});at=at.parent;}
      return path.reverse();
    }
    for(const d of DIRECTIONS){
      const nx=n.x+d.x,ny=n.y+d.y,material=cell(cells,nx,ny);
      let tx=nx,ty=ny,cost=1,kind:RouteStep['kind']='walk',wall:Vec|undefined;
      if(material!==0){
        if(material!==2||progress<.25||cell(cells,nx+d.x,ny+d.y)!==0)continue;
        tx+=d.x;ty+=d.y;wall={x:nx,y:ny};
        // Breaking opens the existing maze permanently; vaults leave it intact.
        kind=progress>=.55&&preferBreak?'break':'leap';
        cost=kind==='break'?3.8:3.2;
      }
      const g=n.g+cost,k=key(tx,ty);
      if(g>=(costs.get(k)??Infinity))continue;
      costs.set(k,g);open.push({x:tx,y:ty,g,f:g+heuristic(tx,ty),parent:n,kind,wall});
    }
  }
  return [];
}

export function createCat(spawn:Vec):Cat {
  return {...spawn,z:0,state:'stalk',stunRemaining:0,animTime:0,facing:0,actionProgress:0,
    route:[],action:null,repath:0,actionNumber:0,growlTimer:8};
}
export function stunCat(cat:Cat,seconds:number):void {
  // Return an interrupted vault to its last safe floor cell before reforming.
  if(cat.action){cat.x=cat.action.from.x;cat.y=cat.action.from.y;}
  cat.stunRemaining=Math.max(0,seconds);cat.state='stunned';cat.z=0;cat.action=null;
  cat.actionProgress=0;cat.route=[];cat.repath=0;
}

export function updateCat(cat:Cat,maze:Maze,player:Vec,velocity:Vec,dt:number,elapsed:number,
  progress:number,emit:(event:CatEvent,position:Vec)=>void=()=>{}):void {
  if(dt<=0||!Number.isFinite(dt))return;
  progress=Math.max(0,Math.min(1,progress));
  cat.animTime+=dt;
  if(cat.stunRemaining>0){
    cat.stunRemaining=Math.max(0,cat.stunRemaining-dt);
    if(cat.stunRemaining<1e-9)cat.stunRemaining=0;
    cat.state=cat.stunRemaining>0?'stunned':'chase';
    return;
  }
  cat.growlTimer-=dt;
  if(cat.growlTimer<=0){cat.growlTimer=6+(Math.sin(elapsed*1.7)+1)*2;emit('growl',cat);}
  const speed=2.3+progress*1.4;
  if(cat.action){
    const action=cat.action;action.time+=dt;
    if(cat.state==='windup'){
      cat.actionProgress=Math.min(1,action.time/.36);
      cat.z=-Math.sin(cat.actionProgress*Math.PI)*.07;
      if(action.time>=.36){cat.state='leap';action.time=0;cat.z=0;emit('jump',cat);}
      return;
    }
    if(cat.state==='leap'){
      const t=Math.min(1,action.time/.68);cat.actionProgress=t;
      cat.x=action.from.x+(action.to.x-action.from.x)*t;
      cat.y=action.from.y+(action.to.y-action.from.y)*t;
      cat.z=Math.sin(t*Math.PI)*1.38;
      if(t>=1){cat.z=0;cat.action=null;cat.state='chase';cat.actionProgress=0;cat.repath=0;emit('land',cat);}
      return;
    }
    if(cat.state==='break'){
      cat.actionProgress=Math.min(1,action.time/.95);
      if(action.time>=.95){
        if(action.wall&&cell(maze.cells,action.wall.x,action.wall.y)===2){
          maze.cells[action.wall.y][action.wall.x]=0;emit('break',center(action.wall.x,action.wall.y));
        }
        cat.action=null;cat.route=[];cat.repath=0;cat.state='chase';cat.actionProgress=0;
      }
      return;
    }
  }
  cat.state=progress<.25?'stalk':'chase';
  cat.repath-=dt;
  let remaining=dt;
  // Consume the unused part of a tick at cell centres; speed stays the same at 30/60/144 Hz.
  for(let segment=0;segment<8&&remaining>1e-8;segment++){
    if(Math.floor(cat.x)===Math.floor(player.x)&&Math.floor(cat.y)===Math.floor(player.y)){
      const d=distance(cat,player);
      if(d>0){const step=Math.min(speed*remaining,d);cat.facing=Math.atan2(player.y-cat.y,player.x-cat.x);
        cat.x+=(player.x-cat.x)/d*step;cat.y+=(player.y-cat.y)/d*step;}
      cat.route=[];return;
    }
    // Replan only at a cell centre, so turning never cuts through a wall corner.
    if(!cat.route.length){
      let target=player;
      if(progress>.45){
        const predict={x:player.x+velocity.x*.55,y:player.y+velocity.y*.55};
        if(!isWall(maze.cells,predict.x,predict.y))target=predict;
      }
      const planned=route(maze.cells,cat,target,progress,cat.actionNumber%2===0);
      // A stun can interrupt a walk off-centre: finish that segment before taking a corner.
      cat.route=distance(cat,center(Math.floor(cat.x),Math.floor(cat.y)))>.02?planned:planned.slice(1);
      cat.repath=.36;
    }
    const next=cat.route[0];if(!next)return;
    cat.facing=Math.atan2(next.y-cat.y,next.x-cat.x);
    if(next.kind!=='walk'){
      cat.action={from:{x:cat.x,y:cat.y},to:{x:next.x,y:next.y},wall:next.wall,kind:next.kind,time:0};
      cat.state=next.kind==='leap'?'windup':'break';cat.route=[];cat.actionNumber++;cat.actionProgress=0;
      emit('growl',cat);return;
    }
    const d=distance(cat,next),step=speed*remaining;
    if(d<=step){
      cat.x=next.x;cat.y=next.y;cat.route.shift();remaining-=d/speed;
      if(cat.repath<=0)cat.route=[];
    }else{
      cat.x+=(next.x-cat.x)/d*step;cat.y+=(next.y-cat.y)/d*step;return;
    }
  }
}
