import * as GFX from './gfx'
import type { Atmosphere } from './Atmosphere'
import { Birds } from './Birds'
import { Bridges } from './Bridges'
import { Bushes, placeBushes } from './Bushes'
import { Falls } from './Falls'
import { Formations } from './Formations'
import { Glow } from './Glow'
import { Grass } from './Grass'
import { Horizon } from './Horizon'
import { Landmarks } from './Landmarks'
import { type Landmark, MapData } from './MapData'
import { placeThings } from './Places'
import { Props } from './Props'
import type { Tier } from './quality'
import { Rocks } from './Rocks'
import { Terrain } from './Terrain'
import type { TerrainShadow } from './TerrainShadow'
import { placeTrees, Trees } from './Trees'
import { Water } from './Water'

/**
 * A WORLD (2026-11-02, the user: "go through a fog, the old world disappears, we entirely remove it … then load the
 * other world"): everything built from one map — its ground, grass, rocks, trees, bushes, water, falls, bridges,
 * landmarks, the small things (Places / Props), the birds — under one group, built in steps (`pace` between them: a
 * world built behind the fog while the car drives lets the frames through) and DISPOSED whole: every geometry,
 * material, texture and render target it made goes back to the GPU, nothing of it stays behind.
 *
 * What lasts across worlds lives in main.ts: the renderer, the camera, the sky and the light (Atmosphere), the car
 * and the physics (OthPhysics.setWorld swaps the colliders), the sound, the HUD, the terrain shadow (its worker gets the
 * new ground: TerrainShadow.setMap). They see the current world's map through liveMap().
 */
export type WorldId = 'valley' | 'desert'
export const WORLDS: Record<WorldId, { path: string; name: string }> = {
  valley: { path: '/oth/valley', name: 'the valley' },
  desert: { path: '/oth/desert', name: 'the desert' },
}

export interface WorldEnv {
  renderer: GFX.WebGLRenderer
  /** The view and the scene the world will be drawn in (its shaders compiled for them before it's entered). */
  camera: GFX.PerspectiveCamera
  scene: GFX.Scene
  atmos: Atmosphere
  tier: Tier
  /** The terrain shadow (lasts across worlds; set to each world's ground in turn — World.adopt). */
  shadow: TerrainShadow
  /** The far grid every world's materials read (the same Vector4 always: the car's material holds it). */
  farGrid: GFX.Vector4
  birds: boolean
  occlusion: boolean
  /** The supply crates already picked up (the journal). */
  crates: number[]
}

export class World {
  readonly group = new GFX.Group()
  /** How long each step took to build (ms) — the dev stats, the crossing's budget. */
  readonly timings: Record<string, number> = {}
  private constructor(
    readonly id: WorldId,
    readonly map: MapData,
    readonly terrain: Terrain,
    readonly rocks: Rocks,
    readonly grass: Grass,
    readonly water: Water,
    readonly falls: Falls,
    readonly trees: Trees,
    readonly bushes: Bushes,
    readonly horizon: Horizon,
    readonly bridges: Bridges,
    readonly glow: Glow | null,
    readonly landmarks: Landmarks,
    readonly props: Props,
    readonly birds: Birds | null,
    /** The desert's sandstone (Blender's slabs — Formations.ts); none in the valley. */
    readonly formations: Formations | null,
    /** Every landmark and camp (the signposts, the map, the journal count them). */
    readonly places: Landmark[],
  ) {}

  /** Build world `id` (its files fetched first); `pace` runs between the steps (a frame, when built while playing).
   *  BACKGROUND (the crossing: built while another world plays): what lasts across worlds is left alone — the terrain
   *  shadow keeps the playing world's ground and trees, the far grid its values — until `adopt` at the swap. */
  static async build(id: WorldId, env: WorldEnv, pace: () => Promise<void> = async () => {}, onProgress?: (f: number) => void, loaded?: MapData, background = false): Promise<World> {
    const timings: Record<string, number> = {}
    const t0 = performance.now()
    const map = loaded ?? (await MapData.load(WORLDS[id].path, env.tier.terrainLeaf, onProgress))
    timings.load = performance.now() - t0
    const step = async <T>(label: string, f: () => T): Promise<T> => {
      const t = performance.now()
      const r = f()
      timings[label] = performance.now() - t
      await pace()
      return r
    }
    /** A step done a slice at a time (a generator yielding as it goes): ~6 ms of it a frame, then `pace`. */
    const sliced = async (label: string, gen: Generator<void, void, void>): Promise<void> => {
      const t = performance.now()
      let s = t, busy = 0
      for (const _ of gen) if (performance.now() - s > 6) { busy += performance.now() - s; await pace(); s = performance.now() }
      timings[label] = busy + performance.now() - s
      timings[label + ' (frames)'] = performance.now() - t
    }
    const { atmos, tier, shadow } = env
    await step('shadow', () => (background ? shadow.prepare(map) : shadow.setMap(map)))
    let farGrid = new GFX.Vector4()
    const terrain = await step('terrain', () => {
      const t = new Terrain(map, atmos, tier, shadow)
      // (the far grid the car's material holds: this world's values in the same Vector4 — at once, or at the swap)
      farGrid = t.uniforms.uFarGrid.value.clone()
      if (!background) env.farGrid.copy(farGrid)
      t.uniforms.uFarGrid.value = env.farGrid
      return t
    })
    // (the desert's sculpted stones — Blender, desert_stones.py — fetched first: tiny, 30 kB)
    const stones = map.desert ? await Rocks.loadStones(`${WORLDS[id].path}/stones.glb`) : null
    // (and its STACKED ROCK — desert_stacks.py: the slab stacks the rocky hills are built of)
    const stacks = map.desert ? await Rocks.loadStacks(`${WORLDS[id].path}/stacks.glb`) : null
    const rocks = await step('rocks', () => new Rocks(map, atmos, shadow, tier, env.farGrid, stones, stacks))
    const grass = await step('grass', () => new Grass(map, atmos, terrain, tier, rocks.footprint, env.renderer))
    const water = await step('water', () => new Water(map, atmos, terrain, tier, rocks.footprint))
    const falls = await step('falls', () => new Falls(map, atmos))
    const treeData: number[] = []
    await sliced('placing trees', placeTrees(map, rocks, treeData))
    const trees = await step('trees', () => new Trees(map, atmos, shadow, tier, rocks, !background, new Float32Array(treeData)))
    await step('impostors', () => trees.bakeImpostors(env.renderer))
    const bushData: number[] = []
    await sliced('placing bushes', placeBushes(map, rocks, bushData))
    const bushes = await step('bushes', () => new Bushes(map, atmos, shadow, tier, rocks, trees.leafTexture, new Float32Array(bushData)))
    // OCCLUSION CULLING: what the hills hide (trees, rocks, bushes behind them are skipped)
    const horizon = await step('horizon', () => new Horizon(map, Math.max(tier.treeReach, tier.rockReach)))
    horizon.enabled = env.occlusion
    trees.horizon = rocks.horizon = bushes.horizon = terrain.horizon = horizon
    const bridges = await step('bridges', () => new Bridges(map, atmos, shadow, tier, env.farGrid))
    // without the post pass: the bloom and the god rays painted forward (Glow.ts)
    const glow = tier.bloom ? null : await step('glow', () => new Glow(map, atmos))
    atmos.uniforms.uGlow.value = glow ? 1 : 0
    // THE SMALL THINGS (Places.ts picks where, seeded): the CAMPS join the landmarks (built, found, on the map like
    // them); the signposts, tables, fences, log piles, cairns, trucks, supply crates and fireflies are Props.ts
    const placed = await step('places', () => placeThings(map, rocks, trees))
    const places = (map.meta.landmarks = [...(map.meta.landmarks ?? []), ...placed.camps])
    const landmarks = await step('landmarks', () => new Landmarks(map, atmos, shadow, tier, env.farGrid))
    const props = await step('props', () => new Props(placed.props, places, placed.swarms, atmos, shadow, tier, env.farGrid, env.crates, rocks.footprint, map.inner, map.desert))
    landmarks.horizon = bridges.horizon = falls.horizon = props.horizon = horizon
    const birds = env.birds ? await step('birds', () => new Birds(atmos, terrain)) : null
    // (the desert's sandstone slabs: fetched, Draco-decoded in the loader's workers)
    const tf = performance.now()
    const formations = map.desert ? await Formations.load(`${WORLDS[id].path}/formations.glb`, atmos, shadow, tier, env.farGrid) : null
    timings.formations = performance.now() - tf
    if (formations) formations.horizon = horizon
    const w = new World(id, map, terrain, rocks, grass, water, falls, trees, bushes, horizon, bridges, glow, landmarks, props, birds, formations, places)
    w.farGrid.copy(farGrid)
    Object.assign(w.timings, timings)
    w.group.add(props.group, landmarks.group, terrain.mesh, grass.group, rocks.group, trees.group, bushes.group, water.group, falls.group, bridges.group)
    if (glow) w.group.add(glow.group)
    if (birds) w.group.add(birds.mesh)
    if (formations) w.group.add(formations.group)
    // WARM: its textures on the GPU (one a frame — ~35 MB went up in the first frame after a swap) and its shaders
    // compiled (in parallel where the browser can) before it's ever drawn
    const textures = new Set<GFX.Texture>()
    w.group.traverse((o) => {
      const m = (o as GFX.Mesh).material as GFX.ShaderMaterial | undefined
      if (m?.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k]?.value; if (v instanceof GFX.Texture) textures.add(v) }
    })
    for (const t of textures) await step('upload', () => env.renderer.initTexture(t))
    const tc = performance.now()
    await env.renderer.compileAsync(w.group, env.camera, env.scene)
    w.timings.compile = performance.now() - tc
    w.timings.total = performance.now() - t0
    return w
  }

  /** This world's far grid values (the shared Vector4 takes them when it's entered). */
  private readonly farGrid = new GFX.Vector4()

  /** What lasts across worlds set to this one (entering it — main.ts): the terrain shadow to its ground and trees,
   *  the shared far grid to its values. */
  adopt(env: WorldEnv): void {
    env.shadow.setMap(this.map)
    this.trees.reshade(env.shadow)
    env.farGrid.copy(this.farGrid)
  }

  /** What's drawn this frame: each system's own culling and lists (the camera has moved). */
  update(camera: GFX.PerspectiveCamera, dt: number, t: number, lamps: number, fire: GFX.Vector4, carX: number, carZ: number): void {
    this.props.fireLight(camera.position, t, lamps, fire)
    this.birds?.update()
    this.glow?.update(camera, dt)
    this.landmarks.update(dt, carX, carZ)
    this.horizon.update(camera.position)
    this.terrain.update(camera)
    this.grass.update(camera)
    this.rocks.update(camera)
    this.trees.update(camera)
    this.bushes.update(camera)
    this.props.update(camera)
    this.formations?.update(camera)
    this.landmarks.cull()
    this.bridges.cull()
    this.falls.cull()
  }

  /** Everything this world made goes back: geometries, materials, the textures they read (but not `keep` — the
   *  sky's noise, the terrain shadow's: they last), the impostor atlas, the glow's page overlay. The group leaves the
   *  scene; the JS objects go with the last reference. */
  dispose(keep: Set<GFX.Texture>): void {
    this.group.removeFromParent()
    const textures = new Set<GFX.Texture>()
    const take = (v: unknown) => { if (v instanceof GFX.Texture && !keep.has(v) && !v.userData.shared) textures.add(v) }
    this.group.traverse((o) => {
      const m = o as GFX.Mesh
      m.geometry?.dispose()
      for (const mat of m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : []) {
        for (const v of Object.values(mat as unknown as Record<string, unknown>)) take(v)
        const u = (mat as GFX.ShaderMaterial).uniforms
        if (u) for (const k in u) take(u[k]?.value)
        mat.dispose()
      }
    })
    const M = this.map
    for (const t of [M.inner.tex, M.far.tex, M.inner.normalTex, M.far.normalTex, M.maskTex, M.trailTex, M.mudTex, this.rocks.footprint]) take(t)
    for (const t of textures) t.dispose()
    this.trees.atlas?.dispose()
    this.grass.dispose()
    this.glow?.dispose()
  }
}

/**
 * The CURRENT world's map for what lasts across worlds (the car, the cameras, the dust, the tracks, the winch, the
 * sound): every read goes to the map `get()` returns now — its methods bound once per map.
 */
export function liveMap(get: () => MapData): MapData {
  let cur: MapData | null = null
  const bound = new Map<PropertyKey, unknown>()
  return new Proxy({} as MapData, {
    get(_, k) {
      const m = get()
      if (m !== cur) { cur = m; bound.clear() }
      const v = (m as unknown as Record<PropertyKey, unknown>)[k]
      if (typeof v !== 'function') return v
      let f = bound.get(k)
      if (!f) bound.set(k, (f = v.bind(m)))
      return f
    },
  })
}
