import { Session } from '../net/Session'
import { botAccount, getCatalog, joinWorld, type PieceInfo } from '../net/api'
import { type Ent, FLAG_TELEPORT, Kind, Slot } from '../net/pose'
import type { Bag, Claim, Mat } from '../net/wire'
import { placementFor } from './Builder'
import { flagSpot } from './Claims'
import { stockSpotOf } from './Gather'
import { deckY, type Bridge, type MapData } from './MapData'
import type { Rocks } from './Rocks'
import type { Trees } from './Trees'

/**
 * THE BOT (2026-11-10, the user: "in multiplayer it will play around automatically … travel around, gather things and
 * build his own place, only in the valley … once he completes building something he will stop and destroy it and go
 * to another place and do other things, like plants … in settings I can turn it on and off"): a second co-op player run
 * from this tab — its own account ("Asha · bot", net/api.ts botAccount), its own WebSocket into the same world — that
 * plays by the same rules as anyone: it WALKS (its pose 20 a second, on foot), and asks the server exactly what a
 * player's keys would (cut_tree, mine, pick, deposit, claim, place, pave, pond, remove, unclaim). So everyone sees him as
 * a player: on the map and the minimap, his name tag, trees falling where he chops, his flag, his stockpile growing,
 * every piece dropping in. Nothing on the server knows he is a bot.
 *
 *   THE LOOP   a PLACE (flat dry ground in the valley, off the tracks, the named places and anyone's land, woods and
 *              boulders near) → walk there → plant his flag → a PROJECT (the stone cottage, the log cabin with its porch,
 *              the garden — hedges, flower beds, vegetables, saplings, a pond, a gravel path — the camp), piece by piece
 *              with the builder's own snapping (Builder.ts placementFor); before each piece, what it costs GATHERED
 *              (chop a tree → pick up its logs, 4 at a time; mine a boulder a stone a blow; carry them to the
 *              stockpile) → done: he looks it over, says so in the chat, takes it down piece by piece (half back),
 *              gives the land up and walks on to the next place and the next project.
 *   METAL      the game can't gather it yet (no scrap on the client), so outside a creative world his projects use
 *              only wood and stone (a stone doorway in the log cabin; no lamp posts).
 *   WALKING    over the ground (MapData.height); round water and slopes steeper than ~40° (the way ahead tried at
 *              ±25°, ±50°… off the line); a river crossed on the nearest BRIDGE (its deck's height); stuck 8 s → a hop.
 *   OFF        (the setting, or leaving co-op): his pieces taken down and his land given up at once (remove and unclaim
 *              ask no distance), then he leaves. Left over from a closed tab: cleared the next time he comes.
 *   `speed`    (?botspeed= — the harness) everything that many times faster: his feet (≤ 90 m/s, the server's limit)
 *              and his pauses.
 */
export interface BotWorld { map: MapData; trees: Trees; rocks: Rocks }
export interface BotOpts {
  /** Our session: the world he joins (its code), our name for his. */
  owner: Session
  world: () => BotWorld | null
  /** Where we are: he turns up beside us. */
  near: () => { x: number; z: number }
  speed?: number
  /** The first project (its index — ?botfirst=, the harness); else one at random. */
  first?: number
  log?: (m: string) => void
}

const RUN = 5.2, WALK = 2.4
const CARRY = 4
const LAND_R = 16
const MATS: Mat[] = ['wood', 'stone', 'metal']
const C = 3 // (KIT.cell — the builder's grid)

class Stopped extends Error {}

/** One step of a project: a piece (where its cursor would be), a pond, or a paving stroke. */
type Step =
  | { piece: string; hx: number; hz: number; turn?: number }
  | { pond: [number, number, number, number] }
  | { pave: 'stone' | 'gravel' | 'planks' | 'dirt'; x: number; z: number; r: number }

interface Project { name: string; cells: [number, number][]; /** its cells hold foundations: ground flat enough */ flat: boolean; steps: (ax: number, az: number, creative: boolean) => Step[] }

/** A cell's middle (a, the anchor cell's middle) and the cursor for one of its edges ('n' −z, 's' +z, 'e' +x, 'w' −x). */
const edge = (ax: number, az: number, i: number, j: number, side: 'n' | 's' | 'e' | 'w') => {
  const cx = ax + i * C, cz = az + j * C, d = C * 0.4
  return side === 'n' ? { hx: cx, hz: cz - d } : side === 's' ? { hx: cx, hz: cz + d } : side === 'e' ? { hx: cx + d, hz: cz } : { hx: cx - d, hz: cz }
}
const cell = (ax: number, az: number, i: number, j: number) => ({ hx: ax + i * C, hz: az + j * C })

const PROJECTS: Project[] = [
  {
    name: 'a stone cottage',
    cells: [[0, 0]],
    flat: true,
    steps: (ax, az) => [
      { piece: 'foundation_stone', ...cell(ax, az, 0, 0) },
      { piece: 'wall_stone_door', ...edge(ax, az, 0, 0, 's') },
      { piece: 'wall_stone_window', ...edge(ax, az, 0, 0, 'e') },
      { piece: 'wall_stone_window', ...edge(ax, az, 0, 0, 'w') },
      { piece: 'wall_stone', ...edge(ax, az, 0, 0, 'n') },
      { piece: 'roof_shingle', ...cell(ax, az, 0, 0) },
      { piece: 'campfire', hx: ax + 0.5, hz: az + 5.5 },
      { piece: 'bench', hx: ax + 2.75, hz: az + 5.5, turn: 6 },
      { piece: 'plant_flowers', hx: ax - 2.5, hz: az + 3.5 },
    ],
  },
  {
    name: 'a log cabin',
    cells: [[0, 0], [1, 0]],
    flat: true,
    steps: (ax, az, creative) => [
      { piece: 'foundation_wood', ...cell(ax, az, 0, 0) },
      { piece: 'foundation_wood', ...cell(ax, az, 1, 0) },
      { piece: creative ? 'wall_log_door' : 'wall_stone_door', ...edge(ax, az, 0, 0, 's') },
      { piece: creative ? 'wall_log_window' : 'wall_log', ...edge(ax, az, 1, 0, 's') },
      { piece: 'wall_log', ...edge(ax, az, 0, 0, 'w') },
      { piece: 'wall_log', ...edge(ax, az, 1, 0, 'e') },
      { piece: creative ? 'wall_log_window' : 'wall_log', ...edge(ax, az, 0, 0, 'n') },
      { piece: 'wall_log', ...edge(ax, az, 1, 0, 'n') },
      { piece: 'roof_shingle', ...cell(ax, az, 0, 0) },
      { piece: 'roof_shingle', ...cell(ax, az, 1, 0) },
      // the porch against the door wall: the cursor just outside it
      { piece: 'porch_deck', hx: ax, hz: az + C / 2 + 1.4 },
      { piece: 'porch_roof', hx: ax, hz: az + C / 2 + 1.4 },
      { piece: 'woodpile', hx: ax + C + 3.2, hz: az + 0.5, turn: 6 },
      ...(creative ? [{ piece: 'lamp_post', hx: ax + 2.2, hz: az + 4.5 }] : []),
    ],
  },
  {
    name: 'a garden',
    cells: [[0, 0], [1, 0], [0, 1], [1, 1]],
    flat: false,
    steps: (ax, az) => [
      // a hedge round two cells by two, a gap on the south side to walk in
      { piece: 'plant_hedge', ...edge(ax, az, 0, 0, 'n') },
      { piece: 'plant_hedge', ...edge(ax, az, 1, 0, 'n') },
      { piece: 'plant_hedge', ...edge(ax, az, 1, 0, 'e') },
      { piece: 'plant_hedge', ...edge(ax, az, 1, 1, 'e') },
      { piece: 'plant_hedge', ...edge(ax, az, 1, 1, 's') },
      { piece: 'plant_hedge', ...edge(ax, az, 0, 1, 'w') },
      { piece: 'plant_hedge', ...edge(ax, az, 0, 0, 'w') },
      { piece: 'plant_flowers', ...cell(ax, az, 0, 0) },
      { piece: 'plant_veg', ...cell(ax, az, 1, 0) },
      { piece: 'plant_veg', ...cell(ax, az, 0, 1) },
      { piece: 'plant_flowers', ...cell(ax, az, 1, 1) },
      { piece: 'plant_pine', hx: ax - 3.5, hz: az - 3.5 },
      { piece: 'plant_birch', hx: ax + C + 3.5, hz: az - 3.5 },
      { piece: 'plant_pine', hx: ax + C + 3.5, hz: az + C + 3.5 },
      { piece: 'plant_birch', hx: ax - 3.5, hz: az + C + 1 },
      // a gravel path out of the gap, and a little pond at its end
      { pave: 'gravel', x: ax, z: az + C + 2.2, r: 1.1 },
      { pave: 'gravel', x: ax, z: az + C + 4.2, r: 1.1 },
      { pave: 'gravel', x: ax + 0.4, z: az + C + 6.2, r: 1.1 },
      { pond: [ax + 1.2, az + C + 10, 3.4, 1.2] },
    ],
  },
  {
    name: 'a camp',
    cells: [[0, 0], [1, 0], [-1, 0], [0, -1]],
    flat: false,
    steps: (ax, az, creative) => [
      { piece: 'campfire', hx: ax, hz: az },
      { piece: 'bench', hx: ax - 2.4, hz: az, turn: 6 },
      { piece: 'bench', hx: ax + 2.4, hz: az, turn: 18 },
      { piece: 'table', hx: ax, hz: az - 3.2 },
      { piece: 'woodpile', hx: ax - 3.5, hz: az - 3.4 },
      { piece: 'fence_rail', ...edge(ax, az, -1, -1, 'n') },
      { piece: 'fence_rail', ...edge(ax, az, 0, -1, 'n') },
      { piece: 'fence_rail', ...edge(ax, az, 1, -1, 'n') },
      { piece: 'wall_drystone', ...edge(ax, az, 1, -1, 'e') },
      { piece: 'wall_drystone', ...edge(ax, az, 1, 0, 'e') },
      { piece: 'plant_pine', hx: ax - 5, hz: az + 3.5 },
      { piece: 'plant_birch', hx: ax + 5.5, hz: az + 3.8 },
      ...(creative ? [{ piece: 'lamp_post', hx: ax + 1.8, hz: az + 2.6 }] : []),
    ],
  },
]

export class Bot {
  status = 'Joining…'
  private S: Session | null = null
  private readonly el: HTMLDivElement
  private readonly speed: number
  private readonly pos = { x: 0, y: 0, z: 0 }
  private heading = 0
  private stopped = false
  private timer = 0
  private catalog = new Map<string, PieceInfo>()
  private projectIx = Math.floor(Math.random() * PROJECTS.length)
  private sinceSend = 0
  private moved = false
  private teleport = true
  /** The walk under way: its waypoints (deck: on a bridge — no steering off it; wade: through the water), where it
   *  ends, and its promise. */
  private walk: { route: { x: number; z: number; deck: Bridge | null; wade: boolean }[]; within: number; ok: () => void; fail: (e: Error) => void; best: number; since: number } | null = null
  private sleeps = new Set<() => void>()
  /** Trees he couldn't cut (someone was quicker, …): not tried again. */
  private readonly skipTrees = new Set<number>()

  constructor(private readonly o: BotOpts) {
    this.speed = Math.max(1, o.speed ?? 1)
    if (o.first !== undefined && o.first >= 0) this.projectIx = o.first
    this.el = document.createElement('div')
    this.el.className = 'oth-bot on'
    document.body.appendChild(this.el)
    this.say('Joining…')
    void this.run().catch((e) => {
      if (this.stopped) return
      // (the world went from under him, or an error: his things cleared, his line left saying why)
      if (!(e instanceof Stopped)) { this.say(`Stopped: ${msg(e)}`); this.o.log?.(String(e)) } else this.say('Stopped')
      void this.stop(true)
    })
  }

  /** (the harness) his session, where he is. */
  get session(): Session | null { return this.S }
  get at(): { x: number; z: number } { return { x: this.pos.x, z: this.pos.z } }
  /** (the harness) the project under way. */
  project_: string = ''

  /** Off: his things taken down, his land given up, gone. */
  async stop(keepLine = false): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    clearInterval(this.timer)
    this.walk?.fail(new Stopped())
    this.walk = null
    for (const f of this.sleeps) f()
    this.sleeps.clear()
    const S = this.S
    if (S && !S.closed) {
      await this.clearOwn(false).catch(() => {})
      S.close()
    }
    if (!keepLine) this.el.remove()
  }

  // ------------------------------------------------------------------------------------------------------------------
  // the loop

  private async run(): Promise<void> {
    const owner = this.o.owner
    if (owner.world.map !== 'valley') { this.say('Plays only in the valley'); return }
    const acct = await botAccount(owner.me.name)
    if (this.stopped) return
    await joinWorld(acct, owner.world.code)
    const S = (this.S = await Session.connect(acct, owner.world.id))
    if (this.stopped) { S.close(); return }
    S.onClose = (why) => { this.say(`Disconnected: ${why}`); this.stopped = true; clearInterval(this.timer); this.walk?.fail(new Stopped()); for (const f of this.sleeps) f() }
    try { for (const p of (await getCatalog()).pieces) this.catalog.set(p.kind, p) } catch { /* (costs unknown: he'll learn from the server's answers) */ }
    // he turns up beside us
    const w = this.need(), n = this.o.near(), a = Math.random() * Math.PI * 2
    this.pos.x = n.x + Math.cos(a) * 7; this.pos.z = n.z + Math.sin(a) * 7
    if (w.map.waterAt(this.pos.x, this.pos.z) !== null) { this.pos.x = n.x; this.pos.z = n.z }
    this.pos.y = w.map.height(this.pos.x, this.pos.z)
    this.heading = Math.atan2(-(n.x - this.pos.x), -(n.z - this.pos.z))
    this.teleport = true
    this.timer = window.setInterval(() => this.tick(0.05), 50)
    this.chat(`Hi — I'm ${owner.me.name}'s bot. I'll gather, build and move on round the valley.`)
    // (left over from a tab closed mid-build)
    await this.clearOwn(true)
    let first = true
    for (;;) {
      this.check()
      const proj = PROJECTS[this.projectIx++ % PROJECTS.length]
      await this.project(proj, first)
      first = false
    }
  }

  private async project(proj: Project, first: boolean): Promise<void> {
    const S = this.S!, creative = S.world.rules.creative
    this.project_ = proj.name
    this.say(`Looking for a place for ${proj.name}`)
    const spot = this.findSpot(proj, first)
    if (!spot) { this.say('No room here — looking further'); await this.sleep(5000); return }
    this.say(`Walking to a place for ${proj.name}`)
    await this.walkTo(spot.x, spot.z, 3)
    this.say('Planting his flag')
    await this.pause(1500)
    try { await S.ask({ t: 'claim', x: spot.x, z: spot.z, r: LAND_R }) } catch (e) { this.say(`Couldn't claim: ${msg(e)}`); await this.sleep(3000); return }
    const c = this.mine()
    if (!c) return
    // the layout: the anchor cell where every cell piece fits (ground flat enough, clear of the flag)
    const anchor = this.anchorFor(proj, c)
    if (!anchor) { this.say('Too steep to build here — moving on'); await this.leave(c); return }
    const steps = proj.steps(anchor.x, anchor.z, creative).filter((s) => !('piece' in s) || this.affordable(s.piece, creative))
    this.chat(`Building ${proj.name} here.`)
    let done = 0
    for (const st of steps) {
      this.check()
      await this.doStep(c.id, st, proj.name, () => `${proj.name} · ${done}/${steps.length}`).then((ok) => { if (ok) done++ })
    }
    // done: a look round it, then down it comes
    this.chat(`Finished ${proj.name} (${done} pieces). Taking it down and moving on.`)
    this.say(`Finished ${proj.name} — looking it over`)
    const cc = this.mine() ?? c
    for (let k = 0; k < 3; k++) {
      const a = Math.random() * Math.PI * 2
      await this.walkTo(cc.x + Math.cos(a) * 9, cc.z + Math.sin(a) * 9, 1.5).catch((e) => { if (e instanceof Stopped) throw e })
      this.face(cc.x, cc.z)
      await this.pause(4000)
    }
    await this.leave(cc)
  }

  /** One step: its cost gathered first, then set down (a piece), dug (a pond) or laid (paving). True: done. */
  private async doStep(claim: string, st: Step, what: string, line: () => string): Promise<boolean> {
    const S = this.S!
    for (let tries = 0; tries < 3; tries++) {
      this.check()
      const c = S.claims.get(claim)
      if (!c) return false
      if ('piece' in st) {
        const info = this.catalog.get(st.piece) ?? { kind: st.piece, cost: { wood: 0, stone: 0, metal: 0 } }
        await this.gatherFor(c, info.cost, line)
        const cNow = S.claims.get(claim)
        if (!cNow) return false
        const pl = placementFor(S, this.need().map, cNow, { kind: st.piece, cost: { wood: 0, stone: 0, metal: 0 } }, st.hx, st.hz, st.turn ?? 0)
        if (pl.why) { this.o.log?.(`bot: skip ${st.piece}: ${pl.why}`); return false }
        this.say(`Building ${what} · ${this.catalog.get(st.piece)?.name ?? st.piece}`)
        await this.walkTo(pl.x, pl.z, 3.2)
        this.face(pl.x, pl.z)
        await this.pause(1800)
        try { await S.ask({ t: 'place', kind: pl.kind, x: pl.x, y: pl.y, z: pl.z, rot: pl.rot, variant: 0 }); await this.pause(900); return true }
        catch (e) { if (!(await this.shortOf(c, msg(e), line))) { this.o.log?.(`bot: ${st.piece}: ${msg(e)}`); return false } }
      } else if ('pond' in st) {
        const [wx, wz, r, depth] = st.pond
        const spot = this.pondSpot(c, wx, wz, r)
        if (!spot) { this.o.log?.('bot: skip the pond: no room for it on his land'); return false }
        const { x, z } = spot
        this.say(`Digging a pond for ${what}`)
        await this.walkTo(x + r + 1, z, 2)
        this.face(x, z)
        await this.pause(2500)
        try { await S.ask({ t: 'pond', x, z, r, depth }); await this.pause(3000); return true } catch (e) { this.o.log?.(`bot: pond: ${msg(e)}`); return false }
      } else {
        if (Math.hypot(st.x - c.x, st.z - c.z) > c.r - st.r) { this.o.log?.('bot: skip a paving stroke: outside his land'); return false }
        this.say(`Laying a ${st.pave} path for ${what}`)
        await this.walkTo(st.x, st.z, 1.5)
        await this.pause(1500)
        try { await S.ask({ t: 'pave', mat: st.pave, x: st.x, z: st.z, r: st.r }); return true }
        catch (e) { if (!(await this.shortOf(c, msg(e), line))) { this.o.log?.(`bot: pave: ${msg(e)}`); return false } }
      }
    }
    return false
  }

  /** Where a pond of radius r goes: the spot wanted, pulled in toward the middle until it's inside the land, dry, and
   *  clear of his pieces, his flag and his stockpile (null: nowhere). */
  private pondSpot(c: Claim, wx: number, wz: number, r: number): { x: number; z: number } | null {
    const S = this.S!, m = this.need().map
    const [fx, fz] = flagSpot(c, m), [sx, sz] = stockSpotOf(c, m)
    const pieces = [...S.pieces.values()].filter((p) => p.claim === c.id)
    for (const side of [0, 0.6, -0.6, 1.2, -1.2, Math.PI]) {
      // (round the middle from the wanted bearing, then pulled in)
      const a = Math.atan2(wz - c.z, wx - c.x) + side, d0 = Math.hypot(wx - c.x, wz - c.z)
      for (let t = 0; t <= 1.001; t += 0.1) {
        const d = d0 * (1 - t), x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d
        if (Math.hypot(x - c.x, z - c.z) > c.r - r - 0.8 || m.waterAt(x, z) !== null) continue
        if (Math.hypot(x - fx, z - fz) < r + 2 || Math.hypot(x - sx, z - sz) < r + 2.5) continue
        if (pieces.some((p) => Math.hypot(p.x - x, p.z - z) < r + 1.4)) continue
        return { x, z }
      }
    }
    return null
  }

  /** The server said the stockpile is short ("you need 2 stone more…"): gather that, true; anything else, false. */
  private async shortOf(c: Claim, m: string, line: () => string): Promise<boolean> {
    const mm = /need (.+) more/.exec(m)
    if (!mm) return false
    const bag: Bag = { wood: 0, stone: 0, metal: 0 }
    for (const part of mm[1].split(',')) { const p = /(\d+)\s+(wood|stone|metal)/.exec(part); if (p) bag[p[2] as Mat] = Number(p[1]) }
    if (bag.metal && !this.S!.world.rules.creative) return false
    const cur = this.S!.claims.get(c.id)?.stock ?? c.stock
    await this.gatherFor(c, { wood: cur.wood + bag.wood, stone: cur.stone + bag.stone, metal: 0 }, line)
    return true
  }

  /** Not in a creative world: only what can be gathered (no metal yet). */
  private affordable(kind: string, creative: boolean): boolean {
    if (creative) return true
    const cost = this.catalog.get(kind)?.cost
    return !cost || cost.metal === 0
  }

  // ------------------------------------------------------------------------------------------------------------------
  // gathering

  /** Until claim c's stockpile covers `cost`: trips to the woods / the rocks and back. */
  private async gatherFor(c0: Claim, cost: Bag, line: () => string): Promise<void> {
    const S = this.S!
    if (S.world.rules.creative) return
    for (let trips = 0; trips < 40; trips++) {
      this.check()
      const c = S.claims.get(c0.id)
      if (!c) return
      const short = MATS.filter((m) => m !== 'metal' && c.stock[m] < cost[m])
      if (!short.length) return
      const mat = short[0]
      const want = cost[mat] - c.stock[mat]
      await this.trip(c, mat, () => `${line()} · ${mat} ${c.stock[mat]}/${cost[mat]}`, want)
    }
  }

  /** One trip: hands filled with `mat` (piles first, then a tree / a boulder), carried to the stockpile. */
  private async trip(c: Claim, mat: Mat, line: () => string, want: number): Promise<void> {
    const S = this.S!, w = this.need()
    const [sx, sz] = stockSpotOf(c, w.map)
    const held = () => S.inv.carry.wood + S.inv.carry.stone + S.inv.carry.metal
    let fails = 0
    // (hands always filled: what's over goes in the stockpile for the next pieces — no trips with one stone)
    void want
    while (held() < CARRY && fails < 4) {
      this.check()
      // a pile lying about (his own tree's logs, someone's left stockpile)
      const pile = this.nearestPile(mat, sx, sz, 90)
      if (pile) {
        this.say(`Picking up ${mat} · ${line()}`)
        await this.walkTo(pile.x, pile.z, 1.6)
        this.face(pile.x, pile.z)
        await this.pause(700)
        await S.ask({ t: 'pick', drop: pile.id, to: 'carry' }).catch(() => { fails++ })
        continue
      }
      if (mat === 'wood') {
        const t = this.pickTree(sx, sz)
        if (!t) { this.say('No trees near — the next place'); fails = 9; break }
        const tr = w.trees.treeAt(t)
        this.say(`Chopping a tree · ${line()}`)
        const a = Math.atan2(this.pos.z - tr.z, this.pos.x - tr.x)
        await this.walkTo(tr.x + Math.cos(a) * 1.8, tr.z + Math.sin(a) * 1.8, 0.6)
        this.face(tr.x, tr.z)
        for (let k = 0; k < 3; k++) await this.pause(850)
        try { await S.ask({ t: 'cut_tree', tree: t, x: tr.x, z: tr.z, h: tr.h }); await this.pause(2600) /* (it falls; its logs land) */ } catch { fails++; this.skipTrees.add(t) }
      } else {
        const b = this.pickBoulder(sx, sz)
        if (!b) { this.say('No rocks near — the next place'); fails = 9; break }
        const r = b.rock, key = `rock:${b.i}`, size = Math.max(2, Math.min(12, Math.round(r.s * 4)))
        this.say(`Mining stone · ${line()}`)
        const a = Math.atan2(this.pos.z - r.z, this.pos.x - r.x), d = r.s * 0.85 + 1.2
        await this.walkTo(r.x + Math.cos(a) * d, r.z + Math.sin(a) * d, 0.6)
        this.face(r.x, r.z)
        while (held() < CARRY && (S.nodes.get(key) ?? size) > 0) {
          this.check()
          await this.pause(1100)
          try { await S.ask({ t: 'mine', node: key, x: r.x, z: r.z, size }) } catch { fails++; break }
        }
      }
    }
    const bag = { ...S.inv.carry }
    if (bag.wood + bag.stone + bag.metal === 0) { await this.pause(2000); return }
    this.say(`Carrying ${bag.wood ? `${bag.wood} wood` : `${bag.stone} stone`} home · ${line()}`)
    await this.walkTo(sx, sz, 2.5)
    this.face(sx, sz)
    await this.pause(700)
    await S.ask({ t: 'deposit', claim: c.id, from: 'carry', bag }).catch((e) => this.o.log?.(`bot: deposit: ${msg(e)}`))
  }

  private nearestPile(mat: Mat, x: number, z: number, r: number): { id: string; x: number; z: number } | null {
    const S = this.S!
    let best: { id: string; x: number; z: number } | null = null, bd = r
    for (const d of S.drops.values()) {
      if (d.mat !== mat || (d.claim && S.claims.get(d.claim)?.owner !== S.me.id)) continue
      const q = Math.hypot(d.x - x, d.z - z)
      if (q < bd && !this.crossesWater(x, z, d.x, d.z)) { bd = q; best = d }
    }
    return best
  }

  /** The nearest standing tree from the stockpile (out of anyone's land, this side of the water). */
  private pickTree(sx: number, sz: number): number {
    const w = this.need(), S = this.S!
    for (const R of [110, 220]) {
      let best = -1, bd = Infinity
      for (const t of w.trees.standingNear(sx, sz, R, 5)) {
        if (S.stumps.has(t) || this.skipTrees.has(t)) continue
        const tr = w.trees.treeAt(t)
        if (this.inLand(tr.x, tr.z, 2) || w.map.waterAt(tr.x, tr.z) !== null) continue
        const d = Math.hypot(tr.x - sx, tr.z - sz)
        if (d < bd && !this.crossesWater(sx, sz, tr.x, tr.z)) { bd = d; best = t }
      }
      if (best >= 0) return best
    }
    return -1
  }

  private pickBoulder(sx: number, sz: number): { i: number; rock: { x: number; z: number; s: number } } | null {
    const w = this.need(), S = this.S!
    for (const R of [140, 260]) {
      let best: { i: number; rock: { x: number; z: number; s: number } } | null = null, bd = Infinity
      for (const b of w.rocks.bouldersNear(sx, sz, R)) {
        const size = Math.max(2, Math.min(12, Math.round(b.rock.s * 4)))
        if ((S.nodes.get(`rock:${b.i}`) ?? size) <= 0 || this.inLand(b.rock.x, b.rock.z, 2) || w.map.waterAt(b.rock.x, b.rock.z) !== null) continue
        const d = Math.hypot(b.rock.x - sx, b.rock.z - sz)
        if (d < bd && !this.crossesWater(sx, sz, b.rock.x, b.rock.z)) { bd = d; best = b }
      }
      if (best) return best
    }
    return null
  }

  // ------------------------------------------------------------------------------------------------------------------
  // places

  /** Flat, dry ground for a project: off the tracks, the named places, the hidden basins and anyone's land; woods and
   *  boulders near; 120–550 m on from where he is (the first: 40–220 m from us, so we see him start). */
  private findSpot(proj: Project, first: boolean): { x: number; z: number } | null {
    const w = this.need(), m = w.map, S = this.S!, half = m.half - LAND_R - 25
    const from = first ? this.o.near() : this.pos
    const [d0, d1] = first ? [40, 220] : [120, 550]
    let best: { x: number; z: number; s: number } | null = null
    for (let k = 0; k < 500; k++) {
      const a = Math.random() * Math.PI * 2, d = d0 + Math.random() * (d1 - d0)
      const x = from.x + Math.cos(a) * d, z = from.z + Math.sin(a) * d
      if (Math.abs(x) > half || Math.abs(z) > half || m.waterAt(x, z) !== null) continue
      // (his land clear of the tracks: the centre the land's radius and a margin off — and the flag's side too)
      if (m.trackDist(x, z) < LAND_R + 3) continue
      if ([...S.claims.values()].some((c) => Math.hypot(c.x - x, c.z - z) < c.r + LAND_R + 8)) continue
      if ((m.meta.landmarks ?? []).some((l) => Math.hypot(l.x - x, l.z - z) < l.r + LAND_R + 10)) continue
      if ((m.meta.hidden ?? []).some((h) => Math.hypot(h.x - x, h.z - z) < h.ro + LAND_R)) continue
      let wet = false, lo = Infinity, hi = -Infinity
      for (let q = 0; q < 12 && !wet; q++) {
        const b = (q / 12) * Math.PI * 2
        for (const rr of [LAND_R * 0.5, LAND_R]) if (m.waterAt(x + Math.cos(b) * rr, z + Math.sin(b) * rr) !== null) wet = true
        const y = m.height(x + Math.cos(b) * 8, z + Math.sin(b) * 8)
        lo = Math.min(lo, y); hi = Math.max(hi, y)
      }
      if (wet || hi - lo > 2.5) continue
      if (w.trees.nearest(x, z, 4.5) || w.trees.standingNear(x, z, 10, 2).length > 2) continue
      if (w.trees.standingNear(x, z, 110, 5).length < 12) continue
      if (w.rocks.bouldersNear(x, z, 140).length < 3) continue
      if (this.crossesWater(from.x, from.z, x, z) && !m.meta.bridges?.length) continue
      const s = hi - lo + (this.crossesWater(from.x, from.z, x, z) ? 1.5 : 0)
      if (!best || s < best.s) best = { x, z, s }
      if (best.s < 0.6 && k > 60) break
    }
    void proj
    return best
  }

  /** The anchor cell (the layout's [0, 0]) where all its foundations fit, clear of the flag, inside the land. */
  private anchorFor(proj: Project, c: Claim): { x: number; z: number } | null {
    const S = this.S!, m = this.need().map
    const [fx, fz] = flagSpot(c, m)
    const tries: [number, number][] = []
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) tries.push([i, j])
    // (nearest the middle, away from the flag)
    tries.sort((a, b) => score(a) - score(b))
    function score([i, j]: [number, number]): number { const x = c.x + i * C, z = c.z + j * C; return Math.hypot(i, j) - 0.25 * Math.hypot(x - fx, z - fz) }
    for (const [i, j] of tries) {
      const ax = c.x + i * C, az = c.z + j * C
      const fits = proj.cells.every(([ci, cj]) => {
        const x = ax + ci * C, z = az + cj * C
        if (Math.hypot(x - c.x, z - c.z) > c.r - 4 || m.waterAt(x, z) !== null) return false
        if (!proj.flat) { const [fx2, fz2] = flagSpot(c, m); return Math.abs(x - fx2) > C / 2 + 1 || Math.abs(z - fz2) > C / 2 + 1 }
        const p = placementFor(S, m, c, { kind: 'foundation_stone', cost: { wood: 0, stone: 0, metal: 0 } }, x, z, 0)
        return !p.why
      })
      if (fits) return { x: ax, z: az }
    }
    return null
  }

  /** Down it comes: every piece and pond of his (half back each), then the land given up. */
  private async leave(c: Claim): Promise<void> {
    const S = this.S!
    this.say('Taking it down')
    const mine = [...S.pieces.values()].filter((p) => p.claim === c.id).reverse()
    for (const p of mine) {
      this.check()
      await this.walkTo(p.x, p.z, 4).catch((e) => { if (e instanceof Stopped) throw e })
      this.face(p.x, p.z)
      await this.pause(900)
      await S.ask({ t: 'remove', piece: p.id }).catch(() => {})
    }
    for (const p of [...S.ponds.values()].filter((q) => q.claim === c.id)) await S.ask({ t: 'remove', piece: p.id }).catch(() => {})
    await this.pause(1200)
    await S.ask({ t: 'unclaim', claim: c.id }).catch((e) => this.o.log?.(`bot: unclaim: ${msg(e)}`))
    this.say('Moving on')
  }

  /** His land left from before (a tab closed mid-build) or now (off): its pieces down and the land given up — no
   *  walking (`slow`: a moment between, so it's seen). */
  private async clearOwn(slow: boolean): Promise<void> {
    const S = this.S
    if (!S) return
    for (const c of [...S.claims.values()].filter((q) => q.owner === S.me.id)) {
      for (const p of [...S.pieces.values()].filter((q) => q.claim === c.id).reverse()) { await S.ask({ t: 'remove', piece: p.id }).catch(() => {}); if (slow) await this.pause(250) }
      for (const p of [...S.ponds.values()].filter((q) => q.claim === c.id)) await S.ask({ t: 'remove', piece: p.id }).catch(() => {})
      await S.ask({ t: 'unclaim', claim: c.id }).catch(() => {})
    }
  }

  private mine(): Claim | null {
    const S = this.S!
    return [...S.claims.values()].find((c) => c.owner === S.me.id) ?? null
  }
  private inLand(x: number, z: number, pad: number): boolean {
    for (const c of this.S!.claims.values()) if (Math.hypot(c.x - x, c.z - z) < c.r + pad) return true
    return false
  }

  // ------------------------------------------------------------------------------------------------------------------
  // walking

  /** Walk to within `within` m of (x, z) (round the water: by a bridge when the line crosses it). */
  private walkTo(x: number, z: number, within: number): Promise<void> {
    this.check()
    return new Promise((ok, fail) => {
      this.walk = { route: this.route(this.pos.x, this.pos.z, x, z), within, ok, fail, best: Infinity, since: 0 }
    })
  }

  private route(ax: number, az: number, bx: number, bz: number): { x: number; z: number; deck: Bridge | null; wade: boolean }[] {
    const end = { x: bx, z: bz, deck: null, wade: false }
    if (!this.crossesWater(ax, az, bx, bz)) return [end]
    let best: { cost: number; pts: { x: number; z: number; deck: Bridge | null; wade: boolean }[] } | null = null
    for (const b of this.need().map.meta.bridges ?? []) {
      if (b.kind === 'rope') continue
      const L = Math.hypot(b.x1 - b.x0, b.z1 - b.z0) || 1, ux = (b.x1 - b.x0) / L, uz = (b.z1 - b.z0) / L
      for (const [p, q, s] of [[[b.x0, b.z0], [b.x1, b.z1], 1], [[b.x1, b.z1], [b.x0, b.z0], -1]] as [[number, number], [number, number], number][]) {
        // (the ends 3 m out on the land, the deck between)
        const p0 = { x: p[0] - ux * s * 3, z: p[1] - uz * s * 3 }, q0 = { x: q[0] + ux * s * 3, z: q[1] + uz * s * 3 }
        const cost = Math.hypot(p0.x - ax, p0.z - az) + L + Math.hypot(bx - q0.x, bz - q0.z) + (this.crossesWater(ax, az, p0.x, p0.z) ? 400 : 0) + (this.crossesWater(q0.x, q0.z, bx, bz) ? 400 : 0)
        if (!best || cost < best.cost) best = { cost, pts: [{ ...p0, deck: null, wade: false }, { x: p[0], z: p[1], deck: b, wade: false }, { x: q[0], z: q[1], deck: b, wade: false }, { ...q0, deck: b, wade: false }, end] }
      }
    }
    // (no bridge that helps: through it)
    const direct = Math.hypot(bx - ax, bz - az)
    if (!best || best.cost > direct * 3 + 300) return [{ ...end, wade: true }]
    return best.pts
  }

  private crossesWater(ax: number, az: number, bx: number, bz: number): boolean {
    const m = this.need().map, L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 3))
    for (let k = 1; k < n; k++) { const t = k / n; if (m.waterAt(ax + (bx - ax) * t, az + (bz - az) * t) !== null) return true }
    return false
  }

  /** Every 50 ms: a step of the walk under way, his pose sent. */
  private tick(dt: number): void {
    const S = this.S, w = this.o.world()
    if (!S || S.closed || !w || this.stopped) return
    S.update(dt)
    const wk = this.walk
    if (wk) {
      const wp = wk.route[0]
      const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z, d = Math.hypot(dx, dz)
      const last = wk.route.length === 1
      if (d <= (last ? wk.within : 1.2)) {
        wk.route.shift()
        if (!wk.route.length) { this.walk = null; wk.ok() }
      } else {
        const sp = Math.min(85, (d > 6 || !last ? RUN : WALK) * this.speed)
        let h = Math.atan2(dx, dz)
        // (round the water and the steep: the way ahead tried off the line, nearest first)
        if (!wp.deck && !wp.wade) {
          const free = (a: number) => {
            const ax = this.pos.x + Math.sin(a) * 3, az = this.pos.z + Math.cos(a) * 3
            return w.map.waterAt(ax, az) === null && Math.abs(w.map.height(ax, az) - this.pos.y) < 2.5
          }
          if (!free(h)) for (const off of [0.44, -0.44, 0.87, -0.87, 1.31, -1.31, 1.75, -1.75]) if (free(h + off)) { h += off; break }
        }
        const step = Math.min(d, sp * dt)
        this.pos.x += Math.sin(h) * step
        this.pos.z += Math.cos(h) * step
        this.pos.y = this.groundY(w.map, wp.deck)
        // he faces where he goes (eased)
        const want = Math.atan2(-Math.sin(h), -Math.cos(h))
        let dh = want - this.heading
        dh = Math.atan2(Math.sin(dh), Math.cos(dh))
        this.heading += dh * Math.min(1, dt * 10)
        this.moved = true
        // stuck (no nearer in 8 s): a hop on toward it
        const left = Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z)
        if (left < wk.best - 0.5) { wk.best = left; wk.since = 0 }
        else if ((wk.since += dt) > 8 / Math.min(this.speed, 4)) {
          const hop = Math.min(12, left)
          this.pos.x += (dx / d) * hop; this.pos.z += (dz / d) * hop
          this.pos.y = this.groundY(w.map, wp.deck)
          this.teleport = true
          wk.since = 0; wk.best = Infinity
        }
      }
    }
    this.sinceSend += dt
    if ((this.moved && this.sinceSend >= 0.05) || this.sinceSend >= 1) {
      const h = this.heading
      const ent: Ent = { slot: Slot.Player, kind: Kind.Foot, flags: this.teleport ? FLAG_TELEPORT : 0, p: [this.pos.x, this.pos.y, this.pos.z], q: [0, Math.sin(h / 2), 0, Math.cos(h / 2)] }
      S.sendPose([ent])
      this.teleport = false
      this.moved = false
      this.sinceSend = 0
    }
  }

  /** The ground under him: a bridge's deck while he's on it, else the land (a pond's or lake's floor never: he goes round). */
  private groundY(m: MapData, deck: Bridge | null): number {
    const g = m.height(this.pos.x, this.pos.z)
    if (!deck) return g
    const L2 = (deck.x1 - deck.x0) ** 2 + (deck.z1 - deck.z0) ** 2 || 1
    const t = ((this.pos.x - deck.x0) * (deck.x1 - deck.x0) + (this.pos.z - deck.z0) * (deck.z1 - deck.z0)) / L2
    return t >= 0 && t <= 1 ? Math.max(g, deckY(deck, t)) : g
  }

  private face(x: number, z: number): void {
    this.heading = Math.atan2(-(x - this.pos.x), -(z - this.pos.z))
    this.moved = true
  }

  // ------------------------------------------------------------------------------------------------------------------

  private need(): BotWorld {
    const w = this.o.world()
    if (!w) throw new Stopped()
    return w
  }
  private check(): void { if (this.stopped || !this.S || this.S.closed) throw new Stopped() }
  /** A pause (shorter at speed). */
  private pause(ms: number): Promise<void> { return this.sleep(ms / this.speed) }
  private sleep(ms: number): Promise<void> {
    this.check()
    return new Promise((ok, fail) => {
      const done = () => { this.sleeps.delete(done); clearTimeout(t); if (this.stopped) fail(new Stopped()); else ok() }
      const t = setTimeout(done, ms)
      this.sleeps.add(done)
    })
  }
  private chat(text: string): void { this.S?.ask({ t: 'chat', text }).catch(() => {}) }
  /** The HUD's line (under the co-op chip): what he's doing. */
  private say(s: string): void {
    this.status = s
    const name = this.S?.me.name ?? 'Bot'
    this.el.replaceChildren(Object.assign(document.createElement('b'), { textContent: 'Bot' }), Object.assign(document.createElement('span'), { textContent: name }), Object.assign(document.createElement('i'), { textContent: s }))
    this.o.log?.(`bot: ${s}`)
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
