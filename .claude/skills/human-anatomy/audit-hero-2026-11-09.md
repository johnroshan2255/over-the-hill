# Anatomy audit: the hero (`frontend/src/assets/models/human/character.glb`), 2026-11-09

## 2026-11-11: a man's frame, cut clothes, the arms' carriage (`hero.py`)

The user: "him walking, his body structure all looks gay … make him like a perfect guy, add a shirt and cargo-like
pants, not leggings". Measured (anatomy_check.py; the clips' joints frame by frame), what read wrong and what was done:

| item | before | after | average man |
|---|---|---|---|
| hip joints apart | 0.229 | **0.191** (each leg 1.9 cm in) | 0.17–0.20 |
| across the thighs' top / the hips, clothed | 0.393 / 0.388 (wider than the chest: an hourglass) | **0.37 / 0.357** | hips 0.36 + cloth |
| waist, bare | 0.241 × 0.161 (hero_fit widened the clothed one to 0.289) | **0.289 × 0.193** (in hero.py: the shirt is cut on it) | 0.28–0.30 × 0.20–0.22 |
| chest, clothed | 0.330 × 0.246 | **0.348 × 0.261** | 0.33 × 0.25, athletic +5–8 % |
| neck breadth | 0.113 | **0.130** | 0.12 |
| trousers | his skin + 2 cm: every muscle of the thigh, the seat and the calf; the hem 9 cm over the boot | **a cut**: 18 cm across at the thigh, 15.6 at the knee, 14.8 from the calf to a hem over the boot; cargo pockets | — |
| boots | the bare foot + 1.7 cm: a pointed slipper, 2 cm high at the toes | **a last**: a round toe box 6 cm high, a 1.7 cm outsole with a heel; 0.29 × 0.11 | 0.29 × 0.11–0.12 |
| elbows from the centre line, walking / standing | 0.28–0.31 (17–21° out) | **0.24** | ~0.21–0.23 |
| wrist cocked, walking / standing | 12–15° / 19–21° | **6–7° / 11°** | near straight |
| clavicles lowered in the clips | 9° | **6°** (9° sloped the shoulders off the neck once the arms came in) | slope 15–25° |
| thighs turned in (hero_fit) | 2.5° | **1°** (step width walking 0.143) | 0.10–0.15 |
| triangles | 16 653 | **16 837** (the outsoles) | — |
| draw cost (this Mac, 1080p uncapped, charcost.mjs) | 0.023 ms LOW · 0.05 ms ULTRA | 0.023 ms LOW · 0.03 ms ULTRA (noise) | — |

The same day, after the user played him ("while running / walking his shoulder goes a bit down and in idle it goes up —
I want it in between … one side has more gap from the body and the other has no gap … put a shirt on him"): measured in
the chest's own frame, clip by clip —

| item | before | after |
|---|---|---|
| shoulder joint under the neck's base: idle / walk / run | 5.0–6.5 / 10.1–10.4 / 6.5–7.1 cm | **8.2–8.6 cm in every standing / moving clip** (the clavicles' mean lift −18°) |
| upper arm's spread, left / right: idle, walk | 8.2° / 9.3°, 12.0° / 8.2° | **11.7° / 11.8°, 11.8° / 11.7°** |
| elbow out from the chest's centre, left / right: idle, walk | 0.228 / 0.249, 0.259 / 0.230 | **0.249 / 0.247, 0.260 / 0.260** |
| wrist out, left / right: idle, walk | 0.223 / 0.226, 0.235 / 0.230 (then 0.235 / 0.272 once the upper arms matched) | **0.246 / 0.244, 0.250 / 0.255** |
| shirt | short sleeves, olive: read as a T-shirt | long sleeves rolled on the forearm, a red-and-black check |

Then ("change the shirt to something like a jacket … make him look good, a cargo and a suitable jacket"): the top is a
brown leather jacket worn open over a grey crew-neck T-shirt — a collar, a zip on each front, two flapped pockets,
shoulder straps, a knit waistband over the belt (its hem 3 cm under the belt's lower edge) and knit cuffs at the wrists.

| item | the check shirt | the jacket |
|---|---|---|
| chest, clothed | 0.363 × 0.268 | **0.373 × 0.275** (leather 15 mm off him; 26 mm over the belt) |
| sleeve across: biceps / elbow / wrist | 0.126 / 0.118 / ended mid-forearm | **0.138 / 0.126 / 0.080** (to the wrist, a 5 cm cuff) |
| the garment's edges | his skin's own rings: a slope across a quad | **cut into the mesh**: the hem, the two fronts, the cuffs — two rings 3 mm apart (+440 vertices) |
| triangles | 16 837 | **17 717** |
| draw cost (this Mac, 1080p uncapped, charcost.mjs) | 0.019 ms LOW · 0.012 ms ULTRA | 0.016 ms LOW · 0.035 ms ULTRA (noise) |

## After the fit (`frontend/scripts/oth/hero_fit.py`, 2026-11-09)

| item | before | after | average man |
|---|---|---|---|
| bones | 22 (fingers fused to the hand) | **52**: + thumb / index / middle / ring / pinky × 3 a hand | — |
| hands | frozen, splayed | curled by the game: open / relaxed / grip / fist (`Character.ts` HAND_POSES) | grips the wheel, the bars, the tools |
| upper arm / forearm | 0.290 / 0.232 | **0.310 / 0.250** | 0.31 / 0.25 |
| arm span / stature | 0.96 | **1.01** (1.842 / 1.830) | 1.00–1.03 |
| head pivot (z) | 1.600 (3.5 cm over the chin) | **1.645** | earlobe level |
| head | 6 % big | 5 % smaller (stature 1.840 → 1.830 to the hair's top) | 7.5 heads |
| waist breadth × depth | 0.261 × 0.183 | **0.289 × 0.200** | 0.28–0.30 × 0.20–0.22 |
| seat behind the lower back | 3.7 cm | +1.5 cm at its fullest (not re-measured) | 5–7 cm |
| boot width | 0.135–0.144 | **0.118** | 0.11–0.12 |
| stance (every clip) | legs straight down from hip joints 23 cm apart | thighs in 2.5°, shins and feet as they were | feet under the hips |
| leg girth, thigh top / knee / calf (jeans on) | 0.577 / 0.409 / 0.478 | **0.521 / 0.362 / 0.423** (the user: too big for his upper body) | bare 0.60 / 0.39 / 0.39 |
| torso pitch, idle / walk (+ forward) | −6.0° / −3.9° (head 7 cm behind the ankles) | **−0.5° / +1.1°** (head over the ankles) | upright to +5° |
| GLB | 1405 kB | **1200 kB** (the clips' unused channels pruned) | — |
| posing cost (this PC, Chrome) | 19 µs idle / 31 µs running | 29 / 50 µs a frame | — |

Not changed: the hip joints' spacing in the mesh (moving the legs in would sink the thighs into each other — they
already touch near the crotch, as a muscular man's do); the clavicles' angle (the user's SHOULDER_BACK in hero.py);
the eyes' size; the boots' sole and heel; the beard's edge; no forearm-twist, jaw or eyelid bones.

## Before the fit

Measured with `frontend/scripts/oth/anatomy_check.py` (bind T-pose, Blender 5.2) against `SKILL.md` (adult male).
His stature is 1.840 m to the top of the hair; the skull's top is ≈ 1.815 m (H for the ratios below). The boots add no
height: hero.py keeps the sole at z = 0.

## His bones beside an average man's (scaled to H = 1.815 m)

y is measured from the plane through the hip joints (his hip joints are at y = −0.036 in the GLB).

| bone | his x | ref x | his y | ref y | his z | ref z | Δ that matters |
|---|---|---|---|---|---|---|---|
| Hips | 0 | 0 | −0.007 | 0 | 0.949 | 0.99 | (the root: a convention) |
| Spine | 0 | 0 | +0.029 | −0.03 | 1.072 | 1.09 | ok |
| Spine1 | 0 | 0 | +0.040 | −0.03 | 1.178 | 1.19 | ok |
| Spine2 | 0 | 0 | +0.043 | −0.02 | 1.311 | 1.33 | ok |
| Neck | 0 | 0 | −0.005 | −0.04 | 1.521 | 1.51 | ok |
| **Head** | 0 | 0 | +0.019 | −0.01 | **1.600** | **1.65** | **pivot 5 cm low: 3.5 cm above the chin, ref 7–8** |
| Shoulder (SC) | ±0.031 | ±0.025 | +0.070 | +0.03 | 1.495 | 1.47 | the clavicle runs 34° back (ref ~20°), +15° more in the clips |
| Arm (shoulder joint) | ±0.183 | ±0.18 | −0.029 | −0.02 | 1.456 | 1.44 | ok |
| **ForeArm (elbow)** | ±0.473 | ±0.49 | | | | | **upper arm 0.290, ref 0.313 (−2.3 cm)** |
| **Hand (wrist)** | ±0.705 | ±0.75 | | | | | **forearm 0.232, ref 0.252 (−2.0 cm)** |
| **UpLeg (hip joint)** | **±0.114** | **±0.09** | 0 | 0 | 0.971 | 0.96 | **hips' joints 23 cm apart, ref 18** |
| **Leg (knee)** | **±0.114** | **±0.085** | 0 | +0.01 | **0.542** | **0.517** | **knee 2.5 cm high; the legs don't converge** |
| Foot (ankle) | ±0.114 | ±0.08 | −0.052 | −0.03 | 0.087 | 0.071 | ankle 1.6 cm high (the boot) |
| ToeBase (ball) | ±0.114 | ±0.085 | +0.091 | +0.11 | 0.015 | 0.02 | ok |

## Lengths and sizes

| measure | his | ref (♂, 1.815 m) | verdict |
|---|---|---|---|
| head (chin → skull top) | ≈ 0.25 | 0.237 | 6 % big (7.3 heads tall, ref 7.5–7.75) — mild |
| eyes' height / the head's half | 1.700 / ≈ 1.69 | at the half | ok |
| interpupillary | 0.067 | 0.064 | ok |
| eyeball (its height) | 0.030 | 0.024 | 25 % big — check close up |
| neck breadth | 0.138 | 0.12–0.13 | ok (athletic) |
| shoulders (bideltoid, idle) | ≈ 0.52 | 0.49 | athletic, ok |
| chest breadth / depth | 0.329 / 0.245 | 0.33 / 0.25 | ok |
| **waist breadth / depth** | **0.261 / 0.182** | **0.29–0.30 / 0.20–0.22** | **pinched 3–4 cm both ways** |
| hip breadth (with the jeans) | 0.39 | 0.36 + cloth | ok |
| buttocks behind the lower back | 3.7 cm | 5–7 cm | flat (the jeans' smoothing) |
| thigh / shank | 0.429 / 0.459 | 0.445 / 0.447 | the shin 3 % long, the thigh 4 % short — mild |
| **arm (shoulder → fingertip)** | **0.70** | **0.75** | **5 cm short; the fingertips hang ~7 cm above mid-thigh** |
| forearm / upper arm | 0.80 | 0.80 | ok |
| hand (wrist → fingertip) | 0.178 (curled) | 0.19 | ok-ish: the fingers are curled, so the true length is longer |
| **boot length / width** | 0.298 / **0.144** | 0.29 / 0.11–0.12 | **3 cm too wide** |
| **boot shaft at the ankle** | **0.070 wide** | 0.10–0.11 | **skin-tight, like a sock** |
| inner thighs touching | 0.735 → 0.90 | a gap below the crotch | fused 16 cm down the thigh |

## The skeleton (22 bones, Mixamo's set)

| missing | what it does to him |
|---|---|
| **finger bones** (hero.py folds every finger onto the hand) | the fingers are locked in their bind shape, splayed and stiff, in every clip: they never close on the wheel, the bars, the axe or the pick |
| forearm / upper-arm twist | the wrist twists like a candy wrapper when the hand turns |
| jaw, eyes, eyelids | no blink, the eyes can't look, the mouth never moves |

## Other things the renders show

- The boots read as flat slippers from the side: no heel block, a thin sole, a pointed toe that turns up.
- The jeans end in a flat cut above the boot (no break, no stacking).
- The beard's edge is a sawtooth (the card's alpha baked as solid).
- The GLB carries a stray 42-vertex `Icosphere` mesh (no weights; the game skips it).
