import * as GFX from './gfx'
import { ATMOS_GLSL, type Atmosphere } from './Atmosphere'
import type { MapData } from './MapData'
import type { Tier } from './quality'
import type { Vehicle } from './Vehicle'

/**
 * TYRE TRACKS (2026-10-27, OTH leaves ruts behind you): each wheel lays a dark tread mark where it rolls on soft
 * ground — the tracks' dirt, the mud (deepest, darkest), the sand and gravel at the water, the crater's floor; none on
 * rock, planks, grass (its blades would hide them) or in the water. A ring of `tier` segments (each ~0.4 m, one per
 * wheel per step it moves): ONE instanced draw, the ground DARKENED under it (multiply blending: the light and the
 * ground's own colour stay), a tread pattern across, soft edges, fading over two minutes and out past 70 m. In the
 * desert's LOOSE SAND (2026-11-02, "sands like in Over the Hill"): deeper ruts — darker, wider, five minutes to fade.
 * ≈ 0.02 ms CPU (four tests a frame), the GPU a few hundred thin quads.
 */
export class TyreTracks {
  readonly mesh: GFX.Mesh
  private readonly n: number
  private readonly a0: GFX.InstancedBufferAttribute // start xyz, birth time
  private readonly a1: GFX.InstancedBufferAttribute // end xyz, darkness
  private head = 0
  private readonly geo: GFX.InstancedBufferGeometry
  private readonly last: (GFX.Vector3 | null)[] = [null, null, null, null]
  private readonly c = new GFX.Vector3()
  private readonly time = { value: 0 }
  /** When the newest mark was laid (s), and round the marks laid since they last all faded: `cull`. */
  private newest = -1e9
  private readonly box = new GFX.Box3()
  private readonly mk: [number, number, number, number] = [0, 0, 0, 0]

  constructor(private readonly map: MapData, tier: Tier, atmos: Atmosphere) {
    this.n = tier.name === 'low' ? 1400 : tier.name === 'medium' ? 2400 : 3600
    const g = new GFX.InstancedBufferGeometry()
    g.setAttribute('position', new GFX.Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, 1, 0, 1, -1, 0], 3)) // (x: along 0 … 1, y: across)
    g.setIndex([0, 2, 1, 0, 3, 2])
    this.a0 = new GFX.InstancedBufferAttribute(new Float32Array(this.n * 4).fill(-1e5), 4).setUsage(GFX.DynamicDrawUsage)
    this.a1 = new GFX.InstancedBufferAttribute(new Float32Array(this.n * 4), 4).setUsage(GFX.DynamicDrawUsage)
    g.setAttribute('aS', this.a0)
    g.setAttribute('aE', this.a1)
    g.instanceCount = 0 // (only what's been laid: grows to n, then the ring wraps)
    this.geo = g
    const mat = new GFX.ShaderMaterial({
      uniforms: { ...atmos.uniforms, uTime: this.time },
      vertexShader: /* glsl */ `
        ${ATMOS_GLSL}
        attribute vec4 aS;
        attribute vec4 aE;
        varying vec2 vUv;
        varying float vK;
        void main() {
          vec3 d = aE.xyz - aS.xyz;
          // (a SAND rut: wider, and it lasts 2.5× as long — till the wind fills it)
          float sand = step(5.0, aE.w), k0 = aE.w - 10.0 * sand, life = mix(1.0, 2.5, sand);
          vec3 side = normalize(vec3(-d.z, 0.0, d.x) + 1e-5) * mix(0.15, 0.19, sand);
          vec3 w = mix(aS.xyz, aE.xyz, position.x) + side * position.y + vec3(0.0, 0.06, 0.0);
          vUv = vec2(position.x * length(d), position.y);
          float age = uTime - aS.w;
          vec4 mv = modelViewMatrix * vec4(w, 1.0);
          // (gone in the haze and the crossing's mist as the ground under them is)
          vK = k0 * (1.0 - smoothstep(60.0 * life, 120.0 * life, age)) * (1.0 - smoothstep(45.0, 70.0, -mv.z)) * (1.0 - fogAmount(w));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vK;
        void main() {
          // the tread: bars across the mark, the edges soft
          float tread = 0.7 + 0.3 * step(0.5, fract(vUv.x * 4.5 + abs(vUv.y) * 0.6));
          float edge = 1.0 - smoothstep(0.55, 1.0, abs(vUv.y));
          float k = vK * tread * edge;
          gl_FragColor = vec4(vec3(1.0 - k), 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      side: GFX.DoubleSide, // (the quads' winding faces down: culled from above)
      blending: GFX.MultiplyBlending,
      premultipliedAlpha: true,
      // (no polygon offset: with the reversed depth buffer (main.ts) a negative one pushes the marks UNDER the ground —
      //  they lie 6 cm over it instead)
    })
    this.mesh = new GFX.Mesh(g, mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
  }

  update(car: Vehicle, t: number): void {
    this.time.value = t
    const sim = car.sim, model = car.model
    if (!sim || !model) return
    const q = car.root.quaternion, p = car.root.position, hw = this.map.meta.trails.hw
    let wrote = false
    for (let k = 0; k < 4; k++) {
      const wk = sim.wheels[k]
      const [hx, hy, hz] = model.wheelPos[k]
      const c = this.c.set(hx, hy + wk.lift - model.wheelRadius * 0.9, hz).applyQuaternion(q).add(p)
      // what it rolls on: the tracks' dirt, mud, the water's sand — not rock, planks, grass or water
      const ground = this.map.height(c.x, c.z)
      const onGround = wk.contact && c.y < ground + 0.35 && this.map.bridgeAt(c.x, c.z) === null && this.map.waterLevel(c.x, c.z) === null
      const mud = this.map.mudAt(c.x, c.z), track = Math.max(0, Math.min(1, (hw + 0.3 - this.map.trailDist(c.x, c.z)) / 0.8))
      // (the desert's LOOSE SAND — its mask's G, not on the rock: deep ruts, darker, lasting longer)
      const sand = this.map.desert ? this.map.maskAt(c.x, c.z, this.mk)[1] * (1 - Math.min(1, this.mk[0] * 2)) * (1 - track) : 0
      const dark = onGround ? Math.max(mud * 0.6, track * 0.32, sand * 0.44) : 0
      const prev = this.last[k]
      if (dark < 0.05) { this.last[k] = null; continue }
      c.y = ground
      if (!prev) { this.last[k] = c.clone(); continue }
      if (prev.distanceToSquared(c) < 0.16) continue
      if (prev.distanceToSquared(c) > 4) { prev.copy(c); continue } // (a jump / a reset: no streak across)
      const i = this.head
      this.head = (this.head + 1) % this.n
      this.a0.setXYZW(i, prev.x, prev.y, prev.z, t)
      this.a1.setXYZW(i, c.x, c.y, c.z, dark + (sand > 0.3 ? 10 : 0)) // (+10: a sand rut)
      if (t - this.newest > 300) this.box.makeEmpty() // (all the older marks have faded)
      this.box.expandByPoint(prev).expandByPoint(c)
      this.newest = t
      prev.copy(c)
      wrote = true
    }
    if (wrote) { this.a0.needsUpdate = true; this.a1.needsUpdate = true; this.geo.instanceCount = Math.max(this.geo.instanceCount, this.head === 0 ? this.n : this.head) }
  }

  /** Every mark gone (the crossing: another world under the car). */
  clear(): void {
    this.geo.instanceCount = 0
    this.head = 0
    this.last.fill(null)
    this.newest = -1e9
    this.box.makeEmpty()
    this.mesh.visible = false
  }

  /** Draw the marks only while some are still there (they fade over 60–120 s, sand ruts 150–300 s) and the eye is within their 70 m
   *  (2026-11-02: drawn every frame, faded or none at all). */
  cull(eye: GFX.Vector3, t: number): void {
    this.mesh.visible = this.geo.instanceCount > 0 && t - this.newest < 300 && this.box.distanceToPoint(eye) < 70
  }
}
