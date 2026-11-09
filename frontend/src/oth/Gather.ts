import * as GFX from './gfx'
import type { Atmosphere } from './Atmosphere'
import type { Character } from './Character'
import type { Grass } from './Grass'
import type { MapData } from './MapData'
import type { OthPhysics } from './Physics'
import type { Rocks } from './Rocks'
import type { TerrainShadow } from './TerrainShadow'
import type { Trees } from './Trees'
import { TRAILER, type Trailer } from './Trailer'
import { flagSpot } from './Claims'
import { assetMaterial, loadParts } from './assetMat'
import type { Session } from '../net/Session'
import type { Bag, Claim, Loose, Mat } from '../net/wire'
import modelUrl from '../assets/models/props/gather.glb?url'
import texUrl from '../assets/models/props/gather.webp?url'
import texNUrl from '../assets/models/props/gather_n.webp?url'

/**
 * GATHERING ON FOOT (docs/MULTIPLAYER.md §1 — step 2: "cut trees, mine stone, haul it … to a stockpile"): the server
 * decides what exists (backend/src/world.rs: cut_tree, mine, pick, drop, deposit, take); this draws it and asks for it.
 *
 *   THE TREES: a felled one is hidden and its trunk gone for everyone (Trees.fell / Physics.dropTrunk); when it's cut
 *     here and now it FALLS (Trees.fall: away from whoever cut it) and its logs appear where it lands; a STUMP stays.
 *   THE PILES: loose wood (logs), stone (stones), metal (scrap) lying about — as many as each holds.
 *   THE STOCKPILES: each claim's, beside its flag — logs stacked between stakes, a stone heap, the scrap, growing with
 *     what's in it.
 *   HIS HANDS: what he carries (up to 4) in his arms — the CARRY clip over his walk — and the axe or the pick in his
 *     hand while he works. A chip on the HUD says what he holds.
 *
 * THE LOOK (2026-11-09, the user: "realistic … not boxes … good quality"): every piece MODELLED (scripts/oth/
 * gather_assets.py: logs in fir bark with the cut ends' rings, broken stones, the stump's flared roots, the forged
 * tools, rusted scrap — ambientCG's scans baked into one atlas, colour and normals) and drawn as the character is (the
 * car's surface shader: the map, its normal map, the world's light). A pile is its pieces merged into one mesh.
 *
 * E (or the touch pill) does what's nearest, GTA's way — the prompt says what: PICK UP a pile · STOCK what you carry
 * (at your own flag) · CHOP a tree (three swings fell it) · MINE a boulder (a stone a swing). H puts down what you
 * carry. Nothing here without a co-op world (the server is the one who says). What lies on the ground marks it
 * (Rocks.mark: trodden — the grass kept off, so the logs show in a meadow).
 */
const REACH_PILE = 2.6
const REACH_TREE = 2.2
const REACH_ROCK = 1.5
const REACH_STOCK = 7
const SWINGS = 3
const CARRY_CAP = 4
/** Where a claim's stockpile stands (from its flag, m: in toward the middle, and to the side). */
const STOCK_AT = [3.4, 1.8]
/** Where claim c's stockpile stands (beside its flag) — every client's and the bot's (Bot.ts) the same. */
export function stockSpotOf(c: Claim, map: MapData): [number, number] {
  const [fx, fz] = flagSpot(c, map), d = Math.hypot(c.x - fx, c.z - fz) || 1, ix = (c.x - fx) / d, iz = (c.z - fz) / d
  return [fx + ix * STOCK_AT[0] - iz * STOCK_AT[1], fz + iz * STOCK_AT[0] + ix * STOCK_AT[1]]
}
/** The models' sizes (gather_assets.py: a log 1.6 m long): its radius, the stump's. */
const LOG_R = 0.12, STUMP_R = 0.33


type Target =
  | { kind: 'hitch'; label: string; run: () => void }
  | { kind: 'loadPile'; drop: Loose; room: number }
  | { kind: 'stowIn' }
  | { kind: 'stowOut'; bag: Bag }
  | { kind: 'unload'; claim: Claim }
  | { kind: 'pile'; drop: Loose }
  | { kind: 'stock'; claim: Claim }
  | { kind: 'tree'; i: number; x: number; z: number; h: number }
  | { kind: 'rock'; key: string; x: number; z: number; size: number; left: number }

export interface GatherWorld { id: string; map: MapData; trees: Trees; rocks: Rocks; grass: Grass }
type Parts = Record<string, GFX.BufferGeometry>

export class Gather {
  readonly group = new GFX.Group()
  private mat: GFX.ShaderMaterial | null = null
  private parts: Parts | null = null
  private readonly piles = new Map<string, { mesh: GFX.Mesh; key: string }>()
  private readonly stocks = new Map<string, { mesh: GFX.Mesh; key: string }>()
  private readonly stumps = new Map<number, GFX.Mesh>()
  /** Drops not shown yet: under a tree still falling (shown when it lands). */
  private readonly held = new Set<string>()
  private readonly falling: { x: number; z: number }[] = []
  private carried: GFX.Mesh | null = null
  private carriedKey = ''
  private axe: GFX.Mesh | null = null
  private pick: GFX.Mesh | null = null
  private readonly swings = new Map<number, number>()
  /** The action playing: when its blow lands (s from its start) and what it does then. */
  busy: { t: number; hitAt: number; hit: () => void; tool: GFX.Mesh | null } | null = null
  private appliedWorld = ''
  private readonly hud: HTMLDivElement
  private readonly pill: HTMLButtonElement
  private hudKey = ''
  private grassDirty = false
  private readonly m = new GFX.Matrix4()
  private readonly m2 = new GFX.Matrix4()
  private readonly v = new GFX.Vector3()
  private readonly v2 = new GFX.Vector3()
  private readonly off: (() => void)[] = []
  /** What E would do now (main.ts shows it in the prompt). */
  prompt: [string, string] | null = null

  constructor(
    private readonly session: Session,
    private readonly world: () => GatherWorld,
    private readonly physics: OthPhysics,
    private readonly hero: Character,
    atmos: Atmosphere, shadow: TerrainShadow, farGrid: GFX.Vector4,
    private readonly toast: (m: string, ms?: number) => void,
    /** On foot and free to act (main.ts: not driving, not in a cut, not paused). */
    private readonly canAct: () => boolean,
    /** Our trailer (Trailer.ts), when there is one. */
    private readonly trailer: () => Trailer | null = () => null,
  ) {
    this.hud = document.createElement('div')
    this.hud.className = 'oth-hands'
    this.pill = document.createElement('button')
    this.pill.className = 'oth-gatherbtn'
    this.pill.addEventListener('pointerdown', (e) => { e.preventDefault(); this.act() })
    document.body.append(this.hud, this.pill)
    const key = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !this.canAct()) return
      if (e.code === 'KeyE') this.act()
      if (e.code === 'KeyH') this.putDown()
    }
    window.addEventListener('keydown', key)
    this.off.push(() => window.removeEventListener('keydown', key))
    this.off.push(session.on((e) => {
      switch (e.t) {
        case 'tree_cut': this.treeCut(e.tree, e.x, e.z, e.by); break
        case 'tree_back': this.treeBack(e.tree); break
        case 'drop': this.pile(e.drop); break
        case 'drop_gone': this.pileGone(e.id); break
        case 'claim': this.stockpile(e.claim.id); break
        case 'stock': this.stockpile(e.claim); break
        case 'claim_gone': this.stockGone(e.id); break
        case 'inv': this.hands(); this.trailerLoad(); break
      }
    }))
    void this.load(atmos, shadow, farGrid)
  }

  /** The models and their atlas; then what's already there drawn. */
  private async load(atmos: Atmosphere, shadow: TerrainShadow, farGrid: GFX.Vector4): Promise<void> {
    const [P, mat] = await Promise.all([loadParts(modelUrl), assetMaterial(atmos, shadow, farGrid, texUrl, texNUrl)])
    const parts: Parts = {}
    for (const n of Object.keys(P.geo)) parts[n] = P.placed(n)!
    this.parts = parts
    this.mat = mat
    this.axe = this.tool('axe'); this.pick = this.tool('pick')
    for (const d of this.session.drops.values()) this.pile(d)
    for (const c of this.session.claims.values()) this.stockpile(c.id)
    this.carriedKey = '-'
    this.hands()
    this.trailerLoad()
  }

  /** A mesh of the parts listed (each its own matrix), merged. */
  private build(list: [string, GFX.Matrix4][]): GFX.BufferGeometry | null {
    if (!this.parts || !list.length) return null
    const geos = list.filter(([n]) => this.parts![n]).map(([n, m]) => this.parts![n].clone().applyMatrix4(m))
    return geos.length ? GFX.mergeGeometries(geos) : null
  }

  private meshAt(geo: GFX.BufferGeometry, x: number, y: number, z: number): GFX.Mesh {
    const mesh = new GFX.Mesh(geo, this.mat!)
    mesh.position.set(x, y, z)
    this.group.add(mesh)
    return mesh
  }

  // ================================================================================================ the world's state
  /** The session's world drawn on this world (its map) — not on another (the desert across the crossing). */
  private here(): GatherWorld | null {
    const w = this.world()
    return w.id === this.session.world.map ? w : null
  }

  /** Felled trees hidden and stumped (once per world entered: they come in the welcome, and as they're cut). */
  private applyStumps(): void {
    const w = this.here()
    const id = w && this.parts ? w.id : ''
    if (id === this.appliedWorld) return
    this.appliedWorld = id
    if (!w || !this.parts) return
    for (const [i] of this.session.stumps) { w.trees.fell(i); this.physics.dropTrunk(i); this.stump(i) }
  }

  private treeCut(i: number, x: number, z: number, by: number): void {
    const w = this.here()
    if (!w) return
    this.swings.delete(i)
    // (away from whoever cut it: ours here, theirs from where they stand now)
    let fx = x - this.hero.pos.x, fz = z - this.hero.pos.z
    if (by !== this.session.me.sid) {
      const p = this.session.remotes.get(by)?.tracks.get(0)?.last?.p
      if (p) { fx = x - p[0]; fz = z - p[2] } else { const a = (i * 2.399) % 6.283; fx = Math.cos(a); fz = Math.sin(a) }
    }
    if (Math.hypot(fx, fz) < 0.1) { fx = 1; fz = 0 }
    // the logs it makes wait for it to land
    const zone = { x, z }
    this.falling.push(zone)
    for (const d of this.session.drops.values()) if (Math.hypot(d.x - x, d.z - z) < 1) this.hide(d.id)
    w.trees.fall(i, fx, fz, () => {
      this.falling.splice(this.falling.indexOf(zone), 1)
      for (const id of [...this.held]) {
        const d = this.session.drops.get(id)
        if (d && Math.hypot(d.x - x, d.z - z) >= 1) continue
        this.held.delete(id)
        const p = this.piles.get(id)
        if (p) p.mesh.visible = true
        else if (d) this.pile(d)
      }
    })
    this.physics.dropTrunk(i)
    this.stump(i)
  }

  private treeBack(i: number): void {
    const w = this.here()
    if (!w) return
    w.trees.restore(i)
    this.physics.trunksDirty()
    const s = this.stumps.get(i)
    if (s) { this.group.remove(s); s.geometry.dispose(); this.stumps.delete(i) }
    this.mark(`s:${i}`, 0, 0, 0)
  }

  /** The ground under something trodden (or free again: r 0). */
  private mark(id: string, x: number, z: number, r: number): void {
    const w = this.here()
    if (!w) return
    w.rocks.mark(id, x, z, r)
    this.grassDirty = true
  }

  private hide(id: string): void {
    this.held.add(id)
    const p = this.piles.get(id)
    if (p) p.mesh.visible = false
  }

  /** A stump where tree i stood, as thick as its trunk, turned its own way. */
  private stump(i: number): void {
    const w = this.here()
    if (!w || !this.parts || this.stumps.has(i)) return
    const t = w.trees.treeAt(i)
    const r = Math.max(0.16, Math.min(0.45, 0.022 * t.h)), k = r / STUMP_R
    const geo = this.build([['stump', new GFX.Matrix4().makeRotationY((i * 2.399) % 6.283).multiply(new GFX.Matrix4().makeScale(k, k * (0.8 + 0.4 * ((i * 0.618) % 1)), k))]])
    if (!geo) return
    this.stumps.set(i, this.meshAt(geo, t.x, w.map.height(t.x, t.z) - 0.04, t.z))
    this.mark(`s:${i}`, t.x, t.z, 0.6)
  }

  // ================================================================================================ piles and stockpiles
  private pile(d: Loose): void {
    const w = this.here()
    if (!w || !this.parts) return
    if (this.falling.some((f) => Math.hypot(d.x - f.x, d.z - f.z) < 1)) this.held.add(d.id)
    const key = `${d.mat}:${d.qty}`
    const old = this.piles.get(d.id)
    if (old?.key === key) return
    if (old) { this.group.remove(old.mesh); old.mesh.geometry.dispose(); this.piles.delete(d.id) }
    const s = hash(d.id)
    const g = (x: number, z: number) => w.map.height(d.x + x, d.z + z) - w.map.height(d.x, d.z)
    const list = d.mat === 'wood' ? logStack(Math.min(d.qty, 12), 4, (s % 628) / 100, g, s)
      : d.mat === 'stone' ? stoneHeap(Math.min(d.qty, 16), g, s) : scrapHeap(Math.min(d.qty, 12), g, s)
    const geo = this.build(list)
    if (!geo) return
    const mesh = this.meshAt(geo, d.x, w.map.height(d.x, d.z), d.z)
    mesh.visible = !this.held.has(d.id)
    this.piles.set(d.id, { mesh, key })
    if (!old) this.mark(`d:${d.id}`, d.x, d.z, d.mat === 'wood' ? 1.1 : 0.7)
  }

  private pileGone(id: string): void {
    const p = this.piles.get(id)
    if (p) { this.group.remove(p.mesh); p.mesh.geometry.dispose(); this.piles.delete(id) }
    this.held.delete(id)
    this.mark(`d:${id}`, 0, 0, 0)
  }

  /** Where claim c's stockpile stands. */
  private stockSpot(c: Claim): [number, number] {
    const w = this.here()
    if (!w) return [c.x, c.z]
    return stockSpotOf(c, w.map)
  }

  private stockpile(id: string): void {
    const w = this.here()
    const c = this.session.claims.get(id)
    if (!w || !c || !this.parts) return
    const s = c.stock, key = `${s.wood}:${s.stone}:${s.metal}`
    const old = this.stocks.get(id)
    if (old?.key === key) return
    if (old) { this.group.remove(old.mesh); old.mesh.geometry.dispose(); this.stocks.delete(id) }
    if (!s.wood && !s.stone && !s.metal) { this.mark(`c:${id}`, 0, 0, 0); return }
    const [x, z] = this.stockSpot(c)
    const y = w.map.height(x, z)
    const g = (u: number, v: number) => w.map.height(x + u, z + v) - y
    const seed = hash(id)
    // the logs stacked between two pairs of stakes; the stone heaped in front, the scrap beside
    const list: [string, GFX.Matrix4][] = []
    if (s.wood) {
      const n = Math.min(s.wood, 60), per = 6
      list.push(...logStack(n, per, 0, g, seed))
      const rows = Math.min(per, Math.ceil(n / per)), width = per * LOG_R * 2.05 * Math.ceil(n / ((per * (per + 1)) / 2))
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const px = sx * (width / 2 + 0.08), pz = sz * 0.55
        list.push(['stake', new GFX.Matrix4().makeTranslation(px, g(px, pz) - 0.05, pz).multiply(new GFX.Matrix4().makeScale(1, 0.6 + rows * 0.12, 1))])
      }
    }
    if (s.stone) list.push(...stoneHeap(Math.min(s.stone, 60), g, seed, 0, 1.9))
    if (s.metal) list.push(...scrapHeap(Math.min(s.metal, 30), g, seed, -2.1, 0.6))
    const geo = this.build(list)
    if (!geo) return
    this.stocks.set(id, { mesh: this.meshAt(geo, x, y, z), key })
    if (!old) this.mark(`c:${id}`, x, z + 0.6, 2.6)
  }

  private stockGone(id: string): void {
    const o = this.stocks.get(id)
    if (o) { this.group.remove(o.mesh); o.mesh.geometry.dispose(); this.stocks.delete(id) }
    this.mark(`c:${id}`, 0, 0, 0)
  }

  // ================================================================================================ his hands
  private hands(): void {
    const c = this.session.inv.carry, n = c.wood + c.stone + c.metal
    this.hero.holding = n > 0
    const key = `${c.wood}:${c.stone}:${c.metal}`
    if (key !== this.carriedKey && this.parts) {
      this.carriedKey = key
      if (this.carried) { this.group.remove(this.carried); this.carried.geometry.dispose(); this.carried = null }
      if (n > 0) {
        // in his arms, across them: the logs (shorter lengths — split for carrying) along his forearms' line, the
        // stones and the scrap on top
        const list: [string, GFX.Matrix4][] = []
        for (let k = 0; k < c.wood; k++) {
          const y = 0.03 + Math.floor(k / 2) * 0.13, zz = (k % 2 - 0.5) * 0.15
          list.push([k % 2 ? 'log_b' : 'log_a', new GFX.Matrix4().makeTranslation(0, y, zz).multiply(new GFX.Matrix4().makeRotationX(k * 1.3)).multiply(new GFX.Matrix4().makeScale(0.62, 0.55, 0.55))])
        }
        const base = c.wood ? 0.1 + Math.ceil(c.wood / 2) * 0.13 : 0
        for (let k = 0; k < c.stone; k++) list.push([`stone_${'abc'[k % 3]}`, new GFX.Matrix4().makeTranslation((k - (c.stone - 1) / 2) * 0.2, base, 0.02 * (k % 2)).multiply(new GFX.Matrix4().makeRotationY(k * 1.7))])
        for (let k = 0; k < c.metal; k++) list.push([k % 2 ? 'scrap_pipe' : 'scrap_sheet', new GFX.Matrix4().makeTranslation((k - (c.metal - 1) / 2) * 0.12, base + 0.02, 0).multiply(new GFX.Matrix4().makeScale(0.6, 0.6, 0.6))])
        const geo = this.build(list)
        if (geo) {
          this.carried = new GFX.Mesh(geo, this.mat!)
          this.carried.frustumCulled = false
          this.carried.matrixAutoUpdate = false
          this.group.add(this.carried)
        }
      }
    }
    if (key !== this.hudKey) {
      this.hudKey = key
      const parts = (['wood', 'stone', 'metal'] as Mat[]).filter((m) => c[m] > 0).map((m) => `<span>${c[m]} ${m}</span>`)
      this.hud.innerHTML = n > 0 ? `<b>HANDS</b>${parts.join('')}<small>${n}/${CARRY_CAP}</small>` : ''
      this.hud.classList.toggle('on', n > 0)
    }
  }

  /** What's in the trailer, drawn on its bed (its model space: the bed along z, the floor at TRAILER.floor) and weighed. */
  private loadKey = ''
  private trailerLoad(): void {
    const tr = this.trailer(), t = this.session.inv.trailer
    if (!tr || !tr.model.ready || !this.parts) return
    const key = `${t.wood}:${t.stone}:${t.metal}`
    if (key === this.loadKey) return
    this.loadKey = key
    tr.setLoadMass(t.wood * 30 + t.stone * 25 + t.metal * 15)
    const list: [string, GFX.Matrix4][] = [], r = rnd(91), y0 = TRAILER.floor + 0.03
    // the logs along the bed, six to a layer, each layer between the last's
    const LR = LOG_R * 0.8, per = 6
    for (let k = 0; k < t.wood; k++) {
      const layer = Math.floor(k / per), j = k % per, n = Math.min(per - (layer % 2), per)
      const x = (j - (n - 1) / 2) * LR * 2.05 + (layer % 2 ? LR : 0), y = y0 + LR + layer * LR * 1.75
      list.push([r() < 0.5 ? 'log_a' : 'log_b', new GFX.Matrix4().makeTranslation(x, y, (r() - 0.5) * 0.12).multiply(new GFX.Matrix4().makeRotationY(Math.PI / 2)).multiply(new GFX.Matrix4().makeRotationX(r() * 6.28)).multiply(new GFX.Matrix4().makeScale(1.04, 0.8, 0.8))])
    }
    const top = t.wood ? y0 + Math.ceil(t.wood / per) * LR * 1.75 + LR * 0.4 : y0
    // the stones heaped toward the tailgate, the scrap toward the front
    for (let k = 0; k < t.stone; k++) {
      const a = k * 2.399, rr = 0.42 * Math.sqrt((k + 0.5) / Math.max(1, t.stone))
      list.push([`stone_${'abc'[k % 3]}`, new GFX.Matrix4().makeTranslation(Math.cos(a) * rr, top + (1 - rr / 0.45) * 0.12, 0.45 + Math.sin(a) * rr * 0.9).multiply(new GFX.Matrix4().makeRotationY(r() * 6.28))])
    }
    for (let k = 0; k < t.metal; k++) {
      list.push([k % 3 === 2 ? 'scrap_pipe' : 'scrap_sheet', new GFX.Matrix4().makeTranslation((r() - 0.5) * 0.8, top + 0.02 * k, -0.55 + (r() - 0.5) * 0.4).multiply(new GFX.Matrix4().makeRotationY(r() * 6.28))])
    }
    tr.model.setLoad(this.build(list))
  }

  private tool(name: 'axe' | 'pick'): GFX.Mesh | null {
    const geo = this.build([[name, new GFX.Matrix4()]])
    if (!geo) return null
    const m = new GFX.Mesh(geo, this.mat!)
    m.frustumCulled = false
    m.matrixAutoUpdate = false
    m.visible = false
    this.group.add(m)
    return m
  }

  /**
   * The tool in his right hand: its handle (the model's +y, from its grip end) through his fist — along the line from
   * the hand's middle finger knuckles across the palm (the hand bone's own x, by eye from the swings), its head up and
   * forward of the fist, the bit (the model's +x) facing where he strikes.
   */
  private inHand(mesh: GFX.Mesh): void {
    if (!this.hero.boneWorld('RightHand', this.m)) { mesh.visible = false; return }
    this.m2.makeRotationZ(Math.PI / 2)
    this.m2.premultiply(new GFX.Matrix4().makeRotationX(Math.PI))
    this.m2.setPosition(0.0, 0.085, 0.0)
    // (the grip a hand's breadth from the knob: the handle slid through the fist)
    this.m2.multiply(new GFX.Matrix4().makeTranslation(0, -0.1, 0))
    mesh.matrixWorld.multiplyMatrices(this.m, this.m2)
    mesh.matrix.copy(mesh.matrixWorld)
    mesh.visible = true
  }

  // ================================================================================================ what E does
  private findTarget(): Target | null {
    const w = this.here()
    if (!w) return null
    const p = this.hero.pos, inv = this.session.inv.carry, held = inv.wood + inv.stone + inv.metal
    // THE TRAILER: its coupler (hitch / unhitch); by its bed — your load in, a load out; by your land — unload it
    const tr = this.trailer(), T = this.session.inv.trailer, inT = T.wood + T.stone + T.metal
    let bedD = Infinity
    const bed = new GFX.Vector3()
    if (tr?.model.ready) {
      const h = tr.footAction(p.x, p.z)
      if (h) return { kind: 'hitch', label: h.label, run: h.run }
      tr.bedWorld(bed)
      bedD = Math.hypot(bed.x - p.x, bed.z - p.z)
      if (held > 0 && bedD < 2.6 && inT < 40) return { kind: 'stowIn' }
      if (inT > 0) for (const c of this.session.claims.values()) {
        if (c.owner !== this.session.me.id) continue
        if (Math.hypot(bed.x - c.x, bed.z - c.z) < c.r + 8 && bedD < 4) return { kind: 'unload', claim: c }
      }
    }
    // a pile within reach (not one held back under a falling tree), if there's room
    let pile: Loose | null = null, pd = REACH_PILE
    for (const d of this.session.drops.values()) {
      if (this.held.has(d.id)) continue
      const q = Math.hypot(d.x - p.x, d.z - p.z)
      if (q < pd) { pd = q; pile = d }
    }
    // (the trailer close to it and room in it: straight into the trailer)
    if (pile && tr?.model.ready && inT < 40 && Math.hypot(bed.x - pile.x, bed.z - pile.z) < 8) return { kind: 'loadPile', drop: pile, room: 40 - inT }
    if (pile && held < CARRY_CAP) return { kind: 'pile', drop: pile }
    if (held === 0 && inT > 0 && bedD < 2.6) {
      const bag: Bag = { wood: 0, stone: 0, metal: 0 }
      let left = CARRY_CAP
      for (const m of ['wood', 'stone', 'metal'] as Mat[]) { const q = Math.min(left, T[m]); bag[m] = q; left -= q }
      return { kind: 'stowOut', bag }
    }
    // your own stockpile, with something to put in it
    if (held > 0) for (const c of this.session.claims.values()) {
      if (c.owner !== this.session.me.id) continue
      const [x, z] = this.stockSpot(c)
      if (Math.hypot(x - p.x, z - p.z) < REACH_STOCK) return { kind: 'stock', claim: c }
    }
    // a tree, a boulder
    const ti = w.trees.nearestIndex(p.x, p.z, REACH_TREE + 0.5)
    if (ti >= 0) { const t = w.trees.treeAt(ti); if (Math.hypot(t.x - p.x, t.z - p.z) < REACH_TREE + 0.4) return { kind: 'tree', i: ti, x: t.x, z: t.z, h: t.h } }
    const r = w.rocks.nearestBoulder(p.x, p.z, REACH_ROCK)
    if (r) {
      const key = `rock:${r.i}`, size = Math.max(2, Math.min(12, Math.round(r.rock.s * 4)))
      return { kind: 'rock', key, x: r.rock.x, z: r.rock.z, size, left: this.session.nodes.get(key) ?? size }
    }
    return null
  }

  private label(t: Target | null): string | null {
    if (!t) return null
    const inv = this.session.inv.carry, held = inv.wood + inv.stone + inv.metal
    const T = this.session.inv.trailer
    switch (t.kind) {
      case 'hitch': return t.label
      case 'loadPile': return `Load ${Math.min(t.drop.qty, t.room)} ${t.drop.mat} into the trailer`
      case 'stowIn': return `Put ${bagText(inv)} in the trailer`
      case 'stowOut': return `Take ${bagText(t.bag)} from the trailer`
      case 'unload': return `Unload the trailer (${bagText(T)}) into your stockpile`
      case 'pile': return `Pick up ${Math.min(t.drop.qty, CARRY_CAP - held)} ${t.drop.mat}`
      case 'stock': return `Stock ${bagText(inv)}`
      case 'tree': { const n = this.swings.get(t.i) ?? 0; return n ? `Chop (${SWINGS - n} more)` : 'Chop' }
      case 'rock': return t.left > 0 ? (held >= CARRY_CAP ? 'Hands full' : `Mine (${t.left} left)`) : 'Worked out'
    }
  }

  /** E: what's nearest. */
  act(): void {
    if (this.busy || !this.canAct() || this.hero.state !== 'move') return
    const t = this.findTarget()
    if (!t) return
    const S = this.session
    const face = (x: number, z: number) => { this.hero.heading = Math.atan2(-(x - this.hero.pos.x), -(z - this.hero.pos.z)) }
    const fail = (e: Error) => this.toast(e.message, 2600)
    switch (t.kind) {
      case 'hitch': t.run(); break
      case 'loadPile': {
        face(t.drop.x, t.drop.z)
        this.play('pickup', 0.42, null, () => { S.ask({ t: 'pick', drop: t.drop.id, to: 'trailer' }).catch(fail) })
        break
      }
      case 'stowIn': {
        const bag = { ...S.inv.carry }
        S.ask({ t: 'stow', from: 'carry', to: 'trailer', bag }).catch(fail)
        break
      }
      case 'stowOut': {
        this.play('pickup', 0.42, null, () => { S.ask({ t: 'stow', from: 'trailer', to: 'carry', bag: t.bag }).catch(fail) })
        break
      }
      case 'unload': {
        const bag = { ...S.inv.trailer }
        S.ask({ t: 'deposit', claim: t.claim.id, from: 'trailer', bag }).then(() => this.toast(`Unloaded ${bagText(bag)} into your stockpile`, 2600)).catch(fail)
        break
      }
      case 'pile': {
        face(t.drop.x, t.drop.z)
        this.play('pickup', 0.42, null, () => { S.ask({ t: 'pick', drop: t.drop.id, to: 'carry' }).catch(fail) })
        break
      }
      case 'stock': {
        const bag = { ...S.inv.carry }
        S.ask({ t: 'deposit', claim: t.claim.id, from: 'carry', bag }).then(() => this.toast(`Stocked ${bagText(bag)}`, 2200)).catch(fail)
        break
      }
      case 'tree': {
        face(t.x, t.z)
        this.play('chop', 0.52, this.axe, () => {
          const n = (this.swings.get(t.i) ?? 0) + 1
          this.swings.set(t.i, n)
          if (n >= SWINGS) { this.swings.delete(t.i); S.ask({ t: 'cut_tree', tree: t.i, x: t.x, z: t.z, h: t.h }).catch(fail) }
        })
        break
      }
      case 'rock': {
        if (t.left <= 0) { this.toast('Nothing left in this one — it comes back in a while', 2600); return }
        face(t.x, t.z)
        this.play('mine', 0.55, this.pick, () => { S.ask({ t: 'mine', node: t.key, x: t.x, z: t.z, size: t.size }).catch(fail) })
        break
      }
    }
  }

  /** H: put down what you carry (the largest share), at your feet, a step ahead. */
  putDown(): void {
    if (this.busy || this.hero.state !== 'move') return
    const c = this.session.inv.carry
    const mat = (['wood', 'stone', 'metal'] as Mat[]).sort((a, b) => c[b] - c[a])[0]
    if (!c[mat]) return
    const h = this.hero.heading, x = this.hero.pos.x - Math.sin(h) * 0.9, z = this.hero.pos.z - Math.cos(h) * 0.9
    const y = this.here()?.map.height(x, z) ?? this.hero.pos.y
    this.session.ask({ t: 'drop', mat, qty: c[mat], from: 'carry', x, y, z }).catch((e: Error) => this.toast(e.message, 2600))
  }

  /** THE BUILDER'S WORK (Build.ts — on foot, near enough to it): he turns to (x, z) and works — DIG (shaping the
   *  ground, a pond: the pick swung into it) or LAY (paving, a piece set down, a plant: he stoops and puts it there);
   *  `hit` at the blow. Not while he's busy, carrying or out of reach (then `hit` at once: the work's still done). */
  work(kind: 'dig' | 'lay', x: number, z: number, hit: () => void): void {
    const h = this.hero
    if (this.busy || h.state !== 'move' || !h.control || Math.hypot(x - h.pos.x, z - h.pos.z) > 16) { hit(); return }
    h.heading = Math.atan2(-(x - h.pos.x), -(z - h.pos.z))
    if (kind === 'dig') this.play('mine', 0.55, this.pick, hit)
    else this.play('pickup', 0.45, null, hit)
  }

  /** A worked clip: its blow at `at` (share of the clip), the tool in his hand meanwhile. */
  private play(clip: 'chop' | 'mine' | 'pickup', at: number, tool: GFX.Mesh | null, hit: () => void): void {
    const name = this.hero.has(clip) ? clip : 'pickup'
    const dur = this.hero.clipLength(name) || 1
    this.hero.act(name, 1, () => { if (this.busy) { if (this.busy.tool) this.busy.tool.visible = false; this.busy = null } })
    this.busy = { t: 0, hitAt: at * dur, hit, tool }
  }

  // ================================================================================================ per frame
  update(dt: number): void {
    this.applyStumps()
    if (this.grassDirty) { this.grassDirty = false; this.here()?.grass.refresh() }
    this.here()?.trees.updateFalls(dt)
    // the blow
    const b = this.busy
    if (b) {
      const t0 = b.t
      b.t += dt
      if (t0 < b.hitAt && b.t >= b.hitAt) b.hit()
      if (b.tool) this.inHand(b.tool)
      // (done once the blow's landed and he's free again — the clip cut short, a teleport, the car — or a safety's 8 s)
      if ((b.t > b.hitAt && this.hero.state === 'move') || b.t > 8) { if (b.tool) b.tool.visible = false; this.busy = null }
    }
    // his load, between his hands (the forearms' line)
    if (this.carried) {
      const vis = this.hero.visible && this.hero.state !== 'seated' && this.hero.holding
      this.carried.visible = vis && this.hero.boneWorld('LeftHand', this.m) && this.hero.boneWorld('RightHand', this.m2)
      if (this.carried.visible) {
        const L = this.v.setFromMatrixPosition(this.m), R = this.v2.setFromMatrixPosition(this.m2)
        const mid = L.clone().add(R).multiplyScalar(0.5)
        const ax = R.clone().sub(L); ax.y = 0
        if (ax.lengthSq() < 1e-4) ax.set(Math.cos(this.hero.heading), 0, -Math.sin(this.hero.heading))
        ax.normalize()
        const up = new GFX.Vector3(0, 1, 0), fw = new GFX.Vector3().crossVectors(ax, up).normalize()
        this.carried.matrixWorld.makeBasis(ax, up, fw).setPosition(mid.x, mid.y - 0.03, mid.z)
        this.carried.matrix.copy(this.carried.matrixWorld)
      }
    }
    // the prompt
    const target = this.parts && this.canAct() && !this.busy && this.hero.state === 'move' ? this.findTarget() : null
    const lab = this.label(target)
    const c = this.session.inv.carry
    this.prompt = lab ? ['E', lab] : c.wood + c.stone + c.metal > 0 && this.canAct() ? ['H', 'Put down'] : null
    const pillText = lab ?? ''
    if (this.pill.textContent !== pillText) this.pill.textContent = pillText
    this.pill.classList.toggle('on', !!lab)
  }

  dispose(): void {
    for (const f of this.off) f()
    this.hud.remove(); this.pill.remove()
    this.hero.holding = false
    for (const o of [...this.piles.values(), ...this.stocks.values()]) o.mesh.geometry.dispose()
    for (const m of this.stumps.values()) m.geometry.dispose()
    this.carried?.geometry.dispose()
    this.group.removeFromParent()
  }
}

// ================================================================================================ the arrangements
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
function rnd(seed: number): () => number {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
}
const bagText = (b: Bag): string => (['wood', 'stone', 'metal'] as Mat[]).filter((m) => b[m] > 0).map((m) => `${b[m]} ${m}`).join(', ')

/**
 * N logs in PYRAMIDS (`per` on the bottom course, per − 1 on the next … ), each the next one along, the whole turned
 * `rot`; each log its own way round its axis, a little longer or shorter, its ends not quite in line.
 */
function logStack(n: number, per: number, rot: number, g: (x: number, z: number) => number, seed: number): [string, GFX.Matrix4][] {
  const r = rnd(seed), out: [string, GFX.Matrix4][] = []
  const full = (per * (per + 1)) / 2, pitch = per * LOG_R * 2.05 + 0.25
  const turn = new GFX.Matrix4().makeRotationY(rot + Math.PI / 2) // (the model lies along x: its length across the stack)
  let k = 0, row = 0, pyr = 0
  while (k < n) {
    const inRow = Math.min(per - row, n - k)
    for (let j = 0; j < inRow; j++, k++) {
      const off = (j - (per - row - 1) / 2) * LOG_R * 2.05 + pyr * pitch
      const lx = Math.cos(rot) * off, lz = -Math.sin(rot) * off
      const y = g(lx, lz) + LOG_R * 0.92 + row * LOG_R * 1.74
      const m = new GFX.Matrix4().makeTranslation(lx, y, lz).multiply(turn)
        .multiply(new GFX.Matrix4().makeTranslation((r() - 0.5) * 0.12, 0, 0))
        .multiply(new GFX.Matrix4().makeRotationX(r() * 6.283))
        .multiply(new GFX.Matrix4().makeScale(0.92 + 0.16 * r(), 1, 1))
      out.push([r() < 0.5 ? 'log_a' : 'log_b', m])
    }
    row++
    if (row >= per || k % full === 0) { row = 0; pyr++ }
  }
  return out
}
/** N stones heaped (a cone), centred (cx, cz). */
function stoneHeap(n: number, g: (x: number, z: number) => number, seed: number, cx = 0, cz = 0): [string, GFX.Matrix4][] {
  const r = rnd(seed + 1), out: [string, GFX.Matrix4][] = []
  const R = 0.22 + Math.sqrt(n) * 0.14
  for (let k = 0; k < n; k++) {
    const a = k * 2.399, rr = R * Math.sqrt((k + 0.5) / n), x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr
    const s = 0.85 + 0.45 * r(), y = g(x, z) - 0.02 + (1 - rr / R) * R * 0.5
    out.push([`stone_${'abc'[k % 3]}`, new GFX.Matrix4().makeTranslation(x, y, z).multiply(new GFX.Matrix4().makeRotationY(r() * 6.283)).multiply(new GFX.Matrix4().makeRotationX((r() - 0.5) * 0.5)).multiply(new GFX.Matrix4().makeScale(s, s, s))])
  }
  return out
}
/** N pieces of scrap: rusted sheet and pipe, centred (cx, cz). */
function scrapHeap(n: number, g: (x: number, z: number) => number, seed: number, cx = 0, cz = 0): [string, GFX.Matrix4][] {
  const r = rnd(seed + 2), out: [string, GFX.Matrix4][] = []
  for (let k = 0; k < n; k++) {
    const a = k * 2.399, rr = 0.12 + Math.sqrt(k) * 0.16, x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr
    const y = g(x, z) + (k % 3) * 0.03
    out.push([k % 3 === 2 ? 'scrap_pipe' : 'scrap_sheet', new GFX.Matrix4().makeTranslation(x, y, z).multiply(new GFX.Matrix4().makeRotationY(r() * 6.283)).multiply(new GFX.Matrix4().makeRotationZ((r() - 0.5) * 0.3))])
  }
  return out
}
