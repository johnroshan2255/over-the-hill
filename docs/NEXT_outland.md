# NEXT — the outland: what's left (hand-off, 2026-11-12)

What was done is in `docs/NEXT.md` §8 (the seams), §9 (the autopilot), §10 (the outland dressed); the costs in
`docs/PERF.md`. This is the list of what is NOT done yet, in the order I'd take it. The rules still hold (CLAUDE.md, the
memory): no sub-agents, test with `?save=0`, measure every change per tier (`abq.mjs`, interleaved), check it in a real
Chrome window (`HEADFUL=1` on the harness scripts) and drive it in with the keys before calling it done. Targets: 500+ fps
at ULTRA on the laptop, 60 fps constant at ULTRA on a Snapdragon 6-series phone.

## 1. The Wardens' ruins (`src/oth/Wardens.ts`)

| what | why / how | where |
|---|---|---|
| **The giants' shapes** | The Sword-Bearer reads as a figure now; the KNEELING WARDEN is still crude (box legs, a ball on two sticks). Give her real kneeling legs (thigh, shin, foot on each side), a torso that leans, arms that hold the stone sun from below. The FALLEN HEAD needs a face that reads at 200 m (deeper eye sockets, a beard / a helm). Stay on the kit's budget (≤ ~600 triangles a piece: they're instanced) | `KIT.kneel`, `KIT.head`, `KIT.statue` |
| **The beacons light when reached** | Each tower's crystal is lit or not at random. Make them DARK until the player reaches the tower (a found landmark), then lit for good — "light the chain". Needs a per-instance on/off: two kinds (`crystal` / `crystalDark`) and moving the instance between them when found, or a found mask in a small texture | `Wardens` (rebuild the lists on discover), `main.ts` onDiscover |
| **The writing's cipher** | The 36 texts are plain English. The idea (the user liked it): the Warden script UNREADABLE at first (runic glyphs), each stone read teaches letters, the card fills in. Map letters → glyphs by a fixed shuffle; reveal `k` letters where k grows with the count read (`oth.wtexts.<map>`) | `main.ts` noteHud, the note card (`readouts.note`) |
| **More writings** | 36 texts over 538 stones: they repeat. Write ~60 more (the Wardens' story: the Tree, the Grey, the beacons, the giants found asleep, the leaving; small human ones — builders, children, lovers, lists). Our own words — no text from any game | `WRITINGS` |
| **Secret places** | Promised to the user, not built: a SEALED DOOR in a hillside (a carved frame against a steep face; opened with the winch: a keystone pulled out, a small vault behind with ◆), a SUNKEN STAIR (a ring wall, steps down into a pit — needs the ground cut: GroundEdits-style or a mesh pit), a hidden valley through a crack. Place them on the steep faces the crags avoid | new site kinds in `planWardens` |
| **Stairs and fallen columns collide** | A stair has no collider (the car drives through it); a fallen column / the toppled giant use axis boxes. Props' colliders turn only about y: add an optional quaternion to `PropCollider` (Physics streams it) and give stairs a tilted ramp box | `Props.ts`, `Physics.ts`, `Wardens.ts` |
| **The names on the map** | 502 sites crowd the chart; the compass shows ruins within 1.2 km only. On the map: show a ruin's icon only once found (or within the radar), the big ones (towers, giants) always | `MapView.ts`, `Chart.ts` |
| **Grass under the floors** | Out past the box there's no footprint texture: the grass grows through the temples' platforms where they're low. Either raise the platforms a little more, or give the outland a coarse footprint (an 8 m grid the grass bake reads) | `Grass.ts` (FIELD bake), `Wardens.ts` |
| **Sites near water and on the lakes** | No ruin stands in or by a lake yet (the "Drowned Shrines" region idea): a temple half in the water, stepping stones to an island shrine, the Hand in the Lake | `planWardens` (the lakes: `meta.outland.lakes`, `lakeAt`) |
| **Regions' character** | Every region gets the same mix and the same stone. The plan was: the north's snow (the Frozen Court — paler stone, more towers), the east's lakes (drowned shrines), the World Tree's south-east (gardens, lanterns, root arches), the canyon's north-west (carved walls, the Scribes). A tint per instance needs `instanceColor` through the wood material (check the gfx layer supports it on WebGPU) | `Wardens.ts`, `Bridges.ts` VERT |

## 2. The land's dressing (`Rocks.ts` crags, `Trees.ts` parkland, `Bushes.ts`)

| what | why / how |
|---|---|
| **Grass caps on the crags** | The references' cliffs have grass on every top; ours are grey blocks. Tint a crag's up-facing faces toward the ground's paint (the outland mask's dryness: green / gold) in the rock shader — `OTH_CRAG` define on the crag meshes' material |
| **The steepest faces** | Over ~0.75 slope only the crags dress them (0.42 of the cells); big faces still show stretches of smooth painted rock. Try a denser band where the face is seen from a road (a view test against the road net), not everywhere — cost |
| **The oak up close** | Its leaf cards are stretched 1.5× across: up close (inside ~10 m) the crown is big dark ovals. A real oak geometry (`treeGeometry.ts`, its own family: 2 more draws + its impostor row) would fix it; or more, smaller cards |
| **Flowers** | The references' meadows have colour; the outland has three flower meadows (`uMeadow0–2`). More meadows (cheap: they're in the ground's paint and the grass bake) |
| **Green vs gold** | The outland's grass is the valley's autumn gold; the Genshin frames are green. Not changed (the game's own look) — ask the user before touching it |

## 3. The autopilot (`src/oth/Autopilot.ts`, §9 of NEXT.md)

- Not tested on a **phone** (the AUTOPILOT button over the speedometer, touch takeover), through **the pass to the desert** (`guide.viaGate`), or in **co-op**.
- Not tested **with the new crags and ruins** in the way: the ray fan sees them (they're Static colliders), the GPS doesn't plan round crags (it does round the ruins — they're places). Drive a few long routes over the outland (`ap.mjs`) and look for new stalls.
- Top speed 45 km/h by choice (`V_ROAD`): one constant if the user wants it faster.

## 4. The seams (§8)

- The box's own tracks end where its texture ends (one stops ~20 m short of an outland road at (2048, −250)).
- The roads' deep cut banks keep their teeth inside the 15 m `walls.mjs` keeps round each road.
- `SET=outland trackdrive.mjs` not re-driven since the walls (the roads' cells are unchanged to the bit).
- **Re-run `node scripts/oth/walls.mjs` after any `wilds.py` / `outland.py` run** (delete `scripts/oth/.cache/valley-prewalls` first).

## 5. Performance

- **Measure on a real phone** (₹15k Snapdragon 6-series, ULTRA): nothing of today's was. On a weak GPU the crags draw at 0.65× and the ruins at 0.7× of their reach.
- **The spawn view is under 500 fps at ULTRA** on the laptop (2.0–2.26 ms — it was before today's work too). Find what grew there (`abq.mjs` with the cut switches, `?perfmark=1` F9 marks while driving).
- A giant filling the view: 504 fps ULTRA — the margin is thin; a far LOD for the big kit pieces (towers, statues: a 1/4-triangle version past ~600 m) would buy it back.
- Load time grew ~0.35 s (the ruins' plan 0.16 s, the trees +0.17 s).
