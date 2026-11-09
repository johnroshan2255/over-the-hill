---
name: human-anatomy
description: Adult human proportions, joint placement and range of motion for checking or building a game character (mesh, skeleton, clothing, animation). Use when the user asks whether the character looks human, about body-part sizes, limb lengths, shoulders, hips, feet, hands, the head, or "check against human anatomy".
---

# Human anatomy for a game character

Reference numbers for an adult man. Use them to **measure** a model, not to eyeball it. All heights are fractions of
stature **H** (barefoot, top of skull, no hair); the absolute column is for **H = 1.80 m**. Sources: Drillis & Contini
(1966) / Winter, *Biomechanics and Motor Control of Human Movement* (segment lengths); ANSUR II (US Army 2012, men,
50th percentile: breadths and depths); standard art-anatomy canon (Loomis, Bridgman) for landmarks. Real people vary by
±5 %; a stylised hero can push breadths, but **joint heights and segment ratios should hold**, or the animation looks wrong.

## 1. Heights (standing, from the floor)

| landmark | × H | at 1.80 m | how to find it on a mesh |
|---|---|---|---|
| top of skull (vertex) | 1.000 | 1.80 | highest skin vertex (not hair) |
| eyes (pupils) | 0.936 | 1.685 | halfway between chin and vertex |
| chin (menton) | 0.870 | 1.565 | lowest point of the face on the centre line |
| suprasternal notch (top of sternum) | 0.818 | 1.47 | dip between the collarbones |
| shoulder joint centre (glenohumeral) | 0.79–0.80 | 1.43 | ~4 cm below the acromion (the shoulder's top) |
| nipples | 0.72 | 1.30 | |
| elbow (arm hanging) | 0.63 | 1.13 | ≈ the lowest rib / just above the navel |
| navel / natural waist | 0.60 | 1.08 | narrowest part of the torso is ~2–4 cm above |
| hip joint centre | 0.53 | 0.95 | level with the greater trochanter |
| wrist (arm hanging) | 0.485 | 0.87 | ≈ crotch / bottom of the buttocks |
| crotch | 0.47 | 0.84 | ~9–11 cm below the hip-joint centres |
| fingertips (arm hanging) | 0.377 | 0.68 | mid-thigh |
| knee joint | 0.285 | 0.51 | |
| ankle (lateral malleolus) | 0.039 | 0.07 | |

Canon: **7.5 heads** tall (head = chin to vertex ≈ 0.13 H = 0.235 m; a "heroic" figure is 8 heads with the same head).
Half the height is at the **pubic bone**, not the navel.

## 2. Segment lengths (joint centre to joint centre)

| segment | × H | at 1.80 m | check |
|---|---|---|---|
| clavicle (sternum → acromion) | 0.085 | 0.15 | runs out and **~20° back**, slightly up |
| upper arm (shoulder joint → elbow) | 0.172 | 0.31 | (Drillis' 0.186 H = 0.335 is from the acromion's top) |
| forearm (elbow → wrist) | 0.139 | 0.25 | forearm / upper arm ≈ **0.80** |
| hand (wrist → middle fingertip) | 0.108 | 0.19 | hand ≈ face height (chin → hairline); palm ≈ fingers |
| thigh (hip → knee) | 0.245 | 0.44 | thigh ≈ shank |
| shank (knee → ankle) | 0.246 | 0.44 | |
| foot (heel → big toe) | 0.152 | 0.27 | ankle joint ~25 % of foot length from the heel |
| arm span (fingertip to fingertip) | 1.00–1.03 | 1.80–1.85 | span ≈ stature |
| neck (chin to notch, front) | | 0.07–0.09 | back of neck: hairline → C7 ≈ 0.10–0.12 |

## 3. Breadths and depths (ANSUR II men, P50, ±1 SD ≈ ±5–8 %)

| measure | m | note |
|---|---|---|
| bideltoid (shoulders, outside the deltoids) | 0.49 | athletic up to 0.52; > 0.55 reads as a bodybuilder |
| biacromial (bone tip to tip) | 0.40 | shoulder **joint centres** ≈ ±0.175–0.19 |
| chest breadth / depth | 0.33 / 0.25 | |
| waist breadth / depth | 0.30 / 0.22 | athletic 0.28 / 0.20; narrower than 0.27 looks pinched |
| hip breadth (bitrochanteric) | 0.36 | |
| hip-joint centres apart | 0.17–0.20 | ±0.09 from the centre line |
| buttock depth | 0.25 | buttocks 5–7 cm behind the lower back |
| neck breadth / depth | 0.12 / 0.12 | |
| head breadth / length | 0.155 / 0.197 | + ears ≈ 0.18 wide |
| interpupillary | 0.064 | eyeball 24 mm; eye opening ~30 × 10 mm |
| hand breadth (palm) | 0.09 | |
| foot breadth | 0.10 | a boot ≈ 0.11–0.12; boot shaft ≈ 0.10–0.11 wide |
| mid-thigh / calf / ankle breadth | 0.17 / 0.12 / 0.075 | |

### 3b. Circumferences (ANSUR II men P50, scaled to 1.80 m; for clothing ease and girth checks)

| part | m | | part | m |
|---|---|---|---|---|
| head | 0.57 | | hip / buttocks | 1.00 |
| neck | 0.39 | | thigh (top) | 0.60 |
| chest | 1.02 | | knee | 0.39 |
| waist (natural) | 0.87 | | calf | 0.39 |
| biceps (relaxed) | 0.33 | | ankle | 0.23 |
| forearm | 0.29 | | foot (ball) | 0.25 |
| wrist | 0.175 | | | |

An athletic build: chest +5–8 %, waist −5 %, biceps / thigh / calf +5–10 %; the joints (wrist, knee, ankle) unchanged.

### 3c. Head and face (the canon: the head 5 eyes wide, the face in thirds)

| measure | m | note |
|---|---|---|
| head height (chin → vertex) | 0.235 | eyes at its half |
| face (hairline → chin) | 0.19 | thirds: hairline → brow → nose base → chin, ~6.3 cm each |
| ears | 0.063 long | top at the brow, bottom at the nose base; set just behind the head's mid-depth |
| nose | 0.055 long, 0.035 wide | projects 2–3 cm from the face |
| mouth | 0.05 wide | the corners under the pupils |
| eye width (opening) | 0.030 | one eye's width between the eyes |
| head pivot (atlanto-occipital) | | level with the earlobe, ~7–8 cm above the chin, just in front of the ear canal's line |

## 3d. Bone positions: the Mixamo 22-bone skeleton on an average man (H = 1.80 m)

Joint centres in the **bind T-pose**, metres. x = lateral (the left side −x), y = forward (+) from the plane through
the hip joints, z = up from the floor, barefoot. Scale everything by H / 1.80 for another stature (add the shoe sole to
z). The spine bones' y is a rig convention (Mixamo puts them ~⅓ of the body's depth in from the back) — ±3 cm.

| bone (its head = this joint) | anatomical joint | x | y | z | parent |
|---|---|---|---|---|---|
| Hips | the root: between the hip joints, a little above | 0 | 0 | 0.98 | — |
| Spine | L3–L4 (the navel's level) | 0 | −0.03 | 1.08 | Hips |
| Spine1 | T12–L1 (the lowest ribs) | 0 | −0.03 | 1.18 | Spine |
| Spine2 | T7 (mid chest, the nipples' level) | 0 | −0.02 | 1.32 | Spine1 |
| Neck | C7–T1 (the base of the neck) | 0 | −0.04 | 1.50 | Spine2 |
| Head | atlanto-occipital (the skull on the spine) | 0 | −0.01 | 1.64 | Neck |
| L/R Shoulder | sternoclavicular (beside the notch) | ±0.025 | +0.03 | 1.46 | Spine2 |
| L/R Arm | glenohumeral (the shoulder joint) | ±0.18 | −0.02 | 1.43 | Shoulder |
| L/R ForeArm | elbow | ±0.49 | −0.02 | 1.43 | Arm |
| L/R Hand | wrist | ±0.74 | −0.02 | 1.43 | ForeArm |
| (middle fingertip) | | ±0.93 | −0.02 | 1.43 | |
| L/R UpLeg | hip joint (femoral head) | ±0.09 | 0 | 0.95 | Hips |
| L/R Leg | knee | ±0.085 | +0.01 | 0.51 | UpLeg |
| L/R Foot | ankle (talocrural) | ±0.08 | −0.03 | 0.07 | Leg |
| L/R ToeBase | the ball (metatarsophalangeal) | ±0.085 | +0.11 | 0.02 | Foot |
| (toe tip / heel) | | | +0.19 / −0.08 | 0 | |

Arms hanging (the idle): elbow z 1.12 (x ±0.21: the carrying angle swings the forearm out ~10°), wrist 0.87, fingertip
0.68 — mid-thigh.

## 4. Placement and alignment (what a measuring tape misses)

- **Plumb line (side view, standing relaxed):** ear lobe → shoulder joint → hip joint → just in front of the knee →
  just in front of the ankle. The shoulder joint sits in the **middle of the chest's depth**, not behind it.
- **Arms hang at the side seam** of the trousers, palms facing the thighs, elbows slightly bent (~10–15°). A hand
  behind the buttock = shoulders pulled too far back.
- **Legs converge:** the femur slopes inward ~9° (knees closer together than the hips); feet under the hips or a little
  inside them. Perfectly vertical columns from wide hips read as a robot / a wide stance.
- **Shoulder slope:** the trapezius falls from the neck to the shoulder at ~15–25°; a flat line is a coat hanger, a steep
  hump a bodybuilder.
- **Spine curves:** neck forward (lordosis), chest back (kyphosis), lower back forward (lordosis), pelvis tipped ~10°.
- **Pelvis:** the top of the hip bone (iliac crest) ≈ navel height; the belt sits on it.
- **Thighs:** a gap from the crotch down is normal; touching inner thighs from mid-thigh is a heavy / very muscular build.
- **Foot:** heel pad ~2–3 cm thick, arch, toes splay; a boot adds a 1–1.5 cm sole and a 2–3 cm heel.

## 5. Range of motion (for IK limits and to catch broken clips)

| joint | range |
|---|---|
| neck | flex 50°, extend 60°, turn ±80°, tilt ±45° |
| shoulder | flex 180°, extend 50°, abduct 180°, rotate ±70–90° |
| elbow | 0–145° flex only (never bends backward); forearm twist ±80° (in the forearm, not at the wrist) |
| wrist | flex 80°, extend 70°, side 20° / 30° |
| fingers | each knuckle 0–90°, the thumb opposes |
| spine (total) | flex 80°, extend 25°, turn ±45° (mostly the chest), side ±35° |
| hip | flex 120°, extend 20°, abduct 45°, rotate ±40° |
| knee | 0–140° flex only |
| ankle | up 20°, down 50°, in/out 30° / 20° |

## 6. Skeleton a human-looking game character needs

Minimum (Mixamo 22): hips, 3 spine, neck, head, clavicle, upper arm, forearm, hand, thigh, shin, foot, toe. Without these
it looks wrong in specific ways:

| missing | the symptom |
|---|---|
| finger bones (3 per finger, thumb) | hands frozen in one shape: can't grip a wheel, bars, a tool |
| forearm twist bone | the wrist "candy-wraps" when the hand turns |
| upper-arm twist | the deltoid / biceps twist when the arm rotates |
| jaw, eyes, eyelids | no blinking, eyes can't look, mouth never moves |

## 7. How to check a model

1. Measure in Blender, bind pose: `blender -b --factory-startup --python frontend/scripts/oth/anatomy_check.py -- GLB=<model.glb> OUT=<dir>`
   — it writes `measure.json` (joints, the widths and depths at each level, limb lengths, eyes, the crotch) and front /
   side / head renders with a stature ÷ 8 grid, plus a posed frame.
2. Subtract the shoe sole and the hair from the stature before taking the ratios.
3. Compare every row in §1–§3; flag anything outside ±5 % (heights, segments) or ±10 % (breadths).
4. Check §4 in the side render and a posed frame (the hands' place, the plumb line, the legs' convergence).
5. Check §6 against the skeleton; play the clips that grip or turn the hand.
6. Then look at it in the game on the chase camera — a number that fits can still read wrong in motion.

The last audit of the game's hero: `audit-hero-2026-11-09.md` (beside this file): his bones and sizes against these.
