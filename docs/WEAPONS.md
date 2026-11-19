# The weapons (branch `companion`, 2026-11-19)

The user: "in Blender create a gun and a Japanese katana and put it somewhere in ruins and show it in maps. I need
pistols and sniper and a normal AK-47. Make sure this is available in co-op too so players can kill each other. First
make physics md files for each gun and katana, and using that make those. Make sure fire rate matches our tick rate.
Zoom in / out for the sniper like in CS:GO. For the katana, abilities like fire, thunder on it based on the type of
katana; you carry one type at a time and turn the ability on with a key, like in Genshin Impact. On mobile a key as
well. While using the katana you can't use a gun — one weapon at a time. Switch with the Q wheel: two small buttons
under the wheel, one is settings, the second is weapon — click weapon and it shows the collected weapons to choose in
the wheel." Then: "add animation and proper movements."

## The spec files (written first — the game's numbers come out of them)

| file | weapon |
|---|---|
| `weapons/PISTOL.md` | the 9 mm service pistol |
| `weapons/AK47.md` | the AK-47 (7.62 × 39 mm) |
| `weapons/SNIPER.md` | the bolt-action sniper rifle (.338) |
| `weapons/KATANA.md` | the katana and its two kinds: the fire blade, the thunder blade |

Each file ends in a fenced `json` block: **the numbers the game reads**. `node scripts/oth/weapons.mjs` (in
`frontend/`) collects those blocks into `proto/weapons.json`, which the game (`frontend/src/oth/weapons.ts`) and the
server (`backend/src/weapons.rs`) both load — one set of numbers, the spec's. Change a number in the `.md`, run the
script.

## The rules they share

- **The tick.** The server runs at **20 Hz: one tick = 50 ms** (`backend/src/world.rs`). Every time in a spec is a
  whole number of ticks — the fire interval, the reload, the draw, the bolt, a slash's windows, an ability's length and
  its cooldown — so the client, the server and every other player's view agree on when a shot or a cut may happen.
  The client counts ticks off the same clock it sends poses on.
- **Health.** 100. A hit takes `damage × zone × falloff`. Zones: head, body, limbs (by the height of the hit on the
  capsule — the character is 1.80 m: head ≥ 1.52 m, limbs ≤ 0.90 m). At 0: down, out for 5 s, then back at the last
  camp (or the spawn) with 100; the weapons are kept.
- **A bullet's flight** (the guns): a point mass with gravity (9.81 m/s²) and a drag that goes with v² —
  `v(x) = v₀ · e^(−k·x)`, `t(x) = (e^(k·x) − 1) / (k · v₀)`, the drop `½ · g · t²`. Flown by the shooter's game each
  frame in straight pieces (a ray per piece against the land, the solid things, the players); the hit is what the
  shooter saw (the server checks it: see below). Damage falls with the energy the bullet keeps, `e^(−2·k·x)`, never
  under the spec's `floor`.
- **One weapon in the hands**: fists, the pistol, the AK-47, the sniper rifle or the katana. Changing takes the new
  one's `draw`. In a vehicle: none (put away when you get in).
- **The wheel (Q)**: two small buttons under the ring — ⚙ the actions (as before), ⚔ the weapons you've found; a sector
  picks one.
- **Keys** (on foot): `J` / left mouse — fire, slash (fists: punch); `U` / right mouse — the sniper's scope (off → ×1
  → ×2 → off; the mouse wheel steps it in and out), the katana's heavy cut (fists: kick); `R` — reload; `I` — the
  katana's ability. Phones: FIRE, AIM, RELOAD, ABILITY buttons by the right thumb.
- **Found in the ruins** — ten of them, each marked on the map and the minimap by what lies there: walk up to it, `E` takes it. A
  weapon is yours for good (kept with the save); its site gives ammunition again every 5 minutes.
- **Co-op**: everyone sees what you hold and your shots. A hit is an intent to the server (`hit`: who, which weapon,
  the zone, the distance); the server takes it only if that weapon's fire interval has passed since your last, the
  distance is within its range and the target's pose is within 3 m of where you said — then it takes the health off,
  tells everyone, and counts the kill. Solo: the same rules against the enemy (`Companion.ts`).

## The order of work, and where it stands (2026-11-19, the evening)

| # | step | state |
|---|---|---|
| 1 | the four spec files, `weapons.mjs` → `proto/weapons.json` | **done** |
| 2 | the models in Blender (`scripts/oth/weapons.py` → `assets/models/weapons/*.glb` + `weapons.meta.json`) | **done** — pistol 356 triangles, AK-47 588, sniper 1028, each katana 744; 25–65 kB a file |
| 3 | the katana's clips in Blender (`scripts/oth/fight.py`: `katana_idle`, `katana_draw`, `cut1` `cut2` `cut3`, `cut_heavy`, `katana_wake` — in `fight.glb`, 264 kB with the fists') | **done** |
| 4 | in the hand, aiming, the bullet's flight, the scope, the cuts — solo, against the enemy (`src/oth/Weapons.ts` `Arsenal`) | **done** — `scripts/harness/weapons.mjs` (15 checks; `KATANA=thunder` the other blade) |
| 5 | the katana's abilities: the fire (the burning, the wave), the thunder (the arc, the stun, the bolt) | **done** — their look is plain glowing boxes: see below |
| 6 | the pick-ups in the ruins, on the map and the minimap (`Weapons.ts` `Pickups`) | **done** — `scripts/harness/pickups.mjs`; kept in `localStorage` (`overhill.weapons.v1`, `overhill.weaponsites.v1`) |
| 7 | the wheel's two buttons (`Wheel.ts`: keys 1 / 2 too); the phone's buttons (FIRE / AIM · SCOPE · HEAVY / RELOAD · WAKE) | **done** — the phone's buttons are not yet tried on a phone |
| 8 | co-op: the wire (`proto/wire.json`), the server's check, health, kills, the others seen armed | **not started** |
| 9 | each step's cost per tier | measured on the PC only — below |

### How it's made (for whoever goes on)

- **A gun is not in a clip.** `Arsenal.placeGun` stands it before his chest, tipped to where the camera looks, and
  bends both wrists onto it (`Character.handIK` — the driver's-hands IK, in the world); the kick, the lowering as it's
  drawn, the left hand's trip to the belt on a reload are a few lines there. He faces where he aims and the keys strafe
  (`Character.aimYaw`); the chase camera sits over his right shoulder (`ChaseCam.side`, `aimHold`).
- **The katana is in the clips**: `fight.py` turns his right hand to the blade's direction and its edge's
  (`blade=(d, m)`), the game fixes the sword to that hand's bone (`Arsenal.placeSword` — the same quarter turn as
  `fight.py`'s `SWORD_REST`) and bends the left wrist under it.
- **The scope** is first person with the lens `Arsenal.scopeFov` (main.ts `weaponView`, `fovWant`), the glass a CSS
  overlay.
- **Whoever can be hit** is a `Target` (`ArsenalHost.targets()`): today only the enemy (`Companion.targets()`). Co-op's
  players go in the same list.
- `?weapons=all&katana=fire|thunder` has everything for a test (nothing kept); `?weaponsites=0` no pick-ups.

### What it costs (2026-11-19 — `scripts/harness/companioncost.mjs`, an M-series Mac, tier LOW; JS only)

| state | the companion + the weapons, ms a frame |
|---|---|
| in the car (he rides with you / follows) | 0.18 – 0.23 |
| on foot, he walks beside you / comes at you | 0.22 – 0.30 |
| the AK-47 firing | 0.34 – 0.37 |
| the katana cutting | 0.25 – 0.27 |
| nothing in the hands, no companion | ~0.004 (the pick-ups' scan) |

Draws: the companion one (skinned, 17 k triangles) + his car's three and its shadow; a weapon one; a pick-up two (only
the nearest site within 150 m). `npm run shot` A/B at the phone's viewport, tier LOW, uncapped: on and off within the
noise. **Not measured on a phone**: a Snapdragon 6-series runs this JS some 6–8× slower — 1 to 3 ms of its 16.7 — to be
checked there (`npm run dev:lan`). Nothing is made each frame (the vectors and matrices are kept); his skeleton is
posed by distance as the co-op players' are; the fight's clips and the weapons' models load only when first used.

### What's left, and what bites

- **Co-op (step 8)**: nothing of it. The plan is in "The rules they share" above: a `hit` intent the server checks
  against `proto/weapons.json` (the fire interval in ticks, the range, the target's pose), health and kills as events,
  the weapon held as part of `ride`-like state so `Remotes.ts` can draw it (`weaponModel` + the same `placeGun`).
  `proto/wire.json` changes must pass `cargo test --test golden` and `npm run test:wire`.
- **No sound** for any of it (shots, cuts, hits) — `Audio.ts` has no one-shot voice yet.
- **The abilities' look** is glowing boxes (the wave's front, the bolt, its flash): no flames, no arcs along the
  blade, no singed grass — the spec's "on the land" row is not done.
- **The enemy has no weapons**: he fights with his fists and his car only.
- **Zones**: a bullet's zone is by height on a standing capsule — a man down or doubled over is still hit as standing.
- **Death**: the spec's "down, out for 5 s, back at the camp" is not there — the enemy is knocked down and gets up; you
  are only knocked down by his fists and his car.
- **Running with a gun** plays the forward run whichever way he goes (no strafe clips); the reload has no clip.
- **The scabbard** isn't modelled; the katana appears in the hand.
- The pick-ups are laid for the world the game starts in; a crossing to another world doesn't lay its own.
- `scripts/harness/prodcheck.mjs` has not been run for the new `.glb` paths (the production build itself passes).
