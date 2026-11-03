# overhill — agent notes

| folder | what |
|---|---|
| `frontend/` | the game: Vite + TypeScript + three r186 + Rapier (`src/oth/` the world, `src/ui/` the menus, `src/main.ts` entry) |
| `backend/` | the server (Rust): multiplayer rooms + save API — the client uses localStorage until it switches over |
| `docs/ARCHITECTURE.md` | read first: the world, the renderer, the front end, the saves |
| `docs/NEXT.md` | **the hand-off: the desert + the crossing — what's done, what's next, in order** |
| `docs/DESERT_MATCH.md` | **matching Over the Hill's desert: the 0–100 score method (`scripts/oth/compare.py`), the loop, the content + terrain checks** |
| `docs/ASSETS.md` | every model / image / sound not made here: source, author, licence — add a row with each new one |

- Run each side's commands from its own folder (`cd frontend && npm test`).
- Every feature states and measures its cost per quality tier (uncapped 1080p A/B, interleaved, `npm run shot`), and is
  checked visually in headless Chrome (`scripts/shot.mjs`); phones (₹15k) must hold 60 fps.
- No code from DARK beyond what's here (the user, 2026-11-02): this is its own game.
- UI: square edges, condensed upper-case type, near-black panels, the amber accent — GTA-like (`src/ui/menu.css`).
- Saves / settings live in localStorage for now (`src/save.ts`, `src/settings.ts`); keep their shapes in step with the
  backend's API.
