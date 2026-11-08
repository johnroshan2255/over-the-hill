# overhill — the shared valley: claim, gather, build (the plan, 2026-11-08)

The user (2026-11-08): friends in one valley; **cut trees, mine stone, haul it with the jeep and a trailer, mark a
territory anywhere with a Blender-like dashed round brush, and build on it** — pave stones, a house, a garage, dig a
lake, plant things. Materials come from the land (hills, quarries, the woods) **or from someone else's place**: inside
your territory, while you are there, nobody can take your things; while you are away, they can. **What we build must
look good** — finished-game quality, not the flat-shaded kit the valley's places use today.

The first step is the **server** (Rust, `backend/`). Everything below is the order the rest follows.

## 1. The loop

```
 gather ──► haul ──► stockpile ──► build ──► (defend / raid) ──► gather more
 axe: trees → logs           the trailer        in your claim        the house, garage, paving, lake, garden
 pick: rocks → stone         (40 units)         (unlimited,          the bigger the place, the more it costs
 scrap: the mine, ruins      on foot: 4         stealable when       to keep it stocked
   → metal                                      you're away)
```

- **Materials (v1):** wood, stone, metal. More only if a building needs one (glass, from sand at the river?).
- **Trees:** walk up with the axe → a few swings → the tree falls (a physics body for 4 s, then logs). It is gone for
  everyone in the world; it regrows after a while unless it stood inside someone's claim (they cleared it).
- **Stone:** small stones picked up by hand (1 each); boulders and the quarry faces broken with the pick (they shrink,
  then are gone and come back later). **Metal:** scrap at the mine site, the ruins, the garage.
- **Carrying:** on foot 4 units (a log on the shoulder, stones in hand: you see it). **The trailer:** hitched to the
  jeep's tow ball (a Rapier joint — it swings, it can jack-knife, the winch can pull it out of mud), 40 units, the load
  drawn on it (logs stacked, stones in a crate). Unload at your stockpile.
- **Stockpile:** a visible pile in your claim (log stack, stone heap, scrap crate — it grows with what's in it). The
  builder spends from it.

## 2. Territory

- **The brush** (Blender's): a dashed ring drawn ON the ground (in the terrain shader — no geometry, it follows every
  bump), an inner ring for the falloff. Scroll / `[` `]` resize it, the mouse (or the screen's centre on the chase
  camera) moves it. The same brush is every tool's cursor.
- **Claiming:** the CLAIM tool sets a circle (radius 12–40 m to start, larger as your place grows). A flag pole
  goes up at its centre. It may not overlap another claim; not on a bridge, a road's centre line, the water or a
  named place (the client checks the map; the server checks overlap and size).
- **Guarded:** a claim is guarded while its owner is **inside it**. Then nobody else can take from its stockpile or
  pick up its loose things. When the owner leaves (or goes offline), it can be raided — **stockpiles and loose
  materials only; buildings are never destroyed or taken.** A raid shows on the owner's screen ("ARUN IS AT YOUR
  CAMP") and on the map.
  - *To settle with the user:* does "away" include being offline? The server has the switch (`offline_guard`, per
    world; off by default = the user's rule as stated). A raid cap (take at most half a pile per hour) is the other
    lever, if it gets mean.

## 3. Building

- **Tools (the build wheel, Tab):** CLAIM · BUILD (pieces) · PAVE (stone, gravel, planks — painted into the ground) ·
  SHAPE (raise, lower, flatten, smooth) · WATER (dig a pond: lower + a water surface at the level you set) · PLANT
  (trees, hedges, flowers, a vegetable patch) · REMOVE (half the cost back).
- **Pieces, snapping:** a ghost of the piece follows the brush, green when it fits and you can pay, red when not; R
  rotates (15° steps, Shift free); walls snap to foundations, roofs to walls, doors / windows into wall openings
  (sockets in the kit). Whole prefabs too (a cabin, a garage, a shed) for players who don't want to build piece by piece.
- **The ground:** shaping works on the 2 m height grid inside your claim only; the server keeps the edited heights
  (a delta per cell, cm), the clients rebuild the height texture region, the physics tile and the grass / trees there.
  Paving is a paint layer per claim (the existing `paveTex.ts` surfaces), so a path blends into the ground.

## 4. The look of what's built (the hard requirement)

The valley's places today are code-built (`Kit.ts`: flat-shaded, vertex colours). The building kit is **modelled**:

- **Blender, by script** (`scripts/oth/buildkit.py`, like `caves.py`): every piece with real detail — log walls with
  notched, overhanging corners and visible log ends; stone foundations of individual stones with mortar; timber posts
  with bevels; shingle / tin roofs as geometry with an eave and a ridge cap; windows with frames, mullions and glass;
  doors with planks and iron. Bevelled edges everywhere (no CG-sharp corners). Ambient occlusion baked into the
  vertices. Exported as Draco glTF, three LODs a piece.
- **Materials:** PBR (albedo + roughness + normal) from CC0 scans (Poly Haven / ambientCG: weathered wood, stone,
  shingles, rusted tin) packed into one texture array; 1K on the PC, 512 on phones, KTX2 later. Each source gets its row
  in `docs/ASSETS.md`. Weathering by world-space noise (moss low on the north side, sun-bleached tops) so no two
  walls are the same.
- **Into the land:** foundations sink below the ground, a dirt / trampled ring is painted round them, grass is cut
  under them — no "sticker" (the user's rule for the cave hill applies here too).
- **The renderer:** one instanced draw per piece type per LOD (a whole village is a few dozen draws), lit by the same
  sun, sky light, fog and terrain shadow as everything else; night windows glow like the valley's cabins. The textured
  PBR path in `gfx` (`gltf.ts` `MeshStandardMaterial`) is checked and brought up to the terrain's light first.
- **Cost, measured** (CLAUDE.md): a full base (≈ 300 pieces) in view ≤ +0.3 ms at ULTRA 1080p on the PC and ≤ +2 ms
  on the phone at its tier; screenshots in headless Chrome for every piece and a whole base at noon, dusk, night, rain.

## 5. The server (`backend/`, Rust) — first

- **axum + tokio**: HTTP (accounts, saves, worlds, the build catalogue) and one WebSocket per player in a world.
- **One task per live world** owns its state; clients send intents, the server checks them (distance, ownership,
  cost, guard) and broadcasts the results. **The server decides** what exists (trees cut, stones left, claims, pieces,
  stockpiles, inventories, terrain edits). **Each client drives its own vehicle** (Rapier stays in the browser) and
  sends its pose 20× a second; the server relays every pose to everyone (binary, 36 bytes an entity) and sanity-checks
  speed (no teleports).
- **The map on the server:** it loads `public/oth/<map>/height.bin` + `meta.json`, so it knows the ground (flatten,
  "are you near that tree?", spawn heights) — the same data the client draws.
- **Storage: SQLite** (`overhill.db`): players, saves, worlds, and the worlds' things as rows (claim, piece, drop,
  stump, node, inventory) written as they change; a restart loses nothing.
- **Accounts (v1):** a name and a random token kept in the browser (no passwords yet). `PUT /v1/saves/:player` takes
  `save.ts`'s `Progress` as it is.
- **Worlds:** made by a player (name, map), joined by a 6-letter code; up to 16 players.
- Protocol and API: `backend/README.md`.

## 6. The order

| step | what | done when |
|---|---|---|
| **0 ✓** | **the server** (2026-11-08): accounts, saves, worlds, rooms, poses, the rules (claim / guard / steal / gather / build / shape / pave / ponds), SQLite, tests | done: `cargo test` (9 unit + `tests/flow.rs`: two players over real sockets fell, haul, claim, build, get raided, survive a restart); smoke-run on the real valley's ground |
| 1 | the client joins: `net.ts`, the MULTIPLAYER menu (create / join by code, GTA style), other players' cars, bikes and people drawn and smoothed, name tags, chat | two browsers drive together on the PC and a phone, 60 fps held |
| 2 | gathering: the axe and the pick on foot, trees falling, logs and stones in hand, the trailer hitched to the jeep, its load drawn | a trailer of logs driven from the woods to a stockpile, measured |
| 3 | the brush + claims: the dashed ring in the terrain shader, CLAIM, the flag, the guard / raid notices | claim, leave, a friend raids, come back, they're locked out |
| 4 | **the building kit** in Blender (foundation, log / stone / plank walls, door, window, roof, porch, fence, garage door) + the PBR path + placement and snapping | a cabin and a garage built by hand, shots at noon / dusk / night pass the look check |
| 5 | the ground: SHAPE, PAVE, WATER (ponds), PLANT | a flattened yard, a paved path, a pond with a jetty, a garden |
| 6 | prefabs, more pieces, the map's view of claims, raids' history, balance | — |
