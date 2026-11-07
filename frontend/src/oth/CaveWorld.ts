import type { Atmosphere } from './Atmosphere'
import { Builder, SURF, woodMaterial } from './Bridges'
import * as GFX from './gfx'
import { beam, crate, rbox, rock, V, wheel } from './Kit'
import type { Landmark, MapData } from './MapData'
import type { Tier } from './quality'
import type { TerrainShadow } from './TerrainShadow'
const { DRACOLoader, GLTFLoader } = GFX

/**
 * THE CAVE WORLD (2026-11-07, the user: "use Blender to make / sculpt a cave — a proper one"; "a single mesh, a big
 * one, like a small world which can be explored, like in Genshin"; "on top of it normal grass and some rock texture
 * with the shaders, and some trees; inside, grass and some pine trees where the light gets"; "naturally blended").
 * Modelled by scripts/oth/caves.py (Blender: a signed distance field → surface nets → remesh / smooth / decimate) and
 * exported as public/oth/valley/cave.glb (Draco: TURF the hill, ROCK the cave, GARDEN the turf in the skylight's
 * light, a lighter COLLIDER) and cave.json (the hill's TOP as a 2 m height grid, the garden's pines and tufts, the
 * stones, the skylight, the dark's reach). Its local frame: the mouth at the origin looking +z, y up, the ground y = 0.
 *
 * Placed by Sites.planSites (one, the valley's: "Sky Hollow"); here every vertex is LAID ON THE LAND — its height is
 * the land's under it plus its own (y = ly + H(x, z)), so the hill rises out of the ground wherever it stands and the
 * cave's floors (≥ 0.4 m up in the model) stay above the terrain, which runs on hidden in the rock. Painted by the
 * landmarks' material (Bridges.ts): the hill in the field's own grass (SURF.turf: the land's dryness where it stands,
 * bare rock in patches where it's steep), the cave in the terrain's rock (SURF.cliff: caveRockPaint + rockRelief), the
 * garden lush. Grass TUFTS over the hill and the garden; rounded STONES round the mouth and on the way to it. The
 * terrain's own grass is kept off where the hill stands (the rocks' footprint), not off its foot — they blend there.
 * Sites.dressHills puts trees on it (the TOP) and young pines in the garden. The physics: one triangle mesh.
 * The cave's inside (rock, garden) is drawn only from on or near the hill — from anywhere else it's all behind turf.
 */
export interface CaveMeta {
  top: { x0: number; z0: number; step: number; nx: number; nz: number; h: (number | null)[] }
  foot: { cx: number; cz: number; rx: number; rz: number }
  sky: [number, number, number]
  dark: { z1: number; r: number; top: number }
  pines: [number, number, number][]
  tufts: [number, number, number][]
  stones: [number, number, number, number, number][]
  /** the cave's floor: spots for grass tufts, and for bushes / its broken things (off the lane and the lake) */
  floorTufts?: [number, number, number][]
  floorBushes?: [number, number, number][]
  /** THE LAKE: local x, its level over the ground, local z, its half widths */
  lake?: [number, number, number, number, number]
  /** THE HAVEN's flat pad (the player's safe house / garage, later): local x, its floor, local z, half widths */
  haven?: [number, number, number, number, number]
  /** every pond (x, level, z, half widths), the second skylight (x, z, r), the trees inside (x, y, z, height) */
  lakes?: [number, number, number, number, number][]
  sky2?: [number, number, number]
  innerTrees?: [number, number, number, number][]
}
/** How many of the floor's bush spots hold the cave's BROKEN THINGS and BONES (the rest grow bushes — Sites.dressHills) */
export const CAVE_PROPS = 14

/** cave.json beside cave.glb (null: none — the desert, or the files missing). */
export async function loadCaveMeta(path: string): Promise<CaveMeta | null> {
  try { const r = await fetch(`${path}/cave.json`); return r.ok ? ((await r.json()) as CaveMeta) : null } catch { return null }
}

/** The hill's top over the ground at local (lx, lz) — bilinear on the 2 m grid; null off the hill, in its holes. */
export function caveTop(m: CaveMeta, lx: number, lz: number): number | null {
  const t = m.top, fx = (lx - t.x0) / t.step, fz = (lz - t.z0) / t.step
  const i = Math.floor(fx), j = Math.floor(fz)
  if (i < 0 || j < 0 || i >= t.nx - 1 || j >= t.nz - 1) return null
  const a = t.h[j * t.nx + i], b = t.h[j * t.nx + i + 1], c = t.h[(j + 1) * t.nx + i], d = t.h[(j + 1) * t.nx + i + 1]
  if (a === null || b === null || c === null || d === null) return null
  const u = fx - i, v = fz - j
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

/** Within the hill's apron (an ellipse a little past its foot), grown by `grow` m. */
export function inCaveFoot(m: CaveMeta, lx: number, lz: number, grow = 0): boolean {
  const f = m.foot
  return ((lx - f.cx) / (f.rx + grow)) ** 2 + ((lz - f.cz) / (f.rz + grow)) ** 2 < 1
}

/** A place's local frame (rot about +y, the mouth at its x, z) — world (x, z) of local (lx, lz), and back. */
export function caveFrame(l: Landmark) {
  const cr = Math.cos(l.rot), sr = Math.sin(l.rot)
  return {
    wx: (lx: number, lz: number) => l.x + lx * cr + lz * sr,
    wz: (lx: number, lz: number) => l.z - lx * sr + lz * cr,
    local: (x: number, z: number): [number, number] => { const dx = x - l.x, dz = z - l.z; return [dx * cr - dz * sr, dx * sr + dz * cr] },
  }
}

/** THE HILL'S GRASS, golden and green (2026-11-07, the user: "on the cave some green grass too — golden and green"):
 *  the land's dryness there, swung by a slow noise (~40 m) to green swales and golden rises. */
const grassDry = (dry: number, x: number, z: number) => Math.min(1, Math.max(0, 0.22 + 0.62 * dry + 0.34 * (Math.sin(x * 0.05 + Math.sin(z * 0.04) * 1.8) * Math.sin(z * 0.047 + 0.9) * 0.7 + Math.sin(x * 0.11 - z * 0.09 + 2.1) * 0.3)))
/** A soft value noise ≈ 0…1 (the hill's bare patches). */
const patch = (x: number, z: number) => 0.5 + 0.25 * Math.sin(x * 0.083 + Math.sin(z * 0.061) * 2.1) * Math.sin(z * 0.071 + 1.7) + 0.25 * Math.sin(x * 0.19 - z * 0.13 + 0.6) * Math.sin(z * 0.23 + x * 0.05)

export class CaveWorld {
  readonly group = new GFX.Group()
  /** The physics' triangle mesh (world positions, indices). */
  collider: { verts: Float32Array; idx: Uint32Array } | null = null
  private inside: GFX.Mesh[] = []
  private readonly frame: ReturnType<typeof caveFrame>

  /** The camera is in the cave (under its hill — main / World hide the sun's glare then). */
  cameraInside = false
  private map: MapData | null = null

  private bones: GFX.Object3D | null = null

  private constructor(readonly site: Landmark, readonly meta: CaveMeta) { this.frame = caveFrame(site) }

  static async load(path: string, map: MapData, site: Landmark, meta: CaveMeta, atmos: Atmosphere, shadow: TerrainShadow, tier: Tier, farGrid: GFX.Vector4, footprint?: GFX.DataTexture): Promise<CaveWorld | null> {
    try {
      const dl = (draco ??= new DRACOLoader().setDecoderPath('/draco/'))
      const [gltf, bones] = await Promise.all([
        new GLTFLoader().setDRACOLoader(dl).loadAsync(`${path}/cave.glb`),
        // (the BONES — scripts/oth/bones.py: low-poly skeletons, skulls, ribs, a femur, a hand, a foot and its toes)
        new GLTFLoader().setDRACOLoader(dl).loadAsync(`${path}/bones.glb`).catch(() => null),
      ])
      const cw = new CaveWorld(site, meta)
      cw.map = map
      cw.bones = bones?.scene ?? null
      const mat = woodMaterial(atmos, shadow, tier, farGrid), mg = map.meta.mask
      mat.uniforms.uMask.value = map.maskTex
      ;(mat.uniforms.uMaskGrid.value as GFX.Vector4).set(mg.n, mg.step, mg.origin, 1)
      cw.build(gltf.scene, map, mat, tier)
      cw.fireflies(map, atmos, tier)
      cw.clearGrass(map, footprint)
      return cw
    } catch (e) {
      console.warn('cave.glb: not loaded', e)
      return null
    }
  }

  private build(scene: GFX.Object3D, map: MapData, mat: GFX.ShaderMaterial, tier: Tier): void {
    const { wx, wz } = this.frame, cr = Math.cos(this.site.rot), sr = Math.sin(this.site.rot)
    const mk: [number, number, number, number] = [0, 0, 0, 0]
    const meshes: Record<string, GFX.Mesh> = {}
    scene.traverse((o) => { const m = o as GFX.Mesh; if (m.isMesh) meshes[(m.name || '').replace(/[._]\d+$/, '').toLowerCase()] = m })
    /** world positions (laid on the land) and turned normals of a part */
    const place = (m: GFX.Mesh) => {
      const P = m.geometry.getAttribute('position').array as Float32Array, N = m.geometry.getAttribute('normal')?.array as Float32Array | undefined
      const n = P.length / 3, pos = new Float32Array(P.length), nor = new Float32Array(P.length)
      for (let i = 0; i < n; i++) {
        const lx = P[i * 3], ly = P[i * 3 + 1], lz = P[i * 3 + 2], x = wx(lx, lz), z = wz(lx, lz)
        pos[i * 3] = x; pos[i * 3 + 1] = ly + map.height(x, z); pos[i * 3 + 2] = z
        if (N) { const nx = N[i * 3], nz = N[i * 3 + 2]; nor[i * 3] = nx * cr + nz * sr; nor[i * 3 + 1] = N[i * 3 + 1]; nor[i * 3 + 2] = -nx * sr + nz * cr }
      }
      const idx = m.geometry.index ? new Uint32Array(m.geometry.index.array as ArrayLike<number>) : new Uint32Array(Array.from({ length: n }, (_, k) => k))
      return { pos, nor, idx, n }
    }
    const mesh = (pos: Float32Array, nor: Float32Array, col: Float32Array, glow: Float32Array, idx: Uint32Array) => {
      const g = new GFX.BufferGeometry()
      g.setAttribute('glow', new GFX.BufferAttribute(glow, 1))
      g.setAttribute('position', new GFX.BufferAttribute(pos, 3))
      g.setAttribute('normal', new GFX.BufferAttribute(nor, 3))
      g.setAttribute('color', new GFX.BufferAttribute(col, 3))
      g.setIndex(new GFX.BufferAttribute(idx, 1))
      g.computeBoundingBox()
      weld.push(pos)
      const me = new GFX.Mesh(g, mat); this.group.add(me); return me
    }
    const weld: Float32Array[] = []
    // THE ENTRANCE'S ARCH: rock — drawn as the hill's turf all bare (vCol.z > 1: the turf shader's rock fill, the cave's
    //  one rock paint), so where it meets the grass the two blend over ~2 m, broken by the shader's noise, not along
    //  the triangles' edges
    const archPts: number[] = []
    if (meshes.arch) {
      const { pos, nor, idx, n } = place(meshes.arch), col = new Float32Array(n * 3), glow = new Float32Array(n).fill(2 * SURF.turf)
      for (let i = 0; i < n; i++) { col[i * 3] = 0.6; col[i * 3 + 2] = 1.3; archPts.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]) }
      mesh(pos, nor, col, glow, idx)
    }
    const nearArch = (x: number, y: number, z: number) => {
      let best = 1e9
      for (let k = 0; k < archPts.length; k += 3) { const d = (archPts[k] - x) ** 2 + (archPts[k + 1] - y) ** 2 + (archPts[k + 2] - z) ** 2; if (d < best) best = d }
      return Math.sqrt(best)
    }
    // THE HILL: the field's grass (the land's dryness where it stands), bare rock in patches where it's steep
    if (meshes.turf) {
      const { pos, nor, idx, n } = place(meshes.turf), col = new Float32Array(n * 3), glow = new Float32Array(n).fill(2 * SURF.turf)
      for (let i = 0; i < n; i++) {
        const x = pos[i * 3], z = pos[i * 3 + 2], m = map.maskAt(x, z, mk), ny = nor[i * 3 + 1]
        col[i * 3] = grassDry(m[1], x, z)
        // (its rock and its grass's colour come from the land's mask, as the terrain's — grassOn writes the hill's into it;
        //  vCol.z only the arch's foot, below)
        const [lx, lz] = this.frame.local(x, z)
        void ny
        // (the arch's foot: bare rock to ~2 m, gravel and thinning grass to ~7 — the shader breaks the line up)
        if (archPts.length && Math.hypot(lx, lz) < 24) { const d = nearArch(x, pos[i * 3 + 1], z), t = Math.min(1, d / 5.5); col[i * 3 + 2] = Math.max(col[i * 3 + 2], 1.1 * (1 - t * t * (3 - 2 * t))) }
      }
      mesh(pos, nor, col, glow, idx)
    }
    // THE CAVE INSIDE (2026-11-07, the user: "inside, most of it green and golden — only the stones like rocks — and the
    //  ground to rock transition as well"): the walls, the floor and the garden ONE turf (vCol.y −1: inside — the cave's
    //  dark on it), the walls bare rock (vCol.z 1.3), the floor green and gold — the land's dryness swung by the slow
    //  noise, the garden lusher — turning to rock over ~3 m toward the walls (by each floor vertex's distance from the
    //  nearest wall vertex: a 2 m hash), the shader's noise and gravel band breaking the line
    {
      const parts = (['rock', 'floor', 'garden'] as const).filter((k) => meshes[k]).map((k) => ({ k, ...place(meshes[k]) }))
      for (const q of parts) {
        const col = new Float32Array(q.n * 3), glow = new Float32Array(q.n).fill(2 * SURF.turf)
        for (let i = 0; i < q.n; i++) {
          const x = q.pos[i * 3], y = q.pos[i * 3 + 1], z = q.pos[i * 3 + 2], dry = grassDry(map.maskAt(x, z, mk)[1], x, z)
          col[i * 3] = q.k === 'garden' ? 0.2 + dry * 0.4 : 0.15 + dry * 0.75; col[i * 3 + 1] = -1
          // (2026-11-07, the user: "inside more green — like 60 % grass — a proper transition to rocks, grass on the side
          //  walls too": what faces up grows grass, the walls rock with grass and moss in patches, the roof rock; the
          //  shader's gravel band between)
          // (the shader decides per pixel from the surface's slope; this is each part's CAP: the garden grass, the floor
          //  mostly grass, the walls free to go bare)
          void y
          col[i * 3 + 2] = q.k === 'garden' ? 0 : q.k === 'floor' ? 0.3 : 1.3
        }
        this.inside.push(mesh(q.pos, q.nor, col, glow, q.idx))
      }
    }
    // THE LAKE (the user: "a small lake"): still dark water in the great hall, in the skylight's light
    for (const [lx, ly, lz, rx, rz] of this.meta.lakes ?? (this.meta.lake ? [this.meta.lake] : [])) {
      const cx = wx(lx, lz), cz = wz(lx, lz), y = map.height(cx, cz) + ly
      const pos: number[] = [cx, y, cz], idx: number[] = [], N = 40
      for (let k = 0; k <= N; k++) { const a = (k / N) * Math.PI * 2, ex = Math.cos(a) * rx * 1.05, ez = Math.sin(a) * rz * 1.05; pos.push(wx(lx + ex, lz + ez), y, wz(lx + ex, lz + ez)); if (k) idx.push(0, k + 1, k) }
      const n = pos.length / 3, nor = new Float32Array(n * 3), col = new Float32Array(n * 3), glow = new Float32Array(n).fill(2 * SURF.plain)
      for (let i = 0; i < n; i++) { nor[i * 3 + 1] = 1; col.set([0.012, 0.04, 0.045], i * 3) }
      const lake = mesh(new Float32Array(pos), nor, col, glow, new Uint32Array(idx))
      this.inside.push(lake)
    }
    // THE COLLIDER
    if (meshes.collider) { const { pos, idx } = place(meshes.collider); this.collider = { verts: pos, idx } }
    // GRASS TUFTS on the hill (one per 2 m cell, thinned on the low tiers) and in the garden
    const b = new Builder(0xcafe), tp: number[] = [], tn: number[] = [], tc: number[] = [], ti: number[] = []
    // (what lies OUTSIDE — the stones on the way, the bones before the mouth — its own small mesh, always drawn: the
    //  inside's is hidden away from it)
    const ob = new Builder(0xbeef)
    let s = 0x2545f491
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    const tuft = (x: number, y: number, z: number, h: number, dry: number, inside = false) => {
      for (let q = 0; q < 4; q++) {
        const ang = rnd() * 6.283, w = 0.07 + 0.05 * rnd(), hh = h * (0.7 + 0.5 * rnd()), lx = (rnd() - 0.5) * 0.5 * hh, lz = (rnd() - 0.5) * 0.5 * hh
        const ox = (rnd() - 0.5) * 0.4, oz = (rnd() - 0.5) * 0.4, ux = Math.cos(ang) * w, uz = Math.sin(ang) * w, base = tp.length / 3
        tp.push(x + ox - ux, y - 0.05, z + oz - uz, x + ox + ux, y - 0.05, z + oz + uz, x + ox + lx, y + hh, z + oz + lz)
        for (let v = 0; v < 3; v++) { tn.push(0, 1, 0); tc.push(dry, inside ? -1 : 0, v < 2 ? -0.1 : -1) }
        ti.push(base, base + 1, base + 2, base, base + 2, base + 1)
      }
    }
    // (no tufts on the hill any more: the field's own grass grows on it — Grass.setHill)
    void tier
    for (const [lx, ly, lz] of this.meta.tufts) { const x = wx(lx, lz), z = wz(lx, lz); tuft(x, ly + map.height(x, z), z, 0.35 + 0.4 * rnd(), 0.2 + map.maskAt(x, z, mk)[1] * 0.4, true) }
    // (and over the cave's floor — golden and green, thinner on the low tiers)
    const fk = tier.name === 'low' ? 0.35 : tier.name === 'medium' ? 0.6 : 1
    for (const [lx, ly, lz] of this.meta.floorTufts ?? []) {
      if (rnd() > fk) continue
      const x = wx(lx, lz), z = wz(lx, lz)
      tuft(x, ly + map.height(x, z), z, 0.3 + 0.45 * rnd(), 0.15 + grassDry(map.maskAt(x, z, mk)[1], x, z) * 0.75, true)
    }
    b.setSurf(SURF.turf); b.raw(tp, tn, tc, ti)
    // STONES on the way to it: rounded, half sunk — the cave's one rock (SURF.cliff), not the props' stone
    ob.setSurf(SURF.cliff)
    this.meta.stones.forEach(([lx, ly, lz, sz, rot], k) => {
      const x = wx(lx, lz), z = wz(lx, lz)
      // (the land's rock grey, not white — 2026-11-07, the user)
      // (Kit.rock paints them SURF.stone — linear albedo: the field's rocks' ~0.17 grey, never 0.5: that read white)
      const k2 = 0.15 + 0.05 * rnd()
      rock(ob, V(x, ly + map.height(x, z) + sz * 0.15, z), V(sz * 1.25, sz * 0.7, sz), rot, [k2, k2 * 1.03, k2 * 1.08], 9100 + k, 1, true)
    })
    // THE BONES (Blender's — bones.glb; the user: "low-poly skeletons, head parts, toes, at some random places"): each piece
    //  laid where it's put, turned, the bone a pale old ivory, its sockets near black
    const pieces: Record<string, { bone?: GFX.Mesh; dark?: GFX.Mesh }> = {}
    this.bones?.traverse((o) => {
      const m = o as GFX.Mesh
      if (!m.isMesh) return
      const nm = (m.name || '').replace(/[._]\d+$/, '').toLowerCase(), dark = nm.endsWith('_dark'), key = dark ? nm.slice(0, -5) : nm
      ;(pieces[key] ??= {})[dark ? 'dark' : 'bone'] = m
    })
    const BONE = [0.6, 0.56, 0.46], DARK = [0.03, 0.025, 0.02]
    const placeBones = (name: string, x: number, y: number, z: number, a: number, sc = 1, into = b) => {
      const pc = pieces[name]
      if (!pc) return
      const ca = Math.cos(a), sa = Math.sin(a)
      for (const [m, col] of [[pc.bone, BONE], [pc.dark, DARK]] as const) {
        if (!m) continue
        const P = m.geometry.getAttribute('position').array as Float32Array, N = m.geometry.getAttribute('normal')?.array as Float32Array | undefined
        const pos: number[] = [], nor: number[] = [], cc: number[] = []
        for (let i = 0; i < P.length; i += 3) {
          const lx = P[i] * sc, ly = P[i + 1] * sc, lz = P[i + 2] * sc
          pos.push(x + lx * ca + lz * sa, y + ly - 0.01, z - lx * sa + lz * ca)
          const nx = N ? N[i] : 0, ny = N ? N[i + 1] : 1, nz = N ? N[i + 2] : 0
          nor.push(nx * ca + nz * sa, ny, -nx * sa + nz * ca); cc.push(col[0], col[1], col[2])
        }
        const idx = m.geometry.index ? Array.from(m.geometry.index.array as ArrayLike<number>) : pos.map((_, k) => k).slice(0, pos.length / 3)
        into.setSurf(SURF.plain); into.raw(pos, nor, cc, idx)
      }
      into.setSurf(SURF.wood)
    }
    // scattered over the floor (off the lane: the floor's grass spots), a few on the way to the mouth
    {
      const spots = this.meta.floorTufts ?? [], kinds = ['skull', 'skull', 'skull', 'femur', 'femur', 'hand', 'foot', 'foot', 'ribs', 'skel_lying']
      for (let k = 0; k < 32 && spots.length; k++) {
        const [lx, ly, lz] = spots[Math.floor(((k * 0.618034) % 1) * spots.length)], x = wx(lx, lz), z = wz(lx, lz)
        placeBones(kinds[Math.floor(rnd() * kinds.length)], x, ly + map.height(x, z), z, rnd() * 6.283, 0.95 + 0.15 * rnd())
      }
      for (const [lx, lz, nm] of [[-6.5, 9, 'skull'], [7, 15, 'femur'], [-8, 21, 'foot']] as [number, number, string][]) {
        const x = wx(lx, lz), z = wz(lx, lz); placeBones(nm, x, map.height(x, z), z, rnd() * 6.283, 1, ob)
      }
    }
    // THE CAVE'S BROKEN THINGS AND BONES (the user: "inside, some broken wooden things and some skeletons"): on the
    //  floor's first CAVE_PROPS spots (off the lane), each its own: a skeleton lying, a smashed crate, fallen timbers and
    //  planks, a broken cart wheel
    ;(this.meta.floorBushes ?? []).slice(0, CAVE_PROPS).forEach(([lx, ly, lz], k) => {
      const x = wx(lx, lz), z = wz(lx, lz), y = ly + map.height(x, z), a = rnd() * 6.283
      const kind = k % 4
      if (kind === 0) placeBones(k % 8 === 0 ? 'skel_sitting' : 'skel_lying', x, y, z, a)
      else if (kind === 1) {
        b.setSurf(SURF.wood)
        crate(b, x, y, z, a, 0.42)
        for (let q = 0; q < 5; q++) rbox(b, x + (rnd() - 0.5) * 2.4, y + 0.03, z + (rnd() - 0.5) * 2.4, rnd() * 3.14, 0.42 + 0.3 * rnd(), 0.025, 0.07, b.wood(0.55 + 0.3 * rnd()))
      } else if (kind === 2) {
        b.setSurf(SURF.wood)
        const L = 2.6 + 2 * rnd(), ca = Math.cos(a), sa = Math.sin(a)
        beam(b, V(x - ca * L / 2, y + 0.12, z - sa * L / 2), V(x + ca * L * 0.15, y + 0.9 + 0.5 * rnd(), z + sa * L * 0.15), 0.16, 0.16, b.wood(0.5))
        beam(b, V(x + ca * L * 0.2, y + 0.1, z + sa * L * 0.2 + 0.3), V(x + ca * L / 2, y + 0.1, z + sa * L / 2 - 0.2), 0.14, 0.14, b.wood(0.45))
        for (let q = 0; q < 4; q++) rbox(b, x + (rnd() - 0.5) * 2.8, y + 0.03, z + (rnd() - 0.5) * 2.8, rnd() * 3.14, 0.5 + 0.4 * rnd(), 0.025, 0.08, b.wood(0.6 + 0.3 * rnd()))
      } else {
        b.setSurf(SURF.wood)
        wheel(b, V(x, y + 0.08, z), V(0, 1, 0), 0.55, 0.09, true)
        rbox(b, x + Math.cos(a) * 1.2, y + 0.06, z + Math.sin(a) * 1.2, a, 0.8, 0.05, 0.1, b.wood(0.5))
        if (k % 2) placeBones('skel_lying', x + Math.cos(a + 1.6) * 1.8, y, z + Math.sin(a + 1.6) * 1.8, a + 2)
      }
    })
    b.setSurf(SURF.wood)
    const g = b.geometry(); g.computeBoundingBox()
    // (the inside's tufts, bones and props: ~120 k triangles — hidden with the rest of the inside, 2026-11-07: drawn
    //  always, 0.37 ms seen from the air)
    const props = new GFX.Mesh(g, mat); this.group.add(props); this.inside.push(props)
    const og = ob.geometry(); og.computeBoundingBox(); this.group.add(new GFX.Mesh(og, mat))
    // THE SEAMS WELDED (2026-11-07, the user: "cracks inside, like lines"): the parts were cut apart in Blender and each
    //  packed on its own grid (Draco), so a shared edge came back a hair apart on each side — the land showed through.
    //  Every vertex within ~2.5 cm of another (any part) moved to their middle: two passes on offset 2 cm grids.
    for (const off of [0, 0.01]) {
      const cells = new Map<string, number[]>()
      weld.forEach((arr, ai) => {
        for (let i = 0; i < arr.length; i += 3) {
          const key = `${Math.round((arr[i] + off) * 50)},${Math.round((arr[i + 1] + off) * 50)},${Math.round((arr[i + 2] + off) * 50)}`
          const l = cells.get(key); if (l) l.push(ai, i); else cells.set(key, [ai, i])
        }
      })
      for (const l of cells.values()) {
        if (l.length < 4) continue
        let sx = 0, sy = 0, sz = 0
        for (let k = 0; k < l.length; k += 2) { const a = weld[l[k]], i = l[k + 1]; sx += a[i]; sy += a[i + 1]; sz += a[i + 2] }
        const n = l.length / 2
        for (let k = 0; k < l.length; k += 2) { const a = weld[l[k]], i = l[k + 1]; a[i] = sx / n; a[i + 1] = sy / n; a[i + 2] = sz / n }
      }
    }
  }

  /** The terrain's own grass kept off where the hill is open — its mouth's face, the skylight, its steep — and under the
   *  cave where no top covers it; elsewhere on the hill it GROWS (grassOn). */
  private clearGrass(map: MapData, footprint?: GFX.DataTexture): void {
    const fp = footprint?.image.data as Uint8Array | undefined
    if (!fp) return
    const gi = map.inner, f = this.meta.foot, { local } = this.frame, R = Math.max(f.rx, f.rz) + Math.hypot(f.cx, f.cz) + 4
    const i0 = Math.max(0, Math.floor((this.site.x - R - gi.origin) / gi.step)), i1 = Math.min(gi.n - 1, Math.ceil((this.site.x + R - gi.origin) / gi.step))
    const j0 = Math.max(0, Math.floor((this.site.z - R - gi.origin) / gi.step)), j1 = Math.min(gi.n - 1, Math.ceil((this.site.z + R - gi.origin) / gi.step))
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const [lx, lz] = local(gi.origin + i * gi.step, gi.origin + j * gi.step)
      if (!inCaveFoot(this.meta, lx, lz)) continue
      const h = caveTop(this.meta, lx, lz)
      const rim = [this.meta.sky, this.meta.sky2].some((sk) => !!sk && Math.hypot(lx - sk[0], lz - sk[1]) < sk[2] + 2.2)
      const steep = (h !== null && this.slope(lx, lz) > 0.85) || rim
      const arch = Math.abs(lx) < 13 && lz > -9 && lz < 5 && h !== null && h > 0.6
      if ((h === null && lz < -1 && inCaveFoot(this.meta, lx, lz, -18)) || steep || arch) fp[j * gi.n + i] = 255
    }
    footprint!.needsUpdate = true
  }

  /** The hill's top's slope (rise / run) at local (lx, lz); 9 off it. */
  private slope(lx: number, lz: number): number {
    const h = caveTop(this.meta, lx, lz), hx = caveTop(this.meta, lx + 2, lz), hz = caveTop(this.meta, lx, lz + 2)
    return h === null || hx === null || hz === null ? 9 : Math.hypot(hx - h, hz - h) / 2
  }

  /** THE FIELD'S GRASS ON THE HILL (2026-11-07, the user: "why no grass over the cave? there must be grass"; "above the
   *  cave some rocky texture as well, properly like we do in other terrain places"): its top's height over the ground
   *  (a 2 m world-aligned grid) to Grass — the blades stand on it, the field's colours and wind; and its bare rock
   *  patches into the map's mask (R: rock) where it stands, so the field thins there as on any rocky hill. */
  grassOn(map: MapData, grass: { setHill(tex: GFX.DataTexture, x0: number, z0: number, step: number, n: number): void }): void {
    const f = this.meta.foot, { wx, wz, local } = this.frame, R = Math.max(f.rx, f.rz) + 6, cx = wx(f.cx, f.cz), cz = wz(f.cx, f.cz)
    const step = 2, x0 = cx - R, z0 = cz - R, n = Math.ceil((2 * R) / step) + 1, data = new Float32Array(n * n)
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const [lx, lz] = local(x0 + i * step, z0 + j * step), h = caveTop(this.meta, lx, lz)
      data[j * n + i] = h !== null && h > 0 ? h : 0
    }
    const tex = new GFX.DataTexture(data, n, n, GFX.RedFormat, GFX.FloatType)
    tex.minFilter = tex.magFilter = GFX.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true
    grass.setHill(tex, x0, z0, step, n)
    // the rock patches into the mask (as the turf paints them: CaveWorld.build's vCol.z)
    const mg = map.meta.mask, md = map.maskTex.image.data as Uint8Array
    const mi0 = Math.max(0, Math.floor((x0 - mg.origin) / mg.step)), mi1 = Math.min(mg.n - 1, Math.ceil((x0 + 2 * R - mg.origin) / mg.step))
    const mj0 = Math.max(0, Math.floor((z0 - mg.origin) / mg.step)), mj1 = Math.min(mg.n - 1, Math.ceil((z0 + 2 * R - mg.origin) / mg.step))
    const bw = mi1 - mi0 + 1, bh = mj1 - mj0 + 1, G = new Float32Array(bw * bh), on = new Uint8Array(bw * bh)
    for (let j = mj0; j <= mj1; j++) for (let i = mi0; i <= mi1; i++) {
      const x = mg.origin + i * mg.step, z = mg.origin + j * mg.step, [lx, lz] = local(x, z), h = caveTop(this.meta, lx, lz)
      const b = (j - mj0) * bw + (i - mi0), k0 = (j * mg.n + i) * 4
      G[b] = md[k0 + 1] / 255
      if (h === null || h < 1) continue
      on[b] = 1
      // DRYNESS: the land's, swung a little to green swales and golden rises (faded in up the foot: no seam there)
      const w = Math.min(1, (h - 1) / 6)
      G[b] += (grassDry(G[b], x, z) - G[b]) * w
      const sl = this.slope(lx, lz), ny = 1 / Math.sqrt(1 + sl * sl), welcome = Math.min(1, Math.max(0, (Math.hypot(lx, lz * 0.8) - 24) / 10))
      // ROCK: where it's steep, and in patches (a slow noise) — SMOOTH, so the terrain's threshold turns it to rock over
      // metres (the user: "gradual, not a sticker"); round the skylights' rims; never round the entrance
      let rz = welcome * Math.max(0, 0.7 * Math.min(1, Math.max(0, (0.86 - ny) / 0.32)) + (patch(x, z) - 0.5) * 1.1 - 0.02)
      for (const sk of [this.meta.sky, this.meta.sky2]) { if (sk) { const d = Math.hypot(lx - sk[0], lz - sk[1]), t = Math.min(1, Math.max(0, (d - sk[2] - 0.5) / 9)); rz = Math.max(rz, 1.1 * (1 - t * t * (3 - 2 * t))) } }
      const k = (j * mg.n + i) * 4, t2 = Math.min(1, Math.max(0, (rz - 0.15) / 0.75))
      md[k] = Math.max(md[k], Math.round(t2 * t2 * (3 - 2 * t2) * 235))
    }
    // (the dryness SOFTENED over the hill — a 20 m box: green runs into gold over metres, in the ground's paint and in
    //  the blades alike, never along a line — 2026-11-07, the user: "a gradual smooth transition")
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
      if (!on[j * bw + i]) continue
      let s = 0, c = 0
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const jj = j + dj, ii = i + di
        if (jj >= 0 && ii >= 0 && jj < bh && ii < bw) { s += G[jj * bw + ii]; c++ }
      }
      md[((j + mj0) * mg.n + i + mi0) * 4 + 1] = Math.round(Math.min(1, Math.max(0, s / c)) * 255)
    }
    map.maskTex.needsUpdate = true
  }

  /** FIREFLIES (2026-11-07, the user: "at night some fireflies"): little green-gold lights drifting in the cave's air
   *  — over the garden and the lake, through the chambers and the Haven — each its own slow wander and pulse, out by day
   *  (uLamps). One draw: every fly a camera-facing quad worked out in the vertex shader; added, no depth write. */
  private fireflies(map: MapData, atmos: Atmosphere, tier: Tier): void {
    const spots = [...(this.meta.floorTufts ?? []), ...this.meta.tufts]
    if (!spots.length) return
    const N = tier.name === 'low' ? 120 : tier.name === 'medium' ? 200 : 320, { wx, wz } = this.frame
    let s = 0x51f1
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    const pos: number[] = [], seed: number[] = [], idx: number[] = []
    for (let k = 0; k < N; k++) {
      // (a third over the garden and the lake — the light's — the rest anywhere on the floor)
      const [lx, ly, lz] = k % 3 === 0 ? this.meta.tufts[Math.floor(rnd() * this.meta.tufts.length)] : spots[Math.floor(rnd() * spots.length)]
      const x = wx(lx, lz), z = wz(lx, lz), y = ly + map.height(x, z) + 0.4 + rnd() * 2.6, ph = rnd() * 100
      for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { pos.push(cx, cy, 0); seed.push(x, y, z, ph) }
      const b = k * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3)
    }
    const g = new GFX.BufferGeometry()
    g.setAttribute('position', new GFX.Float32BufferAttribute(pos, 3))
    g.setAttribute('seed', new GFX.Float32BufferAttribute(seed, 4))
    g.setIndex(idx)
    g.computeBoundingBox()
    const u = atmos.uniforms
    const mat = new GFX.ShaderMaterial({
      uniforms: { uTime: u.uTime, uLamps: u.uLamps, uCamPos: u.uCamPos },
      vertexShader: /* glsl */ `
        attribute vec4 seed;
        uniform float uTime;
        uniform vec3 uCamPos;
        varying vec2 vUv;
        varying float vGlow;
        void main() {
          float t = uTime * 0.35 + seed.w;
          // (a slow wander round its spot, a little bob)
          vec3 c = seed.xyz + vec3(sin(t * 0.9) * 1.6 + sin(t * 2.3) * 0.4, sin(t * 1.3) * 0.5 + sin(t * 3.1) * 0.15, cos(t * 0.7) * 1.6 + cos(t * 1.9) * 0.4);
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float size = 0.07 + 0.002 * length(c - uCamPos); // (a pixel or two far off, never gone)
          vUv = position.xy;
          // (each its own pulse: on for a while, dim, on again)
          vGlow = 0.25 + 0.75 * smoothstep(0.2, 0.9, sin(uTime * (0.8 + fract(seed.w) * 0.9) + seed.w * 7.0) * 0.5 + 0.5);
          gl_Position = projectionMatrix * viewMatrix * vec4(c + (right * position.x + up * position.y) * size, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uLamps;
        varying vec2 vUv;
        varying float vGlow;
        void main() {
          float r = length(vUv), a = (1.0 - smoothstep(0.15, 1.0, r)) * vGlow * uLamps;
          gl_FragColor = vec4(vec3(0.75, 1.0, 0.3) * 2.4, a); // (added × its alpha)
        }`,
      transparent: true,
      depthWrite: false,
      side: GFX.DoubleSide,
      blending: GFX.AdditiveBlending,
    })
    const m = new GFX.Mesh(g, mat)
    m.frustumCulled = false
    m.renderOrder = 60
    this.group.add(m)
    this.flies = m
    this.lamps = u.uLamps
  }
  private flies: GFX.Mesh | null = null
  private lamps: GFX.IUniform | null = null

  /** The cave's inside drawn only from on or near the hill (once a frame). */
  update(cam: GFX.Vector3): void {
    const [lx, lz] = this.frame.local(cam.x, cam.z), near = inCaveFoot(this.meta, lx, lz, 15)
    const top = near ? caveTop(this.meta, lx, lz) : null
    this.cameraInside = near && lz < -3 && inCaveFoot(this.meta, lx, lz, -12) && cam.y < this.map!.height(cam.x, cam.z) + (top ?? 30) - 1
    // (seen only from inside, from before its mouth, or down its skylight — from on its top it's all behind turf:
    //  2026-11-07, abq caveAbove: +0.5 ms ULTRA drawing 140 k triangles nobody saw)
    const [sx, sz] = this.meta.sky
    // (in front of the mouth — from anywhere it can be seen through — always: else the hill reads see-through)
    const s2 = this.meta.sky2
    // (in front: only low enough to see in — from high over the land before it, the mouth's roof hides all but its lip)
    const agl = cam.y - this.map!.height(cam.x, cam.z), front = lz > -4 && Math.abs(lx) < lz * 2.5 + 30 && agl < 20 + 0.35 * Math.hypot(lx, lz)
    const on = this.cameraInside || Math.hypot(lx, lz) < 45 || Math.hypot(lx - sx, lz - sz) < 30 || (!!s2 && Math.hypot(lx - s2[0], lz - s2[1]) < 30) || front
    // (drawn AFTER the hill's turf and the land when looked at from outside — the depth test throws away what's behind
    //  them before it's shaded; FIRST from inside, so the turf over the roof is thrown away instead: 2026-11-07, abq
    //  caveAbove / caveHall — the taller cave's rock, ~1.9 ms seen through the mouth from the air)
    const order = this.cameraInside ? -1 : 1
    for (const m of this.inside) { m.visible = on; m.renderOrder = order }
    if (this.flies) this.flies.visible = on && (this.lamps!.value as number) > 0.02
  }
}
let draco: InstanceType<typeof DRACOLoader> | null = null
