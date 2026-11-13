# overhill — agent notes

| folder | what |
|---|---|
| `frontend/` | the game: Vite + TypeScript + three r186 + Rapier (`src/oth/` the world, `src/ui/` the menus, `src/main.ts` entry) |
| `backend/` | the server (Rust): multiplayer rooms + save API — the client uses localStorage until it switches over |
| `proto/wire.json` | the game ↔ server wire, one schema both read (`backend/src/wire.rs`, `frontend/src/net/wire.ts`); a change must pass `cargo test --test golden` (`GOLDEN=update` to rewrite) and `npm run test:wire` |
| `docs/ARCHITECTURE.md` | read first: the world, the renderer, the front end, the saves |
| `docs/MULTIPLAYER.md` | **the shared valley: claim land, gather, haul, build, raid — the plan and its order; the server's API in `backend/README.md`** |
| `docs/NEXT.md` | **the hand-off (2026-11-10): the garage, the 12 km valley and its outland, the flat look — what's done, what's next, what bites** (the one before, places and caves: `docs/NEXT_caves.md`) |
| `docs/NEXT_outland.md` | **what's left out in the outland (2026-11-12, round 3 — done: `NEXT.md` §11 the Wardens' secrets, §12 the dirt roads' mires, §13 the rally stages out + the hidden vales + the rest): the phone, a real window, the secrets' rewards, the mires' depth and spray** |
| `docs/DESERT_MATCH.md` | **matching Over the Hill's desert: the 0–100 score method (`scripts/oth/compare.py`), the loop, the content + terrain checks** |
| `docs/LOOK.md` | **the look (2026-11-13): the warm height haze that hides the far land, the grade, brown tracks, the ruins' masonry + dressing, the ground clutter, the mist — `?look=0` the A/B, the costs** |
| `docs/PERF.md` | **500 fps on the PC, a constant 60 on a Snapdragon 6-series phone at ULTRA: the measurements, the tools, the plan in phases, the log** |
| `docs/VEHICLES.md` | **the garage to build: 21 vehicles (Over the Hill's roster, our own models of the real machines) — each one's real specs, physics, doors and parts** |
| `docs/ASSETS.md` | every model / image / sound not made here: source, author, licence — add a row with each new one |

- Run each side's commands from its own folder (`cd frontend && npm test`).
- Every feature states and measures its cost per quality tier (uncapped 1080p A/B, interleaved, `npm run shot`), and is
  checked visually in headless Chrome (`scripts/shot.mjs`); phones (₹15k) must hold 60 fps.
- No code from DARK beyond what's here (the user, 2026-11-02): this is its own game.
- UI: square edges, condensed upper-case type, near-black panels, the amber accent — GTA-like (`src/ui/menu.css`).
- Saves / settings live in localStorage for now (`src/save.ts`, `src/settings.ts`); keep their shapes in step with the
  backend's API.
