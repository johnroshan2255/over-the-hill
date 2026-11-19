# What's next for the companion, the enemy and the weapons (the hand-off, 2026-11-19)

Branch `companion` (from `look-haze`). What is built and how: `docs/COMPANION.md`, `docs/WEAPONS.md`, the specs
`docs/weapons/*.md`. This file is only **the rest** — in the order I would do it.

## Where it stands

| | |
|---|---|
| the companion (walks, rides, follows by car) | done — `scripts/harness/companion.mjs` |
| the enemy (fists, kicks, knockdowns, rams, runs you down) | done — `scripts/harness/enemy.mjs` |
| the weapons solo (pistol, AK-47, sniper + scope, the two katanas + abilities) | done — `scripts/harness/weapons.mjs` (`KATANA=thunder` for the other blade) |
| the pick-ups in the ruins, the map's marks, the wheel's two buttons | done — `scripts/harness/pickups.mjs` |
| the phone's buttons | written, **never tried on a phone** |
| co-op (players hitting each other) | **nothing yet** |
| sound | **nothing yet** |

Each harness wants `npm run dev -- --port 5200` in `frontend/` first (`PORT=` for another port); they print PASS / FAIL
and write stills to the folder given.

## 1. Co-op: the weapons between players (the big one)

The rule is in `docs/WEAPONS.md` ("The rules they share"): the shooter's game flies the bullet and says what it hit;
the server checks it and owns the health.

1. **The wire** (`proto/wire.json`; then `GOLDEN=update cargo test --test golden` in `backend/`, `npm run test:wire`
   in `frontend/`):
   - intents: `arm` (the weapon in your hands, the katana's kind — "" for fists), `shot` (weapon, where from, the way —
     for the others' tracers and sound), `hit` (the target's `sid`, the weapon — or `fire` / `thunder` for a blade's
     ability —, the zone, the distance);
   - events: `armed` (sid, weapon, kind), `shot` (sid, …), `health` (sid, what's left), `down` (sid, by whom, with
     what), `up` (sid, where — the respawn).
2. **The server** (`backend/src/world.rs`, a new `backend/src/weapons.rs` reading `proto/weapons.json` as `wire.rs`
   reads `wire.json`): per player the health (100), the weapon armed, the tick of the last shot. A `hit` is taken only
   if: that weapon is armed; `fireTicks` have passed since the last one taken (a cut: its own `windup + edge +
   recover`); the distance is within `range` (a cut: `reach`); the target's last pose is within 3 m of the shooter's
   pose + the distance along… (keep it simple: within `distance ± 3 m` of the shooter). Then the damage — `damage ×
   zone × max(floor, e^(−2·drag·distance))`, computed on the server from the spec, never sent by the client — off the
   health; at 0 `down`, and `up` 100 ticks later at the player's camp (or the spawn). Tests beside `cut_tree`'s.
3. **The game**:
   - `ArsenalHost.targets()` (main.ts) gets the others too: one `Target` per `Remotes` avatar on foot whose `hit()`
     sends the `hit` intent instead of taking anything off locally (the enemy's adapter is `Companion.targets()` — the
     model to copy); `ArsenalHost.shot` sends `shot`; `Arsenal.equip` sends `arm`.
   - `Remotes.ts` draws what each holds: `weaponModel(modelKey(…), weaponMaterial(…))` and the hold. `placeGun` /
     `placeSword` are private to `Arsenal` today and read its state (the recoil, the reload) — lift them into functions
     of `(Character, spec, pitch, state)` so a remote's walker is posed by the same code; their aim's pitch needs a
     byte in the pose (or in `armed` at a few Hz).
   - your own health comes from `health`; `down` plays `Character.knockdown` and holds you till `up`.
   - the blades' abilities: the cutter's game works them out as it does solo and sends each as a `hit` with weapon
     `fire` / `thunder`; the server needs their damages and tick gaps (they are in the katana's spec).
4. `scripts/harness/coop.mjs` is the pattern for a two-tab test: A shoots B, B's health falls, B goes down and comes
   back.

## 2. Being killed, solo

The spec says: at 0 — down, out for 5 s, back at the last camp with 100, the weapons kept. Today you are only knocked
down (by his fists, by his car) and get up where you fell; the enemy gets up after 2–3 s. Decide whether the enemy
should stay down longer or come back from afar (`Companion.join()` puts him 30 m behind you).

## 3. Sound

Nothing makes a sound: shots (each weapon its own), the bolt, the reload, a cut's swish, a hit, a blow, the fire, the
thunder, the ram. `Audio.ts` has no one-shot voice — add one (a small pool of buffer sources; the engine synth is the
pattern for made sounds, `docs/ASSETS.md` gets a row for anything not made here).

## 4. The abilities' look

Glowing boxes now (`Arsenal.spark`): the wave's front, the bolt, its flash. Wanted by the spec: flames running up the
fire blade and embers off a cut; arcs crawling along the thunder blade and a flash on a cut; the wave as a row of
flames; the bolt as a jagged line with a ground flash that lights the land for 2 ticks (`atmos` has a lightning term
for storms?); the singed grass (the ground's trodden mark). Instanced quads in one draw each; measure per tier.

## 5. The enemy armed

He uses his fists and his car only. Give him an `Arsenal`-like state of his own (the hold functions lifted in 1 make
this cheap): a pistol at range, the katana close; his aim's error by distance; you as his `Target`.

## 6. How he moves with a weapon

- with a gun the legs play the forward run whichever way he goes: strafe / backpedal clips (Mixamo's, into
  `character.glb` by `hero.py`) or a blend by the angle between the heading and the way he goes;
- the reload is the left hand's trip to the belt (code): a clip each in `fight.py` would read better;
- the katana has no scabbard; it appears in the hand;
- `dodge` (made, in `fight.glb`) is played by nothing — a key for you, a chance for him.

## 7. On a phone

The user asked for 60+ fps on a Snapdragon 6-series. Measured on the Mac only: 0.18–0.37 ms a frame of our JS
(`scripts/harness/companioncost.mjs`), one draw for him, three + a shadow for his car, one a weapon. To do on the
device (`npm run dev:lan`, https on the Wi-Fi): the FIRE / AIM · SCOPE · HEAVY / RELOAD · WAKE / PUNCH · KICK buttons
(their places against the stick, JUMP, SPRINT and the door button — `Arsenal`'s `mk(…)` calls), the scope's drag
speed by touch, the frame rate in a fight and with the AK-47 firing.

## 8. Smaller things

- `scripts/harness/prodcheck.mjs` for the new `.glb` paths (`fight.glb`, `models/weapons/*.glb`): the build gzips
  them, the loaders go through `GFX.unpacked` — built, not yet checked served.
- a bullet's zone is by height on a standing capsule: a man down or doubled over is hit as if standing.
- the pick-ups are laid for the world the game starts in (`Pickups` is built once in main.ts): the cave world and a
  crossing get none.
- what you've found is in `localStorage` (`overhill.weapons.v1`, `overhill.weaponsites.v1`), not in `save.ts` — the
  backend's save API has no place for it yet (CLAUDE.md: keep the shapes in step).
- his car follows your way as you drove it — through a tree felled across it since, past your parked car — and runs
  you down in a straight line over open ground.
- the passenger gets in and out without the door's clip.
- the weapons' real figures in the specs are from memory, not checked against a source this session.
