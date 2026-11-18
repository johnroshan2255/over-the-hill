import * as GFX from './gfx'
import type { Atmosphere } from './Atmosphere'
import type { World } from './World'

/**
 * THE CLOUD ON THE PASS (Atmosphere uMist): it thickens as you climb the Great Cliff's ledge road toward the top of
 * the pass (meta.gate — valley_cliff.py: where, how high; `mist`: the heights y0 → y1 it builds over, within r m of
 * it) and is at its thickest (~10 m to see) at the top. Was the crossing's (Crossing.ts — the desert beyond the gate,
 * removed 2026-11-18, the user: "delete the desert and the path to desert" — the cliff and its road kept, the gate
 * gone): the same cloud, the same place.
 */
export class PassMist {
  /** The mist now (eased toward its target). */
  mist = 0

  constructor(private readonly o: { world: () => World; atmos: Atmosphere }) {}

  update(dt: number, cam: GFX.Vector3): void {
    const G = this.o.world().map.meta.gate
    const u = this.o.atmos.uniforms
    if (!G) {
      this.mist = Math.max(0, this.mist - dt)
      u.uMist.value = this.mist
      return
    }
    const S = GFX.MathUtils.smoothstep
    const m = G.mist ?? { y0: G.y - 150, y1: G.y - 10, r: 500 }
    const dCam = Math.hypot(cam.x - G.x, cam.z - G.z)
    const target = (1 - S(dCam, m.r, m.r + 300)) * S(cam.y, m.y0, m.y1) * (0.6 + 0.4 * (1 - S(dCam, 40, 300)))
    this.mist += (target - this.mist) * Math.min(1, dt * 1.2)
    u.uMist.value = this.mist < 0.002 ? 0 : this.mist
  }
}
