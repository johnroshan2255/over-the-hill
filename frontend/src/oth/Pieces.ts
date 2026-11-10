import * as GFX from './gfx'
import type RAPIER from '@dimforge/rapier3d-compat'
import { group, Groups } from '../physics/PhysicsWorld'
import type { Atmosphere } from './Atmosphere'
import { webpTexture } from './assetMat'
import type { MapData } from './MapData'
import type { OthPhysics } from './Physics'
import type { TerrainShadow } from './TerrainShadow'
import { VEHICLE_FRAG_SRC } from './Vehicle'
import type { Session } from '../net/Session'
import type { Piece } from '../net/wire'
import kitUrl from '../assets/models/kit/kit.glb?url'
import kitMeta from '../assets/models/kit/kit.json'

/**
 * WHAT'S BUILT (docs/MULTIPLAYER.md §4): every piece in the session (backend world.rs `place`), drawn and solid.
 *
 *   THE KIT: scripts/oth/buildkit.py's pieces (modelled: real logs, fieldstone, shingles, windows, doors …), each in its
 *     materials — TILING scans (1 K, repeated over the surface in metres: no blur on a 3 m wall) with their normal
 *     maps, the ambient occlusion baked into the vertices; glass and the lantern flat colours.
 *   DRAWN: a claim's pieces MERGED PER MATERIAL — a whole homestead a dozen draws — rebuilt when one comes or goes;
 *     lit as the character is (the car's surface shader: the sun, the sky, the terrain shadow, the haze).
 *   SOLID: each piece its boxes (a wall's doorway open, a garage's opening open), on one fixed body per claim.
 *
 * The grid (kit.json): a cell 3 m, the floor 0.45 m over the ground, walls 2.6 m. Model space: the GLB's — a wall
 * along x, its outside −z; Piece.rot turns it about y (the game's heading convention: −z toward rot's direction).
 */
export const KIT = kitMeta as { cell: number; floor: number; wallH: number; pitch: number; eave: number; pieces: string[]; materials: Record<string, KitMatDef> }
const TEX = import.meta.glob('../assets/textures/kit/*.webp', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const texUrl = (name: string) => TEX[`../assets/textures/kit/${name}.webp`]

const VERT = /* glsl */ `
uniform vec3 uTint;
#ifdef SWAY
// THE PLANTS SWAY (buildkit.py: the AO's alpha holds how far up the plant a vertex is, 0 at its foot … 1 at its top):
// leant down the wind (Atmosphere's uWind) in slow gusts, a quick flutter on top — each plant in its own time
uniform float uTime;
uniform vec2 uWind;
#endif
#ifdef SWAY
attribute vec4 color;
#else
attribute vec3 color;
#endif
#define USE_COLOR
out vec3 vWorld;
out vec3 vLocal;
out vec3 vN;
out vec2 vUv;
out vec3 vCol;
out float vPaint;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
#ifdef SWAY
  {
    float k = color.a, ph = dot(w.xz, vec2(0.37, 0.61));
    float gust = 0.55 + 0.45 * sin(uTime * 0.9 + ph * 0.35) * sin(uTime * 0.37 + ph * 0.11);
    vec2 wd = uWind * (0.012 + 0.016 * gust);
    vec3 fl = vec3(sin(uTime * 3.7 + ph * 5.1 + w.y * 3.0), sin(uTime * 4.3 + ph * 3.7) * 0.6, cos(uTime * 3.1 + ph * 4.3 + w.y * 2.0)) * 0.018;
    w.xyz += (vec3(wd.x, -0.25 * length(wd), wd.y) + fl) * k;
  }
#endif
  vWorld = w.xyz;
  vLocal = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
#if defined(USE_COLOR) && defined(VCOL_FULL)
  // (the places' vertices: the paint and the ambient occlusion baked whole — places.py)
  vCol = uTint * color.rgb;
#elif defined(USE_COLOR)
  // (the baked ambient occlusion, eased: the corners and the gaps darker, never black)
  vCol = uTint * mix(vec3(1.0), color.rgb, 0.6);
#else
  vCol = uTint;
#endif
  vPaint = 0.0;
  gl_Position = projectionMatrix * viewMatrix * w;
}`

const FLAT = typeof location === 'undefined' || new URLSearchParams(location.search).get('flat') !== '0'
const PALETTE: Record<string, [number, number, number]> = {
  stone: [0.3, 0.3, 0.32], block: [0.33, 0.33, 0.34], rock: [0.3, 0.3, 0.32], bark: [0.3, 0.25, 0.2], shingle: [0.2, 0.175, 0.155], planks: [0.34, 0.28, 0.22],
  barn: [0.3, 0.2, 0.15], door: [0.22, 0.17, 0.13], tin: [0.34, 0.37, 0.38], iron: [0.08, 0.08, 0.085], birch: [0.66, 0.64, 0.58],
}
export type KitMatDef = { k: number; tint: number[]; tex?: string; flat?: number[]; emit?: boolean; clamp?: boolean; cut?: boolean; sway?: boolean }
/** A model's meshes gathered by the named object each is under (`names`), each with its material's name (model space). */
export function gltfParts(gltf: { scene: GFX.Object3D }, names: Set<string>): Record<string, { mat: string; geo: GFX.BufferGeometry }[]> {
  const parts: Record<string, { mat: string; geo: GFX.BufferGeometry }[]> = {}
  gltf.scene.updateMatrixWorld(true)
  gltf.scene.traverse((o: GFX.Object3D) => {
    const m = o as GFX.Mesh
    if (!m.isMesh) return
    let p: GFX.Object3D | null = m
    while (p && !names.has(p.name)) p = p.parent
    if (!p) return
    const mat = ((Array.isArray(m.material) ? m.material[0] : m.material) as GFX.Material).name.replace(/\.\d+$/, '')
    ;(parts[p.name] ??= []).push({ mat, geo: m.geometry.clone().applyMatrix4(m.matrixWorld) })
  })
  return parts
}
/** One of the kit's tiling materials (kit.json's table; its textures in textures/kit/), lit as the character is. */
export async function kitMaterial(d: KitMatDef, atmos: Atmosphere, shadow: TerrainShadow, farGrid: GFX.Vector4, extra: Record<string, string> = {}): Promise<GFX.ShaderMaterial> {
  const defines: Record<string, string> = { OTH_SPEC: '', MIST_K: '0.45', NO_GRAIN: '', ...extra }
  const uniforms: Record<string, GFX.IUniform> = {
    ...atmos.uniforms, ...shadow.uniforms, uFarGrid: { value: farGrid }, uMap: { value: null }, uNormalMap: { value: null }, uPaintMask: { value: null },
    uPaint: { value: new GFX.Color(1, 1, 1) }, uSunHere: { value: 1 }, uCoat: { value: 0 }, uCoatColor: { value: new GFX.Color(0.8, 0.6, 0.42) }, uCarBase: { value: 0 },
    uTint: { value: new GFX.Vector3(...(d.flat ?? d.tint) as [number, number, number]) },
  }
  // THE FLAT PALETTE (FLAT, below): Over the Hill's few muted colours — grey boulder stone, grey-brown logs, a darker
  // roof — one a material, no texture at all (the scan's mean came out olive for the mossy stone, near black for the
  // logs). A scan with a paint of its own (the siding: its tint IS the paint) keeps its mean (FLAT_MAP).
  const flat = FLAT && d.tex && !d.cut && !d.clamp ? (d.tex === 'bark' && d.tint[0] > 2 ? PALETTE.birch : PALETTE[d.tex]) : undefined
  if (flat) uniforms.uTint.value.set(flat[0], flat[1], flat[2])
  else if (d.tex) {
    const [c, n] = await Promise.all([webpTexture(texUrl(d.tex), true), webpTexture(texUrl(`${d.tex}_n`), false)])
    for (const t of [c, n]) if (!d.clamp) { t.wrapS = t.wrapT = GFX.RepeatWrapping; t.needsUpdate = true }
    uniforms.uMap.value = c; uniforms.uNormalMap.value = n
    defines.USE_MAP_OTH = ''
    // FLAT COLOURS (2026-11-10, the user — Over the Hill's buildings beside ours: "check why it doesn't match"; ours
    // wore photo scans — wood grain, shingles, mossy stone — where theirs are one flat colour a surface, the shape and
    // the light doing the rest): a TILING scan is read at its mean colour (FLAT_MAP: far down its mips) and its normal
    // map left off — the valley's buildings and ruins, the building kit, the same pieces in co-op. The leaves' atlas
    // (cut out by its alpha) and the clamped sheets keep their pictures. `?flat=0`: the scans as before (the A/B).
    if (FLAT && !d.cut && !d.clamp) defines.FLAT_MAP = ''
    else defines.USE_NORMALMAP_OTH = ''
  }
  // (the plants' leaves: cut out by the atlas's alpha, both sides drawn, swaying)
  if (d.cut) defines.ALPHA_CUT = ''
  if (d.sway) defines.SWAY = ''
  return new GFX.ShaderMaterial({ glslVersion: GFX.GLSL3, uniforms, defines, vertexShader: VERT, fragmentShader: VEHICLE_FRAG_SRC(), vertexColors: true, ...(d.cut ? { side: GFX.DoubleSide } : {}) })
}

/** The kit: each piece's parts by material (model space). Loaded once. */
export interface Kit { parts: Record<string, { mat: string; geo: GFX.BufferGeometry }[]>; mats: Record<string, GFX.ShaderMaterial> }
let kitP: Promise<Kit> | null = null
export function loadKit(atmos: Atmosphere, shadow: TerrainShadow, farGrid: GFX.Vector4): Promise<Kit> {
  return (kitP ??= (async () => {
    const gltf = await new GFX.GLTFLoader().setDRACOLoader(new GFX.DRACOLoader().setDecoderPath('/draco/')).loadAsync(kitUrl)
    const parts = gltfParts(gltf, new Set(KIT.pieces.flatMap((k) => [k, `${k}__far`])))
    const mats: Kit['mats'] = {}
    await Promise.all(Object.entries(KIT.materials).map(async ([name, d]) => { mats[name] = await kitMaterial(d, atmos, shadow, farGrid) }))
    return { parts, mats }
  })())
}

/** A piece's solid boxes (model space): [centre x, y, z, half x, y, z, (tilt about x, rad)] — steps a RAMP under their
 *  treads (a character walks up a slope surely; a stair's separate risers caught its capsule). */
const ramp = (z0: number, z1: number, h: number, w: number): number[] => {
  const L = Math.hypot(z1 - z0, h), a = Math.atan2(h, z1 - z0)
  return [0, h / 2 - 0.04, (z0 + z1) / 2, w, 0.04, L / 2, a]
}
export function pieceBoxes(kind: string): number[][] {
  const F = KIT.floor, W = KIT.wallH, h = KIT.cell / 2
  if (kind.startsWith('foundation') || kind === 'floor_plank') return [[0, (F - 0.6) / 2, 0, h, (F + 0.6) / 2, h]]
  if (kind.startsWith('wall_') && kind !== 'wall_drystone') {
    const t = kind.startsWith('wall_stone') ? 0.21 : kind.startsWith('wall_log') ? 0.16 : 0.08
    if (kind.endsWith('_door')) return [[-1.0, W / 2, 0, 0.5, W / 2, t], [1.0, W / 2, 0, 0.5, W / 2, t], [0, (2.1 + W) / 2, 0, 0.5, (W - 2.1) / 2, t]]
    if (kind === 'wall_garage') return [[-1.33, W / 2, 0, 0.17, W / 2, t], [1.33, W / 2, 0, 0.17, W / 2, t], [0, (2.2 + W) / 2, 0, 1.16, (W - 2.2) / 2, t]]
    return [[0, W / 2, 0, h, W / 2, t]]
  }
  if (kind === 'roof_shingle' || kind === 'roof_tin') return [[0, 0.5, 0, h + 0.1, 0.5, h + 0.3]]
  if (kind === 'chimney_stone') return [[0, (W + 2.2) / 2, 0, 0.45, (W + 2.2) / 2, 0.45]]
  if (kind === 'steps_stone') return [ramp(0.05, 1.0, F, 0.65)]
  if (kind === 'porch_deck') return [[0, F / 2, 0, 1.5, F / 2, 1.0], ramp(1.0, 1.72, F, 0.75)]
  if (kind === 'porch_roof') return [[-1.4, 1.18, 0.9, 0.08, 1.18, 0.08], [1.4, 1.18, 0.9, 0.08, 1.18, 0.08]]
  if (kind === 'porch_post') return [[0, W / 2, 0, 0.08, W / 2, 0.08]]
  if (kind === 'fence_rail' || kind === 'fence_gate') return [[0, 0.65, 0, h, 0.65, 0.06]]
  if (kind === 'wall_drystone') return [[0, 0.5, 0, h, 0.5, 0.28]]
  if (kind === 'jetty') return [[0, -0.05, 0, 1.5, 0.05, 0.8]]
  if (kind === 'lamp_post') return [[0, 1.35, 0, 0.1, 1.35, 0.1]]
  return []
}

/** A piece's matrix: at (x, y, z), turned rot about y. */
export function pieceMatrix(p: { x: number; y: number; z: number; rot: number }, out = new GFX.Matrix4()): GFX.Matrix4 {
  return out.makeRotationY(p.rot).setPosition(p.x, p.y, p.z)
}

/** Past this far (m) from a claim's pieces' bounds, their far LOD. */
const PIECES_FAR_M = 45

export class Pieces {
  readonly group = new GFX.Group()
  private kit: Kit | null = null
  private readonly built = new Map<string, { meshes: GFX.Mesh[]; far: GFX.Mesh[]; c: GFX.Sphere; body: RAPIER.RigidBody | null }>()
  private readonly dirty = new Set<string>()
  private readonly marked = new Map<string, string[]>()
  private readonly off: () => void
  /** THE PIECES MOVING (production feel — the user: "nice and good animation"): one just placed DROPS in and settles
   *  (a fall from half a metre, a squash as it lands, the dust), a plant GROWS up out of the ground (an overshoot, then
   *  still), one taken down SINKS and shrinks away. Each drawn on its own meanwhile, merged in with the rest after. */
  private readonly anims = new Map<string, { p: Piece; t: number; dur: number; gone: boolean; meshes: GFX.Mesh[]; landed: boolean }>()
  /** The pieces drawn (by id) — a piece's place when it's taken down (the session forgets it first). */
  private readonly known = new Map<string, Piece>()
  /** Dust where a piece lands or goes (main.ts: Dust.puff) — x, y, z, its spread, a plant's soil or a building's dust. */
  onDust: ((x: number, y: number, z: number, r: number, soil: boolean) => void) | null = null

  constructor(private readonly session: Session, private readonly world: () => { id: string; map: MapData; rocks?: { mark(id: string, x: number, z: number, r: number): void }; grass?: { refresh(): void } }, private readonly physics: OthPhysics,
    atmos: Atmosphere, shadow: TerrainShadow, farGrid: GFX.Vector4) {
    this.off = session.on((e) => {
      if (e.t === 'piece') { this.animate(e.piece, false); this.dirty.add(e.piece.claim) }
      else if (e.t === 'piece_gone' || e.t === 'claim_gone') {
        if (e.t === 'piece_gone') { const p = this.known.get(e.id); if (p) this.animate(p, true) }
        for (const c of this.built.keys()) this.dirty.add(c); if (e.t === 'claim_gone') this.dirty.add(e.id)
      }
    })
    void loadKit(atmos, shadow, farGrid).then((k) => { this.kit = k; for (const c of this.session.claims.keys()) this.dirty.add(c); for (const p of this.session.pieces.values()) this.dirty.add(p.claim) })
  }

  get ready(): boolean { return !!this.kit }

  private animate(p: Piece, gone: boolean): void {
    if (!this.kit || this.world().id !== this.session.world.map) return
    const old = this.anims.get(p.id)
    if (old) for (const m of old.meshes) { this.group.remove(m); m.geometry.dispose() }
    const meshes: GFX.Mesh[] = []
    for (const part of this.kit.parts[p.kind] ?? []) {
      const mat = this.kit.mats[part.mat]
      if (!mat) continue
      const m = new GFX.Mesh(part.geo, mat)
      m.frustumCulled = false
      this.group.add(m)
      meshes.push(m)
    }
    const plant = p.kind.startsWith('plant_')
    this.anims.set(p.id, { p, t: 0, dur: gone ? 0.45 : plant ? 1.1 : 0.62, gone, meshes, landed: false })
    this.pose(this.anims.get(p.id)!)
    if (plant && !gone) this.onDust?.(p.x, p.y, p.z, 0.6, true)
  }

  /** A moving piece's place this frame. */
  private pose(a: { p: Piece; t: number; dur: number; gone: boolean; meshes: GFX.Mesh[]; landed: boolean }): void {
    const u = Math.min(1, a.t / a.dur), plant = a.p.kind.startsWith('plant_')
    let y = 0, sy = 1, sxz = 1
    if (a.gone) {
      // (taken down: it sinks and shrinks into the ground — a plant just shrinks)
      const e = u * u
      y = plant ? 0 : -0.45 * e; sy = sxz = plant ? 1 - e : 1 - 0.3 * e
    } else if (plant) {
      // (planted: up out of the ground, a little past its size, back — easeOutBack)
      const c = 1.9, e = 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2
      sy = Math.max(0.02, e); sxz = Math.max(0.02, 0.4 + 0.6 * e)
    } else if (u < 0.55) {
      // (placed: it drops in — falling faster, as a thing set down does)
      const s = u / 0.55
      y = 0.55 * (1 - s * s)
    } else {
      // (lands: a squash and a damped settle)
      const s = (u - 0.55) / 0.45, q = 0.07 * Math.exp(-4.5 * s) * Math.cos(11 * s)
      sy = 1 - q; sxz = 1 + q * 0.45
    }
    for (const m of a.meshes) {
      m.position.set(a.p.x, a.p.y + y, a.p.z)
      m.rotation.set(0, a.p.rot, 0)
      m.scale.set(sxz, sy, sxz)
    }
  }

  /** Once a frame: the claims whose pieces changed, rebuilt; the pieces moving moved. */
  update(dt = 1 / 60): void {
    for (const [id, a] of this.anims) {
      a.t += dt
      if (!a.gone && !a.landed && !a.p.kind.startsWith('plant_') && a.t >= a.dur * 0.55) {
        a.landed = true
        const big = a.p.kind.startsWith('foundation') || a.p.kind.startsWith('wall') || a.p.kind.startsWith('roof') || a.p.kind === 'porch_deck'
        this.onDust?.(a.p.x, a.p.y, a.p.z, big ? 2.2 : 0.9, false)
      }
      if (a.t >= a.dur) {
        for (const m of a.meshes) this.group.remove(m)
        this.anims.delete(id)
        if (a.gone) this.onDust?.(a.p.x, a.p.y, a.p.z, a.p.kind.startsWith('plant_') ? 0.5 : 1.4, a.p.kind.startsWith('plant_'))
        else this.dirty.add(a.p.claim)
      } else this.pose(a)
    }
    if (!this.kit || !this.dirty.size) return
    const here = this.world().id === this.session.world.map
    for (const c of this.dirty) this.rebuild(c, here)
    this.dirty.clear()
  }

  private rebuild(claim: string, here: boolean): void {
    const old = this.built.get(claim)
    if (old) {
      for (const m of [...old.meshes, ...old.far]) { this.group.remove(m); m.geometry.dispose() }
      if (old.body) this.physics.pw.world.removeRigidBody(old.body)
      this.built.delete(claim)
    }
    const pieces = [...this.session.pieces.values()].filter((p) => p.claim === claim)
    for (const p of pieces) this.known.set(p.id, p)
    // (a piece still dropping in is drawn on its own: merged once it's down)
    const drawn = pieces.filter((p) => { const a = this.anims.get(p.id); return !a || a.gone })
    // the ground they stand on trodden (the grass kept off: a foundation, a porch, steps show — Rocks.mark)
    const w = this.world()
    for (const id of this.marked.get(claim) ?? []) w.rocks?.mark(id, 0, 0, 0)
    const marks: string[] = []
    if (here) for (const p of pieces) {
      // (and a garden's beds: the valley's long grass kept off the flowers and the vegetables, short round a sapling)
      const r = p.kind.startsWith('foundation') ? 2.4 : p.kind === 'porch_deck' ? 2.0 : p.kind === 'steps_stone' || p.kind === 'campfire' || p.kind === 'chimney_stone' ? 1.1 : p.kind === 'lamp_post' ? 0.5
        : p.kind === 'plant_veg' ? 1.9 : p.kind === 'plant_flowers' ? 1.6 : p.kind === 'plant_hedge' ? 1.2 : p.kind === 'plant_pine' || p.kind === 'plant_birch' ? 0.7 : 0
      if (r) { w.rocks?.mark(`p:${p.id}`, p.x, p.z, r); marks.push(`p:${p.id}`) }
    }
    this.marked.set(claim, marks)
    w.grass?.refresh()
    if (!here || !pieces.length || !this.kit) return
    // NEAR (the pieces as modelled) and FAR (buildkit.py's far LOD — the plants their own): merged per material each
    const m = new GFX.Matrix4(), box = new GFX.Box3()
    const merged = (far: boolean): GFX.Mesh[] => {
      const byMat = new Map<string, GFX.BufferGeometry[]>()
      for (const p of drawn) {
        pieceMatrix(p, m)
        for (const part of (far ? this.kit!.parts[`${p.kind}__far`] : null) ?? this.kit!.parts[p.kind] ?? []) {
          let l = byMat.get(part.mat)
          if (!l) byMat.set(part.mat, (l = []))
          l.push(part.geo.clone().applyMatrix4(m))
        }
      }
      const out: GFX.Mesh[] = []
      for (const [mat, geos] of byMat) {
        const g = GFX.mergeGeometries(geos)
        for (const x of geos) x.dispose()
        const material = this.kit!.mats[mat]
        if (!g || !material) continue
        if (!far) { g.computeBoundingBox(); box.union(g.boundingBox!) }
        const mesh = new GFX.Mesh(g, material)
        mesh.visible = !far
        this.group.add(mesh)
        out.push(mesh)
      }
      return out
    }
    const meshes = merged(false), far = merged(true)
    const c = new GFX.Sphere()
    if (!box.isEmpty()) { box.getCenter(c.center); c.radius = box.min.distanceTo(box.max) / 2 }
    // the colliders: one fixed body, each piece its boxes
    const pw = this.physics.pw, R = pw.R
    const body = pw.world.createRigidBody(R.RigidBodyDesc.fixed())
    const q = new GFX.Quaternion(), v = new GFX.Vector3()
    for (const p of pieces) {
      q.setFromAxisAngle(v.set(0, 1, 0), p.rot)
      for (const [cx, cy, cz, hx, hy, hz, tilt] of pieceBoxes(p.kind)) {
        const c = v.set(cx, cy, cz).applyQuaternion(q)
        // (a ramp: tilted about x so its +z end is down)
        const qq = tilt ? q.clone().multiply(new GFX.Quaternion().setFromAxisAngle(new GFX.Vector3(1, 0, 0), tilt)) : q
        pw.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(p.x + c.x, p.y + c.y, p.z + c.z).setRotation({ x: qq.x, y: qq.y, z: qq.z, w: qq.w })
          .setCollisionGroups(group(Groups.Static, 0xffff)).setFriction(0.8), body)
      }
    }
    this.built.set(claim, { meshes, far, c, body })
  }

  /** Once a frame (Coop): each claim's pieces NEAR (as modelled) or, seen from more than FAR_M past their bounds,
   *  FAR (their far LOD: ~15 % of the triangles). */
  lod(cam: GFX.Vector3): void {
    for (const b of this.built.values()) {
      if (!b.far.length) continue
      const far = b.c.center.distanceTo(cam) - b.c.radius > PIECES_FAR_M
      if (b.far[0].visible === far) continue
      for (const x of b.meshes) x.visible = !far
      for (const x of b.far) x.visible = far
    }
  }

  /** The piece nearest (x, z) within r — for removing it (Builder.ts). */
  nearest(x: number, z: number, r: number, claim?: string): Piece | null {
    let best: Piece | null = null, bd = r
    for (const p of this.session.pieces.values()) {
      if (claim && p.claim !== claim) continue
      const d = Math.hypot(p.x - x, p.z - z)
      if (d < bd) { bd = d; best = p }
    }
    return best
  }

  dispose(): void {
    this.off()
    for (const c of [...this.built.keys()]) this.rebuild(c, false)
    this.group.removeFromParent()
  }
}
