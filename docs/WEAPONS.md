# The weapons (branch `companion`, 2026-11-19; round 2: 2026-11-21)

> **THE KATANA IS GONE (2026-11-21, round 4 — the user: "now no katana is showing — remove all katana thing from the
> game").** Its two models, its clips, its fire and lightning (`WeaponFx.ts`), its spec (`weapons/KATANA.md`), its
> pick-ups, its buttons and its harness (`fxshots.mjs`) are deleted; a save that had one simply no longer has it. The
> weapons are **the pistol, the AK-47, the sniper rifle** — and fists. What is written of the katana below (the first
> request, rounds 2 and 3) is the record of what was asked and done, not of what is in the game.

## Co-op (2026-11-24) — the two builds merged

Step 8 had been built twice — on the PC (2026-11-19, brought onto round 4 on 2026-11-21: "The order of work", step 8
below) and again on the Mac (2026-11-24). **The PC's weapons were kept**, as the stricter: a hit must spend one of the
gun's `shot`s from the last 60 ticks, the weapon is an enum on the wire, `down` carries the shooter's name, the hit
marker, the stagger on the puppet (`backend/README.md`, "The fight"). From the Mac's build, what the PC's lacked:

| | how |
|---|---|
| aimed, seen | your pose's **bit 7** (`FLAG_AIM`, on foot): the gun up; the aim's pitch rides in the pose's rotation (the heading as before, the pitch about its x). Their game raises the gun (`holdOther`) while it's set, at that pitch — not only for a second after a shot |
| health across a reload | the server keeps a player's fight 10 minutes after they leave hurt or down (`World.lost`); back, they're told their own `health` / `down` — a reload no longer healed you and got you up at once |
| a newcomer | told each player's car and its dents too (`ride`, `dent` — docs/NEXT_damage.md §7), besides what's in their hands and who's hurt or down |

Checked by `scripts/harness/coopfight.mjs` (the PC's, 17 checks) and `syncchecks.mjs` (three players and a late
joiner: MULTIPLAYER.md §7); the server's: `world::tests::a_shoots_b_down_and_b_gets_up`,
`a_newcomer_is_told_and_health_survives_a_reload`, `weapons::tests`.

Not yet: no sound; a bullet on another player's car does nothing to it (their game owns their car's damage — it dents
only from their own crashes, told by `dent`); the zone is by height on a standing capsule.

## Round 4 (2026-11-21, the same day — from the phone again)

"Now no katana is showing — remove all katana thing from the game. Also fix the collision: my car gets hit from a few
metres back, the enemy doesn't even need to hit the car. And the car's respawn: I get out of the car, then the car
got stuck in the air. Check all the minute details and fix all."

| what | what was wrong | now |
|---|---|---|
| **the katana** | (why it stopped showing on the phone was not found — it showed in every run here) | removed whole, above |
| **the ram** (`Companion.drive`) | given when the two cars' MIDDLES were within a length and a bit of each other, whatever way they lay: with him ALONGSIDE (measured: 2.75 m to your side, nothing touching), or a bumper's gap behind | the two BODIES' own boxes, as they lie and point (`boxesTouch`; yours from `Vehicle.bodyBox`, his from `RemoteCar.box` — each about its root, where the model's `half` is not): his must be on yours, 8 cm, and coming at it. `enemy.mjs` reads how far apart they are at every ram: 0.14–0.2 m (a frame's travel) |
| **run down on foot** | you went down with his bumper still 0.8 m off | his bumper on you (your body 0.3 m round) |
| **the car left in the air** (`Vehicle.park`) | getting out HELD the car the instant its driver left it — as a fixed thing, wherever it was: just reset (set down from 0.8 m up), knocked up by a ram, off a bump | parked, it stays live — nobody at the controls, the brakes locked — until it has STOOD on its wheels for a third of a second (4 s at the most), then it is held. Never on the spot: what its wheels touched is the last step's. `scripts/harness/parktest.mjs`: reset and left at once, lifted 3 m and left at once — it comes down and stands; left standing it is held within a second; got back into, it drives |

The user: "in Blender create a gun and a Japanese katana and put it somewhere in ruins and show it in maps. I need
pistols and sniper and a normal AK-47. Make sure this is available in co-op too so players can kill each other. First
make physics md files for each gun and katana, and using that make those. Make sure fire rate matches our tick rate.
Zoom in / out for the sniper like in CS:GO. For the katana, abilities like fire, thunder on it based on the type of
katana; you carry one type at a time and turn the ability on with a key, like in Genshin Impact. On mobile a key as
well. While using the katana you can't use a gun — one weapon at a time. Switch with the Q wheel: two small buttons
under the wheel, one is settings, the second is weapon — click weapon and it shows the collected weapons to choose in
the wheel." Then: "add animation and proper movements."

## Round 2 (2026-11-21) — what the user asked after playing it, and what was done

"My fps dropped a lot, fix that. Check the running animation while holding the katana and the guns. The guns are not
positioned correctly — **in first person it must be like CS:GO, in third person like GTA 5**. When we zoom we need to
move the camera so the culling and the graphics of where the sniper's lens sees are good — now we just zoom and
nothing is clear there. When we shoot it stutters a bit, and it does not shoot where it aims — the cross is there but
it's not shooting there. The katana just shows a light, red or blue — I want real fire and lightning."

| what | what was wrong | now |
|---|---|---|
| **the hold, third person** (GTA's) | the gun floated before his chest whatever he did; his hands were bent to where it had been a frame before — off it whenever he ran or turned; he always faced the view | **carried**: a pistol in the hand at his side, swinging with his arm; a rifle across him in both hands, muzzle down — he walks, runs and sprints as unarmed, the walker's own camera. **Aimed** (`U` / right mouse held, AIM on a phone — stays on till pressed again —, or the trigger, and a second after): the rifle's butt in his right shoulder with his chest a quarter turned, the pistol out in both hands; he faces the view, the keys strafe, the camera in over his right shoulder (itself moved aside, not only its look), a dot in the middle |
| **the hold, first person** (CS:GO's) | the gun was that same chest hold seen from the eye: a muzzle tip at the bottom of the view and a hand across it | a **view model**: fixed to the view at its lower right, its barrel along the view (so it points at the cross from below), the left hand on the fore-end; it rocks with the stride, kicks back with a shot, dips as it's drawn or reloaded. The view is 68° tall with a weapon out (`FPP_ARMED_FOV` — CS:GO's world is 74°; at the game's 55° the gun stood a third bigger). The arms are let out up to 30 % to reach it (`Character.grip.stretch`) |
| **his hands** | bent to a wrist point, turned however the stride left them | each hand's own turn set on the weapon (`handOn`: where its palm lies, the way its fingers run and its palm faces), its elbow told where to point; all of it asked for WHILE he is posed (`Character.handIK` → `grip`, in his own space): nothing trails |
| **running with a gun** | the forward run whichever way he went (sliding sideways and backward) | aimed, his hips turn toward the way he goes (to 65°) with his spine turned back — the gun stays on the aim; backing away the stride runs backward and the run's forward lean is taken out of his spine (`legTwist`, `strideDir`, `backK`). No sprint while aiming; paces are CS:GO's (pistol 96 %, AK-47 86 %, sniper 80 %, scoped half that) and × 0.72 aimed in third person |
| **running with the katana** | the run's arm swing waved the blade about, through his own legs | **carried**: low at his right side, the point back and down, his left arm free to run; standing and cutting the clips hold it as before; first person: at the view's lower right, the blade up across it |
| **a bug under all of it** | with any weapon out he stood up to 15 cm off his feet on a slope (the walker's lowered pelvis was put back before the arms' pass re-posed him) | fixed (`Character.skinRest`) |
| **where a shot goes** | from the muzzle at whatever the camera's ray met first — in third person that could lie between the camera and him; and a cone of 4° running, + 0.22° a shot without end | the bullet flies **along the sight line** from abeam the muzzle (its trace drawn out of the muzzle, closing on the line): it lands on the cross — 0.05–0.12° off it standing, measured (`weapons.mjs`). The cones: AK-47 0.12° still / 0.4° walking / 1.1° running, + 0.07° a shot to + 0.7°; pistol 0.15 / 0.35 / 0.9. A burst climbs because the VIEW does. The cross's gap is the cone's own size on the screen. Where it stops, a puff of dust |
| **the stutter when firing** | each shot threw the view up and aside in ONE frame (ten times a second with the AK-47) and never brought it back; the first shot's flash and tracer made their pipelines then | the kick eased in over ~40 ms, held two ticks, and brought back over the weapon's `returnTicks` once the firing stops (CS:GO's); the glow's pipelines made under the loading screen |
| **the cross** | one white cross drawn with `mix-blend-mode: difference` — over a canvas that makes the browser composite the page through another full-screen surface every frame the gun is out | first person: CS:GO's four green bars round a gap (none with the sniper out of its scope, as CS:GO); third person: GTA's dot, only while aimed; plain boxes. The rounds' read-out sets text, no HTML a shot |
| **the scope** | 40° and 10° — CS:GO's numbers of a 90° view, taken of this game's 55°: 1.4× and 6×; the world drawn as for the bare eye (far trees their flat pictures, no grass, the ground's far colour); what's in view re-chosen only after a 3° turn — a third of the glass | **2.75× and 11.4×** (21.5° and 5.2° — CS:GO's AWP exactly); **the detail's eye** (`oth/LodEye.ts`): the trees, rocks, bushes and things pick their detail by their distance from the SIGHT LINE; the ground's patches and painted colour, the grass and the clutter are laid round a point out along it — for the NEAREST ground in the glass, so a bank at your feet keeps its grass; the haze thinned by the lens (`uLens`); what's in view chosen again after a third of the lens's turn against a view 1.7× the lens. The glass: four opaque bars and the lens's square, not a full-screen blend |
| **the katana awake** | a tinted shell on the blade; the wave, the bolt and its flash were glowing boxes — a new material and mesh every frame of a wave, never freed | `oth/WeaponFx.ts`: flames along the fire blade (noise climbing a body torn to a point, white-hot to red, sparks out of them), the wave a wall of fire taller than a man, fire on whoever burns; lightning crawling the thunder blade (ribbons re-thrown 22 times a second), the arc to who stands near, the bolt from the sky and its flash. A dozen meshes made once, shown as needed |

**The fps.** Asked to fix a large drop, I could not reproduce one in any steady state here: default play measures the
same as `look-haze` (`abq.mjs "port=5201|"`, 4 reps, the M-series Mac: ULTRA spawn 2.02 vs 2.02 ms, forest 2.25 vs
2.24, lake 2.48 vs 2.41; LOW `mobile=1` spawn 1.32 vs 1.34, forest 1.35 vs 1.35), the picture within its own noise
floor (`pixcmp.mjs`: ≤ 2 of 255 on ≤ 241 k pixels against a floor of ≤ 3 on ≤ 744 k), and every weapon and both
companions are within ± 0.17 ms of unarmed on ULTRA and ± 0.04 ms at the phone's viewport on LOW
(`scripts/harness/weaponcost.mjs`). What WAS found and fixed, each a cost only a real device shows: the cross's blend
mode (above), the firing's one-frame kicks and first-shot pipelines, the abilities' per-frame materials, the garbage
— 46 → 37 KB a frame with the companion (the minimap's lists made anew each frame; his own list), 68 → 61 with a
pistol out (the walker's pose: its quaternions and points from a kept pool, `Character.q4 / v3` — every walker,
co-op's too), and the companion appearing a tile away taking the physics' ground from under you and back. **Not
measured on a phone** — still the open item.

Seen: `scripts/harness/weaponshots.mjs` (each weapon carried / aimed / moving, from the play's camera, his side, his
front, first person — `__oth.spectate` draws a frame from beside him while the game plays on), `scopeshots.mjs` (the
bare lens beside the detail's eye, and a sweep's frame times), `fxshots.mjs` (the two blades awake, the wave, the
bolt). Checked: `weapons.mjs` — 23 checks now (third person carried → aimed → carried, a shot on the cross in both
views, the kick's return, the scope's steps and the detail's eye with it).

### Round 3 (2026-11-21, the same day — after the user tried round 2 on the phone)

- **"When the enemy's car hits me it goes 100 m back"** — two jumps, both gone: `docs/COMPANION.md`, "the enemy by car".
- **"On mobile we don't have the key I to use the katana's power"** — the third button was there but 318 px up: off
  the top of a phone held sideways. The weapon's buttons are the page's own pads now (index.html `.oth-wpad`, with
  the others in `.oth-touch`): FIRE · CUT · PUNCH up and left of JUMP, AIM · SCOPE · HEAVY · KICK over JUMP, RELOAD ·
  **POWER** over FIRE — POWER lit while the blade is awake, dimmed while it rests; the weapon's read-out one line at
  the bottom middle (it lay under them), "TAP · TAKE THE …" at a pick-up. `scripts/harness/phonepads.mjs`: a phone
  sideways (844 × 390), a short one (740 × 360) and upright (390 × 844), each weapon — no button off the screen or
  on another.
- **"The action and animation need more, it must feel real … make it custom using Blender"** (not Mixamo: "it will
  look bad") — the fight's clips made again and eleven added, the blows given weight in the game:
  `docs/COMPANION.md`. The katana's seven clips are made by the same motion code (the hips wound and unwound into a
  cut, a step with it, the blade carried through and settled); a cut that lands holds the two of you on it for a
  moment and jolts the view. (All of the katana's taken out since — round 4.)

### What the scope's detail costs

`scopeshots.mjs`, HIGH, 1280 × 720, a far hillside at the second step: the bare lens 599 k triangles (6 near trees,
53 k blades) → 1.0–1.2 M with the detail's eye (52–63 near trees, 119–221 k blades); a slow sweep at the screen's 60:
p99 24.6 → 25.5 ms (the same frame missed; the mean on the vsync both ways). In a lens the grass's ring is drawn 1.5×
smaller and the trees' own shapes reach three quarters as far from the sight line: all of each ring is in the glass
at once, where the open view holds a quarter of it. Out of the lens nothing changes — the eye is the camera.

## The spec files (written first — the game's numbers come out of them)

| file | weapon |
|---|---|
| `weapons/PISTOL.md` | the 9 mm service pistol |
| `weapons/AK47.md` | the AK-47 (7.62 × 39 mm) |
| `weapons/SNIPER.md` | the bolt-action sniper rifle (.338) |

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
- **One weapon in the hands**: fists, the pistol, the AK-47 or the sniper rifle. Changing takes the new
  one's `draw`. In a vehicle: none (put away when you get in).
- **The wheel (Q)**: two small buttons under the ring — ⚙ the actions (as before), ⚔ the weapons you've found; a sector
  picks one.
- **Keys** (on foot): `J` / left mouse — fire (fists: punch); `U` / right mouse — with the pistol or the AK-47 AIM
  while it's held (third person: the gun comes up, the camera in over his shoulder), the sniper's scope (off → ×1 → ×2
  → off; the mouse wheel steps it in and out) (fists: kick); `R` — reload; `V` — first person / third. Phones: FIRE ·
  PUNCH, AIM (stays on till pressed again) · SCOPE · KICK, RELOAD by the right thumb.
- **Found in the ruins** — ten of them, each marked on the map and the minimap by what lies there: walk up to it, `E` takes it. A
  weapon is yours for good (kept with the save); its site gives ammunition again every 5 minutes.
- **Co-op**: everyone sees what you hold (`arm` → `armed`) and your shots (`shot`). A hit is an intent to the server
  (`hit`: who, which weapon, the cut / the blow, the zone, the distance); the server (`backend/src/weapons.rs`) takes it
  only if that weapon is in your hands, a shot of it is in the air (each `shot` held to its fire rate — a bucket of two,
  one more every `fireTicks`: the network bunches two, never more), a cut's or a blow's gap on that target has passed,
  and the distance is within its range and agrees with the two poses (± 3 m) — then it works out the damage from the
  spec, takes it off, tells everyone (`health`), and at 0 `down` / 5 s later `up`. The rules in `backend/README.md`
  ("The fight"). Solo: the same numbers against the enemy (`Companion.ts`).

## The order of work, and where it stands (2026-11-19, the evening)

| # | step | state |
|---|---|---|
| 1 | the spec files (four; three since the katana went), `weapons.mjs` → `proto/weapons.json` | **done** |
| 2 | the models in Blender (`scripts/oth/weapons.py` → `assets/models/weapons/*.glb` + `weapons.meta.json`) | **done** — pistol 356 triangles, AK-47 588, sniper 1028; 25–65 kB a file |
| 3 | ~~the katana's clips in Blender~~ | removed with the katana (round 4) |
| 4 | in the hand, aiming, the bullet's flight, the scope — solo, against the enemy (`src/oth/Weapons.ts` `Arsenal`) | **done** — `scripts/harness/weapons.mjs` (18 checks) |
| 5 | ~~the katana's abilities~~ | removed with the katana (round 4) |
| 6 | the pick-ups in the ruins, on the map and the minimap (`Weapons.ts` `Pickups`) | **done** — `scripts/harness/pickups.mjs`; kept in `localStorage` (`overhill.weapons.v1`, `overhill.weaponsites.v1`) |
| 7 | the wheel's two buttons (`Wheel.ts`: keys 1 / 2 too); the phone's buttons (FIRE / AIM · SCOPE / RELOAD; PUNCH / KICK) | **done** — laid out by `phonepads.mjs` on three emulated phones; not tried on a real one by me |
| 8 | co-op: the wire (`proto/wire.json`), the server's check, health, kills, the others seen armed | **done** (2026-11-19, the night; 2026-11-21 onto round 4, guns only) — `scripts/harness/coopfight.mjs` (two players), `cargo test` (`weapons::tests`, `world::tests::a_shoots_b_down_and_b_gets_up`) |
| 9 | each step's cost per tier | measured on the PC only — below |

### How it's made (for whoever goes on)

- **A gun is not in a clip.** `Arsenal.holdGun` — called by the character WHILE he is posed (`Character.handIK`) —
  says where the gun is in his own space (`HOLDS`: the butt, the view model's place, where each palm lies) and fills
  `Character.grip`: each wrist, the way its elbow points, the hand's turn. Third person eases between the carry and
  the aim by `aimK`; first person's gun is in the VIEW's space (`gunV`) and is put on this frame's camera after the
  cameras (`Arsenal.afterCamera`). The kick, the dip as it's drawn, the left hand's trip to the belt on a reload are
  a few lines there. Aimed he faces the view and the keys strafe (`Character.aimYaw`, `torsoYaw`); the chase camera
  comes in over his right shoulder (`ChaseCam.side`, `aimHold` — main.ts `weaponView`, by `Arsenal.aiming`).
- **The scope** is first person with the lens `Arsenal.scopeFov` (main.ts `weaponView`, `fovWant`), the glass a few
  boxes; `Arsenal.lens` is its magnification — main.ts hands it to `aimLodEye` each frame (`?lodeye=0`: the bare lens).
- **Whoever can be hit** is a `Target` (`ArsenalHost.targets()`): today only the enemy (`Companion.targets()`). Co-op's
  players go in the same list.
- `?weapons=all` has every weapon for a test (nothing kept); `?weaponsites=0` no pick-ups.

### What it costs (2026-11-19 — `scripts/harness/companioncost.mjs`, an M-series Mac, tier LOW; JS only)

| state | the companion + the weapons, ms a frame |
|---|---|
| in the car (he rides with you / follows) | 0.18 – 0.23 |
| on foot, he walks beside you / comes at you | 0.22 – 0.30 |
| the AK-47 firing | 0.34 – 0.37 |
| nothing in the hands, no companion | ~0.004 (the pick-ups' scan) |

Draws: the companion one (skinned, 17 k triangles) + his car's three and its shadow; a weapon one; a pick-up two (only
the nearest site within 150 m). `npm run shot` A/B at the phone's viewport, tier LOW, uncapped: on and off within the
noise. **Not measured on a phone**: a Snapdragon 6-series runs this JS some 6–8× slower — 1 to 3 ms of its 16.7 — to be
checked there (`npm run dev:lan`). Nothing is made each frame (the vectors and matrices are kept); his skeleton is
posed by distance as the co-op players' are; the fight's clips and the weapons' models load only when first used.

### What's left, and what bites

- **Co-op (step 8)** is in: `arm` / `shot` / `hit` → `armed` / `shot` / `health` / `down` / `up` (guns only: the
  katana's `blade`, `awake`, `part` and `stun` went with it, 2026-11-21). How it's drawn: each player's gun in their
  hands by third person's own hold, lifted out of `Arsenal` (`holdOther` — Weapons.ts: carried, GTA's; up for a second
  after each shot, and while their pose says they aim — `FLAG_AIM`, at its pitch); their staggers as clips on the puppet
  (`Character.puppetStrike`), down a knockdown held till `up`; their shots flown as ghosts (`Arsenal.ghost`: tracers —
  hitting nobody, though a round that stops on your car still holes it); their health a bar under their name; yours
  bottom left; a hit of yours turns the cross red for a moment. Left of it: the
  server doesn't count rounds or reloads; fists don't hurt other players; no kill count is kept; no health comes back
  but by going down.
- **No sound** for any of it (shots, hits, blows) — `Audio.ts` has no one-shot voice yet.
- **Third person's aim** has no clip of its own for the legs (the hips turned, the stride reversed — round 2): a side
  step is the forward run turned up to 65°; past that the feet slide a little.
- **The phone**: the hold, the AIM button's toggle, the scope's cost with the detail's eye — none tried on a device.
- **The enemy has no weapons**: he fights with his fists and his car only.
- **Zones**: a bullet's zone is by height on a standing capsule — a man down or doubled over is still hit as standing.
- **Death**: the spec's "down, out for 5 s, back at the camp" is not there — the enemy is knocked down and gets up; you
  are only knocked down by his fists and his car.
- The reload has no clip (the left hand's trip to the belt).
- The pick-ups are laid for the world the game starts in; a crossing to another world doesn't lay its own.
- `scripts/harness/prodcheck.mjs` has not been run for the new `.glb` paths (the production build itself passes).
