import * as GFX from './gfx'
import type { MapData } from './MapData'
import { KIT, loadKit, type Kit, type Pieces } from './Pieces'
import { flagSpot } from './Claims'
import type { Atmosphere } from './Atmosphere'
import type { TerrainShadow } from './TerrainShadow'
import { getCatalog, type PieceInfo } from '../net/api'
import type { Session } from '../net/Session'
import type { Bag, Claim, Piece } from '../net/wire'

/**
 * BUILDING PIECES (docs/MULTIPLAYER.md §4 — "a ghost of the piece follows the brush, green when it fits and you can pay,
 * red when not; R rotates; walls snap to foundations, roofs to walls"): Build.ts's second mode, on your own land.
 *
 *   THE GRID: cells of 3 m from your flag. Foundations, floors and roofs fill a CELL; walls, fences and dry-stone walls
 *     go on a cell's EDGE (the nearest to the cursor), their outside facing out (R turns them about); the rest (the
 *     chimney, steps, the porch, its posts, a jetty, a fire ring, a lamp) stand FREE on the ground, a quarter-metre
 *     grid, turned in 15° steps.
 *   STOREYS: a foundation sits on the highest ground under its cell (the stones run down to the rest — steeper than
 *     0.6 m: no); a wall on the floor of its cell's foundation, a second wall on the same edge on top of the first; a
 *     plank floor on the walls; a roof on the highest walls round its cell.
 *   THE GHOST: the piece itself, see-through — green: it fits and the stockpile pays; red: why not (the HUD says).
 *   The click asks the server (backend world.rs `place`: in your land, paid from its stockpile); X takes the piece
 *   under the cursor down (half its cost back).
 */
const OK = new GFX.Color(0.35, 0.9, 0.45), NO = new GFX.Color(0.95, 0.3, 0.22)
const GHOST_VERT = /* glsl */ `
out vec3 vN;
out vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`
const GHOST_FRAG = /* glsl */ `
layout(location = 0) out highp vec4 outColor;
uniform vec3 uColor;
uniform float uTime;
in vec3 vN;
in vec3 vW;
void main() {
  float l = 0.55 + 0.45 * max(dot(normalize(vN), normalize(vec3(0.4, 1.0, 0.3))), 0.0);
  float scan = 0.85 + 0.15 * sin(vW.y * 9.0 - uTime * 4.0);
  outColor = vec4(uColor * l * scan, 0.42);
}`

type Slot = 'cell' | 'edge' | 'free'
const slotOf = (kind: string): Slot =>
  kind.startsWith('foundation') || kind.startsWith('roof') || kind === 'floor_plank' ? 'cell'
    : kind.startsWith('wall') || kind.startsWith('fence') || kind === 'plant_hedge' ? 'edge' : 'free'

export interface Placement { kind: string; x: number; y: number; z: number; rot: number; why: string }

export class Builder {
  private list: PieceInfo[] = []
  private idx = 0
  private turn = 0
  private kit: Kit | null = null
  readonly ghost = new GFX.Group()
  private readonly ghostMat: GFX.ShaderMaterial
  private ghostKind = ''
  plan: Placement | null = null
  /** The piece under the cursor that X would take down. */
  private target: Piece | null = null

  constructor(private readonly session: Session, private readonly map: () => MapData, private readonly pieces: Pieces,
    atmos: Atmosphere, shadow: TerrainShadow, farGrid: GFX.Vector4, private readonly toast: (m: string, ms?: number) => void) {
    this.ghostMat = new GFX.ShaderMaterial({ glslVersion: GFX.GLSL3, uniforms: { uColor: { value: OK.clone() }, uTime: { value: 0 } }, vertexShader: GHOST_VERT, fragmentShader: GHOST_FRAG, transparent: true, depthWrite: false })
    this.ghost.visible = false
    void getCatalog().then((c) => { this.list = c.pieces.filter((p) => KIT.pieces.includes(p.kind)) /* (what the kit models; the rest come with step 6) */ }).catch(() => this.toast("The build catalogue didn't load", 3000))
    void loadKit(atmos, shadow, farGrid).then((k) => { this.kit = k })
  }

  get piece(): PieceInfo | null { return this.list[this.idx] ?? null }
  private mine(): Claim | null { return [...this.session.claims.values()].find((c) => c.owner === this.session.me.id) ?? null }

  /** The next / last piece (the wheel, [ ]); the next group (Tab). */
  cycle(d: number): void { if (this.list.length) { this.idx = (this.idx + d + this.list.length) % this.list.length; this.turn = 0 } }
  nextGroup(): void {
    if (!this.list.length) return
    const g = this.list[this.idx].group
    let i = this.idx
    do i = (i + 1) % this.list.length; while (this.list[i].group === g && i !== this.idx)
    this.idx = i; this.turn = 0
  }
  rotate(): void { this.turn++ }

  /** Where the selected piece would go for the cursor at (hx, hz) — and why not, if it can't. */
  private placeFor(hx: number, hz: number): Placement | null {
    const info = this.piece, c = this.mine()
    if (!info || !c) return null
    return placementFor(this.session, this.map(), c, info, hx, hz, this.turn)
  }

  /** Every frame in build mode: the ghost to the cursor's ground point (null: the cursor isn't on the ground). */
  update(dt: number, hit: GFX.Vector3 | null): void {
    this.ghostMat.uniforms.uTime.value += dt
    this.plan = hit ? this.placeFor(hit.x, hit.z) : null
    const c = this.mine()
    this.target = hit && c ? this.pieces.nearest(hit.x, hit.z, 1.6, c.id) : null
    const k = this.plan?.kind ?? ''
    if (k !== this.ghostKind) this.makeGhost(k)
    this.ghost.visible = !!this.plan && !!this.kit
    if (this.plan) {
      this.ghost.position.set(this.plan.x, this.plan.y + 0.01, this.plan.z)
      this.ghost.rotation.set(0, this.plan.rot, 0)
      ;(this.ghostMat.uniforms.uColor.value as GFX.Color).copy(this.plan.why ? NO : OK)
    }
  }

  private makeGhost(kind: string): void {
    this.ghostKind = kind
    for (const m of [...this.ghost.children]) { this.ghost.remove(m); (m as GFX.Mesh).geometry.dispose() }
    if (!kind || !this.kit) { this.ghostKind = this.kit ? kind : ''; return }
    const geos = (this.kit.parts[kind] ?? []).map((p) => p.geo.clone())
    const g = geos.length ? GFX.mergeGeometries(geos.map((q) => { const n = new GFX.BufferGeometry(); n.setAttribute('position', q.getAttribute('position')); n.setAttribute('normal', q.getAttribute('normal')); if (q.index) n.setIndex(q.index); return n })) : null
    if (g) this.ghost.add(new GFX.Mesh(g, this.ghostMat))
  }

  /** The HUD's line and its "why not". */
  text(): { line: string; why: string } {
    const p = this.piece, c = this.mine()
    if (!p) return { line: 'Loading the pieces…', why: '' }
    const stock = c ? bagText(c.stock) || 'empty' : '—'
    return { line: `${p.name} · ${bagText(p.cost)}   (stockpile: ${stock})`, why: this.plan?.why ?? 'Point at your land' }
  }

  place(): void {
    const pl = this.plan
    if (!pl) return
    if (pl.why) { this.toast(pl.why, 2200); return }
    this.session.ask({ t: 'place', kind: pl.kind, x: pl.x, y: pl.y, z: pl.z, rot: pl.rot, variant: 0 }).catch((e: Error) => this.toast(e.message, 2600))
    this.onPlace?.(pl)
  }
  /** A piece sent (main.ts: he stoops and sets it down). */
  onPlace: ((pl: Placement) => void) | null = null

  remove(): void {
    const t = this.target
    if (!t) { this.toast('Point at one of your pieces to take it down', 2200); return }
    this.session.ask({ t: 'remove', piece: t.id }).then(() => this.toast('Taken down — half of it back in your stockpile', 2200)).catch((e: Error) => this.toast(e.message, 2600))
  }

  dispose(): void { this.ghost.removeFromParent() }
}

/** The ground's height (the map's) — the highest under a cell's corners and middle. */
function cellBase(m: MapData, cx: number, cz: number): { y: number; spread: number } {
  const h = KIT.cell / 2
  let lo = Infinity, hi = -Infinity
  for (const [dx, dz] of [[-h, -h], [h, -h], [-h, h], [h, h], [0, 0]]) { const y = m.height(cx + dx, cz + dz); lo = Math.min(lo, y); hi = Math.max(hi, y) }
  return { y: hi, spread: hi - lo }
}
/** The floor's base at a cell: its foundation's, else the ground's. */
function baseAt(S: Session, m: MapData, cx: number, cz: number, claim: string): number {
  for (const p of S.pieces.values()) if (p.claim === claim && p.kind.startsWith('foundation') && Math.hypot(p.x - cx, p.z - cz) < 0.2) return p.y
  return cellBase(m, cx, cz).y
}

/** The ground-floor wall of this claim nearest (hx, hz) — within 3.2 m, the cursor outside it (its cell bare of a
 *  foundation that side) — and its outward normal. */
function wallNear(S: Session, hx: number, hz: number, claim: string): { w: Piece; nx: number; nz: number } | null {
  let best: { w: Piece; nx: number; nz: number } | null = null, bd = 3.2
  for (const p of S.pieces.values()) {
    if (p.claim !== claim || !p.kind.startsWith('wall') || p.kind === 'wall_drystone') continue
    const d = Math.hypot(hx - p.x, hz - p.z)
    if (d >= bd) continue
    // (its faces along its rot's z; the side the cursor is on)
    let nx = Math.sin(p.rot), nz = Math.cos(p.rot)
    if ((hx - p.x) * nx + (hz - p.z) * nz < 0) { nx = -nx; nz = -nz }
    const ox = p.x + nx * KIT.cell / 2, oz = p.z + nz * KIT.cell / 2
    if ([...S.pieces.values()].some((f) => f.claim === claim && f.kind.startsWith('foundation') && Math.hypot(f.x - ox, f.z - oz) < 0.3)) continue
    // (the lowest storey's: a porch is on the ground)
    if ([...S.pieces.values()].some((q) => q !== p && q.claim === claim && q.kind.startsWith('wall') && Math.hypot(q.x - p.x, q.z - p.z) < 0.3 && q.y < p.y - 0.5)) continue
    best = { w: p, nx: Math.round(nx), nz: Math.round(nz) }; bd = d
  }
  return best
}

/**
 * WHERE A PIECE GOES (the builder's snapping — the class comment): piece `info` on claim `c` for the cursor at
 * (hx, hz), turned `turn` times (R) — and why not, if it can't. Shared by the builder and the bot (Bot.ts), so a piece
 * the bot sets down sits exactly where a player's would.
 */
export function placementFor(S: Session, m: MapData, c: Claim, info: { kind: string; cost: Bag }, hx: number, hz: number, turn: number): Placement {
  const kind = info.kind, slot = slotOf(kind), C = KIT.cell, F = KIT.floor, W = KIT.wallH
  const i = Math.round((hx - c.x) / C), j = Math.round((hz - c.z) / C)
  const cx = c.x + i * C, cz = c.z + j * C
  const same = (x: number, y: number, z: number, test: (p: Piece) => boolean) => [...S.pieces.values()].some((p) => p.claim === c.id && test(p) && Math.hypot(p.x - x, p.z - z) < 0.3 && Math.abs(p.y - y) < 0.5)
  let x = cx, z = cz, y = 0, rot = 0, why = ''
  if (slot === 'cell') {
    rot = kind.startsWith('roof') ? (turn % 2) * Math.PI / 2 : (turn % 4) * Math.PI / 2
    if (kind.startsWith('foundation')) {
      const b = cellBase(m, cx, cz)
      y = b.y
      if (b.spread > 0.6) why = 'Too steep for a foundation here — try the next cell'
      if (same(x, y, z, (p) => p.kind.startsWith('foundation'))) why = 'A foundation stands here already'
    } else {
      const base = baseAt(S, m, cx, cz, c.id)
      // the highest wall round this cell → the roof (or a floor) on top of it
      let top = 0
      for (const p of S.pieces.values()) {
        if (p.claim !== c.id || !p.kind.startsWith('wall') || p.kind === 'wall_drystone') continue
        if (Math.abs(p.x - cx) <= C / 2 + 0.1 && Math.abs(p.z - cz) <= C / 2 + 0.1) top = Math.max(top, Math.round((p.y - base - F) / W) + 1)
      }
      if (!top) why = kind === 'floor_plank' ? 'A floor goes on walls — build the walls first' : 'A roof goes on walls — build the walls first'
      y = kind === 'floor_plank' ? base + top * W : base + F + Math.max(1, top) * W
      if (same(x, y, z, (p) => p.kind === kind || (p.kind.startsWith('roof') && kind.startsWith('roof') && kind !== 'roof_shingle_ridge'))) why = 'There is one here already'
    }
  } else if (slot === 'edge') {
    const fx = (hx - cx) / C, fz = (hz - cz) / C
    let ox = 0, oz = 0
    if (Math.abs(fx) > Math.abs(fz)) { ox = Math.sign(fx) || 1; x = cx + ox * C / 2 } else { oz = Math.sign(fz) || 1; z = cz + oz * C / 2 }
    if (turn % 2) { ox = -ox; oz = -oz }
    rot = Math.atan2(-ox, -oz)
    if (kind.startsWith('wall') && kind !== 'wall_drystone') {
      // on the floor of the cell it bounds (either side's foundation), stacked on a wall already there
      const base = Math.max(baseAt(S, m, cx, cz, c.id), baseAt(S, m, cx + (Math.abs(fx) > Math.abs(fz) ? Math.sign(fx) : 0) * C, cz + (Math.abs(fx) > Math.abs(fz) ? 0 : Math.sign(fz)) * C, c.id) - 0.001)
      let level = 0
      while (same(x, base + F + level * W, z, (p) => p.kind.startsWith('wall') && p.kind !== 'wall_drystone') && level < 3) level++
      y = base + F + level * W
      if (level >= 3) why = 'Three storeys is the most'
    } else {
      y = m.height(x, z)
      if (same(x, y, z, (p) => p.kind.startsWith('fence') || p.kind === 'wall_drystone' || p.kind === 'plant_hedge')) why = 'There is one here already'
    }
  } else if ((kind === 'porch_deck' || kind === 'porch_roof') && wallNear(S, hx, hz, c.id)) {
    // A PORCH against a wall: on its outside (the cursor's side), its middle, the deck's top at the floor's
    const { w, nx, nz } = wallNear(S, hx, hz, c.id)!
    x = w.x + nx * (C / 2 - 0.5); z = w.z + nz * (C / 2 - 0.5)
    rot = Math.atan2(nx, nz)
    y = w.y - F
    if (same(x, y, z, (p) => p.kind === kind)) why = 'There is one here already'
  } else {
    x = Math.round(hx * 4) / 4; z = Math.round(hz * 4) / 4
    rot = (turn % 24) * Math.PI / 12
    y = m.height(x, z)
    if (kind === 'jetty') { const w = m.waterAt(x, z); if (w !== null) y = w + 0.35 }
    else if (m.waterAt(x, z) !== null) why = kind.startsWith('plant_') ? 'Not in the water — plant it on the bank' : 'Not in the water'
  }
  // (the flag's pole: nothing built through it)
  const [fx, fz] = flagSpot(c, m)
  if (!why && (slot === 'cell' ? Math.abs(x - fx) < KIT.cell / 2 + 0.4 && Math.abs(z - fz) < KIT.cell / 2 + 0.4 : Math.hypot(x - fx, z - fz) < 1.3)) why = 'Your flag stands here'
  // in your land; the stockpile pays
  if (Math.hypot(x - c.x, z - c.z) > c.r - 0.8) why = 'Outside your land'
  else if (!why && !S.world.rules.creative && !covers(c.stock, info.cost)) why = `Your stockpile needs ${short(c.stock, info.cost)} more`
  return { kind, x, y, z, rot, why }
}

const MATS = ['wood', 'stone', 'metal'] as const
const covers = (a: Bag, b: Bag) => MATS.every((m) => a[m] >= b[m])
const short = (a: Bag, b: Bag) => MATS.filter((m) => b[m] > a[m]).map((m) => `${b[m] - a[m]} ${m}`).join(', ')
const bagText = (b: Bag) => MATS.filter((m) => b[m] > 0).map((m) => `${b[m]} ${m}`).join(', ')
