import * as GFX from './gfx'
import type { MapData } from './MapData'

/**
 * The terrain's SUN SHADOW as two textures (the box at 4 m, the world at 16 m) and the FORESTS' shade (2 m), baked
 * together by terrainShadow.worker.ts for the sun's current direction (off the main thread) and re-baked when it has
 * moved ~1.5° (time of day). Until the first bake lands the
 * ground is fully lit (`uShadowOn` 0). The ground samples it per pixel, the grass per blade root — one fetch each,
 * no shadow-map pass, the same on every tier.
 */
/** The world's shade texture: 1025² (16 m on a 16 km world) for every world — the worlds share the one texture. */
const SH_WORLD_N = 1025

export class TerrainShadow {
  readonly box: GFX.DataTexture
  readonly world: GFX.DataTexture
  /** The FORESTS' shade (R8 on the box's 2 m grid, 255 = lit) — stamped by the worker from the trees (setTrees). */
  readonly treeTex: GFX.DataTexture
  readonly uniforms = {
    uShBox: { value: null as GFX.Texture | null },
    uShWorld: { value: null as GFX.Texture | null },
    uShBoxGrid: { value: new GFX.Vector4() },
    uShOn: { value: 0 },
    uTreeSh: { value: null as GFX.Texture | null },
    uTreeShGrid: { value: new GFX.Vector4() },
    uTreeShOn: { value: 0 },
  }
  private readonly worker: Worker
  private readonly boxN: number
  private busy = false
  private baked = new GFX.Vector3(0, -1, 0)
  /** The sun the shadows now DRAWN were baked for (`baked`: the one asked of the worker — the same once it lands). */
  private readonly shown = new GFX.Vector3(0, -1, 0)
  private id = 0
  /** A bake is in (the hills'; the forests'); how much of the shadows is drawn (0 … 1 — `uShOn`, `uTreeShOn`); the
   *  clock is being run to an hour (`update`): not drawn till that hour's own are in. */
  private ready = false
  private treeReady = false
  private fade = 0
  private hide = false
  private show(): void { this.uniforms.uShOn.value = this.ready ? this.fade : 0; this.uniforms.uTreeShOn.value = this.treeReady ? this.fade : 0 }

  constructor(map: MapData) {
    this.boxN = (map.inner.n - 1) / 2 + 1 // 4 m
    const tex = (n: number) => {
      const t = new GFX.DataTexture(new Uint8Array(n * n).fill(255), n, n, GFX.RedFormat, GFX.UnsignedByteType)
      t.minFilter = GFX.LinearFilter
      t.magFilter = GFX.LinearFilter
      t.unpackAlignment = 1
      t.needsUpdate = true
      return t
    }
    this.box = tex(this.boxN)
    this.world = tex(SH_WORLD_N)
    this.uniforms.uShBox.value = this.box
    this.uniforms.uShWorld.value = this.world
    this.uniforms.uShBoxGrid.value.set(this.boxN, map.inner.step * 2, map.inner.origin, 0)
    const tn = map.inner.n
    this.treeTex = new GFX.DataTexture(new Uint8Array(tn * tn).fill(255), tn, tn, GFX.RedFormat, GFX.UnsignedByteType)
    this.treeTex.minFilter = this.treeTex.magFilter = GFX.LinearFilter
    this.treeTex.unpackAlignment = 1
    this.treeTex.needsUpdate = true
    this.uniforms.uTreeSh.value = this.treeTex
    this.uniforms.uTreeShGrid.value.set(tn, map.inner.step, map.inner.origin, 0)
    this.worker = new Worker(new URL('./terrainShadow.worker.ts', import.meta.url), { type: 'module' })
    this.setMap(map)
    this.worker.onmessage = (e) => {
      const m = e.data
      this.busy = false
      if (m.id !== this.id) return
      // (the worker's arrays — transferred, its own no more — become the textures' data: not copied in, 2026-11-07)
      this.box.image.data = m.box
      this.world.image.data = m.world
      this.box.needsUpdate = this.world.needsUpdate = true
      if (m.trees) {
        this.treeTex.image.data = m.trees
        this.treeTex.needsUpdate = true
        this.treeReady = true
      }
      // (the first bake in: shown at once — unless the clock is being run to an hour: `update` brings them in)
      if (!this.ready && !this.hide) this.fade = 1
      this.ready = true
      this.show()
      this.shown.copy(this.baked)
      this.onBaked?.()
    }
  }

  onBaked?: () => void
  /** The ground the worker has (setMap). */
  private current: MapData | null = null

  /** The worlds' grounds the worker has (prepare), by map. */
  private readonly keys = new Map<MapData, number>()
  private nextKey = 0

  /** Send a world's heights to the worker ahead (a world built behind another: World.build) — ~20 ms of copying off
   *  the frame that swaps to it. */
  prepare(map: MapData): void {
    if (this.keys.has(map)) return
    if ((map.inner.n - 1) / 2 + 1 !== this.boxN || (map.far.n - 1) % (SH_WORLD_N - 1) !== 0) throw new Error('TerrainShadow: a world of another size')
    const key = ++this.nextKey
    this.keys.set(map, key)
    const g = (h: MapData['inner']) => ({ h: h.h.slice(), n: h.n, step: h.step, origin: h.origin })
    const all = (F: MapData['far']) => { const h = new Float32Array(F.n * F.n); for (let q = 0; q < h.length; q++) h[q] = F.at(q); return { h, n: F.n, step: F.step, origin: F.origin } }
    // (the world's shade is baked on SH_WORLD_N² whatever the world's own grid — the valley's is 8 m, 2049², since
    //  2026-11-10: every k-th height goes to the worker)
    const k = (map.far.n - 1) / (SH_WORLD_N - 1), F = map.far
    let far: { h: Float32Array; n: number; step: number; origin: number }
    if (k <= 1) far = all(F)
    else { const h = new Float32Array(SH_WORLD_N * SH_WORLD_N); for (let j = 0; j < SH_WORLD_N; j++) for (let i = 0; i < SH_WORLD_N; i++) h[j * SH_WORLD_N + i] = F.at(j * k * F.n + i * k); far = { h, n: SH_WORLD_N, step: F.step * k, origin: F.origin } }
    this.worker.postMessage({ type: 'init', key, inner: g(map.inner), far })
  }

  /** Another world's ground (World.ts — every world's grids are the same size): the worker bakes over it from now, all
   *  lit until its first bake (the next update re-bakes; a bake of the old ground still under way is dropped). */
  setMap(map: MapData): void {
    if (map === this.current) return
    this.prepare(map)
    this.current = map
    this.worker.postMessage({ type: 'use', key: this.keys.get(map) })
    for (const t of [this.box, this.world, this.treeTex]) { (t.image.data as Uint8Array).fill(255); t.needsUpdate = true }
    this.ready = this.treeReady = false
    this.fade = 0
    this.show()
    this.baked.set(0, -1, 0)
    this.busy = false
    this.id++
  }

  /** The trees (x, z, height, species per tree) whose shade the worker stamps at every bake; crown = crown radius /
   *  height. Re-bakes at the next update. */
  setTrees(trees: Float32Array, crown: number): void {
    this.worker.postMessage({ type: 'trees', trees, crown, grid: { n: this.treeTex.image.width, step: this.treeGrid.y, origin: this.treeGrid.z } })
    this.baked.set(0, -1, 0)
  }
  private get treeGrid(): GFX.Vector4 { return this.uniforms.uTreeShGrid.value }

  /** (scripts/harness/timeshot.mjs) How far the drawn shadows are behind the sun (deg), whether one is being baked. */
  state(sun: GFX.Vector3): { stale: number; busy: boolean; on: number } { return { stale: (sun.angleTo(this.shown) * 180) / Math.PI, busy: this.busy, on: this.uniforms.uShOn.value } }

  /** Call each frame with the sun's direction: re-bakes when it has moved.
   *  THE CLOCK RUN TO AN HOUR (`runTo`: the light's direction at the hour it is running to — Atmosphere.sweepTo,
   *  2026-11-27): a bake takes about a second — the day goes by in two or three, so shadows baked along the way would
   *  trail the sun by a quarter of the sky, and the last came a second after the hour: the old hour's shadows under the
   *  new hour's light ("set to morning, it shows noon first"). So: as the run starts the shadows FADE OUT (a third of
   *  a second) and the bake is asked for the hour it ENDS on, at once; they FADE IN (0.7 s) when the run is over and
   *  that bake is in — never a shadow that is not the hour's own. */
  update(sun: GFX.Vector3, dt = 0, runTo: GFX.Vector3 | null = null): void {
    if (runTo) this.hide = true
    else if (this.hide && sun.angleTo(this.shown) < 0.05) this.hide = false
    if (this.ready) {
      const want = this.hide ? 0 : 1
      if (this.fade !== want) { this.fade = want > this.fade ? Math.min(1, this.fade + dt / 0.7) : Math.max(0, this.fade - dt / 0.35); this.show() }
    }
    const aim = runTo ?? sun
    if (this.busy || aim.angleTo(this.baked) < 0.026) return
    this.busy = true
    this.baked.copy(aim)
    this.worker.postMessage({ type: 'bake', id: ++this.id, sun: [aim.x, aim.y, aim.z], boxN: this.boxN, boxStep: 4 })
  }
}

/** sunVisibility(xz): the baked shadow (needs uFarGrid from HEIGHT_GLSL / the terrain's fragment uniforms). */
export const SHADOW_GLSL = /* glsl */ `
uniform sampler2D uShBox;
uniform sampler2D uShWorld;
uniform vec4 uShBoxGrid; // n, step, origin
uniform float uShOn;
uniform sampler2D uTreeSh;
uniform vec4 uTreeShGrid;
uniform float uTreeShOn;
// the terrain's own shadow (the hills)
float sunVisibilityTerrain(vec2 xz) {
  // (uShOn: how much of it is drawn — 1 but while the clock is run to an hour, when it fades out and back in)
  if (uShOn <= 0.0) return 1.0;
  float e = -uShBoxGrid.z - uShBoxGrid.y, s;
  if (abs(xz.x) < e && abs(xz.y) < e) s = textureLod(uShBox, ((xz - uShBoxGrid.z) / uShBoxGrid.y + 0.5) / uShBoxGrid.x, 0.0).r;
  // (the world's shade: SH_WORLD_N² over the world's span, whatever the world grid's own size)
  else s = textureLod(uShWorld, ((xz - uFarGrid.z) / (uFarGrid.y * (uFarGrid.x - 1.0)) * ${SH_WORLD_N - 1}.0 + 0.5) / ${SH_WORLD_N}.0, 0.0).r;
  return uShOn >= 1.0 ? s : mix(1.0, s, uShOn);
}
// … and the forests' shade on top
float sunVisibility(vec2 xz) {
  float v = sunVisibilityTerrain(xz);
  // (… not read where the hills' shade is already whole: 0 × the trees' is 0 — 2026-11-16, docs/PERF.md)
  if (v > 0.0 && uTreeShOn > 0.0 && abs(xz.x) < -uTreeShGrid.z && abs(xz.y) < -uTreeShGrid.z) {
    float t = textureLod(uTreeSh, ((xz - uTreeShGrid.z) / uTreeShGrid.y + 0.5) / uTreeShGrid.x, 0.0).r;
    v *= uTreeShOn >= 1.0 ? t : mix(1.0, t, uTreeShOn);
  }
  return v;
}
`
