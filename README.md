# overhill

An off-road exploration game for the browser — drive a G500 4×4² or an E30 M3 through an autumn valley: rivers,
waterfalls, cabins, fire lookouts, hidden places. Three.js + Rapier, TypeScript, Vite; runs on ₹15k phones and laptops.

```
frontend/   the game (Vite + TypeScript + three + Rapier)   → frontend/README section below, docs/ARCHITECTURE.md
backend/    the server (Rust: multiplayer rooms + save API)  → coming next
docs/       ARCHITECTURE.md (the world, the renderer, the front end, the saves)
```

## Frontend

```sh
cd frontend
npm install
npm run dev        # http://localhost:5200
npm run dev:lan    # the same on your Wi-Fi (test on a phone)
npm run typecheck && npm test && npm run build
npm run shot -- <outdir> <shots.json>   # headless screenshots + fps per tier (needs npm run dev and Google Chrome)
```

Map baking (Blender + Node): `frontend/scripts/oth/terrain.py`, `scenery.mjs` → `frontend/public/oth/valley/`.
