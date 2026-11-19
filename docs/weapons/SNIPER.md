# The sniper rifle — bolt-action, .338

A long-range bolt-action rifle of the .338 Lapua Magnum class: a heavy free-floating barrel, a folding stock, a
bipod, a telescopic sight, five rounds. One shot, then the bolt. The model is our own (`scripts/oth/weapons.py`).

## The real machine

| | |
|---|---|
| cartridge | .338 Lapua Magnum (8.6 × 70 mm), 16.2 g (250 gr) |
| muzzle velocity | 936 m/s |
| muzzle energy | ½ · 0.0162 · 936² = **7096 J** — 3.5 × the AK-47's |
| momentum | 0.0162 · 936 = 15.2 kg·m/s |
| magazine | 5 |
| mass | 6.9 kg with the sight |
| length / barrel | 1230 mm / 686 mm |
| action | bolt, by hand |
| useful range | 1100 m |

## The flight (k = 0.0007 /m)

| range | speed | time | ticks | drop | energy kept |
|---|---|---|---|---|---|
| 100 m | 873 m/s | 0.111 s | 2.2 | 6 cm | 87 % |
| 200 m | 814 m/s | 0.229 s | 4.6 | 26 cm | 76 % |
| 400 m | 707 m/s | 0.493 s | 9.9 | 1.19 m | 57 % |
| 600 m | 615 m/s | 0.797 s | 15.9 | 3.11 m | 43 % |
| 800 m | 535 m/s | 1.146 s | 22.9 | 6.44 m | 33 % |
| 1000 m | 465 m/s | 1.547 s | 30.9 | 11.7 m | 25 % |

Sighted at 200 m: aim dead on to 250 m, hold over beyond it — the scope's marks under the cross are the hold for
400, 600 and 800 m at ×2. Beyond 1000 m the bullet is gone. At 600 m it is in the air for 16 ticks: a running man
(7 m/s) has moved 5.6 m — lead him.

## The scope (as CS:GO's: two steps)

- `U` / right mouse: **off → ×1 → ×2 → off**; the mouse wheel steps in and out; firing leaves it where it is, working
  the bolt drops out of it and comes back to the step it was on (as the eye leaves the glass).
- **×1: the view 40° tall. ×2: 10° tall** (the game's own is 55°) — the land four times, then five and a half times,
  nearer than the bare eye.
- In the scope the whole screen is the glass: a black surround, a fine cross, the hold marks; the rifle and the
  character aren't drawn. The mouse turns the view slower by the same share as the lens (so a hand's move covers the
  same of the glass).
- Scoping takes **4 ticks (0.2 s)** to settle: a shot before that flies as unscoped.
- Scoped, you walk at 40 % pace; running drops out of the scope.

## The recoil

Free recoil: 15.2 kg·m/s (+ gas) ÷ 6.9 kg ≈ **2.9 m/s** — the shoulder takes it, the sight leaves the target. In the
game the view kicks up 4.5° and comes back over 14 ticks, while the bolt is worked.

## In the game

- **One shot, then the bolt: 30 ticks (1.5 s)** before the next.
- **Spread**: scoped and still 0.02° (a hand's width at 600 m); scoped and walking 1.2°; **unscoped 4°** standing,
  7° moving — it is not a rifle to fire from the hip.
- **Damage 115** at the muzzle: one to the body or the head (× 2.5), × 0.75 to a limb (86 — not quite); falls with the
  energy kept, never under 70 % (80 — still one more hit from a pistol's worth).
- **Reload 70 ticks (3.5 s)**: the magazine out, the next in, the bolt closed. **Draw 16 ticks (0.8 s)**.
- **Ammunition**: 5 in the rifle, up to 20 carried. Every round shows its trace (a thin line of the air it tore).
- **Held** in both hands; walked with at 85 % pace (6.9 kg).

```json
{
  "id": "sniper", "name": "Sniper rifle", "kind": "gun", "hold": "rifle",
  "cartridge": ".338", "bulletMass": 0.0162, "muzzleVelocity": 936, "drag": 0.0007, "range": 1000, "zero": 200,
  "auto": false, "fireTicks": 30, "reloadTicks": 70, "drawTicks": 16,
  "magazine": 5, "reserve": 20,
  "damage": 115, "head": 2.5, "limb": 0.75, "floor": 0.7,
  "spread": { "still": 4.0, "walk": 7.0, "run": 9.0, "perShot": 0, "settleTicks": 0, "scopedStill": 0.02, "scopedWalk": 1.2 },
  "recoil": { "up": 4.5, "side": 0.6, "returnTicks": 14 },
  "scope": { "fov": [40, 10], "settleTicks": 4, "pace": 0.4 },
  "pace": 0.85, "mass": 6.9, "length": 1.23, "tracerEvery": 1
}
```
