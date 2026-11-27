import * as GFX from '../oth/gfx'
const { GLTFLoader, mergeGeometries } = GFX
import hullUrl from './models/vehicles/boat_hull.lod0.glb?url'
import { vehicleDef, type VehicleDef } from '../gameplay/vehicle/catalogue'
import { bodyHulls, triangles } from '../gameplay/vehicle/hulls'

/**
 * Loads the vehicle GLBs (overhill: the cars and their boat hull — DARK's hero and trees are not part of this game) (parallel with Rapier init) and bakes them into plain geometry for the
 * game's own materials — no GLTF materials, scene graphs or PBR programs survive (skills/asset-optimization).
 *
 *   vehicles the garage catalogue (gameplay/vehicle/catalogue.ts): Mercedes G500 4×4², BMW E30, the kei van — each
 *           baked by `bakeVehicle` (materials → vertex colours, paint mask, wheels split out or
 *           found by name, glass split off) and normalised: metres, facing −Z, origin on the ground at the
 *           wheelbase centre. Loaded on demand and cached (`loadVehicle`).
 *   hull    the amphibious boat hull every car deploys (scripts/blender/boat_hull.py; gameplay/vehicle/BoatHull.ts):
 *           6 parts in normalised hull space with their hinge pivots, vertex colours only (~41 KB, loaded once).
 * Credits: ASSET_LIST.md § Credits.
 */
export interface TruckModel {
  /** Catalogue id. */
  id: string
  /** Body: position / normal / uv / color (material colour baked) / paintMask (1 = takes the paint colour; 2 = other bodywork: the paint grain, no tint; 0 = smooth). */
  body: GFX.BufferGeometry
  glass: GFX.BufferGeometry
  /** Front-left wheel, centred on its hub (right-side wheels use it turned 180°). */
  wheel: GFX.BufferGeometry
  /** Steering wheel (rim + spokes), centred on its hub; turns about `steeringAxis` (unit, pointing forward/down
   *  the column, away from the driver) at `steeringPivot`. null = the model has none we can find. */
  steeringWheel: GFX.BufferGeometry | null
  steeringPivot: [number, number, number]
  steeringAxis: [number, number, number]
  /** Hub centres FL, FR, RL, RR (m, truck space). */
  wheelPos: [number, number, number][]
  wheelRadius: number
  /** Body half extents (m) for the collider, and the body's y range. */
  half: { x: number; y: number; z: number }
  bottom: number
  /** Body z extent (m): the nose (−Z) and the tail (+Z) — the body is not symmetric about the wheelbase. */
  front: number
  rear: number
  /** Underside height (m) of the body ahead of the front / behind the rear tyres: the bumper colliders start there. */
  overhang: { front: number; rear: number }
  /** Half the tyre width (m), from the wheel mesh: the tyre envelope samples its tread edges too. */
  tyreHalfWidth: number
  /** Body + glass + closed doors as one triangle soup (xyz… per corner): the car's exact collider. */
  readonly mesh: Float32Array
  /** Convex pieces cut from `mesh` (gameplay/vehicle/hulls): the body against terrain and formations. */
  readonly hulls: Float32Array[]
  /** Body texture, or null for flat-coloured models (colour is in the vertices). */
  map: GFX.Texture | null
  /** Per-pixel paint mask for textured models (R = 1 on the body paint, 0 on rims, glass, trim, lights, rust),
   *  same UVs as `map`; null = the per-vertex `paintMask` alone decides (flat-coloured models). */
  paintMap: GFX.Texture | null
  /** WHERE THE WINCH'S LINE COMES OUT AND WHERE A HOOK GOES ON (car space, m — `towOf`): each ON the bumper's own
   *  face, found on the model. `fairlead`: the middle of the front bumper; `points`: the two front recovery points
   *  (left, right) and the rear one. null: no bumper found there (the winch falls back on the body's box). */
  tow: TowPoints | null
  /** THE LAMPS (car space, m) — the left's then the right's of each: the head lamps, the tail (brake) lamps. Each is the
   *  model's OWN LENS — its faces, where they are, how big, round or square (`lampsOf`): the light is drawn on those
   *  faces and nowhere else (oth/Lamps.ts). null: the model has no such lamp. */
  lamps: { head: [Lamp, Lamp] | null; tail: [Lamp, Lamp] | null }
  /** The doors cut out of the body in Blender (nodes `door_FL*` / `door_FR*` — and `door_RL*` / `door_RR*` — with a
   *  `hinge` extra): the left ones first. The DRIVER'S is `driverDoor(model)`. */
  doors: CarDoor[]
  /** Steering-wheel rim radius (m). */
  steeringRadius: number
  /** UV of a pale, flat texel in `map` (untextured parts of a textured model sample it → their own colour). */
  neutralUv: [number, number]
  /** That texel's colour (linear; white for flat-coloured models) — parts with a set colour divide it out. */
  neutralColor: [number, number, number]
  /** The amphibious hull (shared by every car; fitted to this one by BoatHull). */
  hull: HullAsset
  /** Brake hardware per axle (Blender `caliper_FL` / `caliper_RL`: disc + hat + caliper, or drum + backing plate),
   *  in hub space of the LEFT wheel — the right side is it turned 180° (calipers at 12 o'clock: symmetric). null =
   *  the model has none. Vertex-coloured; drawn hub + steer + suspension, never spinning (Car). */
  brakes: { front: GFX.BufferGeometry | null; rear: GFX.BufferGeometry | null }
  /** Rim radius / tyre radius of the wheel (glTF extra `rim` on `wheel_*`; scripts/blender/vehicle_realism.py) —
   *  where the rubber starts for the tyre-deformation shader (`tyreW` attribute on the wheel, 0 everywhere else). */
  rim: number
  /** The COCKPIT (scripts/blender/vehicle_cabin.py): the static cabin (`cab_*`: dash panels, seats, console, column…)
   *  drawn with the body but not part of its collider; the gauge faces (`dial_*`, UV-mapped onto the canvas the car
   *  draws its instruments on); and the moving parts — pedals, gear lever, wipers — in pivot space. */
  cabin: GFX.BufferGeometry | null
  dials: GFX.BufferGeometry | null
  controls: CockpitPart[]
  /** TOW HOOKS (scripts/blender/vehicle_hooks.py: `hook_F` / `hook_R`, their fairlead plates in the body), front and
   *  rear; null = the model has none. */
  hooks: { front: TowHook | null; rear: TowHook | null }
}

/** A detachable tow hook: geometry with its EYE (where the rope ties on) at the origin, where it hangs stowed (m, truck
 *  space), and the FAIRLEAD the rope leaves the car through (m, truck space). Vertex-coloured, on the car program. */
export interface TowHook {
  geo: GFX.BufferGeometry
  eye: [number, number, number]
  fairlead: [number, number, number]
}

/** A moving cockpit part (Blender `pedal_gas|brake|clutch`, `gear_lever`, `wiper_L|R` with `pivot` + `axis` extras):
 *  geometry with its pivot at the origin; it turns about `axis` (unit, truck space) at `pivot` (m, truck space).
 *  (2026-11-16, the cars' insides — scripts/oth/carkit.py:) the dials' NEEDLES (`needle_speed|rpm|fuel|temp|oil|volt`:
 *  `sweep` rad from 0 to `max`, in `unit`), the transfer case's RANGE lever and the HANDBRAKE's (`lever_transfer`,
 *  `lever_hand`), and on the gear lever how it moves (`shift`: 'floor' | 'column' | 'auto' | 'autofloor'), the column's line (`col`,
 *  unit, truck space) and where its knob is (`knob`, m, truck space). */
export interface CockpitPart {
  kind: string
  geo: GFX.BufferGeometry
  pivot: [number, number, number]
  axis: [number, number, number]
  sweep?: number
  max?: number
  unit?: string
  shift?: 'floor' | 'column' | 'auto' | 'autofloor'
  col?: [number, number, number]
  knob?: [number, number, number]
}

/** Boat hull parts in normalised hull space (scripts/blender/boat_hull.py): geometry + hinge pivot (glTF space). */
export interface HullAsset {
  parts: Map<string, { geo: GFX.BufferGeometry; pivot: [number, number, number] }>
}

export interface CarDoor {
  /** −1 = left (driver, −x), +1 = right. */
  side: -1 | 1
  /** Door skin + trim, in door space: origin on the hinge line, closed = identity, rear edge toward +z. */
  body: GFX.BufferGeometry
  glass: GFX.BufferGeometry | null
  /** Hinge point (m, truck space). */
  hinge: [number, number, number]
  /** Hinge → rear edge (m) and the door's bottom / top (door space y). */
  length: number
  bottom: number
  top: number
}

/** The driver's door: the left side's front one (the hinge furthest forward — −z); null = the model has no doors cut. */
export function driverDoor(m: { doors: CarDoor[] }): CarDoor | null {
  return m.doors.filter((d) => d.side === -1).sort((a, b) => a.hinge[2] - b.hinge[2])[0] ?? null
}

/** A car's winch and recovery points, each a place on its bumper's face (car space, m). */
export interface TowPoints { fairlead: [number, number, number]; points: [[number, number, number], [number, number, number], [number, number, number]] }

/** ONE LENS of a lamp: the middle of its outline on its outermost plane, half its width and height, its shape. */
export interface Lens {
  c: [number, number, number]
  w: number
  h: number
  /** A round lens (its light a disc) — or a square one. */
  round: boolean
  /** ITS OWN FACES: the vertices, three a triangle, in the model's `body` (`ofGlass`: in its `glass`) — what is lit is
   *  these, moved as the body is dented. null: none known (the game draws the disc / the square itself). */
  verts: Uint32Array | null
  ofGlass: boolean
  /** A MEASURED lens (the catalogue's `lamps` — a model that names none): its faces are the body's own under its
   *  outline — whole triangles, so lit only INSIDE the outline (Lamps.ts cuts them to it, to the pixel). */
  clip: boolean
}

/** A LAMP: one side's — its lenses, the biggest first; `c`, `w`, `h`, `round` are that one's (the beam starts there). */
export interface Lamp extends Lens {
  lenses: Lens[]
}

/** RGBA pixels of a texture image, downscaled to ≤ `max` px (CPU analysis at load). */
function readPixels(tex: GFX.Texture, max = 512): { data: Uint8ClampedArray; w: number; h: number } | null {
  const img = tex.image as (CanvasImageSource & { width: number; height: number }) | undefined
  if (!img || !img.width || typeof document === 'undefined') return null
  const k = Math.min(1, max / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, w, h)
  return { data: ctx.getImageData(0, 0, w, h).data, w, h }
}

function hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  let hh = 0
  if (d > 1e-6) hh = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [hh / 6, mx > 0 ? d / mx : 0, mx]
}

/**
 * PAINT MASK from the texture: a vehicle's body colour is ONE dominant hue across the big panels (the G500's
 * green) while rims, tyres, glass, chrome, seats, lights and rust are greys, blacks, creams, reds. The most
 * common saturated hue wins; pixels within ~25° of it (and saturated / bright enough) are paint. Soft edges.
 */
function buildPaintMap(tex: GFX.Texture, white = false): GFX.Texture | null {
  const px = readPixels(tex)
  if (!px) return null
  const { data, w, h } = px
  const bins = new Float32Array(48)
  for (let i = 0; i < w * h; i++) {
    const [hh, sat, val] = hsv(data[i * 4] / 255, data[i * 4 + 1] / 255, data[i * 4 + 2] / 255)
    if (sat > 0.22 && val > 0.18) bins[Math.floor(hh * 48) % 48] += sat
  }
  let best = 0
  for (let i = 1; i < 48; i++) if (bins[i] + bins[(i + 47) % 48] * 0.5 + bins[(i + 1) % 48] * 0.5 > bins[best] + bins[(best + 47) % 48] * 0.5 + bins[(best + 1) % 48] * 0.5) best = i
  const h0 = (best + 0.5) / 48
  const out = new Uint8Array(w * h * 4)
  const ss = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  for (let i = 0; i < w * h; i++) {
    const [hh, sat, val] = hsv(data[i * 4] / 255, data[i * 4 + 1] / 255, data[i * 4 + 2] / 255)
    let dh = Math.abs(hh - h0)
    dh = Math.min(dh, 1 - dh)
    // (a WHITE car, catalogue `whitePaint`: the bright, neutral texels are the paint — trim, glass, lamps and tyres
    //  are dark or coloured)
    const m = white ? ss(0.62, 0.78, val) * (1 - ss(0.1, 0.2, sat)) : (1 - ss(0.06, 0.1, dh)) * ss(0.1, 0.2, sat) * ss(0.06, 0.14, val)
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = Math.round(m * 255)
    out[i * 4 + 3] = 255
  }
  const t = new GFX.DataTexture(out, w, h)
  t.flipY = false // canvas rows are top-down; DataTexture row 0 = v 0 — same orientation as a glTF map (flipY false)
  if (tex.flipY) {
    // A flipY map samples row 0 at v = 1: flip our rows to match.
    const row = w * 4, tmp = new Uint8Array(row)
    for (let y = 0; y < h >> 1; y++) {
      tmp.set(out.subarray(y * row, y * row + row))
      out.copyWithin(y * row, (h - 1 - y) * row, (h - y) * row)
      out.set(tmp, (h - 1 - y) * row)
    }
  }
  t.magFilter = t.minFilter = GFX.LinearFilter
  t.generateMipmaps = false
  t.wrapS = tex.wrapS
  t.wrapT = tex.wrapT
  t.needsUpdate = true
  t.name = 'paintMask'
  return t
}

/** Lowest body point (m) ahead of the front tyres and behind the rear ones, within the frame's width (the same
 *  1.05 r gap the frame boxes leave around the wheels — the arches dip lower there). Missing = the frame height. */
function overhangs(body: GFX.BufferGeometry, wheelPos: [number, number, number][], r: number, halfX: number): { front: number; rear: number } {
  const p = body.getAttribute('position')
  const zf = Math.min(wheelPos[0][2], wheelPos[1][2]) - 1.05 * r, zr = Math.max(wheelPos[2][2], wheelPos[3][2]) + 1.05 * r
  let front = Infinity, rear = Infinity
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(p.getX(i)) > halfX * 0.9) continue
    const y = p.getY(i), z = p.getZ(i)
    if (z < zf) front = Math.min(front, y)
    else if (z > zr) rear = Math.min(rear, y)
  }
  return { front: Number.isFinite(front) ? front : 0.34, rear: Number.isFinite(rear) ? rear : 0.34 }
}

export type VehicleModel = TruckModel

const vehicleCache = new Map<string, Promise<VehicleModel>>()

/** Load (once) and bake a catalogue vehicle. */
/** PC or PHONE (2026-11-10, the user: "make sure all work on a low-end mobile … separate for mobile and PC"): `small`
 *  — a weak GPU, a phone, the LOW / MEDIUM tiers (oth/Vehicle.ts sets it from the tier before the first car loads) —
 *  loads each car's phone file where it has one (`urlSmall`: the painted texture at 1024²), and `maxTexture` caps what
 *  goes to the GPU (512 on LOW: 1.4 MB with its mips, against 21 MB for the PC's 2048²). */
let detail = { small: false, maxTexture: 0 }
export function carDetail(small: boolean, maxTexture = 0): void { detail = { small, maxTexture } }
/** The rule, from the quality tier: a phone-class chip or the LOW / MEDIUM tiers take the phones' files; LOW draws 512². */
export function carDetailFor(tier: { name: string; weakGpu?: boolean }): void { carDetail(!!tier.weakGpu || tier.name === 'low' || tier.name === 'medium', tier.name === 'low' ? 512 : 0) }

export function loadVehicle(id: string, onProgress?: (f: number) => void): Promise<VehicleModel> {
  const def = vehicleDef(id)
  // (kept per detail: the title's preload guesses the tier — a different one in play loads its own)
  const key = `${def.id}|${detail.small ? 's' : 'f'}${detail.maxTexture}`
  let p = vehicleCache.get(key)
  if (!p) {
    let total = def.bytes
    const car = new GLTFLoader().loadAsync(detail.small && def.urlSmall ? def.urlSmall : def.url, (e) => {
      if (e.lengthComputable) total = e.total
      onProgress?.(Math.min(1, e.loaded / total))
    })
    p = Promise.all([car, loadHull()]).then(([g, hull]) => {
      const m = bakeVehicle(g.scene, def)
      // (the paint mask has read the full image: now the size this device draws)
      if (m.map && detail.maxTexture) m.map = downscaleTexture(m.map, detail.maxTexture)
      return { ...m, hull }
    })
    vehicleCache.set(key, p)
  } else onProgress?.(1)
  return p
}

let hullPromise: Promise<HullAsset> | null = null

/** Load (once) the amphibious hull: its parts by node name (`hull_*`), each with its `pivot` extra. */
export function loadHull(): Promise<HullAsset> {
  hullPromise ??= new GLTFLoader().loadAsync(hullUrl).then((g) => {
    const parts: HullAsset['parts'] = new Map()
    for (const m of bakedMeshes(g.scene)) {
      const name = /hull_\w+/.exec(m.name)?.[0]
      if (!name) continue
      for (const a of Object.keys(m.geo.attributes)) if (a !== 'position' && a !== 'normal' && a !== 'color') m.geo.deleteAttribute(a)
      parts.set(name, { geo: m.geo, pivot: (m.extras.pivot as [number, number, number] | undefined) ?? [0, 0, 0] })
    }
    return { parts }
  })
  return hullPromise
}

/** Every mesh in world space. `name` includes the parent's (a multi-material node is a Group of primitives);
 *  `extras` = the node's glTF extras (e.g. a door's `hinge`). */
function bakedMeshes(scene: GFX.Object3D): { name: string; geo: GFX.BufferGeometry; mat: GFX.Material; extras: Record<string, unknown> }[] {
  scene.updateMatrixWorld(true)
  const out: { name: string; geo: GFX.BufferGeometry; mat: GFX.Material; extras: Record<string, unknown> }[] = []
  scene.traverse((o) => {
    const m = o as GFX.Mesh
    if (!m.isMesh) return
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld)
    const parent = m.parent && m.parent !== scene ? m.parent : null
    out.push({ name: parent ? `${m.name}|${parent.name}` : m.name, geo: g, mat: m.material as GFX.Material, extras: { ...(parent?.userData ?? {}), ...m.userData } })
  })
  return out
}

/** UV of the palest flat texel (low saturation, bright, uniform neighbourhood) — untextured parts of a textured
 *  model (interior, axles) point all their UVs at it so the shared textured material shows their own colour. */
function neutralTexel(tex: GFX.Texture): { uv: [number, number]; color: [number, number, number] } {
  const px = readPixels(tex, 128)
  if (!px) return { uv: [0, 0], color: [1, 1, 1] }
  const { data, w, h } = px
  let best = -1e9, bu = 0, bv = 0, bo = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const o = (y * w + x) * 4
      const [, sat, val] = hsv(data[o] / 255, data[o + 1] / 255, data[o + 2] / 255)
      let dev = 0
      for (const d of [-4, 4, -w * 4, w * 4]) dev += Math.abs(data[o + d] - data[o]) + Math.abs(data[o + d + 1] - data[o + 1]) + Math.abs(data[o + d + 2] - data[o + 2])
      const score = val - sat * 2 - dev / 255
      if (score > best) (best = score), (bu = (x + 0.5) / w), (bv = (y + 0.5) / h), (bo = o)
    }
  }
  const lin = (c: number) => new GFX.Color().setRGB(c / 255, 0, 0, GFX.SRGBColorSpace).r
  return { uv: [bu, tex.flipY ? 1 - bv : bv], color: [lin(data[bo]), lin(data[bo + 1]), lin(data[bo + 2])] }
}

/** Connected components (vertices welded by position) → per-triangle component id + component bounds. */
function components(g: GFX.BufferGeometry): { triComp: Int32Array; boxes: Map<number, { box: GFX.Box3; tris: number }> } {
  const pos = g.getAttribute('position')
  const idx = g.index
  const tri = idx ? idx.count / 3 : pos.count / 3
  const vi = (t: number, k: number) => (idx ? idx.getX(t * 3 + k) : t * 3 + k)
  const weld = new Map<string, number>()
  const rep = new Int32Array(pos.count)
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`
    let r = weld.get(k)
    if (r === undefined) weld.set(k, (r = i))
    rep[i] = r
  }
  const parent = Int32Array.from({ length: pos.count }, (_, i) => i)
  const find = (a: number) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]]
    return a
  }
  for (let t = 0; t < tri; t++) {
    const a = find(rep[vi(t, 0)]), b = find(rep[vi(t, 1)]), c = find(rep[vi(t, 2)])
    parent[b] = a
    parent[find(c)] = a
  }
  const triComp = new Int32Array(tri)
  const boxes = new Map<number, { box: GFX.Box3; tris: number }>()
  const v = new GFX.Vector3()
  for (let t = 0; t < tri; t++) {
    const c = find(rep[vi(t, 0)])
    triComp[t] = c
    let e = boxes.get(c)
    if (!e) boxes.set(c, (e = { box: new GFX.Box3(), tris: 0 }))
    e.tris++
    for (let k = 0; k < 3; k++) e.box.expandByPoint(v.fromBufferAttribute(pos, vi(t, k)))
  }
  return { triComp, boxes }
}

/** New geometry with only the triangles `keep(t)` (non-indexed, attributes copied). */
function subset(g: GFX.BufferGeometry, keep: (t: number) => boolean): GFX.BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g
  const tri = src.getAttribute('position').count / 3
  const out = new GFX.BufferGeometry()
  for (const name of Object.keys(src.attributes)) {
    const a = src.getAttribute(name) as GFX.BufferAttribute
    const n = a.itemSize
    const arr: number[] = []
    for (let t = 0; t < tri; t++) {
      if (!keep(t)) continue
      for (let k = 0; k < 3; k++) for (let c = 0; c < n; c++) arr.push(a.array[(t * 3 + k) * n + c])
    }
    out.setAttribute(name, new GFX.Float32BufferAttribute(arr, n))
  }
  if (src !== g) src.dispose()
  return out
}

/** Linear material colour + texture (if any) of a baked mesh. */
function matColor(mat: GFX.Material): { color: GFX.Color; map: GFX.Texture | null; glass: boolean } {
  const m = mat as GFX.MeshStandardMaterial
  const color = (m.color ?? new GFX.Color(1, 1, 1)).clone()
  const map = (m.map as GFX.Texture | undefined) ?? null
  const glass = m.transparent || /wind|glas/i.test(mat.name)
  return { color, map, glass }
}

/**
 * REAL PAINT (catalogue `grade`): a model's texture painted in toy-bright colours is graded toward weathered real
 * paint — saturation × sat (around each texel's own luminance) and brightness × gain — keeping its rust, grime and
 * detail. In place, once at load (after the paint mask has read the original), full resolution.
 */
function gradeTexture(tex: GFX.Texture, sat: number, gain: number): void {
  const img = tex.image as (CanvasImageSource & { width: number; height: number }) | undefined
  if (!img || !img.width || typeof document === 'undefined') return
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0)
  const px = g.getImageData(0, 0, c.width, c.height)
  const d = px.data
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]
    d[i] = (l + (d[i] - l) * sat) * gain
    d[i + 1] = (l + (d[i + 1] - l) * sat) * gain
    d[i + 2] = (l + (d[i + 2] - l) * sat) * gain
  }
  g.putImageData(px, 0, 0)
  tex.image = c
  tex.needsUpdate = true
}

/** A `tyreW` attribute of zeros (geometry drawn on the car program that is not a tyre). */
export function zeroTyre(g: GFX.BufferGeometry): GFX.BufferGeometry {
  if (!g.getAttribute('tyreW')) g.setAttribute('tyreW', new GFX.BufferAttribute(new Float32Array(g.getAttribute('position').count), 1))
  return g
}

/** Geometry with only position/normal/uv/color/paintMask (so bodies merge), colour baked, uv kept only with a map.
 *  `keepColor`: multiply the source's own vertex colours in (parts authored with them, e.g. `caliper_*`). */
function paintGeometry(g: GFX.BufferGeometry, color: GFX.Color, keepUv: boolean, paint: number, keepColor = false): GFX.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g.clone()
  const src = keepColor ? (out.getAttribute('color') as GFX.BufferAttribute | undefined) : undefined
  const srcCol = src ? Array.from({ length: src.count }, (_, i) => [src.getX(i), src.getY(i), src.getZ(i)]) : null
  for (const name of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(name)) out.deleteAttribute(name)
  const n = out.getAttribute('position').count
  if (!out.getAttribute('normal')) out.computeVertexNormals()
  if (!keepUv) out.deleteAttribute('uv')
  if (!out.getAttribute('uv')) out.setAttribute('uv', new GFX.BufferAttribute(new Float32Array(n * 2), 2))
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    color.toArray(col, i * 3)
    if (srcCol) for (let k = 0; k < 3; k++) col[i * 3 + k] *= srcCol[i][k]
  }
  out.setAttribute('color', new GFX.BufferAttribute(col, 3))
  out.setAttribute('paintMask', new GFX.BufferAttribute(new Float32Array(n).fill(paint), 1))
  return out
}

/** WHICH LAMP a part's faces are the lens of, by its names (the node's, its material's): the kit's and the off-roader's
 *  `lamp_lens` (the head lamps' pale glass) and `glows` (the tail lamps' red), the G500's `glas_light` and its
 *  `lights_brakes` (its other `glows` — the position and the reversing lamps — are not the brake lights). */
function lensKind(name: string, mat: string): 'head' | 'brake' | 'tail' | null {
  const s = `${name} ${mat}`
  if (/reverse|position_front|indicator|turn|amber/i.test(s)) return null
  if (/lamp_lens|glas_light|head_?(lamp|light)/i.test(s)) return 'head'
  if (/lights?_brake|brake_?(lamp|light|glow)/i.test(s)) return 'brake'
  if (/glow|tail_?(lamp|light)/i.test(s)) return 'tail'
  return null
}

/**
 * THE LENSES among the faces named a lamp's (2026-11-27, the user: "the light must come exactly from the car's
 * headlight and brake light — not a nanometre off; a round lamp's light round"): `ranges` are those faces' vertices in
 * `geo` (three a triangle), `dir` the way the lamp looks (−1 ahead, 1 back). Each connected piece is a lens: its
 * OUTLINE is its bounds across the car and up, its plane its outermost one, its SHAPE from the face that looks out —
 * a disc fills π/4 of its square, a square all of it. A piece none of whose faces look out, or in the wrong half of
 * the car, is not one. Per side (0 the left, 1 the right), the biggest first.
 */
function lensesOf(geo: GFX.BufferGeometry, ranges: [start: number, count: number][], dir: -1 | 1, ofGlass: boolean): [Lens[], Lens[]] {
  const out: [Lens[], Lens[]] = [[], []]
  const pos = geo.getAttribute('position') as GFX.BufferAttribute | undefined, nor = geo.getAttribute('normal') as GFX.BufferAttribute | undefined
  if (!pos || geo.index) return out
  const P = pos.array as Float32Array
  const tris: number[] = []
  for (const [s0, n] of ranges) for (let i = 0; i + 2 < n; i += 3) tris.push(s0 + i)
  if (!tris.length) return out
  // the pieces: vertices at one place (to 0.1 mm) are one
  const at = new Map<string, number>(), parent: number[] = []
  const find = (a: number) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a }
  const node = (v: number) => {
    const k = `${Math.round(P[v * 3] * 1e4)},${Math.round(P[v * 3 + 1] * 1e4)},${Math.round(P[v * 3 + 2] * 1e4)}`
    let r = at.get(k)
    if (r === undefined) { r = parent.length; parent.push(r); at.set(k, r) }
    return r
  }
  const triNode = tris.map((t) => { const a = node(t), b = node(t + 1), c = node(t + 2); parent[find(b)] = find(a); parent[find(c)] = find(a); return a })
  const pieces = new Map<number, number[]>()
  tris.forEach((t, i) => { const r = find(triNode[i]); pieces.set(r, [...(pieces.get(r) ?? []), t]) })
  const a = new GFX.Vector3(), b = new GFX.Vector3(), c = new GFX.Vector3(), n = new GFX.Vector3(), e1 = new GFX.Vector3(), e2 = new GFX.Vector3()
  const found: (Lens & { area: number })[] = []
  for (const list of pieces.values()) {
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], clo = [1e9, 1e9], chi = [-1e9, -1e9]
    const verts = new Uint32Array(list.length * 3)
    let cap = 0, vi = 0
    for (const t of list) {
      verts[vi++] = t; verts[vi++] = t + 1; verts[vi++] = t + 2
      a.fromBufferAttribute(pos, t); b.fromBufferAttribute(pos, t + 1); c.fromBufferAttribute(pos, t + 2)
      for (const v of [a, b, c]) { lo[0] = Math.min(lo[0], v.x); lo[1] = Math.min(lo[1], v.y); lo[2] = Math.min(lo[2], v.z); hi[0] = Math.max(hi[0], v.x); hi[1] = Math.max(hi[1], v.y); hi[2] = Math.max(hi[2], v.z) }
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a))
      const area = n.length() / 2
      if (area < 1e-10) continue
      // (which way the face looks: its own winding — set right by its vertices' normals where the two disagree: a
      //  pane of glass is drawn from both sides and may be wound either way, the light is drawn from the front only)
      let nz = n.z / (area * 2)
      if (nor) {
        e1.set(nor.getX(t) + nor.getX(t + 1) + nor.getX(t + 2), nor.getY(t) + nor.getY(t + 1) + nor.getY(t + 2), nor.getZ(t) + nor.getZ(t + 1) + nor.getZ(t + 2))
        if (e1.dot(n) < 0) { nz = -nz; verts[vi - 2] = t + 2; verts[vi - 1] = t + 1 }
      }
      if (nz * dir < 0.7) continue
      cap += area
      for (const v of [a, b, c]) { clo[0] = Math.min(clo[0], v.x); clo[1] = Math.min(clo[1], v.y); chi[0] = Math.max(chi[0], v.x); chi[1] = Math.max(chi[1], v.y) }
    }
    const cz = (lo[2] + hi[2]) / 2
    if (cap < 2e-4 || cz * dir < 0) continue                                     // (under 2 cm² looking out, or at the wrong end)
    found.push({ c: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, dir < 0 ? lo[2] : hi[2]], w: (hi[0] - lo[0]) / 2, h: (hi[1] - lo[1]) / 2,
      round: cap / Math.max(1e-9, (chi[0] - clo[0]) * (chi[1] - clo[1])) < 0.89, verts, ofGlass, clip: false, area: cap })
  }
  found.sort((p, q) => q.area - p.area)
  for (const { area: _area, ...l } of found) out[l.c[0] < 0 ? 0 : 1].push(l)
  return out
}

/** The body's outermost surface at (x, y) looking `dir` (−1 the nose, 1 the tail): z there — a measured lamp is laid
 *  on it. null: no face there. */
function surfaceZ(body: GFX.BufferGeometry, x: number, y: number, dir: -1 | 1): number | null {
  const P = (body.getAttribute('position') as GFX.BufferAttribute).array as Float32Array
  let best: number | null = null
  for (let t = 0; t + 8 < P.length; t += 9) {
    const ax = P[t], ay = P[t + 1], bx = P[t + 3], by = P[t + 4], cx = P[t + 6], cy = P[t + 7]
    if (Math.min(ax, bx, cx) > x || Math.max(ax, bx, cx) < x || Math.min(ay, by, cy) > y || Math.max(ay, by, cy) < y) continue
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (Math.abs(d) < 1e-12) continue
    const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d, v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d, w = 1 - u - v
    if (u < 0 || v < 0 || w < 0) continue
    const z = u * P[t + 2] + v * P[t + 5] + w * P[t + 8]
    if (best === null || z * dir > best * dir) best = z
  }
  return best
}

/** THE BODY'S OWN FACES UNDER A MEASURED LENS (its middle c, half its width and height, looking `dir`): every face
 *  that looks out, reaches into the outline's box and lies within 15 cm behind the surface at its middle — the lens's
 *  dome, its ribs, whatever the model has there; null: none. */
function facesUnder(body: GFX.BufferGeometry, c: [number, number, number], w: number, h: number, dir: -1 | 1): Uint32Array | null {
  const pos = body.getAttribute('position') as GFX.BufferAttribute, nor = body.getAttribute('normal') as GFX.BufferAttribute | undefined
  const P = pos.array as Float32Array, out: number[] = []
  for (let t = 0; t + 8 < P.length; t += 9) {
    const ax = P[t], ay = P[t + 1], az = P[t + 2], bx = P[t + 3], by = P[t + 4], bz = P[t + 5], cx = P[t + 6], cy = P[t + 7], cz = P[t + 8]
    if (Math.min(ax, bx, cx) > c[0] + w || Math.max(ax, bx, cx) < c[0] - w || Math.min(ay, by, cy) > c[1] + h || Math.max(ay, by, cy) < c[1] - h) continue
    const zo = dir < 0 ? Math.min(az, bz, cz) : Math.max(az, bz, cz)
    if ((zo - c[2]) * dir < -0.15 || (zo - c[2]) * dir > 0.03) continue
    // (the face's own winding, set right by its vertices' normals — as a named lens's)
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay), ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    const len = Math.hypot(nx, ny, nz)
    if (len < 1e-10) continue
    const v = t / 3
    let flip = false
    if (nor) flip = nx * (nor.getX(v) + nor.getX(v + 1) + nor.getX(v + 2)) + ny * (nor.getY(v) + nor.getY(v + 1) + nor.getY(v + 2)) + nz * (nor.getZ(v) + nor.getZ(v + 1) + nor.getZ(v + 2)) < 0
    if (flip) nz = -nz
    if ((nz / len) * dir < 0.15) continue
    out.push(v, flip ? v + 2 : v + 1, flip ? v + 1 : v + 2)
  }
  return out.length ? Uint32Array.from(out) : null
}

/** THE BUMPER'S FACE at x, looking `dir` (−1 the nose, 1 the tail): up from the body's underside there (`low`) for
 *  0.6 m, the OUTERMOST thing — the lowest such, where two stand out alike — and the run of heights about it that is
 *  its face (within 2 cm of it): its z, its bottom and its top. Taken OFF THE CAR'S MIDDLE (`towOf`: at the side —
 *  clear of a spare wheel, a bull bar's hoop, a plate): there the bumper is what stands out furthest under the body's
 *  panel; under it the chassis is far behind. null: nothing there. */
function bumperFace(body: GFX.BufferGeometry, x: number, dir: -1 | 1, low: number): { z: number; y0: number; y1: number } | null {
  const ys: number[] = [], zs: (number | null)[] = []
  for (let y = low + 0.01; y <= low + 0.6; y += 0.01) { ys.push(y); zs.push(surfaceZ(body, x, y, dir)) }
  let best = -1
  for (let i = 0; i < zs.length; i++) if (zs[i] !== null && (best < 0 || zs[i]! * dir > zs[best]! * dir + 0.004)) best = i
  if (best < 0) return null
  let i0 = best, i1 = best
  while (i0 > 0 && zs[i0 - 1] !== null && Math.abs(zs[i0 - 1]! - zs[best]!) < 0.02) i0--
  while (i1 < zs.length - 1 && zs[i1 + 1] !== null && Math.abs(zs[i1 + 1]! - zs[best]!) < 0.02) i1++
  return { z: zs[best]!, y0: ys[i0], y1: ys[i1] }
}

/**
 * A CAR'S WINCH AND RECOVERY POINTS, ON ITS OWN BUMPERS (2026-11-27, the user: "the hook we pull vehicles with is not
 * connected to the cars — it's in the air; check all cars, it must be perfectly attached"). They were put by the
 * body's BOX — its nose's and its tail's furthest z, at a height reckoned from the wheel: on a car with a spare wheel
 * on its back door (the Bronc's rear eye 15 cm behind its bumper and 22 cm under it), a bull bar, a bumper lower or
 * higher than that, the hook hung and the eyes stood in the air. Now each is found ON THE MODEL: the bumper's height
 * from its face out at the side (`bumperFace`, at 55 % of the half width — nearer the middle where it ends short), and
 * at that height each point's place is the body's own surface there (`surfaceZ`: on the metal, to the float) — the
 * two FRONT points on the face at the side, the REAR one and the FAIRLEAD in the middle (a step aside where a spare
 * wheel or a bar stands before the bumper there), the fairlead near the face's top (the hook hangs down it).
 */
function towOf(body: GFX.BufferGeometry, halfX: number, overhang: { front: number; rear: number }): TowPoints | null {
  const end = (dir: -1 | 1): { x: number; f: { z: number; y0: number; y1: number } } | null => {
    for (const k of [0.55, 0.4, 0.25]) { const f = bumperFace(body, halfX * k, dir, dir < 0 ? overhang.front : overhang.rear); if (f) return { x: halfX * k, f } }
    return null
  }
  // (a place on the bumper at height y, as near x as the bumper's own face is found: not on what stands before it)
  const on = (x: number, y: number, dir: -1 | 1, face: number): [number, number, number] | null => {
    for (const dx of [0, 0.06, -0.06, 0.12, -0.12, 0.2, -0.2, 0.3, -0.3]) {
      const z = surfaceZ(body, x + dx, y, dir)
      if (z !== null && Math.abs(z - face) < 0.06) return [x + dx, y, z]
    }
    return null
  }
  const F = end(-1), R = end(1)
  if (!F || !R) return null
  const fy = (F.f.y0 + F.f.y1) / 2, ry = (R.f.y0 + R.f.y1) / 2
  const l = on(-F.x, fy, -1, F.f.z), r = on(F.x, fy, -1, F.f.z), back = on(0, ry, 1, R.f.z)
  const lead = on(0, Math.max(fy, F.f.y1 - 0.03), -1, F.f.z) ?? on(0, fy, -1, F.f.z)
  if (!l || !r || !back || !lead) return null
  return { fairlead: lead, points: [l, r, back] }
}

/** A side's lamp of its lenses (the biggest first) — null with none. */
function lampOf(lenses: Lens[]): Lamp | null {
  return lenses.length ? { ...lenses[0], lenses } : null
}

/** The other side's lamp where a model has a lens on one side only: the same, across the car, drawn by the game. */
function mirrored(l: Lamp): Lamp {
  const lenses = l.lenses.map((q) => ({ ...q, c: [-q.c[0], q.c[1], q.c[2]] as [number, number, number], verts: null, clip: false }))
  return { ...lenses[0], lenses }
}

/**
 * A MODEL'S LAMPS. From its own LENS FACES where it names them (every car of the garage: `lensKind`) — the brake
 * lights' own where it tells them from its other red lamps. Else from the catalogue's MEASURE (`lamps`: the E30, one
 * painted skin with no lens named), each the body's own faces under its outline (`facesUnder`). Else none: no light is drawn where no
 * lamp is known to be (the texture's brightest patch, guessed until 2026-11-27, was the bumper or the plate on most).
 */
function lampsOf(def: VehicleDef, body: GFX.BufferGeometry, glass: GFX.BufferGeometry, tags: { kind: 'head' | 'brake' | 'tail'; glass: boolean; start: number; count: number }[] | null): { head: [Lamp, Lamp] | null; tail: [Lamp, Lamp] | null } {
  const sides = (kind: 'head' | 'brake' | 'tail', dir: -1 | 1): [Lens[], Lens[]] => {
    const out: [Lens[], Lens[]] = [[], []]
    if (!tags) return out
    for (const ofGlass of [false, true]) {
      const r = tags.filter((t) => t.kind === kind && t.glass === ofGlass).map((t) => [t.start, t.count] as [number, number])
      const f = lensesOf(ofGlass ? glass : body, r, dir, ofGlass)
      out[0].push(...f[0]); out[1].push(...f[1])
    }
    return out
  }
  const pair = (s: [Lens[], Lens[]]): [Lamp, Lamp] | null => {
    const l = lampOf(s[0]), r = lampOf(s[1])
    return l && r ? [l, r] : l ? [l, mirrored(l)] : r ? [mirrored(r), r] : null
  }
  let head = pair(sides('head', -1))
  const brake = sides('brake', 1)
  let tail = pair(brake[0].length || brake[1].length ? brake : sides('tail', 1))
  const M = def.lamps
  if (M && (!head || !tail)) {
    const measured = (at: [number, number, number][], size: [number, number], round: boolean, dir: -1 | 1): [Lamp, Lamp] => {
      const side = (sx: number): Lamp => lampOf(at.map((p) => {
        const x = sx * Math.abs(p[0]), c: [number, number, number] = [x, p[1], surfaceZ(body, x, p[1], dir) ?? p[2]]
        return { c, w: size[0], h: size[1], round, verts: facesUnder(body, c, size[0], size[1], dir), ofGlass: false, clip: true }
      }))!
      return [side(-1), side(1)]
    }
    head ??= measured(M.head2 ? [M.head, M.head2] : [M.head], M.headSize ?? [0.09, 0.09], (M.headShape ?? 'round') === 'round', -1)
    tail ??= measured([M.tail], M.tailSize ?? [0.06, 0.1], M.tailShape === 'round', 1)
  }
  if (!head || !tail) console.warn(`${def.id}: no ${!head ? 'head' : 'tail'} lamp — no lens named in the model (lamp_lens / glows), none measured in the catalogue: no light is drawn there`)
  return { head, tail }
}

/**
 * Bake ANY catalogue vehicle: every mesh gets its material colour in the vertices (flat-coloured models need no
 * texture at all), paint panels are masked, the glass is split off, the four wheels are found by name
 * (`def.wheelRegex`) or split out of the body by shape (parts touching the ground, round in side view), and the
 * whole thing is normalised: metres (`def.length`), facing −Z, origin on the ground at the wheelbase centre.
 */
function bakeVehicle(scene: GFX.Object3D, def: VehicleDef): Omit<VehicleModel, 'hull'> {
  // Models prepared by vehicle_realism.py carry baked AMBIENT OCCLUSION in their vertex colours (scene extra
  // `vertex_ao`): multiplied into every part's material colour. (Older models' vertex colours are not trusted.)
  const vertexAo = !!scene.userData.vertex_ao
  const meshes = bakedMeshes(scene)
  let rim = 0.6
  const bodies: GFX.BufferGeometry[] = [], glasses: GFX.BufferGeometry[] = []
  const wheelParts: { geo: GFX.BufferGeometry; name: string }[] = []
  // Doors (FL / FR — and RL / RR where the model has them cut, the off-roader: skin, trim and their window) and the
  // steering wheel, split out by node name (Blender prep).
  const doorParts = new Map<string, { body: GFX.BufferGeometry[]; glass: GFX.BufferGeometry[]; hinge: number[] }>()
  const steerParts: GFX.BufferGeometry[] = []
  // Cockpit (vehicle_cabin.py): static cabin parts, gauge faces, moving controls (pivot / axis extras, glTF space).
  const cabParts: GFX.BufferGeometry[] = [], dialParts: GFX.BufferGeometry[] = []
  const controlParts: { kind: string; geo: GFX.BufferGeometry; pivot: GFX.Vector3; axis: GFX.Vector3; ex: Record<string, unknown>; col: GFX.Vector3 | null; knob: GFX.Vector3 | null }[] = []
  // Brake hardware (`caliper_<FL|FR|RL|RR>`, scripts/blender/vehicle_brakes.py): kept out of the body and of the
  // wheel search (a drum is round and near the ground); the left corners become the per-axle geometry.
  const brakeParts = new Map<string, GFX.BufferGeometry[]>()
  // Tow hooks (`hook_F` / `hook_R`, vehicle_hooks.py): kept out of the body and its collider — the game takes them off.
  const hookParts = new Map<'F' | 'R', { geo: GFX.BufferGeometry; eye: GFX.Vector3; fairlead: GFX.Vector3 }>()
  // Untextured parts: on a textured model their UVs are pointed at a neutral texel once the map is known.
  const flat: GFX.BufferGeometry[] = []
  let map: GFX.Texture | null = null
  // THE LAMPS' LENSES by name (`lensKind`): which of the body's — or the glass's — vertices are theirs (the parts are
  // joined in this order, none indexed: a part's faces keep their run). null once the body is cut up another way.
  let lensTags: { kind: 'head' | 'brake' | 'tail'; glass: boolean; start: number; count: number }[] | null = []
  let bodyVerts = 0, glassVerts = 0
  for (const m of meshes) {
    const { color, map: mm, glass } = matColor(m.mat)
    const lens = lensKind(m.name, m.mat.name)
    const doorKey = /door_(FL|FR|RL|RR)/i.exec(m.name)?.[1].toUpperCase()
    let door = doorKey ? doorParts.get(doorKey) : undefined
    if (doorKey && !door) doorParts.set(doorKey, (door = { body: [], glass: [], hinge: (m.extras.hinge as number[]) ?? [0, 0, 0] }))
    if (/^dial_/i.test(m.name)) {
      // (UVs kept: they map onto the instrument canvas; position + uv only)
      const g = new GFX.BufferGeometry()
      g.setAttribute('position', m.geo.getAttribute('position'))
      g.setAttribute('uv', m.geo.getAttribute('uv'))
      if (m.geo.index) g.setIndex(m.geo.index)
      dialParts.push(g)
      continue
    }
    if (glass) {
      // (the car's glass material carries the tint: plain white here)
      const g = paintGeometry(m.geo, new GFX.Color(1, 1, 1), false, 0)
      ;(door ? door.glass : glasses).push(g)
      if (!door) {
        const count = g.getAttribute('position').count
        if (lens) lensTags!.push({ kind: lens, glass: true, start: glassVerts, count })
        glassVerts += count
      }
      continue
    }
    const hookKey = /hook_(F|R)\b/i.exec(m.name)?.[1].toUpperCase() as 'F' | 'R' | undefined
    if (hookKey) {
      const g = paintGeometry(m.geo, color, !!mm, 0, true)
      if (!mm) flat.push(g)
      hookParts.set(hookKey, { geo: g, eye: new GFX.Vector3(...((m.extras.eye as number[]) ?? [0, 0, 0])), fairlead: new GFX.Vector3(...((m.extras.fairlead as number[]) ?? [0, 0, 0])) })
      continue
    }
    const brakeKey = /caliper_(FL|FR|RL|RR|BL|BR)/i.exec(m.name)?.[1].toUpperCase().replace('B', 'R')
    if (brakeKey) {
      const g = paintGeometry(m.geo, color, !!mm, 0, true)
      if (!mm) flat.push(g)
      brakeParts.set(brakeKey, [...(brakeParts.get(brakeKey) ?? []), g])
      continue
    }
    if (typeof m.extras.rim === 'number') rim = m.extras.rim as number
    if (mm && !map) map = mm
    const textured = !!mm
    // Door insides / cabin interior: dark trim, never painted (textured: the texture darkened).
    const inner = /inner|interior/i.test(m.mat.name)
    // (1 the paint — tinted; 2 the rest of the BODYWORK — the roof, trim, bumpers, mirrors: untinted, but the paint's
    //  grain on it too — 2026-11-05, the user: "the grains only show on the red parts"; 0 the wheels, the cabin, the
    //  controls, the hardware: smooth)
    const paint = inner || /^(wheel|caliper_|acc_|cab_|pedal_|gear_|wiper_|needle_|lever_|tow_|steering)/i.test(m.name) ? 0 : def.paintRegex ? (def.paintRegex.test(m.mat.name) ? 1 : 2) : 1
    const g = paintGeometry(m.geo, textured ? new GFX.Color(inner ? 0.3 : 1, inner ? 0.3 : 1, inner ? 0.3 : 1) : inner ? color.clone().multiplyScalar(0.35) : color, textured, paint, (vertexAo && !inner) || /^wheel_/i.test(m.name)) // (a big-triangle cabin liner would draw AO gradients as X shapes)
    if (!textured) flat.push(g)
    const control = /^(pedal_(?:gas|brake|clutch)|gear_lever|wiper_[LR]|needle_[a-z]+|lever_(?:transfer|hand))/i.exec(m.name)?.[1].toLowerCase()
    if (def.wheelRegex && def.wheelRegex.test(m.name)) wheelParts.push({ geo: g, name: m.name })
    else if (control && Array.isArray(m.extras.pivot)) controlParts.push({ kind: control, geo: g, pivot: new GFX.Vector3(...(m.extras.pivot as number[])), axis: new GFX.Vector3(...((m.extras.axis as number[]) ?? [1, 0, 0])), ex: m.extras,
      col: Array.isArray(m.extras.col) ? new GFX.Vector3(...(m.extras.col as number[])) : null, knob: Array.isArray(m.extras.knob) ? new GFX.Vector3(...(m.extras.knob as number[])) : null })
    else if (/^cab_/i.test(m.name)) cabParts.push(g)
    else if (door) door.body.push(g)
    else if (/steering_wheel/i.test(m.name)) steerParts.push(g)
    else {
      const count = g.getAttribute('position').count
      if (lens) lensTags!.push({ kind: lens, glass: false, start: bodyVerts, count })
      bodyVerts += count
      bodies.push(g)
    }
  }
  const neutral = map ? neutralTexel(map) : { uv: [0, 0] as [number, number], color: [1, 1, 1] as [number, number, number] }
  const neutralUv = neutral.uv
  if (map) {
    // Untextured parts sample the neutral texel: point their UVs at it and divide its tint out of their colours,
    // so each shows its own colour (rubber stays black, chrome stays chrome).
    const [nr, ng, nb] = neutral.color.map((c) => 1 / Math.max(0.1, c))
    for (const g of flat) {
      const uv = g.getAttribute('uv') as GFX.BufferAttribute
      for (let i = 0; i < uv.count; i++) uv.setXY(i, neutralUv[0], neutralUv[1])
      const c = g.getAttribute('color') as GFX.BufferAttribute
      for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * nr, c.getY(i) * ng, c.getZ(i) * nb)
    }
  }
  let body = mergeGeometries(bodies, false)!
  const glass = glasses.length ? mergeGeometries(glasses, false)! : new GFX.BufferGeometry()
  const doorGeo = [...doorParts.entries()].map(([key, d]) => ({
    key, hinge: new GFX.Vector3(...d.hinge),
    body: mergeGeometries(d.body, false)!, glass: d.glass.length ? mergeGeometries(d.glass, false)! : null,
  }))
  // Normalise: forward axis → −Z, metres, wheel bottoms on y = 0, origin at the wheelbase centre.
  const size = new GFX.Vector3()
  const all = mergeGeometries([body, ...wheelParts.map((w) => w.geo), ...doorGeo.map((d) => d.body)], false)!
  const whole = new GFX.Box3().setFromBufferAttribute(all.getAttribute('position') as GFX.BufferAttribute)
  whole.getSize(size)
  const fwdLen = def.forward.endsWith('z') ? size.z : size.x
  const k = def.length / fwdLen
  const rot = def.forward === '+z' ? Math.PI : def.forward === '-z' ? 0 : def.forward === '+x' ? -Math.PI / 2 : Math.PI / 2
  const norm = new GFX.Matrix4().makeRotationY(rot).multiply(new GFX.Matrix4().makeScale(k, k, k))
  // Wheels by name (centres from their bounds) or by shape (connected components of the body).
  let wheels: { c: GFX.Vector3; r: number; geo: GFX.BufferGeometry }[]
  if (wheelParts.length) {
    const byCorner = new Map<string, GFX.BufferGeometry[]>()
    for (const w of wheelParts) {
      const key = (w.name.match(def.wheelRegex!)?.[1] ?? '').toUpperCase()
      byCorner.set(key, [...(byCorner.get(key) ?? []), w.geo])
    }
    wheels = [...byCorner.values()].map((parts) => {
      const geo = mergeGeometries(parts, false)!
      const bb = new GFX.Box3().setFromBufferAttribute(geo.getAttribute('position') as GFX.BufferAttribute)
      return { c: bb.getCenter(new GFX.Vector3()), r: bb.getSize(new GFX.Vector3()).y / 2, geo }
    })
  } else {
    const { triComp, boxes } = components(body)
    const found = [...boxes.entries()]
      .filter(([, e]) => {
        e.box.getSize(size)
        const along = def.forward.endsWith('z') ? size.z : size.x
        const across = def.forward.endsWith('z') ? size.x : size.z
        return e.box.min.y < whole.min.y + 0.15 * (whole.max.y - whole.min.y) && size.y > 0.12 * (whole.max.y - whole.min.y) && Math.abs(size.y - along) < 0.25 * size.y && across < 0.6 * size.y
      })
      .map(([id, e]) => ({ id, c: e.box.getCenter(new GFX.Vector3()), r: e.box.getSize(new GFX.Vector3()).y / 2 }))
    if (found.length !== 4) throw new Error(`${def.id}: expected 4 wheel parts, found ${found.length}`)
    const isWheel = new Set(found.map((w) => w.id))
    wheels = found.map((w) => ({ c: w.c, r: w.r, geo: subset(body, (t) => triComp[t] === w.id) }))
    body = subset(body, (t) => !isWheel.has(triComp[t]))
    lensTags = null
  }
  // Steering wheel: a named part, or (catalogue `steering`) the ring in front of the left seat, found in normalised space.
  let steeringWheel: GFX.BufferGeometry | null = null
  let pivot = new GFX.Vector3(), axis = new GFX.Vector3(0, 0, -1), steeringRadius = 0.19
  if (steerParts.length) {
    // Named in Blender (`steering_wheel`, every car now): same pivot / axis solve as below.
    steeringWheel = mergeGeometries(steerParts, false)!.applyMatrix4(norm)
  } else if (def.steering) {
    const { triComp, boxes } = components(body)
    const steer = new Set<number>()
    const nb = new GFX.Box3()
    for (const [id, e] of boxes) {
      nb.copy(e.box).applyMatrix4(norm)
      const c = nb.getCenter(new GFX.Vector3()), sz = nb.getSize(new GFX.Vector3())
      if (c.x < -0.15 && c.z > -0.8 && c.z < -0.4 && c.y > 0.8 && c.y < 1.3 && sz.x > 0.3 && sz.x < 0.65 && sz.z < 0.25) steer.add(id)
    }
    if (steer.size) {
      steeringWheel = subset(body, (t) => steer.has(triComp[t])).applyMatrix4(norm)
      body = subset(body, (t) => !steer.has(triComp[t]))
      lensTags = null
    }
  }
  if (steeringWheel) {
    // Pivot = rim centre; axis = rim normal, pointing down the column (away from the driver).
    const sp = steeringWheel.getAttribute('position')
    let lx = 0, rx = 0, by = 0, ty = 0
    for (let i = 1; i < sp.count; i++) {
      if (sp.getX(i) < sp.getX(lx)) lx = i
      if (sp.getX(i) > sp.getX(rx)) rx = i
      if (sp.getY(i) < sp.getY(by)) by = i
      if (sp.getY(i) > sp.getY(ty)) ty = i
    }
    const P = (i: number) => new GFX.Vector3().fromBufferAttribute(sp, i)
    steeringWheel.computeBoundingBox()
    pivot = steeringWheel.boundingBox!.getCenter(new GFX.Vector3())
    axis = new GFX.Vector3().crossVectors(P(rx).sub(P(lx)), P(ty).sub(P(by))).normalize()
    if (axis.z > 0) axis.negate()
    steeringRadius = (P(rx).x - P(lx).x) / 2
    steeringWheel.translate(-pivot.x, -pivot.y, -pivot.z)
  }
  body.applyMatrix4(norm)
  glass.applyMatrix4(norm)
  const cabin = cabParts.length ? mergeGeometries(cabParts, false)!.applyMatrix4(norm) : null
  const dials = dialParts.length ? mergeGeometries(dialParts, false)!.applyMatrix4(norm) : null
  const turn = new GFX.Matrix4().makeRotationY(rot)
  for (const c of controlParts) (c.geo.applyMatrix4(norm), c.pivot.applyMatrix4(norm), c.axis.applyMatrix4(turn).normalize(), c.col?.applyMatrix4(turn).normalize(), c.knob?.applyMatrix4(norm))
  for (const w of wheels) (w.c.applyMatrix4(norm), (w.r *= k), w.geo.applyMatrix4(norm))
  for (const d of doorGeo) (d.body.applyMatrix4(norm), d.glass?.applyMatrix4(norm), d.hinge.applyMatrix4(norm))
  const brakeGeo = new Map([...brakeParts.entries()].map(([k, parts]) => [k, mergeGeometries(parts, false)!.applyMatrix4(norm)]))
  for (const h of hookParts.values()) (h.geo.applyMatrix4(norm), h.eye.applyMatrix4(norm), h.fairlead.applyMatrix4(norm))
  // Ground = wheel bottoms; origin = wheelbase centre.
  const groundY = Math.min(...wheels.map((w) => w.c.y - w.r))
  const cx = wheels.reduce((a, w) => a + w.c.x, 0) / 4, cz = wheels.reduce((a, w) => a + w.c.z, 0) / 4
  const shift = new GFX.Matrix4().makeTranslation(-cx, -groundY, -cz)
  body.applyMatrix4(shift)
  glass.applyMatrix4(shift)
  cabin?.applyMatrix4(shift)
  dials?.applyMatrix4(shift)
  const controls: CockpitPart[] = controlParts.map((c) => {
    c.geo.applyMatrix4(shift)
    c.pivot.applyMatrix4(shift)
    c.knob?.applyMatrix4(shift)
    c.geo.translate(-c.pivot.x, -c.pivot.y, -c.pivot.z)
    c.geo.computeBoundingSphere()
    zeroTyre(c.geo)
    const ex = c.ex, num = (k: string) => (typeof ex[k] === 'number' ? (ex[k] as number) : undefined)
    return { kind: c.kind, geo: c.geo, pivot: c.pivot.toArray() as [number, number, number], axis: c.axis.toArray() as [number, number, number],
      sweep: num('sweep'), max: num('max'), unit: typeof ex.unit === 'string' ? ex.unit : undefined,
      shift: ex.shift === 'floor' || ex.shift === 'column' || ex.shift === 'auto' || ex.shift === 'autofloor' ? ex.shift : undefined,
      col: c.col ? (c.col.toArray() as [number, number, number]) : undefined, knob: c.knob ? (c.knob.toArray() as [number, number, number]) : undefined }
  })
  if (cabin) (zeroTyre(cabin), cabin.computeBoundingSphere())
  dials?.computeBoundingSphere()
  for (const w of wheels) (w.c.applyMatrix4(shift), w.geo.applyMatrix4(shift))
  for (const g of brakeGeo.values()) g.applyMatrix4(shift)
  const hook = (key: 'F' | 'R'): TowHook | null => {
    const h = hookParts.get(key)
    if (!h) return null
    h.geo.applyMatrix4(shift)
    h.eye.applyMatrix4(shift)
    h.fairlead.applyMatrix4(shift)
    h.geo.translate(-h.eye.x, -h.eye.y, -h.eye.z)
    h.geo.computeBoundingSphere()
    zeroTyre(h.geo)
    return { geo: h.geo, eye: h.eye.toArray() as [number, number, number], fairlead: h.fairlead.toArray() as [number, number, number] }
  }
  const hooks = { front: hook('F'), rear: hook('R') }
  if (steeringWheel) pivot.applyMatrix4(shift)
  // Doors: into door space (hinge at the origin). Closed-door bounds still count for the body box below.
  const outline = new GFX.Box3()
  const doors: CarDoor[] = doorGeo.map((d) => {
    d.body.applyMatrix4(shift)
    d.glass?.applyMatrix4(shift)
    d.hinge.applyMatrix4(shift)
    d.body.computeBoundingBox()
    outline.union(d.body.boundingBox!)
    d.body.translate(-d.hinge.x, -d.hinge.y, -d.hinge.z)
    d.glass?.translate(-d.hinge.x, -d.hinge.y, -d.hinge.z)
    d.body.computeBoundingBox()
    d.body.computeBoundingSphere()
    d.glass?.computeBoundingSphere()
    const b = d.body.boundingBox!
    return { side: d.hinge.x < 0 ? -1 : 1, body: d.body, glass: d.glass, hinge: d.hinge.toArray() as [number, number, number], length: b.max.z, bottom: b.min.y, top: b.max.y }
  })
  doors.sort((a, b) => a.side - b.side) // driver's (left) door first
  const fl = wheels.reduce((a, b) => (b.c.x + b.c.z < a.c.x + a.c.z ? b : a)) // most −x (left) and −z (front)
  const wheel = fl.geo.clone().translate(-fl.c.x, -fl.c.y, -fl.c.z)
  const pick = (sx: number, sz: number) => wheels.reduce((a, b) => (b.c.x * sx + b.c.z * sz > a.c.x * sx + a.c.z * sz ? b : a))
  const wheelPos = [pick(-1, -1), pick(1, -1), pick(-1, 1), pick(1, 1)].map((w) => [w.c.x, w.c.y, w.c.z] as [number, number, number])
  // Brakes into the left hubs' space; their vertex colours divided by the neutral texel they sample (textured
  // models), so the part shows its own colour.
  const hubBrake = (key: string, hub: [number, number, number]): GFX.BufferGeometry | null => {
    const g = brakeGeo.get(key)
    if (!g) return null
    g.translate(-hub[0], -hub[1], -hub[2])
    g.computeBoundingSphere()
    return g
  }
  const brakes = { front: hubBrake('FL', wheelPos[0]), rear: hubBrake('RL', wheelPos[2]) }
  for (const [k, g] of brakeGeo) if (k !== 'FL' && k !== 'RL') g.dispose()
  // TYRE WEIGHT per vertex (the deformation shader flattens and bulges only the rubber): 0 inside the rim, rising
  // over the bead to 1 on the sidewall and tread. Every other geometry on the car program gets 0 (§6: a program's
  // attributes must exist on all of its geometries).
  {
    const p = wheel.getAttribute('position'), tw = new Float32Array(p.count)
    const rimR = rim * fl.r, top = rimR + 0.35 * (fl.r - rimR)
    for (let i = 0; i < p.count; i++) {
      const t = Math.min(1, Math.max(0, (Math.hypot(p.getY(i), p.getZ(i)) - rimR * 1.04) / Math.max(1e-4, top - rimR * 1.04)))
      tw[i] = t * t * (3 - 2 * t)
    }
    wheel.setAttribute('tyreW', new GFX.BufferAttribute(tw, 1))
  }
  for (const g of [body, steeringWheel, brakes.front, brakes.rear, ...doors.map((d) => d.body)]) if (g) zeroTyre(g)
  for (const g of [body, wheel, glass, steeringWheel]) if (g) (g.computeBoundingBox(), g.computeBoundingSphere())
  const bb = body.boundingBox!.clone()
  const tyreHalfWidth = (wheel.boundingBox!.max.x - wheel.boundingBox!.min.x) / 2
  let mesh: Float32Array | undefined, hulls: Float32Array[] | undefined
  if (doors.length) bb.union(outline)
  if (map) map.colorSpace = GFX.SRGBColorSpace
  const paintMap = map ? buildPaintMap(map, !!def.whitePaint) : null
  const lamps = lampsOf(def, body, glass, lensTags)
  const overhang = overhangs(body, wheelPos, fl.r, (bb.max.x - bb.min.x) / 2)
  meshes.forEach((m) => m.geo.dispose())
  all.dispose()
  if (map && def.grade) gradeTexture(map, def.grade.sat, def.grade.gain)
  return {
    id: def.id,
    body, glass, wheel, wheelPos,
    steeringWheel, steeringPivot: pivot.toArray() as [number, number, number], steeringAxis: axis.toArray() as [number, number, number],
    wheelRadius: fl.r,
    half: { x: (bb.max.x - bb.min.x) / 2, y: (bb.max.y - bb.min.y) / 2, z: (bb.max.z - bb.min.z) / 2 },
    bottom: bb.min.y,
    front: bb.min.z,
    rear: bb.max.z,
    overhang,
    tow: towOf(body, (bb.max.x - bb.min.x) / 2, overhang),
    tyreHalfWidth,
    // Built on first use (the car you drive), then kept with the model.
    get mesh() {
      return (mesh ??= triangles([
        { g: body, at: undefined }, { g: glass, at: undefined },
        // door parts are in hinge space: back to the closed position
        ...doors.flatMap((d) => [{ g: d.body, at: d.hinge }, { g: d.glass, at: d.hinge }]),
        // (a part may be an empty placeholder — a door glass with no vertices: switching to it threw here)
      ].filter((p) => p.g?.getAttribute('position')).map((p) => ({ position: p.g!.getAttribute('position').array, index: p.g!.index?.array ?? null, offset: p.at }))))
    },
    get hulls() {
      return (hulls ??= bodyHulls(this.mesh, wheelPos.map((hub) => ({ hub, radius: fl.r, halfWidth: tyreHalfWidth })), 0.3))
    },
    map,
    paintMap,
    lamps,
    doors,
    steeringRadius,
    neutralUv,
    neutralColor: neutral.color,
    brakes,
    rim,
    cabin,
    dials,
    controls,
    hooks,
  }
}

/** Downscaled copy of a texture (LOW tier: 1024² → 512² saves ~4 MB of GPU memory). */
export function downscaleTexture(tex: GFX.Texture, size: number): GFX.Texture {
  const img = tex.image as (CanvasImageSource & { width: number }) | undefined
  if (!img || !img.width || img.width <= size) return tex
  const c = document.createElement('canvas')
  c.width = c.height = size
  c.getContext('2d')!.drawImage(img, 0, 0, size, size)
  const t = new GFX.CanvasTexture(c)
  t.colorSpace = GFX.SRGBColorSpace
  t.flipY = tex.flipY
  t.anisotropy = 4
  return t
}
