# What's next for the companion, the enemy and the weapons (the hand-off, 2026-11-19; round 2: 2026-11-21)

**Round 2 (2026-11-21)** — after the user played it: the guns' hold (first person CS:GO's view model, third person
GTA's carry / aim), the legs under an aimed gun, the katana carried when running, shots on the cross, the kick's
return, the scope at CS:GO's magnifications with the world's detail drawn for it (`LodEye.ts`), real fire and
lightning (`WeaponFx.ts`), the frame's hidden costs. The table of it: `docs/WEAPONS.md`, "Round 2". Below, §4 is
done and §6's first point; the rest stands.

**Round 3 (the same day, from the phone)**: the enemy's car no longer jumps back; the phone has its POWER button and
its weapon buttons are laid out with the page's own; the fight's clips were made again in Blender — the user does NOT
want Mixamo for these ("it will look bad … make it custom using Blender") — with runs of blows, a defence, blows
taken as they land, knockback, a hit-stop and a jolt (`docs/COMPANION.md`).

**Round 4 (the same day)**: **the katana is removed from the game, whole** (the user: "remove all katana thing") —
whatever below speaks of it, of blades, of `fire` / `thunder` hits or of `WeaponFx.ts` no longer applies; the ram is
given only with his car's body on yours; a car left before it stood comes down before it is held (`docs/WEAPONS.md`,
"Round 4").

Branch `companion` (from `look-haze`). What is built and how: `docs/COMPANION.md`, `docs/WEAPONS.md`, the specs
`docs/weapons/*.md`. This file is only **the rest** — in the order I would do it.

## Where it stands

**Car damage (2026-11-21, later the same day)** is its own file: `docs/DAMAGE.md` — built (`Damage.ts`), the enemy's
car takes the blow of his ram and of your crash into him, his engine dead he gets out. **His car's contact with yours
was made again with it** (its own shape, no spring-back): the hand-off for both is `docs/NEXT_damage.md`.

| | |
|---|---|
| the companion (walks, rides, follows by car) | done — `scripts/harness/companion.mjs` |
| the enemy (fists, kicks, knockdowns, rams, runs you down) | done — `scripts/harness/enemy.mjs` |
| the weapons solo (pistol, AK-47, sniper + scope) | done — `scripts/harness/weapons.mjs` (the katana: removed, round 4) |
| the pick-ups in the ruins, the map's marks, the wheel's two buttons | done — `scripts/harness/pickups.mjs` |
| the hold (CS:GO's in first person, GTA's in third), the scope's detail | done (round 2) — `weaponshots.mjs`, `scopeshots.mjs` |
| the phone's buttons | written, **never tried on a phone** |
| the fps drop the user saw | **not reproduced** here in any steady state; what could hide on a device was fixed (`docs/WEAPONS.md`) — needs the phone |
| co-op (players hitting each other) | **done** (2026-11-19, the night; brought onto round 4 — guns only — 2026-11-21) — `scripts/harness/coopfight.mjs` (needs the server too: `cd backend && cargo run --release`) |
| sound | **nothing yet** |

Each harness wants `npm run dev -- --port 5200` in `frontend/` first (`PORT=` for another port); they print PASS / FAIL
and write stills to the folder given.

## 1. Co-op: the weapons between players — DONE (2026-11-19, the night)

Built as planned below, with these changes: a gun's hit must spend one of its `shot`s from the last 60 ticks (hits
can't outnumber shots, shots can't beat the fire rate — a bucket of two, so the network's bunching isn't punished);
`health` carries who, with what and the zone; `up` has no place — your own game puts you back at your camp, else beside your car (the map's spawn was
a kilometre off). The newcomer is told who holds what and who's hurt or down. What it does and costs:
`docs/WEAPONS.md` (step 8), the rules: `backend/README.md` ("The fight").

**2026-11-21, brought onto round 4** (it had been left uncommitted on the PC, and the Mac's commit went on without it):
guns only — the katana's `blade`, `awake`, `part` and `stun` are off the wire and out of `weapons.rs`; another
player's gun is held by third person's own hold (`holdOther` / `standOther`, lifted out of `Arsenal.holdGun` —
round 2's bone-by-bone grip), carried, up for a second after each of their shots; `coopfight.mjs` 17 checks pass.

Left of it, smaller: the aim's pitch isn't in the pose (a player's gun is at their last shot's pitch, easing level);
the server doesn't count rounds or reloads; fists between players do nothing; no kill count; no health back but by
going down (the spec says none — decide). `coop.mjs`'s "B saw A drive off" wants > 5 m in 4 s: A's car does 5.0 –
7.6 m headless, so it fails now and then on the old code too.

The plan as it was:

The rule is in `docs/WEAPONS.md` ("The rules they share"): the shooter's game flies the bullet and says what it hit;
the server checks it and owns the health.

1. **The wire** (`proto/wire.json`; then `GOLDEN=update cargo test --test golden` in `backend/`, `npm run test:wire`
   in `frontend/`):
   - intents: `arm` (the weapon in your hands — "" for fists), `shot` (weapon, where from, the way —
     for the others' tracers and sound), `hit` (the target's `sid`, the weapon, the zone, the distance);
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

## 4. (the katana's abilities' look — gone with the katana, round 4)

## 5. The enemy armed

He uses his fists and his car only. Give him an `Arsenal`-like state of his own (the hold functions lifted in 1 make
this cheap): a pistol at range; his aim's error by distance; you as his `Target`.

## 6. How he moves with a weapon

- (round 2: aimed, the hips turn toward the way he goes and the stride reverses backing away — `Character.legTwist`.)
  Real strafe / backpedal clips (Mixamo's, into `character.glb` by `hero.py`) would end the small slide past 65°;
- the reload is the left hand's trip to the belt (code): a clip each in `fight.py` would read better;
- `dodge` (made, in `fight.glb`) is played by nothing — a key for you, a chance for him.

## 7. On a phone

The user asked for 60+ fps on a Snapdragon 6-series, and (2026-11-21) saw the fps drop "a lot" — on what, in which
state, is not known; nothing here reproduces it (`docs/WEAPONS.md`, "The fps"). Measured on the Mac only: every state
within ± 0.17 ms of unarmed (`scripts/harness/weaponcost.mjs`; `stateprof.mjs` says where a state's JS goes), one
draw for him, three + a shadow for his car, one a weapon. **The first thing to do with a phone on USB:**
`scripts/harness/phone.mjs`-style percentiles in each of `weaponcost.mjs`'s states, and the scope's second step on a
far hillside (the detail's eye doubles the triangles there). To do on the device (`npm run dev:lan`, https on the Wi-Fi): the FIRE / AIM · SCOPE · HEAVY / RELOAD · WAKE / PUNCH · KICK buttons
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
