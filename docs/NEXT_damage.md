# Car damage and the enemy's car on yours — the hand-off (2026-11-21)

Branch `companion`. What it is and its numbers: `docs/DAMAGE.md` (the spec — its json → `node scripts/oth/damage.mjs`
→ `proto/damage.json`). The code: `frontend/src/oth/Damage.ts`, `Vehicle.ts` (the crash watch, `blow`, `hitHint`),
`Companion.ts` (`drive`, `reach`, `poseCar`, `fixed`, `carBlow`), `gameplay/vehicle/VehicleSim.ts` + `Drivetrain.ts`
(what the damage takes from the wheels and the engine).

## Where it stands

Built, checked on the PC in headless Chrome, **never run on a phone**.

| | checked by | |
|---|---|---|
| a crash is found, placed and sized; the shell, glass, lamps, axles, tyres, engine, fire, the blast; repair | `scripts/harness/damagetest.mjs` | all pass |
| the spare wheel on the tail takes a knock (6 cars of 21 carry one) | `damagetest.mjs` (`ONLY=spare`) | pass |
| a dent keeps the car's colour | the pictures (`SHOTS=<dir>`) | seen |
| the enemy's car meets yours at its own body — from behind and on the side —, the blow is dead, he never goes backward in the second after, he is never inside your car; what is solid of him is his panel, not a box | `scripts/harness/ramtest.mjs` | passed 6 runs in a row at the end |
| the older harnesses | `enemy.mjs`, `companion.mjs`, `weapons.mjs`, `parktest.mjs`, `npm run test:wire` | see "What bites" |

The setting: SETTINGS › PLAY › CAR DAMAGE, **on** by default (`?damage=0`). The user's standing rule is "new optional
gameplay off by default"; on is my reading of "add damage … like a normal car gets damage" — theirs to change.

## 1. What was changed last (the user's second play-test, the same day)

> "some cars have a tyre on the back, the stepney: hitting it won't crack it, like reality. The crashed and broken
> thing will have the same colour, the dent and all. The enemy's car still has issues: when it hits me it goes back
> like it bounced off a balloon; when it hits on the side it does not touch my car's side — the collision must hit
> the car, not an invisible outer layer."

| said | what it was | what was done |
|---|---|---|
| the spare | nothing knew of it: a blow on it crumpled it like sheet metal and cracked the window over it | `CarDamage.findSpare` (found by shape), `spare.*` in the spec |
| the colour | the first cut scraped the paint to steel where the shell gave | the dent is the car's own colour; the scraps and the trim take it too |
| "bounced off a balloon" | after a ram he was sent back to a 16 m gap at once, at up to 4 m/s | a ram is a dead blow (half of what he closed at to each car); 1.4 s he keeps his weight on you, pushing; then he lets go — easing off if you drive on, backing away on his wheels only if you stand |
| "does not touch my side" | he was stopped by a distance between the two cars' MIDDLES (your half length) — your car across his way, that left him over a metre off its side | he goes as far as his car's own nose meets your car's own body: `Companion.reach`, one cast a step |
| "an invisible outer layer" | what was solid of him was the box round everything on him (mirrors, bars, spare): 33 cm outside his door on the off-roader, measured | his exact mesh, and his inner solid in 0.6 m sections; your own car's tyre guards (capsules 35 cm wider than the wheels) are no longer what he is stopped at |

## 2. What's left, in order

1. **The phone.** Nothing of this has been on one. Play it there; time a blow's frame (the pass over the shell is
   0.6–1.3 ms on the Mac for 72 627 vertices — several times that there, once a crash), the making of his car's solid
   body (12 ms on the Mac, once as his car appears), and a chase with him on your bumper (`reach`: 0.17 ms a step on
   the Mac in the steps the two could meet).
2. **Your car's CCD is off while his is within 10 m** (`Companion.ccd`; on again past 14 m) — see "What bites". It
   wants a drive at speed over rough ground with him on your tail, watching for the car going into the ground.
3. **A ram on a car that is moving and turning** can land up to a hand's breadth inside a corner or a wheel arch
   (measured −0.14 … +0.09 m in `enemy.mjs`; straight from behind or square on the side it is 1–2 cm): he is stopped
   at your car's inner solid pieces, 3 cm short, and those stand further in at the corners and are cut away at the
   arches. Trying his nose against your exact mesh is right to a centimetre and costs 2.7 ms a step on the Mac —
   too much for a phone. A cheaper exact answer: wheel-sized pieces in the arches, and the mesh only in the last step.
4. ~~**His own driving at you on foot** (`runDown`) does not try his nose against anything: he drives through your
   parked car.~~ **Done (2026-11-21, the evening)**: a parked car, once it stands, is HELD — a kinematic body, as his
   is, and two of those pass through each other. Now each step of his run casts his nose (`Companion.blocked`) against
   whatever is solid — your car's inner pieces, trees, rocks, walls, props; not the land, the roads' ribbons, the
   bridges' decks, you, a wheel's guard. Met at more than 2 m/s: a blow — your parked car is made live for it
   (`Vehicle.knocked`, its crash watch told it stood still) and takes half, his car the other half through your car's
   crash (main.ts, as a ram's); a tree or a wall gives his car the lot. Either way the run is over: he gets out.
   `scripts/harness/rundown.mjs` (his car 25 m behind yours at 8 m/s, you beyond it: he reaches 13 m/s, stops 7 cm
   off your car's solid pieces, it is shoved 4.6 m, both are damaged, he gets out).
5. **A door torn off** when it stands open in a blow (GTA IV's). Not built.
6. **Saved**: the damage is the session's — a reload, or another car from the garage, is whole.
7. **Co-op**: your car takes damage; the others' cars are not shown damaged and nothing of it is on the wire. (Their
   solid is no longer the box — 2026-11-21, the evening: their exact mesh and their inner pieces in 0.6 m sections,
   as the enemy's car has, once their model is in — `Remotes.ts` `carPieces`; `coopfight.mjs`: a ray at the other's
   door stops at 0.795 m from its middle, the box stood at 1.141. A friend's shots that stop on your car hole it:
   `Arsenal.ghost`. Its cost, `coopcost.mjs` on this PC, 1080p uncapped, ABBA: a friend in view +0.24 ms LOW, +0.12 ms
   ULTRA — MULTIPLAYER.md had +0.30–0.35 with the box; that A/B turns the drawing off, not the body, so the solid's own
   share in the physics step is not split out — and its making, once as their car's model comes in, ~12 ms as the
   enemy's: not yet on a phone.)
8. **Per-car numbers** (GTA IV's `handling.dat` multipliers): one table for every car; the engine is taken to be at
   the front; the bike takes no damage.
9. **Deeper**: the collider does not crumple with the shell; a flat tyre does not come off its rim with speed; nobody
   is set alight by a fire, only knocked down by the blast.

## 3. What bites

- **Rapier's CCD and a kinematic body a hair off.** Your car's body has CCD on. With his car stopped 1 cm from it
  and coming on, CCD held your car where it was for the rest of every step (4.5 cm moved in a step its speed made
  18, measured) and his went on into it — a quarter of a metre and more — and the contacts then threw both cars.
  Hence `Companion.ccd`. Do not put his car's stop at "touching" without that.
- **After a hard step the solver's contacts are gone.** `contactImpulse` / `numSolverContacts` read zero by the time
  the game looks (CCD runs the step in pieces): the crash is placed by the narrow phase's contact POINTS within 8 cm
  of touching (`Vehicle.blow`), and a ram — an impulse, nothing touching — by `Vehicle.hitHint`.
- **His place along your way must follow his car.** Held at your car, the place ran on without the car (1.8 m,
  measured); the step anything gave, the car was put there — 100 m/s of it. `drive` takes the place again from the
  car each step, and a step is never longer than his speed makes it. Moved far (brought beside him), his solid body
  is put, not swept (`fixed`).
- **A shape tried against a hollow mesh** from a hair off it answers "already inside, on its way out" and stops
  nothing: `reach` asks only for steps that bring the two nearer, with `stopAtPenetration`.
- **He must not give way.** Cutting his step by your car's motion too, he backed off in front of a car driven at
  him and there was no crash at all; the cut is of his own step, to nothing at the most.
- **One crash, one blow.** Pressed on, a body gets a change of velocity every step; each was a blow, and two cars
  wore each other's engines out in a second. For 330 ms only a harder one counts (`Vehicle.blow`).
- **The harnesses that drive blind.** Flat out for more than ~2.5 s from the spawn the car leaves the track and goes
  nose-first into a bank at 75 km/h — a real crash, and with damage on it now wrecks the run (`companion.mjs` asks
  to get out till it is out; `ramtest.mjs` and `damagetest.mjs` drive 2.2–2.4 s).
- **Failing now and then**: `enemy.mjs` — "his blows land (0)" (from before this work, cause not found); "back in
  the cars, his joins your way" with him on foot — found (2026-11-21, the evening): it was YOU still on foot, the
  fight had drifted 20 m and more from your car and F only gets you in within 3.2 m of its door; the harness puts you
  by it now. `ramtest.mjs`'s "it met your car on its flank" — he met its end: your car was turned a quarter from its
  own heading after a braked stop that had slid askew to its way; it is turned square to the way's last 4 m now. `weapons.mjs` failed every run until it held him off before walking clear — he is on you sooner now.
- Editing `src/` while a harness runs reloads its page (Vite) — and the user's phone.

## 4. Running it

```
cd frontend
npx vite --port 5200 --strictPort            # the harnesses' server
node scripts/harness/damagetest.mjs          # ONLY=drive,wall,repair,side,drop,spare,shots,gun,enemy,cost  SHOTS=<dir>
node scripts/harness/ramtest.mjs             # the enemy's car on yours, every physics step  SHOTS=<dir>
node scripts/oth/damage.mjs                  # the spec's numbers → proto/damage.json (--check)
blender -b --factory-startup --python scripts/oth/damage.py -- PREVIEW=<dir>   # the debris, the cracks
npm run dev:lan                              # the phone: https://<this machine's address>:5300/
```

The phone and the Mac: with Ethernet and Wi-Fi both up on the same address range, macOS answered the phone through
the Wi-Fi link, which reached nothing — the page never loaded. Wi-Fi off on the Mac (or the Wi-Fi address) and it does.
