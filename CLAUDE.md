# Mystical Armies — notes for Claude

A 2D top-down auto-battle strategy web game (Phaser 3 + Vite + TypeScript), later to be
packaged for Android/iOS with Capacitor. Read this file first in every session.

## Working with the owner

- The owner is an amateur developer with little game-dev experience. Explain things in
  plain language, give exact step-by-step commands (they use **Windows** and `cmd`), and
  say exactly what to test after each change.
- Build **one phase at a time**; don't start the next phase until the owner has tested the
  current one and said "continue". Small fix requests between phases are normal.
- If a requirement is unclear or conflicts with another, **ask** instead of guessing.
- Keep **all balance numbers in `src/config/gameConfig.ts`** so they can be tuned without
  touching logic. Placeholder coloured shapes until real art is requested.
- All interaction must work with touch and mouse (no hover-only / keyboard-only controls,
  finger-sized buttons). Landscape, fixed logical size scaled to fit.

## Commands

```
npm install            # once after cloning
npm run dev            # play at http://localhost:5173
npm test               # Vitest: determinism, rules, orders, army setup
npm run typecheck
npm run build          # production build into dist/
npm run build:single   # whole game as ONE file: release/mystical-armies.html (double-click to play)
npm run sim -- 42      # one headless battle with seed 42
```

Before committing: `npm run typecheck && npm test && npm run build` must all pass.
Pushing to branch `claude/mystical-armies-game-savq1k` (the repo's default branch) auto-deploys
to GitHub Pages: https://livredslot.github.io/Claude/ (workflow `.github/workflows/deploy.yml`).

## Architecture (important)

- `src/sim/` = **pure deterministic simulation**. No Phaser, no DOM, no timers, no
  `Math.random()`. Integer maths only (positions in sub-tiles: 1 tile = 1000; HP in
  centi-HP: 1 HP = 100), exact `isqrt`, seeded mulberry32 RNG, stable iteration order.
  20 ticks/s. `battle.stateHash()` fingerprints the state (used by tests, later P2P desync
  checks). Must stay runnable headless and fast (≈0.1 s per 102-unit battle).
- Fairness: unit IDs interleave teams; which team moves first each tick comes from the RNG;
  damage/heals are collected and applied at the end of the tick. Mirrored armies must win
  ~50/50 — check this after any movement/targeting change.
- Player **orders** during battle (`issueCommand`) are recorded with their tick in
  `commandLog`, so replays (and later P2P) re-issue them exactly (`applyRecordedCommands`).
- `src/config/gameConfig.ts` → compiled to integers in `src/sim/compiledConfig.ts`.
- `src/game/armyDraft.ts` = army being built on the setup screen (groups, auto-place,
  presets); `src/scenes/` = Phaser scenes (Menu, Setup, Battle); `src/ui/` = shared UI.
- `src/data/` = maps and the hard-coded demo/practice armies.

## Current game rules (as decided with the owner)

- **Armies:** 10 **groups of 5** identical soldiers (50) + **1 King** = 51 units per side.
  Max 1 group of Medics, max 1 group of Mages; other types up to 10 groups.
- **Setup screen:** step 1 choose number of groups (+/−); step 2 place each group as a
  **vertical line of 5** in the 6-column deployment zone (tap to place; tap a group then a
  spot to move; tap another group to swap; drag works too). Stances: **Advance** or
  **Flank** (per group or all groups). Auto-place, Clear, Save/Load (browser storage).
  **PvP: 60 s** to build the army (auto-completed when time runs out); **vs AI: no limit**.
- **Battle:** max **60 seconds**. If a **King dies, its side loses immediately**. If both
  Kings are alive at 60 s: the King with more HP (% of max) wins; equal HP = draw.
- **Targeting:** every unit simply attacks the **nearest enemy** (no automatic priorities —
  the owner removed fighting-back, defend-the-King, Horseman/Spearman preferences and
  King-hunting on purpose). Retarget every 1 s or when the target dies.
- **King:** HP 200, dmg 25, speed 0.6 (slowest); follows ~3 tiles behind its army's centre;
  only fights enemies within 3 tiles (attacks if it is the last unit). Ignores stances.
- **Medics:** heal 6 HP/s to the most injured ally within 3 tiles (max 2 Medics per ally),
  follow the army (not the King), stay behind the front line, only swing back if hit.
- **Mage:** 3 s cast, blast aimed where it hits most enemies; melee damage interrupts it.
- **Horseman speed is 1.7** (owner's choice). Other stats: see `gameConfig.ts`.
- Allies don't block each other (fast units pass through their own army); enemies do.
- **Battle orders (bottom bar):** **Auto** (nearest enemy) · **Attack King** (everyone goes
  for the enemy King) · **Keep Formation** (army marches as one block at the slowest unit's
  speed keeping the placed shape; a unit breaks off when an enemy is within 3 tiles, or
  within its range for ranged units, or when hit). **Tap an enemy** = whole army focuses it
  (tap again to cancel). Orders override stances.
- The opponent is still the fixed practice army `TEST_ARMY_RED` until the AI (Phase 5).

## Phase plan and status

1. ✅ Project setup + simulation core
2. ✅ Deployment (plus King, groups of 5, battle orders, 60 s rules — all added by the owner)
3. ⏳ **NEXT: Terrain and maps** — Flat / Mountain / Deep water / Shallow water, terrain
   effects, A* pathfinding, 5 mirror-symmetrical maps (Open Plains, River Crossing,
   Twin Peaks, Mountain Pass, Lake Valley), map select
4. Formation mechanics — facing, flanking bonus (+30% side / +60% behind), line bonus,
   Horseman charge; `npm run balance` script
4b. **Team battles (3v3 / 4v4)** — owner wants this; recommended right after Phase 4 so the
   AI and P2P are built for teams. Open questions to ask then: lose when ALL Kings or ANY
   King dies? army size per player (performance/map size)? deployment per player? who
   commands orders?
5. AI Easy & Medium + main menu/results polish (AI should also use battle orders)
6. Elements (Fire > Air > Earth > Water > Fire) with passives and Mage specials
7. AI Hard (headless search in a Web Worker + learning from last 5 battles)
8. P2P (PeerJS rooms, commit–reveal of setups, desync check; battle orders must be sent and
   applied on the same tick on both devices)
9. Polish & mobile (replays, sound hooks, PWA, zoomed placement view for phones)
10. Native apps with Capacitor

The original full specification is in the first message of the project; the rules above
override it wherever they differ (e.g. 60 s battles, 51-unit armies, no Hold stance).
