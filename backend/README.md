# overhill server (Rust)

Accounts, saves, and the shared worlds: friends in one valley, claiming land, gathering, hauling, building, raiding
(the plan: `docs/MULTIPLAYER.md`). axum + tokio, SQLite (bundled), one task per live world.

```sh
cd backend
cargo run                    # http://0.0.0.0:5280 — overhill.db here, the maps from ../frontend/public/oth
cargo test                   # unit tests + tests/flow.rs (two players over real HTTP / WebSockets, a restart)
cargo build --release
```

| env | default | |
|---|---|---|
| `OVERHILL_ADDR` | `0.0.0.0:5280` | where it listens |
| `OVERHILL_DB` | `overhill.db` | the SQLite file (WAL) |
| `OVERHILL_MAPS` | `../frontend/public/oth` | `<map>/height.bin` + `meta.json`: the ground the server builds on |
| `RUST_LOG` | `info` | |

CORS is open (the Vite dev server on :5200 calls it); tighten it when it's deployed.

## HTTP

`Authorization: Bearer <token>` on everything but sign-up, `/health` and `/v1/catalog`. Errors: `{ "error": "..." }`.

| | | |
|---|---|---|
| `POST /v1/players` | `{ name }` | → `{ id, name, token }` — keep the token (localStorage); there are no passwords yet |
| `GET /v1/me`, `PATCH /v1/me` | `{ name }` | |
| `GET / PUT /v1/saves/:player` | `save.ts`' `Progress` | your own only; ≤ 64 KB, an object with `v` |
| `GET /v1/catalog` | | materials, carry / trailer capacity, every piece and its cost, paving |
| `GET /v1/worlds` | | the worlds you're in, with `online` |
| `POST /v1/worlds` | `{ name, map: "valley" \| "desert", rules? }` | → the world, with its 6-letter `code` |
| `POST /v1/worlds/join` | `{ code }` | joins (any case) |
| `GET /v1/worlds/:id/ws?token=` | | the world's WebSocket (members only) |

## The world's WebSocket — all binary

Every frame is binary, little-endian. **Poses** are packed by hand (`proto.rs` / the game's `net/pose.ts`); **every
other message** is laid out by one schema both sides read, `proto/wire.json` (`wire.rs` / `net/wire.ts`): `[tag u8]`
then the fields in order — varints for counts and ids, f32 for positions, length-prefixed UTF-8 for strings, a byte
for an enum. `tests/golden.json` pins one of every message as bytes; `cargo test --test golden` and the game's
`npm run test:wire` both check it, so neither side can drift.

```
pose     client → server  [1u8] [n u8] n × ENTITY                                  20/s while moving, 1/s still
poses    server → client  [2u8] [tick u32] [p u8] p × ([sid u16] [n u8] n × ENTITY)
ENTITY (17 B)  [meta u8] [x y z f32] [rotation u32]
  meta      slot (bits 0–1: 0 the player · 1 their car parked while they're out · 2 the trailer)
            | kind (bits 2–4: 0 on foot · 1 the jeep · 2 the E30 · 3 the motorbike · 4 the trailer)
            | bit 5 teleported (no speed check) · bit 6 trailer hitched
  rotation  the quaternion's "smallest three": bits 30–31 the dropped (largest) one, 10 bits each for the rest
```

Each player gets their own poses frame, every 50 ms: the OTHER players whose pose changed since that player last heard
— within 300 m every tick (20 Hz), beyond every 4th (5 Hz); what was last sent is remembered per player, so a far car
still arrives where it stopped. Nobody moved: no frame. A newcomer gets everyone. A pose faster than 90 m/s without
the teleport flag is ignored. The server relays each entity's 17 bytes as they came.

**Intents** (client → server): `[tag] [req varn] fields…` — give a `req` to get `ok {req}` or `err {req, msg}` back
(the message is for the player's screen). The shapes, by name (tags and field order: `proto/wire.json`):

| intent | fields | rule |
|---|---|---|
| `chat` | `text` | ≤ 200 |
| `cut_tree` | `tree` (index in the map's tree list), `x`, `z`, `h` | within 8 m; a pile of 2–6 wood falls there; regrows in 2 h unless it stood in a claim |
| `mine` | `node` (`"rock:<i>"`, `"scrap:<place>"`), `x`, `z`, `size` (1–12) | one stone (metal for scrap) into your hands; worked out → back in 1 h |
| `pick` | `drop`, `to`: `carry` \| `trailer` | as much as fits (hands 4, trailer 40) |
| `drop` | `mat`, `qty`, `from`, `x`, `y`, `z` | put down (merges with a pile within 1.5 m) |
| `deposit` | `claim`, `from`, `bag` `{wood, stone, metal}` | into a stockpile (anyone may give) |
| `take` | `claim`, `to`, `bag` | the owner, or anyone while it's **unguarded** → a `raid` |
| `claim` | `x`, `z`, `r` (12–40) | one each; 4 m clear of others; loose piles inside become yours |
| `unclaim` | `claim` | no buildings left; the stockpile is left on the ground |
| `place` | `kind`, `x`, `y`, `z`, `rot`, `variant` | in your claim; paid from its stockpile |
| `remove` | `piece` (a piece or a pond) | yours; half the cost back |
| `shape` | `op`: `raise` \| `lower` \| `flatten` \| `smooth`, `x`, `z`, `r` (1–12), `strength`, `y` (flatten; null otherwise) | in your claim, ±8 m |
| `pave` | `mat`: `stone` \| `gravel` \| `planks` \| `dirt` \| `erase`, `x`, `z`, `r` (0.5–6) | 1 stone / wood per 8 m² |
| `ride` | `car`: the garage's id of the car the player drives (≤ 24 letters / digits / `_` `-`) — relayed to everyone as the `ride` event (`sid`, `car`); the server keeps none of it: the game says it again when someone joins | — |
| `pond` | `x`, `z`, `r` (3–15), `depth` (0.5–3) | inside your claim; 4 each |
| `ping` | `n` | answered at once with `pong {n}` (the round trip) |

Building, shaping and paving: the player within 40 m of their claim's edge. Taking things: within reach of them
(the trailer's own pose for `trailer`).

**Events** (server → client): `welcome` (you, the world, its whole state, your hands and trailer), `joined`,
`left`, `chat`, `tree_cut`, `tree_back`, `drop`, `drop_gone`, `node`, `node_back`, `inv` (yours), `claim`,
`claim_gone`, `stock`, `guard` `{claim, on}`, `raid` `{claim, owner, by, by_name, bag}`, `piece`, `piece_gone`,
`cells` `{claim, cells: [[i, j, cm]]}` (the 2 m grid's cell, its height change from the map's), `pave`, `pond`,
`pond_gone`, `ok`, `err`, `pong`.

**The guard**: a claim is guarded while its owner is inside it (within its radius + 2 m). With the world rule
`offline_guard`, also while they're offline (off by default: the user's rule — "if we are out they can steal").
Buildings are never taken or destroyed.

## Fast (2026-11-08, measured: `cargo run --release --example load -- <addr> 16 16 30`)

256 players in 16 worlds, each driving (poses 20 Hz) and pinging once a second, server and bots on one Windows
laptop: **round trip p50 1.2 ms, p99 2.4 ms**; every player gets all 20 frames a second; **4.7 KB/s down a
player**; the server **0.5–0.6 of one core** in steady play (mostly the sockets' reads and writes — ~82 k frames a
second each way), **66 MB**. What makes it so: binary frames (a pose 17 B, the rotation in 4), the server relaying
the clients' bytes untouched, a frame per player of only what changed and nothing when nothing did, far players at
5 Hz, TCP_NODELAY (no Nagle delay on small frames), a socket's queued frames written then flushed once, mimalloc,
LTO + one codegen unit, one task per world (no locks in play), SQLite written behind in batched transactions.

**Storage — SQLite (WAL)**: one file, no server to run, transactions; its weak spot (slow single writes, each an fsync)
never shows — a world's changes are coalesced (the last write of a row in 250 ms wins) and committed together.
sled calls itself beta (its README: "use SQLite if reliability matters"), redb is newer still; Postgres earns its
keep only when worlds spread over several machines.

## Inside

- `world.rs` — a live world: its members, poses, things and rules (every intent's checks are here).
- `http.rs` — the HTTP routes and the WebSocket connection.
- `db.rs` — SQLite: players, saves, worlds, members; a world's things as rows `(world, kind, id) → JSON`, written
  behind by a thread (the last write of a row in 250 ms wins).
- `map.rs` — the ground (`height.bin`); `catalog.rs` — materials and costs; `proto.rs` — the poses (by hand);
  `wire.rs` — everything else, by `proto/wire.json`.
- `examples/load.rs` — the load test; `tests/flow.rs` — two players over real sockets; `tests/golden.rs` — the wire.
