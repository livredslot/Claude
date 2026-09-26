# Mystical Armies

A 2D auto-battle strategy game. Two armies (12 groups of 3 soldiers + 1 King = 37 units each)
are placed secretly, then fight automatically for up to 60 seconds. Built with **Phaser 3**, **Vite** and **TypeScript**.

**Current status: terrain and maps, AI opponents (Easy / Medium / Hard) and online PvP.**

- **Play vs AI:** pick a map and a difficulty. Easy builds a random army; Medium picks a sensible army
  style; Hard tests many armies in quick simulated battles on the chosen map (while you build yours) and
  keeps the strongest, and gives smarter battle orders. The AI never sees your army.
- **Play online with a friend:** one player creates a room (and picks the map) and sends the 4-character
  code or the link; the other joins. Both build their army in 60 seconds without seeing each other's,
  then watch the same battle live and give orders. Uses [PeerJS](https://peerjs.com) (its free public
  server only helps the two devices find each other; the game itself goes directly between them).

- **Maps:** Open Plains, River Crossing, Twin Peaks, Mountain Pass and Lake Valley (all mirror-symmetrical),
  picked on the map select screen after the menu.
- **Terrain:** Mountain = slow (35%) but high ground (+25% damage, Archers/Mage +1 range). Deep water = can't
  be crossed (arrows and spells fly over). Shallow water = slow (50%) and −25% damage. Units find their own way
  around obstacles. All numbers are in `TERRAIN` in `src/config/gameConfig.ts`.

- **King:** every army has exactly 1 King (on top of the 12 groups). If your King dies, you lose immediately.
  If both Kings survive the 60 seconds, the King with more HP wins; equal HP is a draw.
  The King follows a few tiles behind its army; Medics follow the army itself.
  Every unit simply fights the nearest enemy; only the player's orders change that.
- **Battle orders:** "Auto" (fight the nearest enemy), "Attack King" (everyone goes for the enemy King)
  or "Keep Formation" (the army marches as a block in the shape you placed it; units break off when they
  find a target). Tap any enemy to make your whole army focus it. Orders are recorded, so replays repeat them.
- **Stances** (set per group or for all groups on the setup screen): Advance or Flank.
- Units walk through their own army, so fast units aren't stuck behind slow ones.
- **Army setup:** Step 1 picks 12 groups of 3 (+/−; max 1 group of Medics and of Mages); Step 2 places
  each group as a vertical line of 3 by tapping (tap a group, then a spot, to move it), with stances,
  Auto-place, Save/Load. Online gives you 60 seconds (missing groups are auto-filled when time runs out);
  vs AI has no limit.
- "Watch a demo battle" shows two fixed practice armies on a random map.

## Getting started

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install        # once: downloads the libraries into node_modules/
npm run dev        # starts the game at http://localhost:5173
```

`npm run dev` also prints a "Network" address (e.g. `http://192.168.1.20:5173`). Open it on a
phone connected to the same Wi-Fi to test on mobile.

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Run the game locally with live reload |
| `npm test` | Run the automated tests (determinism, rules, speed) |
| `npm run sim -- 1234` | Simulate one battle with seed 1234 without graphics and print the result |
| `npm run sim -- 1234 lake-valley` | Same, on another map (`open-plains`, `river-crossing`, `twin-peaks`, `mountain-pass`, `lake-valley`) |
| `npm run typecheck` | Check the TypeScript code for type errors |
| `npm run build` | Build the production version into `dist/` |
| `npm run preview` | Serve the built `dist/` folder locally |
| `npm run build:single` | Pack the whole game into ONE file, `release/mystical-armies.html`, to share (opens by double-click, no install) |

## Project layout

```
src/
  config/gameConfig.ts   ALL balance numbers (HP, damage, speed, ranges, caps...). Tune here.
  sim/                   Pure deterministic simulation: no Phaser, no DOM, no Math.random
    battle.ts            The battle: targeting, movement, attacks, healing, spells, win rules
    terrain.ts           Map tiles, terrain lookups and path-finding around obstacles
    compiledConfig.ts    Turns config numbers into integers (sub-tiles, centi-HP, ticks)
    fixed.ts             Integer maths helpers
    rng.ts               Seeded random generator (mulberry32)
    army.ts              Army validation (12 groups of 3 + King, limits, deployment zone)
  data/                  Maps and the hard-coded Phase 1 test armies
  game/armyDraft.ts      Army being built on the setup screen: counts, auto-place, presets
  ai/armyBuilder.ts      How the AI builds its army (Easy / Medium / Hard)
  ai/commander.ts        The AI's battle orders
  net/session.ts         Online connection (PeerJS room codes, messages)
  net/lockstep.ts        Keeps both players' battles identical (orders applied on the same tick)
  net/commit.ts          Commit–reveal: nobody sees the other army before locking in their own
  scenes/MenuScene.ts    Start menu
  scenes/MapSelectScene.ts  Choose the battlefield (and the AI difficulty)
  scenes/OnlineScene.ts  Create or join an online room
  scenes/SetupScene.ts   Army setup: counts, then placement (timer in PvP)
  scenes/BattleScene.ts  Phaser: draws the battle, HUD, effects, results
  ui/                    Layout constants and the touch-friendly button
tests/                   Automated tests (Vitest)
scripts/sim.ts           Headless battle runner
```

## How the simulation stays deterministic

- Fixed 20 ticks per second; a battle is at most 1800 ticks.
- Positions are integers (1 tile = 1000 units), HP is integer (1 HP = 100 units).
- Only integer-safe maths (no `sin`/`cos`/`pow` in game logic); square roots use an exact integer `isqrt`.
- All randomness comes from a seeded generator; the same seed always gives the same battle.
- Units get IDs in a canonical order, so the order units are listed in doesn't matter.
- `battle.stateHash()` gives a fingerprint of the whole state, used by the tests (and later for P2P desync checks).
