# Mystical Armies

A 2D auto-battle strategy game. Two armies of 25 units are placed secretly, then fight
automatically for up to 90 seconds. Built with **Phaser 3**, **Vite** and **TypeScript**.

**Current status: Phase 1**: simulation core plus a watchable test battle on Open Plains.

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
