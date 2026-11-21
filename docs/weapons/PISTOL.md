# The pistol — 9 mm service pistol

A full-size, striker-fired, polymer-framed 9 × 19 mm pistol of the kind most police carry: 17 rounds, one shot a pull.
The model is our own (`scripts/oth/weapons.py`).

## The real machine

| | |
|---|---|
| cartridge | 9 × 19 mm Parabellum, 8.0 g (124 gr) full metal jacket |
| muzzle velocity | 375 m/s |
| muzzle energy | ½ · 0.0080 · 375² = **562 J** |
| momentum | 0.0080 · 375 = 3.00 kg·m/s |
| magazine | 17 |
| mass | 0.63 kg empty, 0.91 kg loaded |
| length / barrel | 186 mm / 114 mm |
| action | semi-automatic, short recoil |
| useful range | 50 m |

## The flight (`v(x) = v₀·e^(−k·x)`, k = 0.0019 /m)

| range | speed | time | ticks | drop | energy kept |
|---|---|---|---|---|---|
| 10 m | 368 m/s | 0.027 s | 0.5 | 0.4 cm | 96 % |
| 25 m | 358 m/s | 0.068 s | 1.4 | 2.3 cm | 91 % |
| 50 m | 341 m/s | 0.140 s | 2.8 | 9.6 cm | 83 % |
| 100 m | 310 m/s | 0.294 s | 5.9 | 42 cm | 68 % |

Sighted at 25 m. Beyond 100 m the bullet is gone (`range`).

## The recoil

Free recoil of the gun: 3.00 kg·m/s ÷ 0.91 kg = **3.3 m/s** — sharp, but the slide and the wrists take it: the muzzle
flips ~1.6° and is back in about a fifth of a second. In the game: the view kicks up 1.6° (± 0.5° sideways), eased
back over 4 ticks; each shot fired before it is back adds to the spread.

## In the game

- **One shot a press**; no faster than **one every 3 ticks (150 ms — 400 a minute)**, as fast as a practised hand.
- **It shoots where the cross is** (the user, 2026-11-21: "the cross is there but it's not shooting there"): the
  bullet leaves for what the middle of the screen is on. **Spread** (the cone's half angle — the cross's gap opens to
  show it): 0.15° standing still, 0.35° walking, 0.9° running or in the air; + 0.12° for each shot fired in the last
  6 ticks, to + 0.6° at most.
- **Pace** with it in the hands: 96 % (CS:GO's 240 of 250).
- **Damage 26** at the muzzle (four to the body), × 2.0 to the head, × 0.75 to a limb; falls with the energy kept, never
  under 60 %.
- **Reload 32 ticks (1.6 s)**: the magazine dropped, a new one in, the slide released. **Draw 8 ticks (0.4 s)**.
- **Ammunition**: 17 in the gun, up to 68 carried (four magazines).
- **Held** — third person (GTA's): carried in the right hand at his side while he walks, runs and sprints; aimed (the
  other button held, or fired) out before his face in both hands, he faces the view and the keys strafe. First
  person (CS:GO's): fixed to the view at its lower right, both hands on it, a cross in the middle.

```json
{
  "id": "pistol", "name": "Pistol", "kind": "gun", "hold": "pistol",
  "cartridge": "9x19", "bulletMass": 0.0080, "muzzleVelocity": 375, "drag": 0.0019, "range": 100, "zero": 25,
  "auto": false, "fireTicks": 3, "reloadTicks": 32, "drawTicks": 8,
  "magazine": 17, "reserve": 68,
  "damage": 26, "head": 2.0, "limb": 0.75, "floor": 0.6,
  "spread": { "still": 0.15, "walk": 0.35, "run": 0.9, "perShot": 0.12, "perShotMax": 0.6, "settleTicks": 6 },
  "recoil": { "up": 1.6, "side": 0.5, "returnTicks": 4 },
  "pace": 0.96, "mass": 0.91, "length": 0.186, "tracerEvery": 0
}
```
