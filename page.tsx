"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { CheeseGame, type HUD } from "./game/engine";

const INITIAL: HUD = {mode:"start",score:0,best:0,cheese:0,lives:3,progress:0,threat:0,weapon:"hidden",stun:0,message:"FIND THE CHEESE. STAY ALIVE.",hint:"",elapsed:0,muted:false};
const pad = (n: number, length = 2) => String(n).padStart(length, "0");

function Speaker({ muted }: { muted: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/>{muted ? <path d="m16 9 6 6m0-6-6 6"/> : <><path d="M15 8c3 2 3 6 0 8M18 5c5 4 5 10 0 14"/></>}</svg>;
}

export default function PlayPage() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const map = useRef<HTMLCanvasElement>(null);
  const game = useRef<CheeseGame | null>(null);
  const [hud, setHUD] = useState<HUD>(INITIAL);
  useEffect(() => {
    const instance = new CheeseGame(canvas.current!, map.current!, setHUD);
    game.current = instance;
    return () => { instance.dispose(); game.current = null; };
  }, []);
  const phase = hud.progress >= .55 ? "DEMOLITION" : hud.progress >= .25 ? "WALL HUNTER" : "STALKER";
  const time = `${pad(Math.floor(hud.elapsed / 60))}:${pad(Math.floor(hud.elapsed % 60))}`;
  const touch = (key: string, down: boolean) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault(); if (down) e.currentTarget.setPointerCapture(e.pointerId); game.current?.touch(key, down);
  };
  const touchButton = (key: string, label: string, symbol: string) => <button aria-label={label} onPointerDown={touch(key,true)} onPointerUp={touch(key,false)} onPointerCancel={touch(key,false)} onLostPointerCapture={() => game.current?.touch(key,false)}>{symbol}</button>;

  return <main className={`game-shell mode-${hud.mode}`}>
    <canvas ref={canvas} className="world" aria-label="First person maze. Use W A S D to move, arrows to turn, shift to sprint, space to fire."/>
    <div className="grain" aria-hidden="true"/>
    <header className="topbar">
      <a className="wordmark" href="/" aria-label="Cheese home">C<span>H</span>EESE<span className="version"> / II</span></a>
      <div className="sector"><span className="status-dot"/> UNDERGROUND RESEARCH FACILITY <span className="sector-number">// SECTOR 09</span></div>
      <div className="top-actions"><button className="icon-button" onClick={() => game.current?.toggleMute()} aria-label={hud.muted ? "Unmute audio" : "Mute audio"} title="Toggle audio [M]"><Speaker muted={hud.muted}/></button>{hud.mode === "playing" && <button className="icon-button pause-button" onClick={() => game.current?.pause()} aria-label="Pause game" title="Pause [P]"><svg width="14" height="16" viewBox="0 0 14 16" aria-hidden="true"><path d="M3 2v12M11 2v12" stroke="currentColor" strokeWidth="2"/></svg></button>}</div>
    </header>

    <div className="in-game" aria-hidden={hud.mode !== "playing"}>
      <div className="objective"><span className="micro">CURRENT OBJECTIVE</span><strong>FOLLOW THE HUNGER.</strong><span className="objective-line">Collect cheese. Avoid becoming dinner.</span></div>
      <div className="predator"><span className="micro">PREDATOR ADAPTATION <b>{Math.round(hud.progress * 100)}%</b></span><div className="progress-track"><i style={{width:`${hud.progress*100}%`}}/></div><span className="phase"><span className="status-dot"/> {phase}</span></div>
      <div className={`crosshair ${hud.weapon === "ready" ? "armed" : ""}`} aria-hidden="true"><i/><i/><i/><i/></div>
      <div className="game-message" role="status">{hud.stun > 0 ? `PREDATOR DOWN // ${hud.stun.toFixed(1)}s` : hud.hint || hud.message}</div>
      <div className="map-panel"><span className="micro">LOCAL SCAN <span>21 × 21</span></span><canvas ref={map} width="168" height="168" aria-label="Maze map: white is you, amber is cheese, red is the nearby cat."/><div className="map-caption"><span className="status-dot"/> {hud.threat > .65 ? "CONTACT IMMINENT" : hud.threat > .2 ? "MOVEMENT DETECTED" : "SCANNING"}</div></div>
      <div className="bottom-hud">
        <div className="vital hud-cell"><span className="micro">VITAL SIGNS</span><div className="lives" aria-label={`${hud.lives} lives remaining`}>{[0,1,2].map(i=><span key={i} className={i<hud.lives?"alive":"lost"}>♥</span>)}</div><span className="hud-detail">{hud.lives} / 3 LIVES</span></div>
        <div className="score hud-cell"><span className="micro">SCORE</span><strong>{pad(hud.score,6)}</strong><span className="hud-detail">{pad(hud.cheese)} CHEESE RECOVERED</span></div>
        <div className="threat-meter hud-cell"><span className="micro">THREAT LEVEL</span><div className="threat-bars">{Array.from({length:20},(_,i)=><i key={i} className={i/20<hud.threat?"lit":""}/>)}</div><span className="hud-detail">{hud.threat > .65 ? "RUN. NOW." : hud.threat > .2 ? "YOU ARE BEING HUNTED" : "NO VISUAL CONTACT"}</span></div>
        <div className="ammo hud-cell"><span className="micro">{hud.weapon === "hidden" ? "EQUIPMENT" : "M-01 BLASTER"}</span><strong>{hud.weapon === "hidden" ? "—" : hud.weapon === "ready" ? "01" : "00"}<small>{hud.weapon !== "hidden" && " / 01"}</small></strong><span className="hud-detail">{hud.weapon === "hidden" ? "KEEP SEARCHING" : hud.weapon === "ready" ? "[ SPACE / CLICK ] FIRE" : "CHAMBER EMPTY"}</span></div>
      </div>
      <div className="run-clock">RUN {pad(hud.cheese+1)} <span>/</span> {time}</div>
      <div className="touch-controls"><div className="touch-pad">{touchButton("ArrowLeft","Turn left","↶")}{touchButton("KeyW","Move forward","↑")}{touchButton("ArrowRight","Turn right","↷")}{touchButton("KeyA","Strafe left","←")}{touchButton("KeyS","Move backward","↓")}{touchButton("KeyD","Strafe right","→")}</div><div className="touch-actions">{touchButton("ShiftLeft","Sprint","RUN")}<button onClick={()=>game.current?.interact()}>USE</button><button onClick={()=>game.current?.fire()}>FIRE</button></div></div>
    </div>

    {hud.mode === "start" && <section className="intro overlay">
      <div className="intro-main"><div className="eyebrow"><span/> A FIRST-PERSON SURVIVAL NIGHTMARE</div><h1>CHEESE<span className="title-period">.</span></h1><div className="title-rule"><span>SMALL PREY. BIG PROBLEM.</span><span>VOL. 02</span></div><p className="intro-copy">You’re a mouse in a maze.<br/>Something bigger is learning your way out.</p><button className="start-button" onClick={()=>game.current?.start()}><span>ENTER THE MAZE</span><span aria-hidden="true">↗</span></button><div className="sound-note"><Speaker muted={false}/> ORIGINAL THRASH METAL SCORE <span>·</span> SOUND RECOMMENDED</div></div>
      <aside className="briefing"><div className="briefing-header"><span className="micro">SURVIVAL PROTOCOL</span><span className="file-number">FILE / 009</span></div><div className="protocol"><span>01</span><div><h2>FEED THE INSTINCT.</h2><p>Find the cheese. Keep moving.<br/>You have three lives to lose.</p></div></div><div className="protocol"><span>02</span><div><h2>FEAR THE LEARNING.</h2><p>It stalks. It vaults. It tears down walls.<br/>The maze won’t stay the way you left it.</p></div></div><div className="protocol"><span>03</span><div><h2>FIND THE EQUALIZER.</h2><p>A secret hides a single shot.<br/>Five seconds of mercy. Use them.</p></div></div><div className="controls-guide"><div><kbd>W A S D</kbd><span>MOVE / STRAFE</span></div><div><kbd>MOUSE / ← →</kbd><span>LOOK / TURN</span></div><div><kbd>SHIFT</kbd><span>SPRINT</span></div><div><kbd>E</kbd><span>SEARCH SECRET</span></div><div><kbd>CLICK / SPACE</kbd><span>FIRE</span></div><div><kbd>ESC / P</kbd><span>PAUSE</span></div></div><div className="briefing-foot"><span className="status-dot"/> NOTHING HERE STAYS SAFE.</div></aside>
      <footer className="intro-footer"><span>BUILT FOR THE CHASE.</span><span className="footer-warning">⚠ LOW LIGHT · FAST MOVEMENT · LOUD COMPANY</span><span>BEST <b>{pad(hud.best,6)}</b></span></footer>
    </section>}

    {hud.mode === "paused" && <section className="pause-overlay overlay"><div className="dialog"><span className="eyebrow">SIGNAL HELD // {time}</span><h1>STILL<br/>BREATHING.</h1><p>The hunt resumes when you do.</p><button className="start-button" onClick={()=>game.current?.start()}><span>BACK TO THE HUNT</span><span>↗</span></button><div className="pause-controls"><kbd>WASD</kbd> move <kbd>MOUSE / ARROWS</kbd> look <kbd>SHIFT</kbd> sprint<br/><kbd>E</kbd> search <kbd>SPACE</kbd> fire <kbd>M</kbd> audio</div></div></section>}
    {hud.mode === "dead" && <section className="death-overlay overlay"><div className="dialog"><span className="eyebrow"><span/> END OF THE FOOD CHAIN</span><h1>DINNER<br/>IS SERVED.</h1><p>The maze remembers. Start a new hunt.</p><div className="death-stats"><div><span className="micro">FINAL SCORE</span><strong>{pad(hud.score,6)}</strong></div><div><span className="micro">CHEESE</span><strong>{pad(hud.cheese)}</strong></div><div><span className="micro">SURVIVED</span><strong>{time}</strong></div></div><button className="start-button" onClick={()=>game.current?.start()}><span>RUN IT BACK</span><span>↗</span></button><div className="sound-note">PERSONAL BEST / {pad(hud.best,6)}</div></div></section>}
  </main>;
}
