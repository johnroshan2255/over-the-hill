# Car damage — GTA IV's way (2026-11-21)

**State: built and checked on the PC in headless Chrome (`scripts/harness/damagetest.mjs`, `ramtest.mjs`). Not yet
run on a phone. What is left, and what still bites: `docs/NEXT_damage.md`.** Round 2, the same day, after the user
played it: the spare wheel on the tail takes a knock (§3.4b), a dent keeps the car's own colour (§3.1), and the
enemy's car meets yours at its own body and no longer springs back off it (§2, `docs/NEXT_damage.md` §1). The setting — SETTINGS › PLAY › CAR DAMAGE — is **on** by default (`?damage=0` is off): the
user asked for it as how cars are; their standing rule is "new optional gameplay off by default", so this default is
my reading and theirs to change.

The user, 2026-11-21: "add damage, how the damage system works in GTA 4 … the real physics: if I hit him, my car and
his take damage … engine damage and all, broken axles, all sorts of things. Check online and make an md file, then
build the damage feature from it. Do everything with Blender and PlayCanvas."

Code: `frontend/src/oth/Damage.ts` (one car's state — `CarDamage`; what is seen of it — `DamageFx`), its numbers from
this file (`node scripts/oth/damage.mjs` → `proto/damage.json`), the pieces from Blender
(`scripts/oth/damage.py` → `src/assets/models/damage/debris.glb`, `crack.png`).

## 1. What GTA IV does (looked up)

| what | how GTA IV does it | source |
|---|---|---|
| the body | not pre-modelled dented parts: any part of the shell flexes and crumples by the force and the direction of the blow | gta.fandom.com/wiki/Vehicle_Damage, grandtheftwiki.com/Vehicle_Damage |
| axles and wheels | a side blow bends an axle: the wheel leans (camber), may lock; a hard frontal / rear blow bends it till it no longer turns and its wheel drags; a blow on a quarter panel spoils the suspension and the handling | same |
| tyres | burst by bullets or hard blows; a flat tyre breaks up with speed and leaves the bare rim | same |
| engine | blows and bullets near the engine bay wear it: it loses power, smokes, stalls, in the end burns | same |
| fire | after enough damage the car burns and then explodes; whoever is near is set alight | same |
| doors, lamps, glass | an opened door can be torn off; lamps and panes break where they are hit; a hard frontal crash can throw the driver through the windscreen | same |
| per-car numbers | `handling.dat`: `fCollisionDamageMult`, `fWeaponDamageMult`, `fDeformationDamageMult`, `fEngineDamageMult` | grandtheftwiki.com/GTA_IV_Handling.dat_Breakdown |

Not found: GTA IV's own engine-health thresholds. The well-known 0–1000 scale with smoke at 650 / 550 / 390 and fire
at 250 is **San Andreas'** (open.mp/docs/scripting/resources/vehiclehealth) — used here as the shape of the curve, and
said so. From memory, not from a page read this session: in GTA IV crashes alone wear the engine out (it stalls and
will not start) and it is gunfire that sets a car alight — which is how fire is ruled here (§3.6).

## 2. The physics here

- **Your car** is a dynamic Rapier body (`gameplay/vehicle/VehicleSim.ts`), 60 Hz. Its tyre, damper and drag forces
  are *added forces*; its springs are the vehicle controller's impulses, put on before the world's step.
- **A crash is a change of velocity that was not the car's own doing.** `Vehicle.watchEnd` notes the body's velocity
  and the forces it has put on itself; after the world's step `Vehicle.crashWatch` takes those forces and gravity out
  of the change. What is left came from what it ran into. Driving, braking, cornering, a minute on the autopilot: 0.00
  m/s left (measured). A wall at 10 / 14 / 20 m/s: 9.7 / 14.1 / 20.1 m/s. From `crash.minDv` it is a **blow**.
- **Where, and against what**: on a blow's step only, the body's contact pairs (`world.contactPairsWith` /
  `contactPair`): the middle of every contact point within 8 cm of touching, in the body's own space, the deeper the
  heavier; the nearest's body is the other one; the ΔV taken *at that point* (the body's turn counted). Not the
  solver's contacts and impulses: the body's CCD runs a hard step in pieces and leaves those at zero (measured: 2 127
  manifolds against a wall, 607 with points, none with an impulse). Nothing touching (the enemy's scripted ram, a
  blast: impulses): the face of the body's box the push came through.
- **A hard landing** is not a contact: the wheel's shock comes down on its stops (`TruckSim.hardHit`, the shaft's
  closing speed — about the speed of the fall). One landing, one blow to that wheel's axle, of the hardest it came down.
- **His car** (the enemy's / the companion's) is a kinematic body posed along your way — it feels nothing by itself.
  When your blow's other body is his (or it lands within 0.15 s of his ram), `Companion.carBlow` gives his car the
  same blow the other way: the same ΔV, the contact point in his car's space. What is solid of it is its own shape
  (its exact mesh, and its inner solid in 0.6 m sections), not a box round its mirrors and bars; his ram is a dead
  blow — half of what he closed at to each car, at the point his nose met yours (`Vehicle.hitHint`). One crash is
  one blow: for a third of a second only a harder one counts.
- **Bullets** (`Weapons.ts fly()` → the host's `struck`): a round that stops on a car's body is a small blow at that
  point with its own table (`shot`).
- A car **put** somewhere (brought to you, set down at a camp, the crossing) is no blow: the watch sees the jump.

## 3. What a blow does

1. **The shell crumples** — the car's own body and glass vertices (each car's own merged copy; the driver's door
   gets its own) pushed along the blow inside a radius, deepest at the middle, creased (folds a hand's width apart
   and each vertex's own share, by where it began: a seam's two vertices move as one); never further than `maxDepth`
   from where a vertex began, never into the cabin's cell (the middle half of the length, `cabinCell` of the width,
   four fifths of the height). The moved vertices' normals are made again from their faces. **The dent is the car's
   own colour** — the light falls on it another way and nothing else changes; what is torn off (the scraps, the
   trim) is the car's colour too. (The first cut scraped the paint to steel there; the user, the same day: "the
   crashed and broken thing will have the same colour, the dent and all".) Only a burnt-out car changes: soot.
2. **Glass**: each pane (a piece of the glass mesh that hangs together) takes what reaches it: cracked — the crack
   pattern drawn over it — then out, its shards on the ground.
3. **Lamps** break when the blow lands on them: no beam from that lamp, no glow; both gone, no light.
4. **Wheels and axles**: a wheel's share of a blow is by how near it landed; a blow from the side goes into both
   wheels of the side it struck, one on the nose or the tail into that end's axle. The axle bends — the wheel leans
   and points out of line (the car pulls to that side), grips less, drags; past `jam` it no longer turns; past
   `tearOff` in a blow of `tearOffDv` the wheel comes off and rolls away, the corner on its hub. A tyre bursts in a
   hard enough blow, a hard enough landing, or by a round: it rides on its rim.
   **4b. The spare wheel** on the tail (six of the 21 cars carry one; no model names it — it is found: the rearmost
   of the body that is a wheel's round, `CarDamage.findSpare`): a blow that lands on it is taken by the tyre —
   `spare.cushion` of it reaches the car, half of that again the glass over it (`spare.glass`), the rubber itself
   keeps `spare.give` of a dent; a round stops in it. Measured on the off-roader, 9 m/s from behind: on the spare
   no window cracks, the tyre dents 9 mm, the tail 4 cm; the same blow beside it cracks two windows, 23 cm.
5. **Engine**: by how much of the blow is in its bay (the front three tenths, under the bonnet). Steam, grey smoke,
   black smoke and misfires, dead at 0 — the power falling all the way (`engine.power`).
6. **Fire**: under `fireAt`, a round into the bay or a blow of `fireDv` there sets it alight; it burns `burnTicks`
   and goes up: the blast, a burnt shell, every pane, lamp and tyre gone, you thrown out beside it (the enemy out
   of his, most of his strength gone), what stands within `explosion.radius` shoved and hurt.
7. **Debris**: shards, torn metal in the car's colour, a strip of trim — Blender's pieces, thrown by the blow, lying
   where they fall for `debris.lifeTicks`.

**The enemy's car** drives by what is left of it (`CarDamage.drive`); its engine dead, he gets out and comes on foot;
well away from the wreck (or 12 s on) another car is brought him.

**Repair**: resting at a camp mends the car for nothing; the wheel has REPAIR (stopped): the price by what is broken,
or what you have if that is less.

**Sound** (`OthAudio.impact`, made in the page — nothing loaded): the thud and crunch of a crash by how hard, glass
going, the blast. A dead engine is silent.

## 4. The numbers

Times in the server's 20 Hz ticks. Speeds in m/s.

```json
{
  "id": "damage",
  "crash": { "minDv": 1.5, "maxDv": 30 },
  "deform": {
    "radius": { "base": 0.35, "perDv": 0.11, "max": 1.6 },
    "depthPerDv": 0.022,
    "maxPerHit": 0.45,
    "maxDepth": 0.6,
    "crumple": 0.35,
    "cabinCell": 0.72
  },
  "glass": { "crackDv": 2.5, "shatterDv": 5.0, "radius": 0.9 },
  "lamp": { "breakDv": 3.0, "radius": 0.35 },
  "spare": { "cushion": 0.45, "give": 0.12, "glass": 0.5 },
  "wheel": {
    "radius": 0.75,
    "bendPerDv": 0.018,
    "maxCamber": 0.21,
    "toePerCamber": 0.35,
    "gripLoss": 0.45,
    "dragNm": 400,
    "jam": 0.15,
    "tearOff": 0.2,
    "tearOffDv": 14,
    "burstDv": 9,
    "flat": { "radius": 0.8, "grip": 0.55, "dragNm": 250 },
    "hub": { "radius": 0.4, "grip": 0.35 }
  },
  "landing": { "bendFrom": 6.2, "bendPerMs": 0.03, "burstFrom": 10 },
  "engine": {
    "health": 1000,
    "bayDamagePerDv": 30,
    "elsewherePerDv": 5,
    "steamAt": 650,
    "smokeAt": 450,
    "misfireAt": 300,
    "fireAt": 250,
    "fireDv": 16,
    "power": [[1000, 1.0], [650, 0.92], [450, 0.75], [300, 0.5], [120, 0.3], [0, 0.0]],
    "burnTicks": 200
  },
  "shot": { "engine": 14, "glassCracks": 1, "glassShatters": 3, "dentDv": 2.2 },
  "explosion": { "radius": 9, "pushDv": 7, "hurt": 70 },
  "debris": { "max": 48, "lifeTicks": 400 },
  "repair": { "coinsPerPoint": 0.05, "minCoins": 5, "campFree": true }
}
```

What they come to (`node scripts/oth/damage.mjs`), and what was measured against a wall:

| into a wall at | the blow | the shell gave | engine left | also |
|---|---|---|---|---|
| 5 m/s (18 km/h) | 4.3 m/s | 9 cm | 917 | |
| 10 m/s (36 km/h) | 9.7 m/s | 28 cm | 754 | both headlamps, the front axle 1.3° |
| 14 m/s (50 km/h) | 14.1 m/s | 44 cm | 620 — steaming | the windscreen cracked, the front axle 2° |
| 20 m/s (72 km/h) | 20.1 m/s | 60 cm (the limit) | 440 — smoking | the windscreen out, the front axle 3° |

("gave": the furthest any vertex moved — the crease's deepest fold, not the dent's mean.)
Sideways into a wall at 6 m/s: found on that side, both its axles 3.4°, three panes out. Your car sent into the
enemy's at 10 m/s as he came on: a blow of 11.3 m/s to both — your engine 570, his 572, his shell in 32 cm, his
headlamps out. Five pistol rounds at the car from beside it: the three that left the gun marked it.

Landings (measured): 1.5 m — nothing; 4 m — every axle bent 3–5°, none jammed. By the numbers, not tried: the
tyres burst from a fall of about 5 m (`landing.burstFrom`).
53 rounds into the bay set the engine alight; it burns 10 s.

## 5. What it costs (measured 2026-11-21, the Mac, headless Chrome)

| | |
|---|---|
| the picture, nothing damaged | the same: `pixcmp "damage=0\|"` at the spawn and the forest — fewer pixels differ than between two shots of the same build (the dust and exhaust move) |
| the frame, nothing damaged | ULTRA 1080p spawn 2.03 ms against 2.06 off, forest 2.19 against 2.29; LOW spawn 1.31 against 1.30 — no difference above the noise (`abq "damage=0\|"`, 4 interleaved reps) |
| a blow's frame | one pass over the car's 72 627 vertices and its triangles: 0.6–1.3 ms for a 14 m/s blow (13 000 vertices moved; run to run), the first — its copies made — up to 2.7 ms; the scan of the contacts (not timed apart). Then the buffers sent again — at most 12 times a second |
| memory | one float a vertex from the start (0.3 MB a car); at the first blow, the shell as it left the works kept (about 2.6 MB a car) |
| debris, flames | an instanced draw per kind of piece (5) and one for the flames, each only while some are alive; smoke rides the dust's ring |
| the enemy's car on yours | his way made in the physics' steps: 0.08 ms a step; the try of his nose against your car's inner pieces, only in the steps the two could meet: 0.17 ms (the worst 1.1); his solid body made once, as his car appears: 12 ms. `companioncost.mjs`, the enemy in his car: 0.29 ms a frame in all |

Not measured: any of it on a phone. The blow's pass will be several times longer there — once, in the frame of
the crash.

## 6. What's left

**The hand-off, in order, with what bites: `docs/NEXT_damage.md`.** In short:

- **The phone**: play it there; time a blow's frame on the Snapdragon.
- **A door torn off** when it stands open in a blow (GTA IV's): not built.
- **Saved**: the damage is the session's — a reload, or another car from the garage, is whole.
- **Co-op**: your car takes damage; the others' cars are not shown damaged and nothing of it is on the wire.
- **The bike**: takes none.
- **The trailer**: its hitch pulls on the car through the solver — a hard jerk could read as a blow. Not tried.
- **Per-car numbers** (GTA IV's `handling.dat` multipliers): one table for every car now; the engine's bay is taken
  to be at the front.
- **Deeper**: the collider does not crumple with the shell; a flat tyre does not come off its rim with speed; no
  one is set alight by a fire, only knocked down by the blast.
- `scripts/harness/companion.mjs` failed "he pulls up and gets out of his car" in 2 runs of 10 while this was built
  and passed the rest; the cause was not found (the harness now prints the state when it does).
