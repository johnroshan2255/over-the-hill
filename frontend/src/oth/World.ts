import * as GFX from './gfx'
import { type Atmosphere, LOOK } from './Atmosphere'
import { Birds } from './Birds'
import { Bridges } from './Bridges'
import { Bushes, placeBushes } from './Bushes'
import { Falls } from './Falls'
import { CaveWorld, loadCaveMeta } from './CaveWorld'
import { Formations } from './Formations'
import { Glow } from './Glow'
import { Grass } from './Grass'
import { Horizon } from './Horizon'
import { Landmarks, pavePatch } from './Landmarks'
import { Wonders } from './Wonders'
import { planWardens, Wardens } from './Wardens'
import { type Landmark, MapData } from './MapData'
import { gameParams } from '../settings'
import { placeThings } from './Places'
import { dressHills, NOTES, planSites, regrowPads } from './Sites'
import { Props } from './Props'
import type { Tier } from './quality'
import { Rocks } from './Rocks'
import { Terrain } from './Terrain'
import type { TerrainShadow } from './TerrainShadow'
import { placeTrees, Trees, TREE_STRIDE } from './Trees'
import { Water } from './Water'
import { Clutter } from './Clutter'
import { Mist } from './Mist'

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
  /** The cave's floor's grass (CaveWorld.grassFloor): its own field, drawn with the cave's inside. */
  caveGrass: Grass | null = null
  /** The outland's wonders (Wonders.ts: the World Tree, the stone arch). */
  wonders: Wonders | null = null
  /** The ground's small things round the camera (Clutter.ts — the look, 2026-11-13). */
  clutter: Clutter | null = null
  /** The ground mist in the hollows (Mist.ts — the look). */
  mist: Mist | null = null
  /** The Wardens' country (Wardens.ts: the outland's ruins, giants, writings). */
  wardens: Wardens | null = null

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
    /** The valley's cave world (Blender's — CaveWorld.ts; its physics a triangle mesh: main.ts). */
    readonly cave: CaveWorld | null = null,
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
      const t = new Terrain(map, atmos, tier, shadow, env.renderer)
      // (the far grid the car's material holds: this world's values in the same Vector4 — at once, or at the swap)
      farGrid = t.uniforms.uFarGrid.value.clone()
      if (!background) env.farGrid.copy(farGrid)
      t.uniforms.uFarGrid.value = env.farGrid
      return t
    })
    // (the desert's sculpted stones — Blender, desert_stones.py — fetched first: tiny, 30 kB)
    const stones = map.desert ? await Rocks.loadStones(`${WORLDS[id].path}/stones.glb`) : null
    // (and its STACKED ROCK — desert_stacks.py: the slab stacks the rocky hills are built of)
    const stacks = map.desert ? await Rocks.loadStacks(`${WORLDS[id].path}/stacks.json`) : null
    const rocks = await step('rocks', () => new Rocks(map, atmos, shadow, tier, env.farGrid, stones, stacks))
    // (the stacks cast shade: their slabs stamped into the shadow worker's copy of this world's heights)
    if (stacks) await step('stack shade', () => shadow.setOccluders(map, rocks.occluders()))
    const grass = await step('grass', () => new Grass(map, atmos, terrain, tier, rocks.footprint, env.renderer))
    const water = await step('water', () => new Water(map, atmos, terrain, tier, rocks.footprint))
    const falls = await step('falls', () => new Falls(map, atmos))
    const treeData: number[] = []
    await sliced('placing trees', placeTrees(map, rocks, treeData))
    const bushData: number[] = []
    await sliced('placing bushes', placeBushes(map, rocks, bushData))
    // THE SMALL THINGS (Places.ts picks where, seeded) — from the trees' places alone (the same as ever: every crate's id
    // kept), then THE NEW PLACES (Sites.ts — 2026-11-06) clear of all of it; the trees, bushes and stones on the new
    // places' ground taken out before the trees and bushes are built
    const treeAll = new Float32Array(treeData)
    const placed = await step('places', () => placeThings(map, rocks, { data: treeAll, count: treeAll.length / TREE_STRIDE } as unknown as Trees))
    // (?sites=0: without the new places — the cost A/B)
    // (the cave world's shape: its hill's top, its apron — fetched before the places are chosen: it takes the most room)
    const caveMeta = map.desert || gameParams().get('cave') === '0' ? null : await loadCaveMeta(WORLDS[id].path)
    const plan = gameParams().get('sites') === '0' ? { sites: [], keep: [] } : await step('sites', () => planSites(map, rocks, placed.props, [...(map.meta.landmarks ?? []), ...placed.camps], 1000, caveMeta))
    // THE WARDENS' COUNTRY (Wardens.ts): its ruins planned now, so the trees, bushes and stones keep off them
    const wplan = await step('wardens plan', () => planWardens(map, rocks))
    const wk = new Map<number, [number, number, number][]>()
    for (const k of wplan.keep) { const h = Math.floor(k[0] / 64) * 4096 + Math.floor(k[1] / 64); const l = wk.get(h); if (l) l.push(k); else wk.set(h, [k]) }
    const wardenOpen = (x: number, z: number) => {
      const ci = Math.floor(x / 64), cj = Math.floor(z / 64)
      for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (const [kx, kz, r] of wk.get(i * 4096 + j) ?? []) if ((x - kx) ** 2 + (z - kz) ** 2 < r * r) return false
      return true
    }
    const open = (x: number, z: number) => plan.keep.every(([kx, kz, r]) => (x - kx) ** 2 + (z - kz) ** 2 > r * r) && wardenOpen(x, z)
    const keepEvery = (a: ArrayLike<number>, stride: number) => { const o: number[] = []; for (let i = 0; i < a.length; i += stride) if (open(a[i], a[i + 2])) for (let k = 0; k < stride; k++) o.push(a[i + k]); return new Float32Array(o) }
    rocks.removeWithin(plan.keep)
    rocks.removeWithin(wplan.keep)
    // (the cave's hill: the land round it raised into its long flanks — before anything is placed on it)
    { const cs = plan.sites.find((l) => l.kind === 'cave'); if (cs && caveMeta && gameParams().get('caveflanks') === '1') CaveWorld.spreadFoot(map, cs, caveMeta) } // (off: it made walls and creases — 2026-11-08)
    // (and the small things on it: pebbles, logs, stumps — never a crate, a sign, a camp's)
    placed.props = placed.props.filter((p) => !['stones', 'log', 'stump', 'logs'].includes(p.kind) || open(p.x, p.z))
    // (the look, 2026-11-13 — the user: "remove those from the game": the meadows' small RUINS, a lone stone chimney among
    //  low walls, read as a tall box standing in a field)
    if (LOOK) placed.props = placed.props.filter((p) => p.kind !== 'ruin')
    // (the tunnel's hill: the trees and bushes where it stands lifted onto it, a few more on its crest — Sites.dressHills)
    const dressed = dressHills(map, plan.sites, keepEvery(treeAll, TREE_STRIDE), TREE_STRIDE, keepEvery(bushData, 7), 7, caveMeta)
    const trees = await step('trees', () => new Trees(map, atmos, shadow, tier, rocks, !background, dressed.trees))
    await step('impostors', () => trees.bakeImpostors(env.renderer))
    const bushes = await step('bushes', () => new Bushes(map, atmos, shadow, tier, rocks, trees.leafTexture, dressed.bushes))
    // OCCLUSION CULLING: what the hills hide (trees, rocks, bushes behind them are skipped)
    const horizon = await step('horizon', () => new Horizon(map, Math.max(tier.treeReach, tier.rockReach)))
    horizon.enabled = env.occlusion
    trees.horizon = rocks.horizon = bushes.horizon = terrain.horizon = horizon
    const bridges = await step('bridges', () => new Bridges(map, atmos, shadow, tier, env.farGrid))
    // without the post pass: the bloom and the god rays painted forward (Glow.ts)
    const glow = tier.bloom ? null : await step('glow', () => new Glow(map, atmos))
    atmos.uniforms.uGlow.value = glow ? 1 : 0
    // (the verges' stones join the rocks now, clear of the trees, the things and the new places: Rocks.settleVerge)
    await step('verge', () => rocks.settleVerge(trees.data, TREE_STRIDE, placed.props, plan.keep))
    // the old landmarks' pads grown back to grass (a yard, a path to the road): Sites.regrowPads
    await step('pads', () => regrowPads(map, map.meta.landmarks ?? []))
    // the CAMPS and the NEW PLACES join the landmarks (built, found, on the map like them); the notes left at them
    const places = (map.meta.landmarks = [...(map.meta.landmarks ?? []), ...placed.camps, ...plan.sites])
    for (const l of places) if (!l.note && NOTES[l.name]) l.note = NOTES[l.name]
    const landmarks = await step('landmarks', () => new Landmarks(map, atmos, shadow, tier, env.farGrid, rocks.footprint))
    // (and the meadows' small RUINS — Places.ts / Props.ts: a chimney among low walls, local x 0.4 … 6, z ±2.5 — paved
    //  the same; before Props keeps its footprint's base)
    for (const p of placed.props) if (p.kind === 'ruin') {
      const s = p.s ?? 1, cs = Math.cos(p.rot), sn = Math.sin(p.rot), cx = 3.2 * s
      const r = pavePatch(map, rocks.footprint.image.data as Uint8Array, p.x + cx * cs, p.z - cx * sn, p.rot, 3.4 * s, 3.0 * s, p.x, p.z)
      if (r > 0) landmarks.paved.push(p.x, p.z, p.rot, r + 2.5)
    }
    rocks.footprint.needsUpdate = map.trailTex.needsUpdate = true
    terrain.setPaved(landmarks.paved) // (the places' flagstones laid square to each)
    const props = await step('props', () => new Props(placed.props, [...places, ...wplan.fires], placed.swarms, atmos, shadow, tier, env.farGrid, env.crates, rocks.footprint, map.inner, map.desert))
    landmarks.horizon = bridges.horizon = falls.horizon = props.horizon = horizon
    // the outland's wonders (the World Tree, the stone arch): drawn, and run into, as the landmarks are
    const wonders = await step('wonders', () => new Wonders(map, atmos, shadow, tier, env.farGrid))
    wonders.horizon = horizon
    landmarks.colliders.push(...wonders.colliders)
    wonders.addLakes(water.poolMaterial())
    // (the Wardens' named sites join the landmarks — found, on the map and the signposts, the GPS round them — after
    //  Landmarks is built: their stones are Wardens' own; their colliders stream with the props')
    if (gameParams().get('wsites') !== '0') places.push(...wplan.sites)
    props.colliders.push(...wplan.cols)
    const wardens = await step('wardens', () => new Wardens(wplan, atmos, shadow, tier, env.farGrid))
    wardens.horizon = horizon
    if (wplan.floors.length) { const f = grass.setFloors(wplan.floors, map.play); terrain.setFloors(f.tex, f.grid) }   // (no blades up through a platform, a plinth, a court; the paths and courts painted earth)
    wardens.light(landmarks.found)   // (the beacons reached before burn)
    wardens.restoreVaults()          // (the vaults opened before stand open)
    // THE GROUND'S CLUTTER (the look): clear of the places (their reach), the ruins, the cleared spots; ?clutter=0: none
    const placeKeep = places.map((l) => [l.x, l.z, (l.r ?? 18) + 6] as [number, number, number])
    const clutter = map.desert || !LOOK || gameParams().get('clutter') === '0' ? null : await step('clutter', () => new Clutter(map, atmos, shadow, tier, env.farGrid, { data: trees.data, count: trees.count, stride: TREE_STRIDE },
      (x, z) => open(x, z) && placeKeep.every(([kx, kz, r]) => (x - kx) ** 2 + (z - kz) ** 2 > r * r)))
    const birds = env.birds ? await step('birds', () => new Birds(atmos, terrain)) : null
    // (the desert's sandstone slabs: fetched, Draco-decoded in the loader's workers)
    const tf = performance.now()
    const formations = map.desert ? await Formations.load(`${WORLDS[id].path}/formations.glb`, atmos, shadow, tier, env.farGrid) : null
    timings.formations = performance.now() - tf
    if (formations) formations.horizon = horizon
    // THE CAVE WORLD (cave.glb, Draco): laid on the land where Sites put it
    const caveSite = places.find((l) => l.kind === 'cave')
    const tCave = performance.now()
    const cave = caveSite && caveMeta ? await CaveWorld.load(WORLDS[id].path, map, caveSite, caveMeta, atmos, shadow, tier, env.farGrid, rocks.footprint, terrain) : null
    if (cave) cave.grassOn(map, grass) // (the field's grass on its hill)
    if (cave) cave.addPools(water.poolMaterial()) // (its ponds: the valley's water)
    // (and the field's grass on its floor: the same blades, a field of their own — drawn only with the inside)
    const floor = gameParams().get('cavegrass') === '0' ? null : cave?.grassFloor(map) // (?cavegrass=0: none — the A/B)
    const caveGrass = floor ? await step('cave grass', () => { const g = new Grass(map, atmos, terrain, tier, floor.foot, env.renderer, true); g.setHill(floor.lift, floor.x0, floor.z0, 2, floor.n, true, floor.cpu); return g }) : null
    if (cave && glow) glow.lift = (x, z) => cave.liftAt(x, z) // (no sun's glare through the hill)
    timings.cave = performance.now() - tCave
    const w = new World(id, map, terrain, rocks, grass, water, falls, trees, bushes, horizon, bridges, glow, landmarks, props, birds, formations, places, cave)
    w.farGrid.copy(farGrid)
    Object.assign(w.timings, timings)
    w.caveGrass = caveGrass
    w.wonders = wonders
    w.group.add(wonders.group)
    w.wardens = wardens
    w.clutter = clutter
    const mist = map.desert || !LOOK || gameParams().get('mist') === '0' ? null : new Mist(map, atmos, tier)
    w.mist = mist
    if (mist) w.group.add(mist.mesh)
    if (clutter) w.group.add(clutter.group)
    if (gameParams().get('wdraw') !== '0') w.group.add(wardens.group)
    if (caveGrass) w.group.add(caveGrass.group)
    w.group.add(props.group, landmarks.group, terrain.mesh, grass.group, rocks.group, trees.group, bushes.group, water.group, falls.group, bridges.group)
    if (glow) w.group.add(glow.group)
    if (birds) w.group.add(birds.mesh)
    if (formations) w.group.add(formations.group)
    if (cave) w.group.add(cave.group)
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
    this.wardens?.update(camera, dt)
    this.clutter?.update(camera)
    if (this.mist) { this.mist.update(camera); if (this.cave?.cameraInside) this.mist.mesh.visible = false }
    this.formations?.update(camera)
    this.cave?.update(camera.position)
    if (this.caveGrass) { const on = !!this.cave?.insideShown; this.caveGrass.group.visible = on; if (on) this.caveGrass.update(camera) }
    if (this.glow) this.glow.group.visible = !this.cave?.cameraInside // (no sun's glare through the hill)
    this.landmarks.cull(camera.position)
    this.wonders?.cull(camera.position)
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
    for (const t of [M.inner.tex, M.far.tex, M.inner.normalTex, M.far.normalTex, M.maskTex, M.trailTex, M.waterTex, this.rocks.footprint]) take(t)
    for (const t of textures) t.dispose()
    this.trees.atlas?.dispose()
    this.grass.dispose()
    this.caveGrass?.dispose()
    this.terrain.dispose()
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
