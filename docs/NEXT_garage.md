# NEXT — the garage: free paint, factory colours, working cockpits, the cars' pictures (hand-off, 2026-11-16)

Stopped mid-way at the user's word (*"make a next.md and stop for now so that I can continue later"*), then committed
as it stood on `look-haze` (the kit, the game's code, the 38 rebuilt car files, 20 pictures, 5 harness tools, this
note). It type-checks, `npm test` passes, the release build builds — and it has only been seen in stills and logs.

## What was asked (2026-11-16)

1. *"right now the car colour change is based on money collecting — remove that, it must be free"*
2. *"we have a lot of custom-made cars, but in the FPP view they don't have the car's gear parts, the animation of a
   gear change, a speedometer — nothing. So check how each car works online, then make the inside like the original"*
3. *"put a default colour for the cars — now all look the same colour; I want the real colour … I can change the colour
   later but the default will be the car's original in real life"*
4. *"while selecting cars show an image of the car there — now we don't know which one we are going to select"*

## 1. What is done

| | what | where |
|---|---|---|
| **Paint is free, and per car** | no prices, no locks. The paint was ONE setting for the whole garage (a paint picked once coloured every car — "all look the same colour"); now `settings.paints[carId]`, a car not in it wears its factory colour. The old single `paint` in a save is dropped on load. The first swatch is **FACTORY** (the car's own colour, named). `#ffffff` is gone from the list (to the shader pure white means "untinted panels": every car the same pale grey — the old "Stock"); an "Arctic White" `#f0eee8` instead | `src/settings.ts`, `src/journal.ts` (the pricing removed; `paints` stays in the save's shape, unread), `src/ui/Menu.ts` `paints()` / `pickPaint()`, `src/ui/menu.css`, `src/oth/main.ts` (`applySettings`, `applyRide`) |
| **Factory colours** | each car's real colour, its name and a line about it: `PAINT` in `scripts/oth/cars.py` → `cars.json` (`paint`, `paintName`, `paintNote`) → the catalogue's `stock.paint`. The Overlander: its rust red (`#a8573f` — it was a grey in the catalogue that `Vehicle.ts` overrode) | `scripts/oth/cars.py`, `src/gameplay/vehicle/catalogue.ts`, `src/oth/Vehicle.ts` (`OTH_PAINT`) |
| **The cockpits** | every kit car's cabin from its own `COCKPIT` spec (`cars.py`): a painted STEEL dash in the factory colour or a black padded one (wood fascia on the Grand Wagon); the instruments where the real car has them (ahead of the driver, or the panel in the dash's centre — Scoutling, Eighty-Eight), which dials and their scales (85 mph on the square-body GMs, 180 km/h + a rev counter on the Steppe …); the steering wheel (size, rim, spokes, an ivory one with a horn ring on Wagon 63); the gear lever as it really is (floor, **column manual** — Bronc, Wagon 63 —, **column automatic** — Sierra, Squarebody, Grand Wagon); the transfer levers (the Eighty-Eight's red and yellow knobs, the Steppe's two, the Bronc's T-handle, the Gelände's lock pulls); the handbrake's lever; pull knobs, a grab handle, the glovebox. The Overlander (its own script): two dials, a console selector | `scripts/oth/carkit.py` (the cabin, "THE DASH, AS THE REAL ONE'S"; the movers), `scripts/oth/cars.py` (`COCKPIT`, `PAINT`), `scripts/oth/offroader.py` |
| **… that work** | `Cockpit.ts`: the dial FACES drawn once a car on a 1024 × 512 canvas (each `dial_k` mesh's UVs are cell k); the NEEDLES follow the car (speed in the dial's own unit, revs, oil with the revs, temperature warming up); the GEAR LEVER goes through its gate as the box shifts (out of gear → neutral → across → in; a column manual's up / down and toward / away; an automatic's P R N D); the range lever goes back in low range; the handbrake comes up; the instrument lamps glow with the headlights. The driver's **right hand leaves the wheel for the knob** during a shift and comes back | `src/oth/Cockpit.ts` (new), `src/oth/Vehicle.ts` (`anim`, `dialTex`, `shiftGrip`, `fine`), `src/assets/loadModels.ts` (`needle_*`, `lever_transfer`, `lever_hand`; `sweep`, `max`, `unit`, `shift`, `col`, `knob`), `src/oth/main.ts` `seatDriver`, `Drivetrain.gearTarget` |
| **The wheel 7 cm lower** | the kit's steering hub stood OVER the dash's top with the dials behind it; now under the dash's brow, the dials seen through the rim's upper half. The seat and the driver's hips stayed: `cars.json` `hip` is the seat's now, and `seatDriver` takes the catalogue's `seatHip` (else hub − 0.36, as before) | `carkit.py` (`HUB`, `SEAT_Z`), `catalogue.ts` `seatHip`, `main.ts` |
| **The first-person view tipped down** | the driver's eye looked level: the top third of the frame was roof lining, the dash wholly under it. Now tipped 0.24 rad (~14°) with a 62° lens (was 55°): the wheel and the instruments in the bottom of the view. `?fpptilt=` rad, `?fppfov=` ° | `main.ts` `placeFpp`, `FPP_TILT`, `FPP_FOV` |
| **The garage's pictures** | each ride's picture on its tile and (desktops) large in the side panel: `src/assets/ui/cars/<id>.jpg`, 640 × 360, ~40 kB each (0.8 MB in all, lazy-loaded), shot from the game with the HUD hidden | `scripts/harness/garageshots.mjs`, `src/ui/Menu.ts` (`RIDE_IMG`, `picture`), `menu.css` |

### The factory colours

✓ = the name / code was found online this session; e = from memory, **to confirm** (the hex values are all by eye).

| car | real machine | colour | |
|---|---|---|---|
| Powerline | Dodge Power Wagon | Seawolf Submarine Green | ✓ the standard colour from 1946 |
| Sierra K | GMC K1500, 1984 | Apple Red, a Frost White band | e |
| Forty-Five | Land Cruiser FJ45 | Dune Beige (416), white cab roof | ✓ code |
| Squarebody | K5 Blazer | Midnight Blue, white top | e |
| Bronc | Ford Bronco, 1970 | Sky View Blue, white top | ✓ in the 1970 list |
| Scoutling | Scout 800 | Apache Gold, white top | e |
| Steppe | Lada Niva | Orange | e (the Soviet names were not found) |
| Eighty-Eight | Series IIA | Bronze Green, sand tilt | e |
| Guardian | Defender 90, 1991 | Arles Blue, white roof | ✓ a 1991 car listed in it |
| Gelände | W460 280 GE | Cream White | e |
| Forty | Land Cruiser FJ40 | Freeborn Red (309), white roof | ✓ code |
| Seventy | Land Cruiser BJ70 | White | e |
| Lynx | VW Iltis | Gelboliv RAL 6014 | ✓ the Bundeswehr's before 1984 |
| Wayfarer | Ford Explorer, 1991 | Deep Jewel Green, sandalwood band | ✓ name and code |
| Wagon 63 | Jeep Wagoneer, 1963 | Spruce Tip Green | e |
| Grand Wagon | Grand Wagoneer, 1986 | Garnet, the wood strip | e |
| Boar | Volvo TP21 | Army Green | e |
| Woodbox | IH R-140 Travelall | Harvester Red | e |
| Overlander | ours | Rust Red | — |

### The interiors: what was found online, what is from memory

Found: the Bronc's three speeds on the **column** and the Dana 20's **T-handle** (1967–72); the Series IIA's **red**
(high / low) and **yellow** (4WD) knobs, and that the three-spoke wheel came in 1967 (an earlier one was metal-spoked);
the Wagon 63's **rectangular cluster** (9.25 × 4.15 in), its two-spoke wheel with a chrome ring, sold in white; the
Scout 800's **80 mph** speedometer; the FJ40's parking brake **under the dash** and its two floor levers; the Power
Wagon's dash (an early one 1946–50, the gauges in the centre later). The web search gave little on the layouts
themselves: **every cluster layout, wheel and lever position not listed here is from memory** — the notes are the
comments over each car in `cars.py` `COCKPIT`. Still to write: a §6 in `docs/VEHICLES.md` with these, car by car.

## 2. Checked

- `npx tsc --noEmit`, `npm test` (drivetrain / mtb / moto / gpu / wire: all pass), `npm run build`.
- `Q=mobile=1 node scripts/harness/fleetshot.mjs <dir> low`: all 18 kit cars load the phones' way — "all ok".
- `scripts/oth/coplanar.py` on the 19: **17 clean**; Steppe (100 cm²) and Guardian (80 cm²) are their old under-sill
  overlaps, as before. (My first build had four: steering spokes crossing at the boss, two lock pulls touching, the
  gaiters' feet — fixed in the kit.)
- By eye, every car: the dash from the driver's seat, the levers from the passenger's side, the outside
  (`fppshot.mjs`, `outshot.mjs`); the garage on a desktop, a phone, a phone sideways (`garageui.mjs`).
- `shifttest.mjs` (drive off in first person, log the lever): Forty 1 → 2 → 3 through the gate, the hand to the knob and
  back; Bronc's column 1 → 2; the Sierra's and the Overlander's automatics stay in D. The Bronc's needle read ~32 mph at
  51 km/h.
- **Cost** (`abq.mjs`, the M4, release builds, the spawn's chase camera, 8 reps, two tabs a build): Forty ULTRA 2.041 →
  2.061 ms (+0.02), Steppe 2.03 → 2.07–2.10 (**+0.04–0.06**), Forty LOW + `mobile=1` 1.280 → 1.296 (+0.016). The fine
  parts (dial faces, needles, the small levers) are drawn from inside or within 6 m only (`Vehicle.close`) — the Steppe's
  +0.04 was measured AFTER that, so it is not their draws: see below.

## 3. What is left, in order

1. (Committed and pushed, 2026-11-16.)
2. **Play it in a real window** — none of this was seen moving, only in stills and numbers: the hand going to the lever
   (is it too quick? `CockpitAnim` `reach` 9 / s out, 5.5 / s back, 0.16 s held), the view's tilt (the HUD's hint bar and
   the "PITCH CAMP" prompt lie over the dials' lower edge at 0.24 rad — try `?fpptilt=0.28`, or lift the hints in first
   person), the dials at NIGHT (their lamps: `uLamps` × 0.55 — never looked at), reverse and P → D on an automatic's
   column, the range lever in low range, the handbrake.
3. **The Steppe's +0.04–0.06 ms**: not the fine parts (measured with them off at chase distance). Suspects: the cabin's
   ~2 k more triangles (dash brow, pod, knobs, gaiters) in the body's draw; the old build's car file. A/B `?car=steppe`
   old vs new at `scale=10` to see if it is vertices.
4. **`docs/VEHICLES.md` §6** — the interiors and colours, car by car, with the ✓ / e marks above; and its §0 says "each
   its own colour" of the old invented ones. A row in `docs/PERF.md`'s log for the cost above.
5. **Confirm the "e" facts** (the table and the list above) against photographs — the search tool returned shop
   listings, not pictures. Likeliest to be wrong: the Boar's and the Lynx's instruments, the Scoutling's single transfer
   lever, the Guardian's four-spoke wheel, the Niva's small gauges' order, the colour names marked e.
6. **Small things seen**: the Wayfarer's sandalwood lower band does not show (its `band` seems to take the body's
   colour); the Woodbox's screen divider draws as a red line from inside; the steel dashes are flat colour (no baked
   shade inside the cabin: the cab parts are not in `carkit.weather`); the garage's pictures show the FACTORY colour
   whatever paint is chosen; another player's car (`Remotes`) draws no dials.
7. Still open from before: the three cab-overs (Forward, Rust Ox, Mammoth — a body kind the kit lacks); a phone on USB
   (`docs/PERF.md`); the look-changing speed options the user has not chosen among (`docs/PERF.md`, 2026-11-16).

## 4. How to run

```sh
cd frontend && npm run dev                                   # :5200
blender -b --factory-startup --python scripts/oth/cars.py -- CAR=all        # the 18 kit cars (~7 s each) → *.glb, *.m.glb, cars.json
blender -b --factory-startup --python scripts/oth/cars.py -- CAR=forty,steppe
blender -b --factory-startup --python scripts/oth/offroader.py              # the Overlander
node scripts/harness/garageshots.mjs                          # the garage's pictures again (after a model or a colour changes)
node scripts/harness/fppshot.mjs <dir> forty,steppe           # first person, the dash, the levers — a PNG each
node scripts/harness/shifttest.mjs <dir> forty                # drive off, log the lever's gate and the hand
node scripts/harness/garageui.mjs <dir>                       # the garage's tabs: desktop, phone, phone sideways
ls src/assets/models/vehicles/{forty,steppe}.glb | xargs blender -b --factory-startup --python scripts/oth/coplanar.py --
npm test
```

`?car=<id>` · `?paint=rrggbb` · `?fpptilt=0.24` · `?fppfov=62` · V: first person.

## 5. Things that bite

- **A new dial is three things**: a gauge in `cars.py` (`G(kind, x, z, r, max=, unit=)` — ONE of each kind a car, at
  most 8: the canvas is 4 × 2 cells), the kit writes `dial_k` + `needle_<kind>` + `cars.json` `gauges`, and
  `Cockpit.ts` `dialTexture` draws it by `kind`. A new kind needs a branch in `dialTexture` and in `CockpitAnim.update`.
- **Angles**: a dial's `a0` / `sweep` are counter-clockwise from 3 o'clock, seen by the driver — a speedometer's sweep
  is −270° (clockwise). The needle's `axis` points at the driver.
- **The kit's `hip` is the seat's** (S0 + 0.40), no longer the hub − 0.36: moving the hub does not move the driver.
- **Floor levers and a bench seat**: the bench's front edge is at `COWL − 0.60`; the kit puts a bench car's levers at
  `COWL − 0.5`. A lever's `y` further back comes up through the cushion.
- **No backtick inside a GLSL template's comment** (it ends the string: `rockRelief.ts` did it once today).
- **`#ffffff` as a paint is "untinted"** (`Vehicle.ts` `isWhite`): use an off-white.
- zsh does not split `$FILES`: give `coplanar.py` its files through `xargs`.
- The dial texture is made per car in `buildMeshes` and disposed at the next car; 2 MB each.
- The baseline for A/Bs was a copy of `dist/` built from bd91498 in the session's scratch folder — gone at a reboot:
  build one from a worktree (`docs/PERF.md`, "the commit before from a worktree on :5201").
