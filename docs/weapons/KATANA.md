# The katana — and its two kinds: the fire blade, the thunder blade

The Japanese long sword: a single curved edge, a two-handed grip wrapped in cord over ray skin, a small round guard.
Carried edge up in its scabbard at the left hip, drawn and cut in one motion. The model is our own
(`scripts/oth/weapons.py`): one sword, two kinds — told apart by the grip's cord, the guard, and what the blade does.

## The real sword

| | |
|---|---|
| blade (nagasa) | 0.72 m, curved 1.8 cm (sori) |
| grip (tsuka) | 0.27 m — two hands, a fist apart |
| whole length | 1.03 m |
| mass | 1.15 kg, balanced 13 cm ahead of the guard |
| edge | one, the back thick (7 mm) — it cuts on the draw, not the chop |

## The cut

A cut is a swing about the wrists and the shoulders: the blade turns about 110° in ~0.12 s — **16 rad/s**; the tip,
1.0 m from the hands and with the arms' reach about 1.6 m from the shoulder, moves at **~25 m/s**. Its turning
weight about the grip is ⅓ · m · L² ≈ ⅓ · 1.15 · 1.0² = 0.38 kg·m², so the blade alone carries ½ · 0.38 · 16² ≈
**50 J** — little beside a bullet's 562 J, but on a hand's width of edge and with the arms behind it. It reaches
**1.9 m** from the centre of the body (the arm's 0.65 m, the blade's 0.72 m, the step into the cut), across an arc.

## The tick

Every cut is counted in ticks (50 ms). A cut has three parts: the **wind-up** (the blade goes back — nothing is hit),
the **edge** (the ticks in which the blade is in the arc: whoever is in it is hit once), the **recovery** (it can be
cancelled into the next cut of the combo, never into a dodge).

| cut | wind-up | edge | recovery | whole | arc | reach | damage |
|---|---|---|---|---|---|---|---|
| 1 — a rising cut from the left hip (the draw's own) | 2 | 2 | 4 | **8 ticks (0.40 s)** | 110° | 1.9 m | 34 |
| 2 — back across, right to left, level | 2 | 2 | 4 | **8 ticks (0.40 s)** | 120° | 1.9 m | 34 |
| 3 — down from overhead, a step in | 3 | 2 | 6 | **11 ticks (0.55 s)** | 50° | 2.1 m | 48 |
| heavy (`U`) — a lunge and a level sweep right round | 5 | 3 | 8 | **16 ticks (0.80 s)** | 200° | 2.3 m | 60 |

`J` again inside a cut's recovery goes on to the next of 1 → 2 → 3; three ticks without it and the combo starts over.
A cut to the head (the edge passing ≥ 1.52 m up the capsule: cut 3 always) × 1.5. No falloff. A cut can't be thrown
while another is on its wind-up or its edge. Blocking: none yet.

## The two kinds

You carry **one katana** — picking up the other kind leaves the one you had where the new one lay. Each has an
**ability on `I`** (phones: the ABILITY button): it wakes the blade for a while; then it must rest.

| | the FIRE blade — *Homura* | the THUNDER blade — *Raiden* |
|---|---|---|
| looks | red cord, a brass guard cut as flames; awake: the edge glows orange, flames run up the blade, embers trail a cut | indigo cord, a steel guard cut as a three-comma wheel; awake: the edge glows blue-white, small arcs crawl along it, a cut leaves a flash |
| awake for | **160 ticks (8 s)** | **160 ticks (8 s)** |
| rests for | **400 ticks (20 s)** from the moment it wakes | **400 ticks (20 s)** |
| each cut also | **sets alight**: 6 damage every 10 ticks (0.5 s) for 80 ticks (4 s) — 48 more; a new cut starts the burning again, never stacks | **arcs** to everyone else within 6 m of the one cut (each once): 18 damage, and **stuns** the one cut for 12 ticks (0.6 s — no moving, no firing) |
| the heavy cut, awake | throws a **wave of fire** along the ground: 12 m, 2.4 m wide, 20 m/s (so 12 ticks to its end) — 40 damage and alight | calls a **bolt** down 6 m ahead (or on the one cut): everyone within 3.5 m takes 55 and is stunned 16 ticks; it lands 6 ticks after the cut |
| on the land | the grass it passes over is singed for a minute (the ground's own trodden mark) — nothing burns down | a flash lights the land round it for 2 ticks; in the rain the arc reaches 9 m |

The ability is the blade's, not the hand's: put the katana away and it sleeps (the rest goes on counting).

## In the game

- **Draw 10 ticks (0.5 s)** — and the draw is cut 1 if `J` is held as it comes out.
- **Held** in both hands in front, point up and forward; run with at full pace; no gun with it — one weapon in the
  hands.

```json
{
  "id": "katana", "name": "Katana", "kind": "blade", "hold": "katana",
  "mass": 1.15, "length": 1.03, "blade": 0.72, "drawTicks": 10, "comboTicks": 3, "head": 1.5,
  "cuts": [
    { "id": "cut1", "windup": 2, "edge": 2, "recover": 4, "arc": 110, "reach": 1.9, "damage": 34 },
    { "id": "cut2", "windup": 2, "edge": 2, "recover": 4, "arc": 120, "reach": 1.9, "damage": 34 },
    { "id": "cut3", "windup": 3, "edge": 2, "recover": 6, "arc": 50, "reach": 2.1, "damage": 48, "head": true },
    { "id": "heavy", "windup": 5, "edge": 3, "recover": 8, "arc": 200, "reach": 2.3, "damage": 60 }
  ],
  "types": {
    "fire": {
      "name": "Homura — the fire blade", "awakeTicks": 160, "restTicks": 400, "glow": "#ff7a1a",
      "burn": { "damage": 6, "everyTicks": 10, "forTicks": 80 },
      "wave": { "length": 12, "width": 2.4, "speed": 20, "damage": 40 }
    },
    "thunder": {
      "name": "Raiden — the thunder blade", "awakeTicks": 160, "restTicks": 400, "glow": "#9fd0ff",
      "arc": { "radius": 6, "rainRadius": 9, "damage": 18, "stunTicks": 12 },
      "bolt": { "ahead": 6, "radius": 3.5, "damage": 55, "stunTicks": 16, "delayTicks": 6 }
    }
  }
}
```
