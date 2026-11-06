# CHEESE // No Safe Corners

A Doom-inspired, first-person cat-and-mouse survival game. Collect cheese, survive three lives, and find the hidden M-01 blaster before the predator adapts.

## Run

Requires Node.js 20.9 or newer.

```sh
npm install
npm run dev
```

Open http://localhost:3000 or `/play/cheese-doom`. Existing `/play` links redirect to the new slug. For production, run `npm run build` then `npm start`.

## Controls

| Action | Controls |
| --- | --- |
| Move / strafe | W A S D |
| Look / turn | Mouse while locked, or left / right arrows (Q also turns left) |
| Forward / backward | Up / down arrows |
| Sprint | Shift |
| Search secret | E, near the scratched blaster symbol in a dead end |
| Fire | Left click while locked, or Space |
| Pause | Esc, P, or pause button |
| Mute | M or speaker button |

Touch devices have movement, turn, sprint, use and fire buttons; drag the scene to look. Click **Enter the Maze** to unlock audio and mouse look. If a browser refuses pointer lock, the keyboard remains usable. Losing focus pauses the hunt.

## The hunt

- Movement uses elapsed time, acceleration and circular collision with wall sliding; running reaches 5.2 cells/second and sprinting reaches 7.2. Diagonals are normalized.
- The camera-plane DDA raycaster uses perpendicular depth and unclipped texture coordinates. Floor and ceiling textures are anchored in world space. Render buffers are reused at a bounded internal resolution.
- The cat continuously navigates the maze. Time, cheese and lost lives increase adaptation. At 25% it can telegraph and vault walls; at 55% it predicts movement and can tear out interior walls. Debris and changes to the minimap reveal permanent passages. Boundary walls remain intact.
- A reachable dead end hides the blaster. Search near its subtle symbol to reveal it. There is **one shot per entire run**, including all three lives. Aim at the cat within ten cells and with clear line of sight: a hit explodes into debris, disables capture and freezes the cat for **five simulation seconds**. Missing spends the shot too. Pausing freezes the countdown. A new run resets the weapon and maze.
- Three captures end the run. Respawns preserve the changing maze; your best completed score is saved locally when storage is available.

## Validation

```sh
npm run typecheck
npm test
npm run test:browser
npm run build
```

Browser tests use system Chromium when installed at `/usr/bin/chromium`; otherwise run `npx playwright install chromium` once. Simulation tests cover connected mazes, perspective-correct rays, refresh-rate consistency, five-second stun, vaulting and permanent demolition. Browser tests exercise the actual modules, weapon restrictions, collision, pause and restart, plus the rendered page and touch controls.

## Assets and audio

- The feral cat is original generated artwork bundled at `public/cheese-doom/assets/feral-cat.png`, with eight locally animated frames and an original procedural fallback. No third-party cat license or asset host is needed.
- Original procedural score: 184 BPM thrash-metal power chords, bass, and drums synthesized with Web Audio; no external recordings. Threat increases the double-kick intensity. All sound effects are synthesized too. Audio starts only after interaction, and supports mute, pause and cleanup.
- Barlow Condensed and IBM Plex Mono are bundled locally under the SIL Open Font License. License notices are in `public/cheese-doom/fonts/`.
- Textures, cheese, weapon and effects are drawn locally. Gameplay requires no external services.

The root `page.tsx` remains the game component so it can also be integrated into an existing Next.js App Router project; copy its `game/` modules, stylesheet, and `public/` assets with it.

## Integrate with julianyanes.com

The live portfolio is a separate Next.js/Vercel project. Its Sky Arcade Cheese selector and **Board Ride** button currently link to `/play`. Install this version into the portfolio checkout with:

```sh
node scripts/integrate-site.mjs /absolute/path/to/portfolio-repository
```

The installer adds `/play/cheese-doom`, gives `/play` a server redirect to that route, and bundles the game below the new route with scoped CSS and `/cheese-doom/` assets. It changes only the existing `app/play/page.tsx`, the new `app/play/cheese-doom/` directory, and `public/cheese-doom/` (or `src/app/` for a source-directory project). It leaves the portfolio homepage, navigation, layout, typography, metadata, dependencies, domain, and deployment configuration intact.

Review the portfolio diff and run its own checks/build before pushing the branch used by Vercel. Updating this game's repository alone does not deploy the separate portfolio repository.
