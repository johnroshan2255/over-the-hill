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

## The world's WebSocket

**Binary — poses** (little-endian), 20 a second from each client while it moves:

```
client → server  [1u8] [n u8] n × ENTITY
server → client  [2u8] [tick u32] [n u16] n × ([sid u32] ENTITY)        every 50 ms, everyone's (your own too)
ENTITY (32 B)    [slot u8] [kind u8] [flags u16] [x y z f32] [qx qy qz qw f32]
  slot  0 the player (what they control) · 1 their car, parked while on foot · 2 the trailer
  kind  0 on foot · 1 the jeep · 2 the E30 · 3 the motorbike · 4 the trailer
  flags bit 0 teleported (no speed check) · bit 1 trailer hitched
```

A pose faster than 90 m/s without the teleport flag is ignored.

**Text — intents** (client → server, JSON). Add `"req": n` to get `{ "t": "ok", "req": n }` or
`{ "t": "err", "req": n, "msg": "..." }` back (the message is for the player's screen).

| `t` | fields | rule |
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
| `shape` | `op`: `raise` \| `lower` \| `flatten` \| `smooth`, `x`, `z`, `r` (1–12), `strength`, `y` (flatten) | in your claim, ±8 m |
| `pave` | `mat`: `stone` \| `gravel` \| `planks` \| `dirt` \| `erase`, `x`, `z`, `r` (0.5–6) | 1 stone / wood per 8 m² |
| `pond` | `x`, `z`, `r` (3–15), `depth` (0.5–3) | inside your claim; 4 each |

Building, shaping and paving: the player within 40 m of their claim's edge. Taking things: within reach of them
(the trailer's own pose for `trailer`).

**Text — events** (server → client): `welcome` (you, the world, its whole state, your hands and trailer), `joined`,
`left`, `chat`, `tree_cut`, `tree_back`, `drop`, `drop_gone`, `node`, `node_back`, `inv` (yours), `claim`,
`claim_gone`, `stock`, `guard` `{claim, on}`, `raid` `{claim, owner, by, by_name, bag}`, `piece`, `piece_gone`,
`cells` `{claim, cells: [[i, j, cm]]}` (the 2 m grid's cell, its height change from the map's), `pave`, `pond`,
`pond_gone`.

**The guard**: a claim is guarded while its owner is inside it (within its radius + 2 m). With the world rule
`offline_guard`, also while they're offline (off by default: the user's rule — "if we are out they can steal").
Buildings are never taken or destroyed.

## Inside

- `world.rs` — a live world: its members, poses, things and rules (every intent's checks are here).
- `http.rs` — the HTTP routes and the WebSocket connection.
- `db.rs` — SQLite: players, saves, worlds, members; a world's things as rows `(world, kind, id) → JSON`, written
  behind by a thread (the last write of a row in 250 ms wins).
- `map.rs` — the ground (`height.bin`); `catalog.rs` — materials and costs; `proto.rs` — the wire.
