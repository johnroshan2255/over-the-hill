# overhill — agent notes

| folder | what |
|---|---|
| `frontend/` | the game: Vite + TypeScript + three r186 + Rapier (`src/oth/` the world, `src/ui/` the menus, `src/main.ts` entry) |
| `backend/` | the server (Rust): multiplayer rooms + save API — the client uses localStorage until it switches over |
| `proto/wire.json` | the game ↔ server wire, one schema both read (`backend/src/wire.rs`, `frontend/src/net/wire.ts`); a change must pass `cargo test --test golden` (`GOLDEN=update` to rewrite) and `npm run test:wire` |
| `docs/ARCHITECTURE.md` | read first: the world, the renderer, the front end, the saves |
| `docs/MULTIPLAYER.md` | **the shared valley: claim land, gather, haul, build, raid — the plan and its order; the server's API in `backend/README.md`** |
| `docs/NEXT.md` | **the hand-off (2026-11-10): the garage, the 12 km valley and its outland, the flat look — what's done, what's next, what bites** — §15 (2026-11-14): the narrow ways — paths, shortcuts, secret passages, alleys (`paths.ts`) (the one before, places and caves: `docs/NEXT_caves.md`) |
| `docs/NEXT_outland.md` | **what's left out in the outland (2026-11-12, round 3 — done: `NEXT.md` §11 the Wardens' secrets, §12 the dirt roads' mires, §13 the rally stages out + the hidden vales + the rest): the phone, a real window, the secrets' rewards, the mires' depth and spray** |
| `docs/LOOK.md` | **the look (2026-11-13): the warm height haze that hides the far land, the grade, brown tracks, the ruins' masonry + dressing, the ground clutter, the mist; round 5: four more frames measured — the colour, the tracks' stones and damp, the megaliths, the dressed walls, the forts; round 6: the glowing ground mist, jagged peaks, trodden paths, gates and hoardings — `?look=0` the A/B, the costs** |
| `docs/PERF.md` | **500 fps on the PC, a constant 60 on a Snapdragon 6-series phone at ULTRA: the measurements, the tools, the plan in phases, the log; 2026-11-16: the 1000 fps question — where the frame goes, what went without changing a pixel (it bought nothing), what would cost the look** |
| `docs/NEXT_garage.md` | **the garage's hand-off (2026-11-16, stopped mid-way): free per-car paint, each car's factory colour, the cockpits that work (dials, needles, the gear lever through its gate, the hand to it), the cars' pictures in the garage — what's done, what's checked, what's left** |
| `docs/NEXT_fps.md` | **the fps drops along every way (2026-11-17, stopped mid-way): the harness fit for it (`perfmarks.mjs` SET=all, `hitchprof.mjs`, `leakprof.mjs`), what was fixed (a leak that crashed long drives, the marks' own GPU timing, the crossing's 687 ms build stall); 2026-11-18: the desert deleted (the gate only — the Great Cliff kept); the memory mapped and cut 545 → 320 MB (`heapsnap` / `heapwho.mjs`; lean buffers, released static geometries — `BufferGeometry.releasable`; a lost device reloads the page), what's left and why** |
| `docs/NEXT_companion.md` | **the hand-off for the companion, the enemy and the weapons (2026-11-19; round 2: 2026-11-21): what's left, in order — co-op DONE (§1: `coopfight.mjs`; guns only since the katana went), being killed solo, sound, the enemy armed, the phone (the fps drop the user saw there: not reproduced on the PC)** |
| `docs/COMPANION.md` | **the companion and the enemy (2026-11-19, branch `companion`): the NPC of solo play — SETTINGS › PLAY — who walks, rides and follows, or fights you and rams your car; the fight's clips made in Blender (`scripts/oth/fight.py` — made again 2026-11-21: how a move is written and what makes it move; the user wants these custom, not Mixamo's)** |
| `docs/WEAPONS.md` | **the weapons (2026-11-19; co-op in — `arm` / `shot` / `hit`, the server's `weapons.rs` owns the health): the pistol, the AK-47, the sniper and its scope (a katana was built and, 2026-11-21, removed whole at the user's word) — each one's spec in `docs/weapons/*.md` (the game's numbers come out of them: `node scripts/oth/weapons.mjs` → `proto/weapons.json`), the models and cuts made in Blender, the pick-ups in the ruins, the wheel's weapons — what's done, what's left; round 2 (2026-11-21): held as CS:GO's in first person and GTA's in third, shots on the cross, the scope's detail (`LodEye.ts`), the fps question; round 4: the katana out, the ram by the cars' own boxes, a car left in the air comes down before it is held** |
| `docs/DAMAGE.md` | **car damage, GTA IV's way (2026-11-21, built — not on a phone yet): what GTA IV does (sourced), a crash as the change of velocity that was not the car's own doing, what a blow does (the shell crumpled, glass, lamps, bent axles, tyres, the engine, fire and the blast), the numbers (its json → `node scripts/oth/damage.mjs` → `proto/damage.json`), the pieces made in Blender (`scripts/oth/damage.py`), the costs, what's left; SETTINGS › PLAY › CAR DAMAGE, `?damage=0`** |
| `docs/NEXT_damage.md` | **the hand-off for car damage and the enemy's car on yours (2026-11-21): what's done, what's left in order (the phone first), what bites — your car's CCD off while his is near, the harnesses that fail now and then** |
| `docs/VEHICLES.md` | **the garage to build: 21 vehicles (Over the Hill's roster, our own models of the real machines) — each one's real specs, physics, doors and parts** |
| `docs/ASSETS.md` | every model / image / sound not made here: source, author, licence — add a row with each new one |

- Run each side's commands from its own folder (`cd frontend && npm test`).
- After any map bake that writes a `.bin` (terrain.py, outland.py, wilds.py, walls.mjs), run
  `node scripts/oth/pack.mjs` in `frontend/`: the game downloads the packed `.pk` grids (docs/PERF.md, "The load").
- The first download is measured on the production build: `npx vite build && npx vite preview --port 4173`, then
  `node scripts/harness/download.mjs` (16.5 MB to PLAY, 2026-11-18); the build gzips its .glb / .wasm itself
  (`vite.config.ts`), so check a new model path with `scripts/harness/prodcheck.mjs` too, not only on the dev server.
- Every feature states and measures its cost per quality tier (uncapped 1080p A/B, interleaved, `npm run shot`), and is
  checked visually in headless Chrome (`scripts/shot.mjs`); phones (₹15k) must hold 60 fps.
- No code from DARK beyond what's here (the user, 2026-11-02): this is its own game.
- UI: square edges, condensed upper-case type, near-black panels, the amber accent — GTA-like (`src/ui/menu.css`).
- Saves / settings live in localStorage for now (`src/save.ts`, `src/settings.ts`); keep their shapes in step with the
  backend's API.
