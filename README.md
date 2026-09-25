# Mystical Armies

A 2D auto-battle strategy game. Two armies of 25 units are placed secretly, then fight
automatically for up to 90 seconds. Built with **Phaser 3**, **Vite** and **TypeScript**.

**Current status: Phase 1 + King + army setup screen.**

- **King:** every army has exactly 1 King (part of the 25). If your King dies, you lose immediately.
  The King follows a few tiles behind its army; Medics follow the army itself.
  Every unit simply fights the nearest enemy; only the player's orders change that.
- **Battle orders:** "Auto" (fight the nearest enemy), "Attack King" (everyone goes for the enemy King)
  or "Keep Formation" (the army marches as a block in the shape you placed it; units break off when they
  find a target). Tap any enemy to make your whole army focus it. Orders are recorded, so replays repeat them.
- **Stances** (set per unit or for all units on the setup screen): Advance or Flank.
- Units walk through their own army, so fast units aren't stuck behind slow ones.
- **Army setup:** Step 1 picks how many of each unit (+/−, total 25); Step 2 places them by
  tapping or dragging in your deployment zone, with stances, Auto-place, Save/Load.
  PvP gives you 60 seconds (missing units are auto-filled when time runs out); vs AI has no limit.
- The opponent is a fixed practice army until the AI (Phase 5) and online PvP (Phase 8) are built.

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
    compiledConfig.ts    Turns config numbers into integers (sub-tiles, centi-HP, ticks)
    fixed.ts             Integer maths helpers
    rng.ts               Seeded random generator (mulberry32)
    army.ts              Army validation (25 units, caps, deployment zone)
  data/                  Maps and the hard-coded Phase 1 test armies
  game/armyDraft.ts      Army being built on the setup screen: counts, auto-place, presets
  scenes/MenuScene.ts    Start menu
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
