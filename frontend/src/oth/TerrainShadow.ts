import * as GFX from './gfx'
import type { MapData } from './MapData'

/**
 * The terrain's SUN SHADOW as two textures (the box at 4 m, the world at 16 m) and the FORESTS' shade (2 m), baked
 * together by terrainShadow.worker.ts for the sun's current direction (off the main thread) and re-baked when it has
 * moved ~1.5° (time of day). Until the first bake lands the
 * ground is fully lit (`uShadowOn` 0). The ground samples it per pixel, the grass per blade root — one fetch each,
 * no shadow-map pass, the same on every tier.
 */
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
  private id = 0

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
    this.world = tex(map.far.n)
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
      ;(this.box.image.data as Uint8Array).set(m.box)
      ;(this.world.image.data as Uint8Array).set(m.world)
      this.box.needsUpdate = this.world.needsUpdate = true
      if (m.trees) {
        ;(this.treeTex.image.data as Uint8Array).set(m.trees)
        this.treeTex.needsUpdate = true
        this.uniforms.uTreeShOn.value = 1
      }
      this.uniforms.uShOn.value = 1
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
    if ((map.inner.n - 1) / 2 + 1 !== this.boxN || map.far.n !== this.world.image.width) throw new Error('TerrainShadow: a world of another size')
    const key = ++this.nextKey
    this.keys.set(map, key)
    const g = (h: MapData['inner']) => ({ h: h.h.slice(), n: h.n, step: h.step, origin: h.origin })
    this.worker.postMessage({ type: 'init', key, inner: g(map.inner), far: g(map.far) })
  }

  /** A world gone (World.dispose): the worker lets go of its ground. */
  forget(map: MapData): void {
    const key = this.keys.get(map)
    if (key === undefined || map === this.current) return
    this.keys.delete(map)
    this.worker.postMessage({ type: 'drop', key })
  }

  /** Another world's ground (World.ts — every world's grids are the same size): the worker bakes over it from now, all
   *  lit until its first bake (the next update re-bakes; a bake of the old ground still under way is dropped). */
  setMap(map: MapData): void {
    if (map === this.current) return
    this.prepare(map)
    this.current = map
    this.worker.postMessage({ type: 'use', key: this.keys.get(map) })
    for (const t of [this.box, this.world, this.treeTex]) { (t.image.data as Uint8Array).fill(255); t.needsUpdate = true }
    this.uniforms.uShOn.value = this.uniforms.uTreeShOn.value = 0
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

  /** Call each frame with the sun's direction: re-bakes when it has moved. */
  update(sun: GFX.Vector3): void {
    if (this.busy || sun.angleTo(this.baked) < 0.026) return
    this.busy = true
    this.baked.copy(sun)
    this.worker.postMessage({ type: 'bake', id: ++this.id, sun: [sun.x, sun.y, sun.z], boxN: this.boxN, boxStep: 4 })
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
  if (uShOn < 0.5) return 1.0;
  float e = -uShBoxGrid.z - uShBoxGrid.y;
  if (abs(xz.x) < e && abs(xz.y) < e) return textureLod(uShBox, ((xz - uShBoxGrid.z) / uShBoxGrid.y + 0.5) / uShBoxGrid.x, 0.0).r;
  return textureLod(uShWorld, ((xz - uFarGrid.z) / uFarGrid.y + 0.5) / uFarGrid.x, 0.0).r;
}
// … and the forests' shade on top
float sunVisibility(vec2 xz) {
  float v = sunVisibilityTerrain(xz);
  if (uTreeShOn > 0.5 && abs(xz.x) < -uTreeShGrid.z && abs(xz.y) < -uTreeShGrid.z)
    v *= textureLod(uTreeSh, ((xz - uTreeShGrid.z) / uTreeShGrid.y + 0.5) / uTreeShGrid.x, 0.0).r;
  return v;
}
`
