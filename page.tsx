"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export default function PlayPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mmRef     = useRef<HTMLCanvasElement>(null);
  const gameRef   = useRef<any>({});
  const [overlay, setOverlay]     = useState<"start"|"dead"|null>("start");
  const [score, setScore]         = useState(0);
  const [cheese, setCheese]       = useState(0);
  const [round, setRound]         = useState(1);
  const [iq, setIq]               = useState(0);
  const [lives, setLives]         = useState(3);
  const [centerMsg, setCenterMsg] = useState("find the cheese");
  const [compass, setCompass]     = useState("N");
  const [threat, setThreat]       = useState(0);
  const [deadStats, setDeadStats] = useState({ score:0, cheese:0, iq:0 });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const mm     = mmRef.current!;
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W; canvas.height = H;
    const ctx  = canvas.getContext("2d")!;
    const mctx = mm.getContext("2d")!;
    const MMW = 120, MMH = 120;
    const MSIZE = 14;
    const FOV = Math.PI / 3.4;
    const RAYS = W;
    const HALF_H = H / 2;
    const MAX_DIST = 18;
    const ACTIONS_4: [number,number][] = [[0,-1],[0,1],[-1,0],[1,0]];
    const EPS_MIN = 0.06, EPS_DECAY = 0.88, ALPHA = 0.25, GAMMA = 0.92;

    const g = gameRef.current;
    g.map = [] as number[][];
    g.player = { x:1.5, y:1.5, angle:0, speed:0.078, turnSpeed:0.082, bobT:0, bobAmt:0 };
    g.cat = { x:0, y:0, animT:0, prevX:0, prevY:0, lerpT:1, targetX:0, targetY:0 };
    g.cheese = { x:0, y:0, bobT:0 };
    g.Q = {} as Record<string,number>;
    g.eps = 1.0;
    g.lives = 3; g.score = 0; g.cheeseN = 0; g.round = 1;
    g.active = false; g.catTimer = 0; g.CAT_FRAMES = 12;
    g.frame = 0; g.spidey = 0; g.mouseLocked = false;
    g.keys = {} as Record<string,boolean>;
    g.particles = [] as any[];
    g.screenShake = 0;
    g.floorCells = [] as any[];
    g.deathSeq = 0;       // 0=alive, 1=dying anim, 2=respawning
    g.deathT = 0;         // timer for death animation
    g.deathAngle = 0;     // stored angle at moment of death
    g.deathPitch = 0;     // camera pitches down on death
    g.deathRoll = 0;      // roll sideways like falling
    g.stepSound = 0;      // footstep timer
    g.ambient = 0;        // ambient pulse timer
    g.bloodDecals = [] as any[]; // blood splat positions

    // ── MAP ──────────────────────────────────────────────
    function genMap() {
      g.map = Array.from({length:MSIZE}, () => Array(MSIZE).fill(1));
      function carve(x:number,y:number){
        const dirs:([number,number])[] = [[0,-2],[0,2],[-2,0],[2,0]];
        dirs.sort(()=>Math.random()-.5);
        for(const [dx,dy] of dirs){
          const nx=x+dx,ny=y+dy;
          if(nx>0&&nx<MSIZE-1&&ny>0&&ny<MSIZE-1&&g.map[ny][nx]===1){
            g.map[y+Math.floor(dy/2)][x+Math.floor(dx/2)]=0;
            g.map[ny][nx]=0;
            carve(nx,ny);
          }
        }
      }
      g.map[1][1]=0; carve(1,1);
      for(let i=0;i<MSIZE;i++){g.map[0][i]=1;g.map[MSIZE-1][i]=1;g.map[i][0]=1;g.map[i][MSIZE-1]=1;}
      // pre-compute floor cell hashes for texture
      g.floorCells=[];
      for(let y=0;y<MSIZE;y++) for(let x=0;x<MSIZE;x++)
        if(g.map[y][x]===0) g.floorCells.push({x,y,noise:Math.random()});
    }

    function emptyCells(){const c:any[]=[];for(let y=0;y<MSIZE;y++)for(let x=0;x<MSIZE;x++)if(g.map[y][x]===0)c.push({x,y});return c;}
    function randEmpty(ex:any[]=[]):any{const c=emptyCells().filter((c:any)=>!ex.some((e:any)=>e.x===c.x&&e.y===c.y));return c[Math.floor(Math.random()*c.length)];}

    // ── Q-LEARNING ────────────────────────────────────────
    function sk(cx:number,cy:number,px:number,py:number){
      const dx=px-cx,dy=py-cy;
      return `${Math.sign(dx)},${Math.sign(dy)},${Math.min(Math.abs(dx),5)},${Math.min(Math.abs(dy),5)}`;
    }
    function gq(s:string,a:number){return g.Q[s+"|"+a]||0}
    function sq(s:string,a:number,v:number){g.Q[s+"|"+a]=v}
    function bestAct(s:string){let b=0,bq=gq(s,0);for(let a=1;a<4;a++){const q=gq(s,a);if(q>bq){bq=q;b=a;}}return b;}

    function catQLStep(){
      const cx=Math.floor(g.cat.x),cy=Math.floor(g.cat.y);
      const px=Math.floor(g.player.x),py=Math.floor(g.player.y);
      const s=sk(cx,cy,px,py);
      let action=Math.random()<g.eps?Math.floor(Math.random()*4):bestAct(s);
      const [dx,dy]=ACTIONS_4[action];
      const nx=cx+dx,ny=cy+dy;
      const valid=nx>=0&&ny>=0&&nx<MSIZE&&ny<MSIZE&&g.map[ny][nx]===0;
      const oldD=Math.abs(cx-px)+Math.abs(cy-py);
      let ncx=cx,ncy=cy;
      if(valid){ncx=nx;ncy=ny;}
      const newD=Math.abs(ncx-px)+Math.abs(ncy-py);
      let reward=(oldD-newD)*1.5;
      if(newD===0)reward=50;
      if(!valid)reward=-2;
      const ns=sk(ncx,ncy,px,py);
      sq(s,action,gq(s,action)+ALPHA*(reward+GAMMA*gq(ns,bestAct(ns))-gq(s,action)));
      return {x:ncx,y:ncy};
    }

    function astar(sx:number,sy:number,ex:number,ey:number):any[]{
      const open:any[]=[{x:sx,y:sy,g:0,f:0,parent:null}];
      const closed=new Set<string>();
      const h=(x:number,y:number)=>Math.abs(x-ex)+Math.abs(y-ey);
      while(open.length){
        open.sort((a:any,b:any)=>a.f-b.f);
        const cur=open.shift();
        if(cur.x===ex&&cur.y===ey){const path:any[]=[];let n=cur;while(n){path.push({x:n.x,y:n.y});n=n.parent;}return path.reverse();}
        closed.add(cur.x+","+cur.y);
        for(const [dx,dy] of ACTIONS_4){
          const nx=cur.x+dx,ny=cur.y+dy;
          if(nx<0||ny<0||nx>=MSIZE||ny>=MSIZE||g.map[ny][nx]===1||closed.has(nx+","+ny))continue;
          const ng=cur.g+1,nf=ng+h(nx,ny);
          if(!open.find((o:any)=>o.x===nx&&o.y===ny))open.push({x:nx,y:ny,g:ng,f:nf,parent:cur});
        }
      }
      return [];
    }

    // ── RAYCASTER w/ SMOOTH SHADING ───────────────────────
    function castRayDDA(px:number,py:number,angle:number){
      const cosA=Math.cos(angle),sinA=Math.sin(angle);
      let mapX=Math.floor(px),mapY=Math.floor(py);
      const deltaX=Math.abs(1/cosA),deltaY=Math.abs(1/sinA);
      const stepX=cosA<0?-1:1,stepY=sinA<0?-1:1;
      let sideDistX=cosA<0?(px-mapX)*deltaX:(mapX+1-px)*deltaX;
      let sideDistY=sinA<0?(py-mapY)*deltaY:(mapY+1-py)*deltaY;
      let side=0,hit=false;
      for(let i=0;i<64;i++){
        if(sideDistX<sideDistY){sideDistX+=deltaX;mapX+=stepX;side=0;}
        else{sideDistY+=deltaY;mapY+=stepY;side=1;}
        if(mapX>=0&&mapY>=0&&mapX<MSIZE&&mapY<MSIZE&&g.map[mapY][mapX]===1){hit=true;break;}
      }
      let wallDist=side===0?(sideDistX-deltaX):(sideDistY-deltaY);
      if(wallDist<0.001)wallDist=0.001;
      // wallX for texture coordinate
      let wallX=side===0?py+wallDist*sinA:px+wallDist*cosA;
      wallX-=Math.floor(wallX);
      return{dist:wallDist,side,wallX,mapX,mapY};
    }

    // pre-bake a simple brick texture into an offscreen canvas
    const texSize=64;
    const texCanvas=document.createElement('canvas');
    texCanvas.width=texSize;texCanvas.height=texSize;
    const texCtx=texCanvas.getContext('2d')!;
    // brick pattern
    for(let y=0;y<texSize;y++){
      for(let x=0;x<texSize;x++){
        const brickH=16,brickW=32;
        const row=Math.floor(y/brickH);
        const offset=row%2===0?0:brickW/2;
        const bx=((x+offset)%brickW);
        const by=y%brickH;
        const mortar=2;
        if(bx<mortar||by<mortar){texCtx.fillStyle='#111';}
        else{
          const noise=(Math.sin(x*7.3+y*13.7)*43758.5453)%1;
          const v=Math.floor(30+noise*18);
          texCtx.fillStyle=`rgb(${v},${v},${v})`;
        }
        texCtx.fillRect(x,y,1,1);
      }
    }
    const texData=texCtx.getImageData(0,0,texSize,texSize);

    function getTexel(x:number,y:number):number{
      const tx=((Math.floor(x*texSize))%texSize+texSize)%texSize;
      const ty=((Math.floor(y*texSize))%texSize+texSize)%texSize;
      return texData.data[(ty*texSize+tx)*4]/255;
    }

    function render3D(){
      const bob = g.player.bobAmt * Math.sin(g.player.bobT) + (g.deathPitch||0);
      const roll = g.deathRoll||0;
      const shake = g.screenShake;
      const ox = shake>0?(Math.random()-.5)*shake:0;
      const oy = shake>0?(Math.random()-.5)*shake:0;
      if(shake>0)g.screenShake=Math.max(0,shake-0.8);

      // image data for direct pixel manipulation
      const imgData=ctx.createImageData(W,H);
      const pixels=imgData.data;

      // ── ambient pulse darkness (cat growl makes walls breathe)
      const ambPulse=g.deathSeq===0?(1-g.eps)*Math.sin(g.ambient*1.4)*0.04:0;

      // ── ceiling gradient
      for(let y=0;y<HALF_H;y++){
        const t=y/HALF_H;
        const v=Math.floor((t*18)*(1-ambPulse*.5));
        for(let x=0;x<W;x++){
          const i=(y*W+x)*4;
          pixels[i]=v;pixels[i+1]=v;pixels[i+2]=v+4;pixels[i+3]=255;
        }
      }

      // ── floor with perspective-correct distance shading + subtle texture
      for(let y=HALF_H;y<H;y++){
        const rowDist=HALF_H/(y-HALF_H+0.001);
        const floorBright=Math.max(0,Math.min(1,rowDist/MAX_DIST*1.2));
        const fv=Math.floor(floorBright*22);
        for(let x=0;x<W;x++){
          // floor texturing via world-space projection
          const rayAngleL=g.player.angle-FOV/2;
          const rayAngleR=g.player.angle+FOV/2;
          const fx=g.player.x+rowDist*(Math.cos(rayAngleL+((x/W)*(rayAngleR-rayAngleL))));
          const fy=g.player.y+rowDist*(Math.sin(rayAngleL+((x/W)*(rayAngleR-rayAngleL))));
          const tx=Math.abs(fx%1),ty=Math.abs(fy%1);
          const checker=(Math.floor(fx)+Math.floor(fy))%2===0;
          const floorV=checker?fv+2:fv;
          const i=(y*W+x)*4;
          pixels[i]=floorV;pixels[i+1]=floorV;pixels[i+2]=floorV+3;pixels[i+3]=255;
        }
      }

      const zBuf=new Float32Array(W);

      for(let x=0;x<W;x++){
        const rayAngle=g.player.angle-FOV/2+(x/W)*FOV;
        const {dist,side,wallX}=castRayDDA(g.player.x,g.player.y,rayAngle);
        zBuf[x]=dist;

        const wallH=Math.min(H*2,H/dist);
        const wallTop=Math.max(0,Math.floor(HALF_H-wallH/2+bob+oy));
        const wallBot=Math.min(H,Math.floor(HALF_H+wallH/2+bob+oy));

        // texture sample
        const texV=getTexel(wallX,0.5);

        // distance fog + side shading + texture
        const fog=Math.max(0,1-dist/MAX_DIST);
        const sideFactor=side===0?1.0:0.72;
        const brightness=fog*sideFactor;

        // ambient occlusion hint — darken near floor and ceiling
        for(let y=wallTop;y<wallBot;y++){
          const wallY=(y-wallTop)/(wallBot-wallTop);
          // AO darkening at edges
          const ao=Math.sin(wallY*Math.PI);
          const texRow=getTexel(wallX,wallY);
          const v=Math.floor((brightness*ao*0.7+brightness*0.3)*texRow*220+brightness*18);
          const i=(y*W+x)*4;
          pixels[i]=v;pixels[i+1]=v;pixels[i+2]=v+6;pixels[i+3]=255;
        }
      }

      ctx.putImageData(imgData,Math.floor(ox),0);

      // ── sprites on top
      drawSprite(g.cat.x,g.cat.y,zBuf,true);
      drawSprite(g.cheese.x+0.5,g.cheese.y+0.5,zBuf,false);

      // particles
      drawParticles(zBuf);
    }

    // ── CAT SPRITE (animated, scary) ─────────────────────
    function drawSprite(sx:number,sy:number,zBuf:Float32Array,isCat:boolean){
      const dx=sx-g.player.x,dy=sy-g.player.y;
      const dist=Math.sqrt(dx*dx+dy*dy);
      if(dist<0.15)return;
      let sa=Math.atan2(dy,dx)-g.player.angle;
      while(sa>Math.PI)sa-=Math.PI*2;
      while(sa<-Math.PI)sa+=Math.PI*2;
      if(Math.abs(sa)>FOV*1.1)return;

      const jsBoost=isCat&&g.cat.jumpScare>0?1+g.cat.jumpScare*3.5:1;
      const sH=Math.min(H*2.5,(H/dist)*jsBoost);
      const sW=sH;
      const screenX=(sa/FOV+0.5)*W;
      const startY=Math.floor(HALF_H-sH*0.5);

      const cS=Math.max(0,Math.floor(screenX-sW/2));
      const cE=Math.min(W,Math.floor(screenX+sW/2));
      if(cE<=cS)return;

      let vis=0;const tot=cE-cS;
      for(let c=cS;c<cE;c++){if(dist<(zBuf[c]||999))vis++;}
      const vr=tot>0?vis/tot:0;
      if(isCat&&vr<0.35)return;
      if(!isCat&&vr<0.1)return;

      ctx.save();
      const cp=new Path2D();
      for(let c=cS;c<cE;c++){if(dist<(zBuf[c]||999))cp.rect(c,0,1,H);}
      ctx.clip(cp);

      if(isCat){
        const smart=1-g.eps;
        const fog=Math.max(0,1-dist/MAX_DIST);
        const alpha=Math.min(1,0.12+fog*(0.28+smart*0.72));
        const s=sH;
        const cx2=screenX;
        const cy2=startY+s*0.5;

        g.cat.animT=(g.cat.animT||0)+0.07;
        const t=g.cat.animT;

        // DUMB = big wobble, lazy bounce. SMART = tight controlled stalk
        const wobbleAmt=smart<0.4?0.022:0.006;
        const wobX=Math.sin(t*0.85)*s*wobbleAmt;
        const wobY=Math.sin(t*1.1)*s*(wobbleAmt*0.6);
        const breathe=Math.sin(t*(smart<0.4?0.4:0.7))*s*(smart<0.4?0.022:0.01);
        // dumb cat bobs head goofily; smart cat is stone still
        const headBob=smart<0.4?Math.sin(t*1.8)*s*0.025:Math.sin(t*0.3)*s*0.005;

        // DUMB = warm tabby orange-gray. SMART = cold dark asphalt gray
        const furBase=smart<0.35
          ? Math.floor(38+smart*20)   // warm mid-gray tabby
          : Math.floor(10+smart*22);  // cold near-black predator
        const furWarm=smart<0.35;
        const fr=furBase+(furWarm?8:0), fg=furBase+(furWarm?6:0), fb=furBase+(furWarm?2:0);
        const furC=`rgba(${fr},${fg},${fb},${alpha})`;
        const furL=`rgba(${fr+28},${fg+25},${fb+22},${alpha})`;
        const furD=`rgba(${Math.max(0,fr-12)},${Math.max(0,fg-12)},${Math.max(0,fb-10)},${alpha})`;
        const pinkR=fr+75,pinkG=fg+28,pinkB=fb+30;

        // ── SHADOW
        ctx.fillStyle=`rgba(0,0,0,${fog*0.32})`;
        ctx.beginPath();
        ctx.ellipse(cx2+wobX,cy2+s*.54+wobY,s*.30*(1-dist/MAX_DIST*0.4),s*.046,0,0,Math.PI*2);
        ctx.fill();

        // ── BODY — dumb=chubby round; smart=lean crouching oval
        const bodyW=smart<0.4?s*.32:s*.28;
        const bodyH=smart<0.4?s*.30:s*.22;
        const bodyTilt=smart<0.4?0:Math.PI*0.08; // smart cat crouches/leans
        ctx.fillStyle=furD;
        ctx.beginPath();
        ctx.ellipse(cx2+wobX,cy2+s*.24+wobY+breathe,bodyW,bodyH+breathe,bodyTilt,0,Math.PI*2);
        ctx.fill();
        ctx.fillStyle=furC;
        ctx.beginPath();
        ctx.ellipse(cx2+wobX-s*.05,cy2+s*.2+wobY+breathe,bodyW*.68,bodyH*.62,bodyTilt+Math.PI*.12,0,Math.PI*2);
        ctx.fill();
        // DUMB: white belly patch
        if(smart<0.5){
          ctx.fillStyle=`rgba(${fr+40},${fg+38},${fb+35},${alpha*.75})`;
          ctx.beginPath();
          ctx.ellipse(cx2+wobX,cy2+s*.28+wobY+breathe,bodyW*.35,bodyH*.45,0,0,Math.PI*2);
          ctx.fill();
        }

        // ── HEAD
        // DUMB = big round innocent head; SMART = narrower angular skull
        const headR=smart<0.4?s*.255:s*.22;
        const headSquish=smart<0.4?1.0:0.88;
        ctx.fillStyle=furC;
        ctx.beginPath();
        ctx.ellipse(cx2+wobX,cy2-s*.04+wobY+headBob,headR,headR*headSquish,0,0,Math.PI*2);
        ctx.fill();
        ctx.fillStyle=furL;
        ctx.beginPath();
        ctx.ellipse(cx2+wobX-s*.06,cy2-s*.1+wobY+headBob,headR*.52,headR*.38,Math.PI*.1,0,Math.PI*2);
        ctx.fill();

        // ── EARS
        // DUMB = tall floppy rounded ears; SMART = flat pinned-back aggression
        const earH=smart<0.35 ? s*.28 : s*.14*(1-Math.max(0,smart-0.35)*0.8);
        const earSpread=smart<0.35?0.02:0.12; // smart ears pin back wider
        ctx.fillStyle=furC;
        // left ear
        ctx.beginPath();
        ctx.moveTo(cx2+wobX-s*.24,cy2-s*.14+wobY+headBob);
        ctx.lineTo(cx2+wobX-s*(.14+earSpread),cy2-s*.14-earH+wobY+headBob);
        ctx.lineTo(cx2+wobX-s*.04,cy2-s*.2+wobY+headBob);
        ctx.closePath();ctx.fill();
        ctx.fillStyle=`rgba(${pinkR},${pinkG},${pinkB},${alpha*.65})`;
        ctx.beginPath();
        ctx.moveTo(cx2+wobX-s*.22,cy2-s*.15+wobY+headBob);
        ctx.lineTo(cx2+wobX-s*(.14+earSpread),cy2-s*.15-earH*.78+wobY+headBob);
        ctx.lineTo(cx2+wobX-s*.07,cy2-s*.21+wobY+headBob);
        ctx.closePath();ctx.fill();
        // right ear
        ctx.fillStyle=furC;
        ctx.beginPath();
        ctx.moveTo(cx2+wobX+s*.04,cy2-s*.2+wobY+headBob);
        ctx.lineTo(cx2+wobX+s*(.14+earSpread),cy2-s*.14-earH+wobY+headBob);
        ctx.lineTo(cx2+wobX+s*.24,cy2-s*.14+wobY+headBob);
        ctx.closePath();ctx.fill();
        ctx.fillStyle=`rgba(${pinkR},${pinkG},${pinkB},${alpha*.65})`;
        ctx.beginPath();
        ctx.moveTo(cx2+wobX+s*.07,cy2-s*.21+wobY+headBob);
        ctx.lineTo(cx2+wobX+s*(.14+earSpread),cy2-s*.15-earH*.78+wobY+headBob);
        ctx.lineTo(cx2+wobX+s*.22,cy2-s*.15+wobY+headBob);
        ctx.closePath();ctx.fill();

        // ── EYES
        const eyeY=cy2-s*.07+wobY+headBob;
        const eyeR=Math.max(2,s*.076);
        const scA=Math.min(1,alpha*1.35);

        // DUMB: big wide innocent eyes. SMART: narrow angular slits
        const eyeScaleX=smart<0.35?1.5:1.1+(smart*0.15);
        const eyeScaleY=smart<0.35?1.15:0.95;
        // sclera
        ctx.fillStyle=`rgba(${fr+50},${fg+46},${fb+44},${scA})`;
        ctx.beginPath();ctx.ellipse(cx2+wobX-s*.1,eyeY,eyeR*eyeScaleX,eyeR*eyeScaleY,0,0,Math.PI*2);ctx.fill();
        ctx.beginPath();ctx.ellipse(cx2+wobX+s*.1,eyeY,eyeR*eyeScaleX,eyeR*eyeScaleY,0,0,Math.PI*2);ctx.fill();

        // DUMB: pupils are big round circles (curious/dopey)
        // MED: gold vertical slits
        // SMART: burning red slits
        let iR=140,iG=185,iB=200; // dumb = pale blue-gray
        if(smart>0.7){iR=225;iG=20;iB=20;}
        else if(smart>0.35){iR=245;iG=190;iB=20;}
        const irisA=Math.min(1,0.35+smart*0.75)*scA;
        const irisW=smart<0.35?eyeR*.9:eyeR*.55;
        ctx.fillStyle=`rgba(${iR},${iG},${iB},${irisA})`;
        ctx.beginPath();ctx.ellipse(cx2+wobX-s*.1,eyeY,irisW,eyeR*1.02,0,0,Math.PI*2);ctx.fill();
        ctx.beginPath();ctx.ellipse(cx2+wobX+s*.1,eyeY,irisW,eyeR*1.02,0,0,Math.PI*2);ctx.fill();

        // pupil — dumb=big round; smart=razor thin
        const pupW=smart<0.35?eyeR*.68:eyeR*(smart>0.65?0.12:0.22);
        ctx.fillStyle=`rgba(0,0,0,${scA*.92})`;
        ctx.beginPath();ctx.ellipse(cx2+wobX-s*.1,eyeY,pupW,eyeR*.95,0,0,Math.PI*2);ctx.fill();
        ctx.beginPath();ctx.ellipse(cx2+wobX+s*.1,eyeY,pupW,eyeR*.95,0,0,Math.PI*2);ctx.fill();

        // DUMB: little sparkle highlight dot (cute)
        if(smart<0.4){
          ctx.fillStyle=`rgba(255,255,255,${scA*.7})`;
          ctx.beginPath();ctx.arc(cx2+wobX-s*.12,eyeY-eyeR*.4,eyeR*.22,0,Math.PI*2);ctx.fill();
          ctx.beginPath();ctx.arc(cx2+wobX+s*.08,eyeY-eyeR*.4,eyeR*.22,0,Math.PI*2);ctx.fill();
        }

        // SMART: burning glow
        if(smart>0.32){
          const gR=smart>0.7?225:245,gG=smart>0.7?20:190,gB2=smart>0.7?20:20;
          const gA=smart*(smart>0.7?0.24:0.13);
          ctx.fillStyle=`rgba(${gR},${gG},${gB2},${gA})`;
          ctx.beginPath();ctx.arc(cx2+wobX-s*.1,eyeY,eyeR*4.8,0,Math.PI*2);ctx.fill();
          ctx.beginPath();ctx.arc(cx2+wobX+s*.1,eyeY,eyeR*4.8,0,Math.PI*2);ctx.fill();
        }

        // ── NOSE — DUMB=big pink button; SMART=small tight triangle
        const noseSize=smart<0.4?0.055:0.038;
        ctx.fillStyle=`rgba(${pinkR},${pinkG-10},${pinkB},${alpha})`;
        ctx.beginPath();
        ctx.moveTo(cx2+wobX,cy2+s*.06+wobY+headBob);
        ctx.lineTo(cx2+wobX-s*noseSize,cy2+s*(.06+noseSize*1.8)+wobY+headBob);
        ctx.lineTo(cx2+wobX+s*noseSize,cy2+s*(.06+noseSize*1.8)+wobY+headBob);
        ctx.closePath();ctx.fill();

        // ── MOUTH
        const snarl=Math.max(0,smart-0.45)*0.5;
        const mouthY=cy2+s*(.06+noseSize*1.8)+wobY+headBob;
        ctx.strokeStyle=`rgba(${fr+55},${fg+30},${fb+32},${alpha*.88})`;
        ctx.lineWidth=Math.max(.5,s*.013);
        ctx.beginPath();ctx.moveTo(cx2+wobX,mouthY);ctx.lineTo(cx2+wobX,mouthY+s*.04);ctx.stroke();
        ctx.beginPath();ctx.moveTo(cx2+wobX,mouthY+s*.04);
        ctx.quadraticCurveTo(cx2+wobX-s*.08,mouthY+s*(.09+snarl),cx2+wobX-s*.13,mouthY+s*(.05-snarl));ctx.stroke();
        ctx.beginPath();ctx.moveTo(cx2+wobX,mouthY+s*.04);
        ctx.quadraticCurveTo(cx2+wobX+s*.08,mouthY+s*(.09+snarl),cx2+wobX+s*.13,mouthY+s*(.05-snarl));ctx.stroke();

        // DUMB: cute little tongue poking out
        if(smart<0.3){
          ctx.fillStyle=`rgba(${pinkR+10},${pinkG-20},${pinkB-20},${alpha*.8})`;
          ctx.beginPath();ctx.ellipse(cx2+wobX,mouthY+s*.1,s*.04,s*.05,0,0,Math.PI*2);ctx.fill();
        }

        // SMART: long curved fangs
        if(smart>0.55){
          const fangLen=s*(.08+Math.max(0,smart-.55)*.22);
          ctx.fillStyle=`rgba(235,228,220,${alpha*.92})`;
          ctx.beginPath();ctx.moveTo(cx2+wobX-s*.04,mouthY+s*.05);ctx.lineTo(cx2+wobX-s*.09,mouthY+fangLen);ctx.lineTo(cx2+wobX-s*.015,mouthY+s*.05);ctx.closePath();ctx.fill();
          ctx.beginPath();ctx.moveTo(cx2+wobX+s*.04,mouthY+s*.05);ctx.lineTo(cx2+wobX+s*.09,mouthY+fangLen);ctx.lineTo(cx2+wobX+s*.015,mouthY+s*.05);ctx.closePath();ctx.fill();
          // fang tips are slightly darker/bloodied at very high IQ
          if(smart>0.8){
            ctx.fillStyle=`rgba(180,40,40,${alpha*.6})`;
            ctx.beginPath();ctx.ellipse(cx2+wobX-s*.09,mouthY+fangLen,s*.02,s*.025,0,0,Math.PI*2);ctx.fill();
            ctx.beginPath();ctx.ellipse(cx2+wobX+s*.09,mouthY+fangLen,s*.02,s*.025,0,0,Math.PI*2);ctx.fill();
          }
        }

        // ── WHISKERS — DUMB=droopy/uneven; SMART=ramrod straight
        ctx.lineWidth=Math.max(.35,s*.007);
        const wPairs=smart<0.35
          ? [[-0.14,0.06,-0.28,-0.04],[-0.12,0.1,-0.3,0.12],[-0.1,0.14,-0.26,0.22]]  // droopy
          : [[-0.04,0.1,-0.34,0.06],[-0.04,0.13,-0.34,0.13],[-0.04,0.15,-0.3,0.21]]; // straight
        for(const [sx1,sy1,sx2,sy2] of wPairs){
          ctx.strokeStyle=`rgba(${fr+85},${fg+82},${fb+78},${alpha*(smart<0.35?.5:.65)})`;
          ctx.beginPath();ctx.moveTo(cx2+wobX+s*sx1,cy2+s*sy1+wobY+headBob);ctx.lineTo(cx2+wobX+s*sx2,cy2+s*sy2+wobY+headBob);ctx.stroke();
          ctx.beginPath();ctx.moveTo(cx2+wobX-s*sx1,cy2+s*sy1+wobY+headBob);ctx.lineTo(cx2+wobX-s*sx2,cy2+s*sy2+wobY+headBob);ctx.stroke();
        }

        // ── TAIL
        // DUMB: lazy S-curve wagging high; SMART: low sweeping stalk tail
        const tailSpeed=smart<0.4?1.4:0.7;
        const tailAmp=smart<0.4?s*.22:s*.1;
        const tailSwing=Math.sin(t*tailSpeed)*tailAmp;
        const tailBaseY=smart<0.4?s*.38:s*.46;
        ctx.strokeStyle=furC;ctx.lineWidth=Math.max(1.5,s*.042);
        ctx.beginPath();
        ctx.moveTo(cx2+wobX+s*.25,cy2+tailBaseY+wobY);
        ctx.quadraticCurveTo(cx2+wobX+s*.5+tailSwing*.6,cy2+tailBaseY+s*.12+wobY,cx2+wobX+s*.42+tailSwing,cy2+tailBaseY+s*.28+wobY);
        ctx.stroke();
        ctx.lineWidth=Math.max(1,s*.024);ctx.strokeStyle=furL;
        ctx.beginPath();
        ctx.moveTo(cx2+wobX+s*.42+tailSwing,cy2+tailBaseY+s*.28+wobY);
        ctx.quadraticCurveTo(cx2+wobX+s*.52+tailSwing,cy2+tailBaseY+s*.38+wobY,cx2+wobX+s*.36+tailSwing,cy2+tailBaseY+s*.44+wobY);
        ctx.stroke();

        // ── PAWS
        const pawSpread=smart<0.4?s*.14:s*.11;
        ctx.fillStyle=furC;
        ctx.beginPath();ctx.ellipse(cx2+wobX-pawSpread,cy2+s*.5+wobY,s*.085,s*.052,Math.PI*(smart<0.4?.08:.14),0,Math.PI*2);ctx.fill();
        ctx.beginPath();ctx.ellipse(cx2+wobX+pawSpread,cy2+s*.5+wobY,s*.085,s*.052,-Math.PI*(smart<0.4?.08:.14),0,Math.PI*2);ctx.fill();
        // claws
        if(smart>0.45){
          ctx.fillStyle=`rgba(218,212,205,${alpha*.72})`;
          for(let cc=-1;cc<=1;cc++){
            ctx.beginPath();ctx.ellipse(cx2+wobX-pawSpread+cc*s*.038,cy2+s*.535+wobY,s*.013,s*.038,0,0,Math.PI*2);ctx.fill();
            ctx.beginPath();ctx.ellipse(cx2+wobX+pawSpread+cc*s*.038,cy2+s*.535+wobY,s*.013,s*.038,0,0,Math.PI*2);ctx.fill();
          }
        }

      } else {
        // ── CHEESE (pixel art) ─────────────────────────────
        g.cheese.bobT=(g.cheese.bobT||0)+0.04;
        const cheeseY=startY+Math.sin(g.cheese.bobT)*sH*.04;
        const bright=Math.max(0,1-dist/MAX_DIST);
        const bx=Math.floor(screenX-sW*.28);
        const by=Math.floor(cheeseY+sH*.18);
        const bw=Math.floor(sW*.56);
        const bh=Math.floor(sH*.58);
        const pw=Math.max(1,Math.floor(bw/8));
        const ph=Math.max(1,Math.floor(bh/8));
        const pat=[
          [0,5,5,5,5,5,5,0],
          [5,2,2,1,1,2,1,5],
          [5,1,4,1,2,1,4,5],
          [5,2,1,1,4,1,1,5],
          [5,1,2,1,1,2,1,5],
          [5,3,3,4,1,1,3,5],
          [5,3,3,3,3,3,3,5],
          [0,5,5,5,5,5,5,0],
        ];
        for(let row=0;row<8;row++){
          for(let col=0;col<8;col++){
            const v=pat[row][col];
            if(v===0)continue;
            let r=0,g2=0,b2=0,a=bright;
            if(v===1){r=245;g2=197;b2=24;}
            else if(v===2){r=255;g2=220;b2=70;}
            else if(v===3){r=175;g2=135;b2=8;}
            else if(v===4){r=28;g2=18;b2=4;a=bright*.95;}
            else{r=95;g2=65;b2=4;a=bright*.85;}
            ctx.fillStyle=`rgba(${r},${g2},${b2},${a})`;
            ctx.fillRect(bx+col*pw,by+row*ph,pw,ph);
          }
        }
        // glow aura
        const grd=ctx.createRadialGradient(screenX,by+bh*.5,0,screenX,by+bh*.5,sW*.7);
        grd.addColorStop(0,`rgba(245,197,24,${bright*.12})`);
        grd.addColorStop(1,"rgba(245,197,24,0)");
        ctx.fillStyle=grd;
        ctx.beginPath();ctx.arc(screenX,by+bh*.5,sW*.7,0,Math.PI*2);ctx.fill();
      }
      ctx.restore();
    }

    // ── PARTICLES ────────────────────────────────────────
    function spawnParticles(x:number,y:number,color:string,count:number){
      for(let i=0;i<count;i++){
        const angle=Math.random()*Math.PI*2;
        const speed=0.02+Math.random()*0.06;
        g.particles.push({
          x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,
          life:1,color,size:0.03+Math.random()*0.05
        });
      }
    }

    function drawParticles(zBuf:Float32Array){
      g.particles=g.particles.filter((p:any)=>p.life>0);
      for(const p of g.particles){
        p.x+=p.vx;p.y+=p.vy;p.life-=0.035;
        if(p.life<=0)continue;
        const dx=p.x-g.player.x,dy=p.y-g.player.y;
        const dist=Math.sqrt(dx*dx+dy*dy);
        if(dist<0.1)continue;
        let sa=Math.atan2(dy,dx)-g.player.angle;
        while(sa>Math.PI)sa-=Math.PI*2;
        while(sa<-Math.PI)sa+=Math.PI*2;
        if(Math.abs(sa)>FOV)continue;
        const screenX=(sa/FOV+0.5)*W;
        const pSize=Math.max(2,(H/dist)*p.size);
        const bi=Math.floor((screenX/W)*RAYS);
        if(bi>=0&&bi<zBuf.length&&dist<zBuf[bi]){
          ctx.fillStyle=p.color.replace("1)",`${p.life})`);
          ctx.fillRect(screenX-pSize/2,HALF_H-pSize/2,pSize,pSize);
        }
      }
    }

    // ── SPIDEY SENSE ─────────────────────────────────────
    function catHasLOS(){
      const cdx=g.cat.x-g.player.x,cdy=g.cat.y-g.player.y;
      const dist=Math.sqrt(cdx*cdx+cdy*cdy);
      const steps=Math.ceil(dist*14);
      for(let i=1;i<steps;i++){
        const rx=g.player.x+(cdx/steps)*i,ry=g.player.y+(cdy/steps)*i;
        const mx=Math.floor(rx),my=Math.floor(ry);
        if(my>=0&&my<MSIZE&&mx>=0&&mx<MSIZE&&g.map[my][mx]===1)return false;
      }
      return true;
    }

    function drawSpideySense(){
      const cdx=g.cat.x-g.player.x,cdy=g.cat.y-g.player.y;
      const dist=Math.sqrt(cdx*cdx+cdy*cdy);
      const threat=Math.max(0,1-dist/8);
      if(threat<0.06)return;
      g.spidey=(g.spidey+0.07)%(Math.PI*2);
      const los=catHasLOS();
      const smart=1-g.eps;
      const catAngle=Math.atan2(cdy,cdx);
      let rel=catAngle-g.player.angle;
      while(rel>Math.PI)rel-=Math.PI*2;
      while(rel<-Math.PI)rel+=Math.PI*2;
      const inView=Math.abs(rel)<FOV*.48;

      if(!inView||!los){
        const pulse=.5+.5*Math.sin(g.spidey*(1+threat*4));
        const alpha=threat*(.5+pulse*.5);
        const sz=8+threat*18;
        const ir=Math.min(W,H)*.4;
        const ix=W/2+Math.cos(catAngle)*ir;
        const iy=H/2+Math.sin(catAngle)*ir;
        ctx.save();ctx.translate(ix,iy);ctx.rotate(catAngle+Math.PI/2);
        // color shifts red when very smart
        const r2=smart>0.7?220:232,g2v=smart>0.7?30:232,b2=smart>0.7?30:232;
        ctx.fillStyle=`rgba(${r2},${g2v},${b2},${alpha})`;
        ctx.beginPath();ctx.roundRect(-sz*.2,-sz*.65,sz*.4,sz*.68,2);ctx.fill();
        ctx.beginPath();ctx.arc(0,sz*.23,sz*.21,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle=`rgba(${r2},${g2v},${b2},${alpha*.3})`;ctx.lineWidth=1;
        ctx.beginPath();ctx.arc(0,0,sz*(.95+pulse*.55),0,Math.PI*2);ctx.stroke();
        ctx.restore();
      }

      // red vignette danger
      if(dist<3&&los){
        const v=(3-dist)/3*.5;
        const pulse=.5+.5*Math.sin(g.spidey*6);
        const vColor=smart>0.7?`rgba(220,0,0,${v*pulse})`:`rgba(180,10,10,${v*pulse*.7})`;
        ctx.fillStyle=vColor;
        ctx.fillRect(0,0,W,H);
      }

      // heartbeat EKG
      if(threat>.2){
        const bpm=.5+.5*Math.sin(g.spidey*(2+threat*6));
        const lineY=H-52;
        const r3=smart>0.7?220:232,g3=smart>0.7?30:232,b3=smart>0.7?30:232;
        ctx.strokeStyle=`rgba(${r3},${g3},${b3},${threat*bpm*.6})`;ctx.lineWidth=1;
        ctx.beginPath();
        for(let i=0;i<=120;i++){
          const x=(i/120)*W;let y=lineY;
          const c=Math.abs(i/120-.5);
          if(c<.06)y-=Math.sin((i/120-.44)*Math.PI*16)*threat*22*bpm;
          i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
        }
        ctx.stroke();
      }
    }

    // ── MINIMAP ───────────────────────────────────────────
    function renderMinimap(){
      const scale=MMW/MSIZE;
      mctx.fillStyle="#080808";mctx.fillRect(0,0,MMW,MMH);
      for(let y=0;y<MSIZE;y++) for(let x=0;x<MSIZE;x++){
        if(g.map[y][x]===1){mctx.fillStyle="#1c1c1c";mctx.fillRect(x*scale,y*scale,scale,scale);}
      }
      mctx.fillStyle="#f5c518";
      mctx.fillRect(g.cheese.x*scale+1,g.cheese.y*scale+1,scale-2,scale-2);
      const cd=Math.abs(Math.floor(g.cat.x)-Math.floor(g.player.x))+Math.abs(Math.floor(g.cat.y)-Math.floor(g.player.y));
      if(cd<=1){
        mctx.fillStyle="rgba(220,30,30,.7)";
        mctx.beginPath();mctx.arc(g.cat.x*scale,g.cat.y*scale,scale*.35,0,Math.PI*2);mctx.fill();
      }
      mctx.fillStyle="#e8e8e8";
      mctx.beginPath();mctx.arc(g.player.x*scale,g.player.y*scale,scale*.42,0,Math.PI*2);mctx.fill();
      mctx.strokeStyle="#e8e8e8";mctx.lineWidth=1;mctx.beginPath();
      mctx.moveTo(g.player.x*scale,g.player.y*scale);
      mctx.lineTo((g.player.x+Math.cos(g.player.angle)*.85)*scale,(g.player.y+Math.sin(g.player.angle)*.85)*scale);
      mctx.stroke();
    }

    // ── SPAWN ─────────────────────────────────────────────
    function spawnEntities(){
      g.cheese=randEmpty();
      g.cheese.bobT=0;
      const pc=randEmpty([g.cheese]);
      g.player.x=pc.x+.5;g.player.y=pc.y+.5;g.player.angle=Math.random()*Math.PI*2;
      g.player.bobT=0;g.player.bobAmt=0;
      const cc=randEmpty([g.cheese,pc]);
      g.cat.x=cc.x+.5;g.cat.y=cc.y+.5;
      g.cat.animT=0;
    }

    // ── HUD SYNC ──────────────────────────────────────────
    let lastSync=0;
    function syncHUD(){
      const now=performance.now();
      if(now-lastSync<80)return;
      lastSync=now;
      setScore(g.score);setCheese(g.cheeseN);setRound(g.round);
      setIq(Math.round((1-g.eps)*100));setLives(g.lives);
      const dist=Math.sqrt(Math.pow(g.player.x-g.cat.x,2)+Math.pow(g.player.y-g.cat.y,2));
      setThreat(Math.max(0,1-dist/8));
      const dirs=["N","NE","E","SE","S","SW","W","NW"];
      setCompass(dirs[Math.round(((g.player.angle+Math.PI/8)%(Math.PI*2))/(Math.PI/4))%8]);
    }

    // ── GAME EVENTS ───────────────────────────────────────
    function catCaught(){
      if(g.deathSeq!==0)return; // already dying
      const cx=Math.floor(g.cat.x),cy=Math.floor(g.cat.y);
      const px=Math.floor(g.player.x),py=Math.floor(g.player.y);
      const s=sk(cx,cy,px,py);
      g.Q[s+"|0"]=(g.Q[s+"|0"]||0)+20;
      g.eps=Math.max(EPS_MIN,g.eps*EPS_DECAY);
      g.lives--;g.round++;

      // store death position/angle for animation
      g.deathAngle=g.player.angle;
      g.deathPitch=0;
      g.deathRoll=0;
      g.deathT=0;
      g.deathSeq=1; // start cinematic

      // massive screen shake
      g.screenShake=28;
      // blood explosion
      for(let i=0;i<40;i++) spawnParticles(g.player.x,g.player.y,"rgba(200,20,20,1)",1);
      // push cat to fill screen (jump scare)
      g.cat.jumpScare=1.0;
      // add blood decal at death spot
      g.bloodDecals.push({x:g.player.x,y:g.player.y,r:Math.random()*Math.PI*2,size:0.4+Math.random()*0.3});
    }

    function tickDeath(){
      if(g.deathSeq===0)return;
      g.deathT+=1;

      if(g.deathSeq===1){
        // phase 1: camera topples over (0-60 frames)
        const t=g.deathT/60;
        g.deathPitch=t*t*HALF_H*1.4;   // pitches way down
        g.deathRoll=Math.sin(t*Math.PI)*0.18; // rolls
        g.screenShake=Math.max(0,28-g.deathT*.4);
        g.player.angle=g.deathAngle+Math.sin(g.deathT*.08)*0.12; // wobble

        // fade cat jumpscare
        if(g.cat.jumpScare>0) g.cat.jumpScare=Math.max(0,g.cat.jumpScare-0.035);

        if(g.deathT>=75){
          g.deathSeq=2;
          g.deathT=0;
          if(g.lives<=0){
            g.active=false;
            setDeadStats({score:g.score,cheese:g.cheeseN,iq:Math.round((1-g.eps)*100)});
            setOverlay("dead");
            return;
          }
        }
      }

      if(g.deathSeq===2){
        // phase 2: fade to black then respawn (0-40 frames)
        if(g.deathT>=30){
          genMap();spawnEntities();
          g.deathSeq=3;g.deathT=0;
          g.deathPitch=0;g.deathRoll=0;
          setCenterMsg("round "+g.round);
          setTimeout(()=>setCenterMsg("find the cheese"),2000);
        }
      }

      if(g.deathSeq===3){
        // phase 3: fade back in (0-30 frames)
        if(g.deathT>=30){g.deathSeq=0;g.deathT=0;}
      }
    }

    function gotCheese(){
      g.score+=100;g.cheeseN++;
      g.eps=Math.max(EPS_MIN,g.eps*EPS_DECAY*.95);
      spawnParticles(g.cheese.x+.5,g.cheese.y+.5,"rgba(245,197,24,1)",14);
      g.cheese=randEmpty([{x:Math.floor(g.player.x),y:Math.floor(g.player.y)}]);
      g.cheese.bobT=0;
      setCenterMsg("+100");
      setTimeout(()=>setCenterMsg("find the cheese"),1500);
    }

    // ── INPUT ─────────────────────────────────────────────
    const onKey=(e:KeyboardEvent)=>{
      g.keys[e.code]=e.type==="keydown";
      if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(e.key))e.preventDefault();
    };
    window.addEventListener("keydown",onKey);window.addEventListener("keyup",onKey);
    canvas.addEventListener("click",()=>{if(!g.mouseLocked)canvas.requestPointerLock();});
    document.addEventListener("pointerlockchange",()=>{g.mouseLocked=document.pointerLockElement===canvas;});
    const onMM=(e:MouseEvent)=>{if(g.mouseLocked&&g.active)g.player.angle+=e.movementX*.003;};
    document.addEventListener("mousemove",onMM);

    function movePlayer(){
      const spd=g.player.speed;
      let dx=0,dy=0,moving=false;
      if(g.keys["KeyW"]||g.keys["ArrowUp"]){dx+=Math.cos(g.player.angle)*spd;dy+=Math.sin(g.player.angle)*spd;moving=true;}
      if(g.keys["KeyS"]||g.keys["ArrowDown"]){dx-=Math.cos(g.player.angle)*spd;dy-=Math.sin(g.player.angle)*spd;moving=true;}
      if(g.keys["KeyA"]||g.keys["KeyQ"])g.player.angle-=g.player.turnSpeed;
      if(g.keys["KeyD"]||g.keys["KeyE"])g.player.angle+=g.player.turnSpeed;
      if(g.keys["ArrowLeft"])g.player.angle-=g.player.turnSpeed;
      if(g.keys["ArrowRight"])g.player.angle+=g.player.turnSpeed;
      if(moving){g.player.bobT+=0.16;g.player.bobAmt=Math.min(3.5,g.player.bobAmt+0.35);}
      else{g.player.bobAmt=Math.max(0,g.player.bobAmt-0.15);}
      const nx=g.player.x+dx,ny=g.player.y+dy;
      const m=.28;
      if(g.map[Math.floor(g.player.y)][Math.floor(nx+Math.sign(dx)*m)]===0)g.player.x=nx;
      if(g.map[Math.floor(ny+Math.sign(dy)*m)][Math.floor(g.player.x)]===0)g.player.y=ny;
    }

    function moveCat(){
      g.catTimer++;
      const smart=1-g.eps;
      g.CAT_FRAMES=Math.max(5,Math.floor(16-smart*11));
      if(g.catTimer<g.CAT_FRAMES)return;
      g.catTimer=0;
      const cx=Math.floor(g.cat.x),cy=Math.floor(g.cat.y);
      const px=Math.floor(g.player.x),py=Math.floor(g.player.y);
      const dist=Math.abs(cx-px)+Math.abs(cy-py);
      let tx=cx,ty=cy;
      if(smart>.5&&dist<7){const r=catQLStep();tx=r.x;ty=r.y;}
      else if(smart>.2){const p=astar(cx,cy,px,py);if(p.length>1){tx=p[1].x;ty=p[1].y;}else{const r=catQLStep();tx=r.x;ty=r.y;}}
      else{const r=catQLStep();tx=r.x;ty=r.y;}
      g.cat.x=tx+.5;g.cat.y=ty+.5;
    }

    // ── MAIN LOOP ─────────────────────────────────────────
    let animId:number;
    function loop(){
      animId=requestAnimationFrame(loop);
      if(!g.active&&g.deathSeq===0)return;
      g.frame++;
      g.ambient=(g.ambient||0)+0.012;

      if(g.deathSeq===0){
        movePlayer();moveCat();
        const cdx=g.player.x-(g.cheese.x+.5),cdy=g.player.y-(g.cheese.y+.5);
        if(Math.sqrt(cdx*cdx+cdy*cdy)<.65)gotCheese();
        const kdx=g.player.x-g.cat.x,kdy=g.player.y-g.cat.y;
        if(Math.sqrt(kdx*kdx+kdy*kdy)<.55)catCaught();
      }

      tickDeath();
      render3D();
      drawDeathOverlay();
      drawSpideySense();
      renderMinimap();
      syncHUD();
    }

    function drawDeathOverlay(){
      if(g.deathSeq===0)return;
      // phase 1: camera fall + blood flash
      if(g.deathSeq===1){
        const t=Math.min(1,g.deathT/75);
        // blood red fill that intensifies
        ctx.fillStyle=`rgba(180,0,0,\${t*0.72})`;
        ctx.fillRect(0,0,W,H);
        // white flash on first frame
        if(g.deathT<8){
          ctx.fillStyle=`rgba(255,255,255,\${(1-g.deathT/8)*0.85})`;
          ctx.fillRect(0,0,W,H);
        }
        // vignette crush
        const vGrad=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.max(W,H)*.6);
        vGrad.addColorStop(0,"rgba(0,0,0,0)");
        vGrad.addColorStop(1,`rgba(0,0,0,\${t*.95})`);
        ctx.fillStyle=vGrad;
        ctx.fillRect(0,0,W,H);
        // DEATH text flashes in
        if(g.deathT>40){
          const dt=Math.min(1,(g.deathT-40)/20);
          ctx.fillStyle=`rgba(255,255,255,\${dt*0.9})`;
          ctx.font=`\${Math.floor(H*.12)}px 'Bebas Neue',sans-serif`;
          ctx.textAlign="center";
          ctx.fillText("CAUGHT",W/2,H/2);
          ctx.font=`\${Math.floor(H*.035)}px ui-monospace,monospace`;
          ctx.fillStyle=`rgba(232,232,232,\${dt*.55})`;
          ctx.fillText(`\${g.lives} \${g.lives===1?"life":"lives"} remaining`,W/2,H/2+H*.1);
          ctx.textAlign="left";
        }
      }
      // phase 2: fade to black
      if(g.deathSeq===2){
        const t=Math.min(1,g.deathT/30);
        ctx.fillStyle=`rgba(0,0,0,\${t})`;
        ctx.fillRect(0,0,W,H);
      }
      // phase 3: fade in
      if(g.deathSeq===3){
        const t=1-Math.min(1,g.deathT/30);
        ctx.fillStyle=`rgba(0,0,0,\${t})`;
        ctx.fillRect(0,0,W,H);
      }
    }

    g.startGame=()=>{genMap();spawnEntities();g.active=true;setOverlay(null);setCenterMsg("find the cheese");};
    g.restartGame=()=>{g.lives=3;g.score=0;g.cheeseN=0;g.round=1;g.eps=1.0;g.Q={};g.particles=[];genMap();spawnEntities();g.active=true;setOverlay(null);setCenterMsg("find the cheese");};

    genMap();spawnEntities();
    loop();

    return()=>{
      cancelAnimationFrame(animId);
      window.removeEventListener("keydown",onKey);window.removeEventListener("keyup",onKey);
      document.removeEventListener("mousemove",onMM);
      if(document.pointerLockElement===canvas)document.exitPointerLock();
    };
  },[]);

  const threatColor=threat>0.7?"#e83a3a":threat>0.4?"#e8a83a":"#e8e8e8";
  const mono="ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace";

  return (
    <div style={{position:"relative",width:"100vw",height:"100vh",background:"#000",overflow:"hidden",fontFamily:mono,color:"#e8e8e8"}}>
      <canvas ref={canvasRef} style={{display:"block",position:"absolute",inset:0}}/>
      <canvas ref={mmRef} width={120} height={120} style={{position:"absolute",bottom:16,right:16,border:"1px solid rgba(255,255,255,.08)",opacity:.75,zIndex:10}}/>

      {/* HUD top */}
      <div style={{position:"absolute",top:0,left:0,right:0,display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 24px",background:"linear-gradient(to bottom,rgba(0,0,0,.85),transparent)",pointerEvents:"none",zIndex:10}}>
        <div style={{display:"flex",gap:24}}>
          {[["score",score],["cheese",cheese],["round",round]].map(([l,v])=>(
            <div key={String(l)} style={{fontSize:11,letterSpacing:".12em",color:"rgba(232,232,232,.38)"}}>
              {l}<span style={{color:"#e8e8e8",marginLeft:6}}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{fontSize:11,letterSpacing:".12em",color:"rgba(232,232,232,.5)"}}>{centerMsg}</div>
        <div style={{display:"flex",gap:24}}>
          <div style={{fontSize:11,letterSpacing:".12em",color:"rgba(232,232,232,.38)"}}>cat iq<span style={{color:iq>70?"#e83a3a":iq>40?"#e8a83a":"#e8e8e8",marginLeft:6}}>{iq}%</span></div>
          <div style={{fontSize:11,letterSpacing:".12em",color:"rgba(232,232,232,.38)"}}>lives<span style={{color:"#e8e8e8",marginLeft:6}}>{"♦".repeat(lives)+"♢".repeat(Math.max(0,3-lives))}</span></div>
        </div>
      </div>

      {/* HUD bottom */}
      <div style={{position:"absolute",bottom:16,left:16,pointerEvents:"none",zIndex:10,display:"flex",flexDirection:"column",gap:6}}>
        <div style={{fontSize:10,color:"rgba(232,232,232,.28)",letterSpacing:".14em"}}>{compass}</div>
        <div style={{height:2,background:"#111",width:200}}>
          <div style={{height:"100%",width:`${threat*100}%`,background:threatColor,transition:"width .15s"}}/>
        </div>
        <div style={{fontSize:9,color:"rgba(232,232,232,.22)",letterSpacing:".1em"}}>proximity</div>
      </div>

      {/* crosshair */}
      <svg style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",pointerEvents:"none",zIndex:5,opacity:.25}} width={20} height={20} viewBox="0 0 20 20">
        <line x1="10" y1="3" x2="10" y2="8" stroke="#fff" strokeWidth="1"/>
        <line x1="10" y1="12" x2="10" y2="17" stroke="#fff" strokeWidth="1"/>
        <line x1="3" y1="10" x2="8" y2="10" stroke="#fff" strokeWidth="1"/>
        <line x1="12" y1="10" x2="17" y2="10" stroke="#fff" strokeWidth="1"/>
        <circle cx="10" cy="10" r="1" fill="#fff"/>
      </svg>

      <Link href="/" style={{position:"absolute",top:16,left:16,fontSize:10,color:"rgba(232,232,232,.18)",textDecoration:"none",letterSpacing:".1em",zIndex:30,pointerEvents:"auto"}}
        onMouseEnter={e=>(e.currentTarget.style.color="rgba(232,232,232,.6)")}
        onMouseLeave={e=>(e.currentTarget.style.color="rgba(232,232,232,.18)")}
      >← back</Link>

      {overlay==="start"&&(
        <div style={{position:"absolute",inset:0,zIndex:20,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.9)"}}>
          <div style={{fontSize:11,letterSpacing:".2em",color:"rgba(232,232,232,.3)",marginBottom:12,textTransform:"uppercase"}}>cheese / v1</div>
          <h1 style={{fontSize:42,letterSpacing:8,marginBottom:12,fontFamily:"'Bebas Neue',sans-serif"}}>CAT & MOUSE</h1>
          <p style={{fontSize:12,color:"rgba(232,232,232,.4)",letterSpacing:".1em",marginBottom:4}}>you are the mouse</p>
          <p style={{fontSize:12,color:"rgba(232,232,232,.4)",letterSpacing:".1em",marginBottom:4}}>find the cheese — survive the cat</p>
          <p style={{fontSize:10,color:"rgba(232,232,232,.2)",letterSpacing:".1em",marginTop:16}}>WASD / arrows to move &nbsp;·&nbsp; click canvas for mouse-look</p>
          <p style={{fontSize:10,color:"rgba(232,232,232,.2)",letterSpacing:".1em"}}>the cat uses Q-learning reinforcement — it gets smarter every round</p>
          <button onClick={()=>gameRef.current.startGame?.()}
            style={{marginTop:28,background:"none",border:"1px solid rgba(232,232,232,.25)",color:"#e8e8e8",fontFamily:mono,fontSize:12,letterSpacing:".16em",padding:"12px 40px",cursor:"pointer",transition:"border-color .2s"}}
            onMouseEnter={e=>(e.currentTarget.style.borderColor="rgba(232,232,232,.8)")}
            onMouseLeave={e=>(e.currentTarget.style.borderColor="rgba(232,232,232,.25)")}
          >start</button>
        </div>
      )}

      {overlay==="dead"&&(
        <div style={{position:"absolute",inset:0,zIndex:20,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.92)"}}>
          <div style={{fontSize:11,letterSpacing:".2em",color:"rgba(220,30,30,.6)",marginBottom:12}}>GAME OVER</div>
          <h1 style={{fontSize:42,letterSpacing:8,marginBottom:16,fontFamily:"'Bebas Neue',sans-serif",color:"#e8e8e8"}}>CAUGHT</h1>
          <p style={{fontSize:12,color:"rgba(232,232,232,.45)",letterSpacing:".1em",marginBottom:4}}>score: {deadStats.score} &nbsp;·&nbsp; cheese: {deadStats.cheese}</p>
          <p style={{fontSize:12,color:"rgba(232,232,232,.45)",letterSpacing:".1em"}}>cat iq reached: <span style={{color:deadStats.iq>70?"#e83a3a":deadStats.iq>40?"#e8a83a":"#e8e8e8"}}>{deadStats.iq}%</span></p>
          <p style={{fontSize:10,color:"rgba(232,232,232,.2)",letterSpacing:".1em",marginTop:16}}>the cat will remember everything</p>
          <button onClick={()=>gameRef.current.restartGame?.()}
            style={{marginTop:28,background:"none",border:"1px solid rgba(232,232,232,.25)",color:"#e8e8e8",fontFamily:mono,fontSize:12,letterSpacing:".16em",padding:"12px 40px",cursor:"pointer",transition:"border-color .2s"}}
            onMouseEnter={e=>(e.currentTarget.style.borderColor="rgba(232,232,232,.8)")}
            onMouseLeave={e=>(e.currentTarget.style.borderColor="rgba(232,232,232,.25)")}
          >play again</button>
        </div>
      )}
    </div>
  );
}