import * as GFX from './gfx'
import { type Builder, SURF } from './Bridges'
import {
  backpack, barrel, beam, box, C, campChair, campTable, chimney, chopBlock, clothesline, crate, dock, door, fence, fireRing, fishingSpot,
  foundation, gableRoof, type Ground, headframe, lantern, leanRoof, logWalls, mailbox, oreCart, orePile, panel, pickup, porch, post,
  radioMast, rails, rbox, type RGB, rock, rowboat, shade, steps, stovepipe, tarpShelter, tentA, tentDome, V, warningSign, windowAt,
  type WinState, woodpile, wheel, X, Y, Z, boardWalls, mixc,
} from './Kit'
import { hasPlace, panes } from './Buildings'

/**
 * THE VALLEY'S PLACES, COMPOSED (2026-11-06, the user: "transform these into recognizable points of interest … every
 * location should look like a place that belongs in a finished game"; "the cabins and tents are too small beside our
 * vehicles and people"; "add colour to the houses, realistic stylized textures without more cost; broken houses,
 * hidden places, caves"). Each place is a composition — a focal building, what stands round it and why (a woodpile by
 * the door, the truck that brought the supplies, the dock the boat is tied to), its approach — built from the Kit in
 * its own frame (+z its front, the ground under it from `g`). Sized against the 1.8 m character and the 2.3 m truck:
 * cabins ~8.5 × 6.5 m with 3.3 m walls and 2.3 m doors, wall tents 2 m tall.
 */
export type Col = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, ground?: boolean) => void
export interface Ctx {
  b: Builder
  g: Ground
  col: Col
  /** Keep the grass off a box (local centre, half sizes, turned rot): floors, decks, yards. */
  clear: (cx: number, cz: number, hx: number, hz: number, rot?: number) => void
  /** A seed of the place's own (its variations). */
  seed: number
  /** A MODELLED building (Buildings.ts — places.py) placed at (x, z) turned rot, on the place's ground level. */
  model?: (name: string, x: number, z: number, rot: number, y?: number) => void
}

const DOOR_H = 2.3, DOOR_HW = 0.58

/** A PART built in its own frame (at the origin, its ground from `c`'s) and moved to (dx, dz) turned rot. */
export function sub(c: Ctx, dx: number, dz: number, rot: number, f: (c2: Ctx) => void): void {
  const { b, g } = c, cs = Math.cos(rot), sn = Math.sin(rot)
  const from = b.count
  const c2: Ctx = {
    ...c, g: (x, z) => g(dx + x * cs + z * sn, dz - x * sn + z * cs),
    col: (cx, cy, cz, hx, hy, hz, gr) => { const r = Math.abs(sn) > 0.7; c.col(dx + cx * cs + cz * sn, cy, dz - cx * sn + cz * cs, r ? hz : hx, hy, r ? hx : hz, gr) },
    clear: (cx, cz, hx, hz, r = 0) => c.clear(dx + cx * cs + cz * sn, dz - cx * sn + cz * cs, hx, hz, r + rot),
    model: c.model && ((name, x, z, r, y) => c.model!(name, dx + x * cs + z * sn, dz - x * sn + z * cs, r + rot, y)),
  }
  // (the props' models too, moved with the part)
  const sink = b.sink
  if (sink) b.sink = (name, x, y, z, r, o) => sink(name, dx + x * cs + z * sn, y, dz - x * sn + z * cs, r + rot, o)
  f(c2)
  b.sink = sink
  b.transform(from, new GFX.Matrix4().compose(V(dx, 0, dz), new GFX.Quaternion().setFromAxisAngle(Y, rot), V(1, 1, 1)))
}
/** Painted siding colours (linear, weathered): faded barn red, cream, sage, slate blue, mustard, a soft white. */
export const PAINTS: Record<string, RGB> = {
  red: [0.3, 0.075, 0.05], cream: [0.56, 0.5, 0.4], sage: [0.2, 0.26, 0.17], slate: [0.16, 0.22, 0.28], mustard: [0.48, 0.33, 0.1],
  white: [0.62, 0.6, 0.55], green: [0.08, 0.17, 0.11], brown: [0.2, 0.12, 0.07],
}

// --------------------------------------------------------------------------------------------------- cabins
export interface CabinOpts {
  walls: 'log' | 'clap' | 'batten'
  paint?: RGB
  trim?: RGB
  roof: RGB
  tin?: boolean
  shutters?: RGB
  state: 'lived' | 'empty' | 'ruin'
  w?: number
  d?: number
  chimney?: 'stone' | 'pipe'
  porch?: boolean
  /** Two storeys (the ghost house). */
  storeys?: number
  /** The upper windows' states (a haunted house: one cold light that gutters). */
  upper?: WinState[]
  /** Its model (places.py) — drawn instead of the boxes when the place can take one. */
  model?: string
}
/** A CABIN on its foundation (centre 0, 0, its front +z): walls, a real roof, framed windows (lit when lived in;
 *  broken / boarded when not), a door (ajar in a ruin), a porch with steps, a chimney. The colliders, the clearing. */
export function cabin(c: Ctx, o: CabinOpts): void {
  const { b, g } = c
  const w = o.w ?? 8.5, d = o.d ?? 6.5, floor = 0.5, H = 3.3 * (o.storeys ?? 1), ruin = o.state === 'ruin'
  if (o.model && c.model && hasPlace(o.model)) {
    // THE MODEL (places.py): the building whole; its glass ours; its colliders and its clearing as before
    c.model(o.model, 0, 0, 0)
    panes(b, o.model)
    if ((o.chimney ?? 'stone') === 'stone') c.col(-w / 2 - 0.45, 2.5, -0.8, 0.55, 2.5, 0.55)
    c.col(0, floor + H / 2, 0, w / 2 + 0.2, H / 2 + floor / 2, d / 2 + 0.2)
    c.clear(0, 0, w / 2 + 0.6, d / 2 + 0.6)
    if (o.porch !== false) c.clear(0, d / 2 + 1.2, w / 2 + 0.3, 1.4)
    return
  }
  const paint = o.paint ?? b.wood(1), trim = o.trim ?? C.trim
  foundation(b, w + 0.1, d + 0.1, floor, g)
  box(b, 0, floor - 0.06, 0, w / 2, 0.06, d / 2, b.wood(0.8)) // (the floor)
  if (o.walls === 'log') logWalls(b, w, d, floor, H, 0.19)
  else boardWalls(b, w, d, floor, H, ruin ? mixc(paint, b.wood(0.9), 0.45) : paint, o.walls === 'batten', trim)
  const top = floor + H + (o.walls === 'log' ? 0.2 : 0)
  gableRoof(b, w + 0.3, d + 0.3, top, w * 0.3, 0.55, { col: o.roof, gable: o.walls === 'log' ? b.wood(0.85) : ruin ? b.wood(0.8) : paint, tin: o.tin, sag: ruin ? 0.45 : o.state === 'empty' ? 0.12 : 0, holes: ruin ? 0.35 : 0 })
  // the openings: the door (front, right of centre), windows either side and on the sides
  const st = (k: number): WinState => (o.state === 'lived' ? 'lit' : ruin ? (k % 2 ? 'broken' : 'boarded') : k === 1 ? 'broken' : 'dark')
  const fz = d / 2 + (o.walls === 'log' ? 0.2 : 0.06)
  door(b, V(0.9, floor, fz), Z, X, DOOR_HW, DOOR_H, o.walls === 'log' ? b.wood(0.75) : shade(trim, 0.6), ruin ? 0.9 : o.state === 'empty' ? 0.25 : 0, trim)
  windowAt(b, V(-2.2, floor + 1.75, fz), Z, X, 0.62, 0.55, st(0), trim, o.shutters)
  for (const s of [-1, 1]) windowAt(b, V(s * (w / 2 + (o.walls === 'log' ? 0.2 : 0.06)), floor + 1.75, -0.6), V(s, 0, 0), V(0, 0, -s), 0.55, 0.5, st(s > 0 ? 1 : 2), trim, o.shutters)
  windowAt(b, V(1.6, floor + 1.75, -fz), V(0, 0, -1), V(-1, 0, 0), 0.5, 0.45, st(3), trim)
  if ((o.storeys ?? 1) > 1) {
    const up = o.upper ?? ['dark', 'dark', 'dark']
    windowAt(b, V(-2.2, floor + 5.0, fz), Z, X, 0.55, 0.6, up[0], trim, o.shutters)
    windowAt(b, V(1.4, floor + 5.0, fz), Z, X, 0.55, 0.6, up[1], trim, o.shutters)
    windowAt(b, V(w / 2 + 0.06, floor + 5.0, 0.6), X, V(0, 0, -1), 0.5, 0.55, up[2], trim)
    box(b, 0, floor + 3.35, fz + 0.05, w / 2 + 0.05, 0.08, 0.06, shade(trim, 0.8)) // (the band between the storeys)
  }
  // the chimney: stone up the left gable's outside, or a stovepipe through the roof
  if ((o.chimney ?? 'stone') === 'stone') { chimney(b, -w / 2 - 0.45, -0.8, g(-w / 2 - 0.45, -0.8) - 0.2, top + w * 0.3 + 0.8, 0.5); c.col(-w / 2 - 0.45, 2.5, -0.8, 0.55, 2.5, 0.55) }
  else stovepipe(b, -1.8, -1.0, top + 0.8, top + w * 0.3 * 0.6 + 1.0)
  c.col(0, floor + H / 2, 0, w / 2 + 0.2, H / 2 + floor / 2, d / 2 + 0.2)
  c.clear(0, 0, w / 2 + 0.6, d / 2 + 0.6)
  if (o.porch !== false) {
    if (ruin) {
      // the porch fallen in: planks askew, a post down
      for (let i = 0; i < 14; i++) { const x = -w / 2 + 0.3 + i * 0.58; rbox(b, x, floor - 0.25 + 0.15 * b.rnd(), d / 2 + 1.1, (b.rnd() - 0.5) * 0.4, 0.12, 0.03, 0.9 + 0.3 * b.rnd(), b.wood(0.8 + 0.3 * b.rnd())) }
      b.log(V(-w / 2 + 0.2, g(-w / 2, d / 2 + 2) + 0.15, d / 2 + 2.1), V(-w / 2 + 2.2, g(-w / 2 + 2, d / 2 + 1.5) + 0.1, d / 2 + 2.7), 0.09, b.wood(0.7))
      post(b, w / 2 - 0.2, d / 2 + 2.1, floor + H - 0.3, g)
    } else porch(b, w, d / 2 + 0.05, 2.2, floor, floor + H - 0.05, g, o.roof, 0.9)
    c.clear(0, d / 2 + 1.2, w / 2 + 0.3, 1.4)
  } else steps(b, V(0.9, floor, fz + 0.05), Z, X, 0.7, g)
}

/** THE CABINS' YARDS — what's round each, by its story. */
export function cabinYard(c: Ctx, kind: 'trapper' | 'pond' | 'birch' | 'ruin'): void {
  const { b, g } = c
  if (kind === 'trapper') {
    woodpile(b, V(5.6, 0, -1), Math.PI / 2, 3.2, 6, g); c.col(5.6, 0.6, -1, 0.5, 0.6, 1.7)
    chopBlock(b, 4.8, 2.6, g)
    // a hide-stretching frame, a meat rack, traps hung on the wall
    for (const [fx, fz, r] of [[-6.2, 1.5, 0.3], [-6.0, -1.2, -0.2]] as const) {
      const p0 = V(fx, g(fx, fz), fz), u = V(Math.cos(r), 0, -Math.sin(r))
      for (const s of [-0.7, 0.7]) b.log(p0.clone().addScaledVector(u, s).setY(p0.y - 0.1), p0.clone().addScaledVector(u, s).setY(p0.y + 1.9), 0.04, b.wood(0.7))
      for (const h of [0.3, 1.8]) b.log(p0.clone().addScaledVector(u, -0.75).setY(p0.y + h), p0.clone().addScaledVector(u, 0.75).setY(p0.y + h), 0.035, b.wood(0.75))
      b.setSurf(SURF.fabric); panel(b, p0.clone().addScaledVector(u, -0.6).setY(p0.y + 1.7), p0.clone().addScaledVector(u, 0.6).setY(p0.y + 1.7), p0.clone().addScaledVector(u, 0.5).setY(p0.y + 0.45), p0.clone().addScaledVector(u, -0.5).setY(p0.y + 0.45), [0.38, 0.25, 0.15], [0.3, 0.2, 0.12]); b.setSurf(SURF.wood)
    }
    pickup(b, 6.5, 7.5, -0.6, g, [0.14, 0.2, 0.15], { rust: 0.25 }); c.col(6.5, 1.1, 7.5, 2.7, 1.1, 1.0)
    barrel(b, -5.2, g(-5.2, 3.6), 3.6, [0.22, 0.14, 0.08])
    lantern(b, 1.9, 0.5 + 2.6, 3.4 + 0.2)
  } else if (kind === 'pond') {
    mailbox(b, 5.5, 8.6, 0.3, g)
    for (const [x, z, r] of [[-1.6, 4.5, 0.2], [-2.6, 4.4, -0.2]] as const) campChair(b, x, 0.5, z, r + Math.PI, [0.2, 0.3, 0.38])
    clothesline(b, V(-7.5, 2.2, -3.5), V(-7.2, 2.2, 2.5), g, [[0.6, 0.6, 0.55], [0.4, 0.1, 0.08], [0.15, 0.25, 0.4], [0.55, 0.5, 0.2]])
    pickup(b, 6.8, 6.0, -1.1, g, [0.45, 0.42, 0.36], { rust: 0.1 }); c.col(6.8, 1.1, 6.0, 2.7, 1.1, 1.0)
    woodpile(b, V(-5.4, 0, -1.6), Math.PI / 2, 2.4, 5, g)
    rowboat(b, 3.6, g(3.6, -6.5) + 0.05, -6.5, 0.4, [0.25, 0.4, 0.42], true)
    fence(b, [[-8, 6], [-8, 9], [-3, 10.5]], g)
  } else if (kind === 'birch') {
    // a GARDEN behind a picket fence, an outhouse, a clothesline, a bench by the door
    fence(b, [[-9, -2], [-9, -8], [-3.5, -8.5], [-3.5, -5.5]], g)
    for (let i = 0; i < 4; i++) for (let k = 0; k < 6; k++) { const x = -8 + i * 1.2, z = -7.6 + k * 0.85, y = g(x, z); b.setSurf(SURF.fabric); box(b, x, y + 0.15, z, 0.25, 0.15 + 0.1 * b.rnd(), 0.25, [0.09 + 0.05 * b.rnd(), 0.2 + 0.08 * b.rnd(), 0.07]); b.setSurf(SURF.wood) }
    outhouse(c, 8.2, -5.5, -Math.PI / 2)
    clothesline(b, V(6.8, 2.2, 1.5), V(6.5, 2.2, 7.0), g, [[0.62, 0.62, 0.6], [0.6, 0.5, 0.15], [0.62, 0.62, 0.6]])
    box(b, -2.7, 0.5 + 0.45, 4.4, 0.9, 0.05, 0.2, b.wood(1.1)); for (const s of [-0.75, 0.75]) box(b, -2.7 + s, 0.5 + 0.22, 4.4, 0.05, 0.22, 0.18, b.wood(0.8))
    woodpile(b, V(5.5, 0, -2.2), Math.PI / 2, 2.8, 6, g)
    mailbox(b, 2.5, 9.5, -0.2, g, [0.35, 0.08, 0.05])
  } else {
    // THE RUIN: a rusted truck on flat tyres, a fallen fence, junk in the grass, a stove dragged out
    pickup(b, -6.8, 6.5, 0.9, g, [0.32, 0.22, 0.1], { rust: 0.85, flat: true, open: true, noWheel: true, sunk: 0.15 }); c.col(-6.8, 1.0, 6.5, 2.7, 1.0, 1.0)
    fence(b, [[4, 9], [8.5, 7], [9.5, 2], [9, -4]], g, 0.55)
    barrel(b, 5.6, g(5.6, 4.6), 4.6, C.rust, true, 0.6, true)
    barrel(b, 6.4, g(6.4, 3.9), 3.9, shade(C.rust, 0.8), false, 0, true)
    b.setSurf(SURF.metal); rbox(b, -4.6, g(-4.6, 3.2) + 0.45, 3.2, 0.4, 0.4, 0.45, 0.35, [0.1, 0.1, 0.1]); b.setSurf(SURF.wood)
    stovepipe(b, -4.6, 3.2, g(-4.6, 3.2) + 0.9, g(-4.6, 3.2) + 1.6)
    for (let i = 0; i < 7; i++) { const a = b.rnd() * 6.28, r = 5.5 + 3 * b.rnd(); rbox(b, Math.cos(a) * r, g(Math.cos(a) * r, Math.sin(a) * r) + 0.03, Math.sin(a) * r, b.rnd() * 3, 0.9 + 0.5 * b.rnd(), 0.03, 0.09, b.wood(0.7 + 0.3 * b.rnd())) }
  }
}

/** An OUTHOUSE (a tall plank box, a moon cut in the door, a lean roof). */
export function outhouse(c: Ctx, x: number, z: number, rot: number): void {
  const { b, g } = c, y = g(x, z), cs = Math.cos(rot), sn = Math.sin(rot)
  if (c.model && hasPlace('outhouse')) { c.model('outhouse', x, z, rot, y); c.col(x, y + 1.3, z, 0.75, 1.3, 0.75); return }
  const P = (lx: number, ly: number, lz: number) => V(x + lx * cs + lz * sn, y + ly, z - lx * sn + lz * cs)
  const u = V(cs, 0, -sn), w = V(sn, 0, cs)
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) b.box(P(-0.6 + i * 0.3, 1.25, s * 0.65), u, Y, w, 0.14, 1.25 + (s < 0 ? 0.15 : 0), 0.03, b.wood(0.9 + 0.2 * b.rnd()))
  for (let i = 0; i < 5; i++) b.box(P(-0.65, 1.3, -0.6 + i * 0.3), u, Y, w, 0.03, 1.3, 0.14, b.wood(0.9 + 0.2 * b.rnd()))
  door(b, P(0.67, 0, 0), u, w.clone().negate(), 0.5, 2.25, b.wood(0.85), 0)
  b.setSurf(SURF.plain); b.tri(P(0.72, 1.95, -0.05), P(0.72, 1.85, 0.08), P(0.72, 2.05, 0.08), C.dark); b.setSurf(SURF.wood)
  b.box(P(0, 2.75, 0), u.clone().applyAxisAngle(w, -0.15), Y.clone().applyAxisAngle(w, -0.15), w, 0.85, 0.05, 0.8, C.shingle)
  c.col(x, y + 1.3, z, 0.75, 1.3, 0.75)
}

// ------------------------------------------------------------------------------------------------------ mine
/** THE MINE: the ADIT driven into the hill (a heavy timber portal, the rock built up round it, the dark mouth going
 *  back), rails out to an ORE BIN on stilts over the loading spot, a SPOIL HEAP, a HEADFRAME over an old shaft, a tin
 *  TOOL SHED, a stone POWDER HOUSE with its warning sign, carts (one tipped), barrels, crates, lantern posts. */
export function mineSite(c: Ctx): void {
  const { b, g } = c
  const hw = 1.9, hh = 3.4
  // the adit: lined walls and roof going back, the black mouth, the portal's heavy posts and cap
  for (const sx of [-1, 1]) for (let i = 0; i < 7; i++) box(b, sx * (hw - 0.05), 0.25 + i * 0.5, -2.2, 0.06, 0.24, 2.4, b.wood(0.55 + 0.15 * b.rnd()))
  for (let i = 0; i < 6; i++) box(b, 0, hh + 0.05, -0.4 - i * 0.75, hw + 0.15, 0.08, 0.36, b.wood(0.5 + 0.15 * b.rnd()))
  b.setSurf(SURF.plain); b.quad(V(-hw + 0.1, 0, -1.2), V(hw - 0.1, 0, -1.2), V(hw - 0.1, hh, -1.2), V(-hw + 0.1, hh, -1.2), C.dark); b.setSurf(SURF.wood)
  for (const sx of [-1, 1]) { b.log(V(sx * hw, -0.3, 0.3), V(sx * hw * 0.95, hh + 0.2, 0.3), 0.26, b.wood(0.65)); c.col(sx * hw, hh / 2, 0.3, 0.3, hh / 2, 0.3) }
  b.log(V(-hw - 0.7, hh + 0.35, 0.3), V(hw + 0.7, hh + 0.35, 0.3), 0.3, b.wood(0.6))
  for (const sx of [-1, 1]) beam(b, V(sx * hw, hh - 0.6, 0.35), V(sx * (hw - 0.8), hh + 0.25, 0.35), 0.12, 0.16, b.wood(0.6), Z)
  c.col(0, hh / 2, -1.2, hw, hh / 2, 1.0)
  // the rock built up round the portal: chunks of the hill's own grey, the biggest over the cap
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.05 + 0.9 * (i / 8)), r = 3.2 + 0.8 * b.rnd()
    const x = Math.cos(a) * r * 1.1, y = Math.sin(a) * r * 1.0 + 0.2
    rock(b, V(x, y, -0.3 - 0.8 * b.rnd()), V(1.3 + 0.7 * b.rnd(), 1.1 + 0.5 * b.rnd(), 1.2), b.rnd() * 6, shade(C.stone, 0.85 + 0.2 * b.rnd()), c.seed + i, 1)
  }
  lantern(b, hw - 0.4, hh - 0.6, 0.65)
  // the rails out of the adit, curving to the ore bin
  const track: [number, number][] = [[0, -2.5], [0, 2], [0.4, 6], [1.8, 10], [4, 13.5]]
  rails(b, track, g)
  oreCart(b, 0, 4.4, Math.PI / 2, g)
  oreCart(b, 6.5, 11, 0.6, g, true)
  // the ORE BIN: a timber hopper on stilts over the end of the track, a chute
  const ob = V(5.5, 0, 15.5), oy = g(ob.x, ob.z)
  for (const [px, pz] of [[-1.4, -1.2], [1.4, -1.2], [1.4, 1.2], [-1.4, 1.2]]) post(b, ob.x + px, ob.z + pz, oy + 3.2, g, 0.14, b.wood(0.65))
  for (let i = 0; i < 9; i++) box(b, ob.x, oy + 3.4 + i * 0.26, ob.z - 1.4, 1.55, 0.12, 0.05, b.wood(0.7 + 0.2 * b.rnd()))
  for (let i = 0; i < 9; i++) box(b, ob.x, oy + 3.4 + i * 0.26, ob.z + 1.4, 1.55, 0.12, 0.05, b.wood(0.7 + 0.2 * b.rnd()))
  for (const s of [-1, 1]) for (let i = 0; i < 9; i++) box(b, ob.x + s * 1.55, oy + 3.4 + i * 0.26, ob.z, 0.05, 0.12, 1.4, b.wood(0.7 + 0.2 * b.rnd()))
  box(b, ob.x, oy + 3.25, ob.z, 1.55, 0.08, 1.4, b.wood(0.6))
  beam(b, V(ob.x + 1.5, oy + 3.3, ob.z), V(ob.x + 3.4, oy + 1.6, ob.z), 0.9, 0.1, b.wood(0.7), Z)
  orePile(b, ob.x + 4.0, ob.z + 0.5, 1.8, 1.1, C.ore, g, 3)
  c.col(ob.x, oy + 3, ob.z, 1.6, 3, 1.5)
  // the SPOIL HEAP spilling down the slope
  orePile(b, -9, 6, 5.5, 3.2, mixc(C.stone, C.soil, 0.4), g, 7)
  orePile(b, -12, 11, 3.5, 2.0, mixc(C.stone, C.soil, 0.5), g, 9)
  // the HEADFRAME over an old shaft (a fence round its hole), set back on the right
  headframe(b, 11, 2, -0.4, g, 9)
  b.setSurf(SURF.plain); box(b, 11, g(11, 2) + 0.02, 2, 1.1, 0.03, 1.1, C.dark); b.setSurf(SURF.wood)
  fence(b, [[9.2, 0.2], [12.8, 0.2], [12.8, 3.8], [9.2, 3.8], [9.2, 0.2]], g, 0.2)
  c.col(11, 4, 2, 1.8, 4, 1.8)
  // the TOOL SHED (tin roof, the door hanging), the POWDER HOUSE (stone, a steel door, the sign)
  shed(c, -6.5, -0.5, 0.2, true)
  sub(c, 14, 10, 0.3, (c2) => {
    const py = c2.g(0, 0)
    if (c2.model && hasPlace('powder_house')) {
      c2.model('powder_house', 0, 0, 0, py); warningSign(b, -2.2, 2.2, 0.3, c2.g); c2.col(0, py + 1.2, 0, 1.4, 1.2, 1.4); return
    }
    b.setSurf(SURF.stone)
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) box(b, s * 1.2, py + 0.2 + i * 0.4, 0, 0.2, 0.2, 1.2, shade(C.stone, 0.7 + 0.35 * b.rnd()))
    for (let i = 0; i < 6; i++) box(b, 0, py + 0.2 + i * 0.4, -1.15, 1.2, 0.2, 0.2, shade(C.stone, 0.7 + 0.35 * b.rnd()))
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) box(b, s * 0.75, py + 0.2 + i * 0.4, 1.15, 0.45, 0.2, 0.2, shade(C.stone, 0.7 + 0.35 * b.rnd()))
    b.setSurf(SURF.metal); box(b, 0, py + 1.0, 1.2, 0.32, 1.0, 0.04, [0.2, 0.22, 0.2]); b.setSurf(SURF.wood)
    leanRoof(b, 2.8, -1.6, py + 2.65, 1.6, py + 2.35, C.tinGrey, true)
    warningSign(b, -2.2, 2.2, 0.3, c2.g)
    c2.col(0, py + 1.2, 0, 1.4, 1.2, 1.4)
  })
  // barrels, crates, a lantern post by the track, a second sign at the adit
  for (const [x, z, k] of [[-3.2, 3.2, 0], [-3.7, 2.4, 1], [-2.6, 2.3, 2]] as const) barrel(b, x, g(x, z), z, k === 1 ? [0.36, 0.1, 0.06] : [0.22, 0.14, 0.08], false, 0, k === 1)
  crate(b, 3.2, g(3.2, 2.2), 2.2, 0.3, 0.38); crate(b, 3.5, g(3.5, 2.2) + 0.76, 2.2, 0.1, 0.3); crate(b, 4.1, g(4.1, 3.2), 3.2, 0.8, 0.35)
  warningSign(b, -3.0, 1.2, 0.2, g)
  b.log(V(2.6, g(2.6, 8) - 0.2, 8), V(2.6, g(2.6, 8) + 2.6, 8), 0.06, b.wood(0.7)); lantern(b, 2.85, g(2.6, 8) + 2.35, 8)
  c.clear(0, 5, 3.2, 8)
}

/** A TOOL SHED: plank walls, a tin lean-to roof, its door hanging open, tools leaning by it. */
export function shed(c: Ctx, x: number, z: number, rot: number, tin = true): void {
  sub(c, x, z, rot, (c2) => {
    const { b, g } = c2, y = g(0, 0)
    if (c2.model && hasPlace('tool_shed')) { c2.model('tool_shed', 0, 0, 0, y); c2.col(0, y + 1.3, 0, 1.7, 1.3, 1.4); return }
    const n = 12
    for (let i = 0; i < n; i++) { const t = -1.6 + (i + 0.5) * (3.2 / n); for (const s of [-1, 1]) box(b, t, y + 1.3 + (s > 0 ? 0.15 : -0.15), s * 1.3, 3.2 / n / 2 - 0.01, 1.3 + (s > 0 ? 0.15 : -0.15), 0.03, b.wood(0.85 + 0.25 * b.rnd())) }
    for (let i = 0; i < 9; i++) { const t = -1.3 + (i + 0.5) * (2.6 / 9); for (const s of [-1, 1]) if (!(s > 0 && Math.abs(t) < 0.6)) box(b, s * 1.6, y + 1.3, t, 0.03, 1.3, 2.6 / 18 - 0.01, b.wood(0.85 + 0.25 * b.rnd())) }
    foundation(b, 3.2, 2.6, y + 0.05, g)
    door(b, V(1.62, y, 0), X, V(0, 0, -1), 0.55, 2.2, b.wood(0.8), 0.9)
    leanRoof(b, 3.8, 1.75, y + 2.95, -1.75, y + 2.45, tin ? C.tin : C.shingle, tin)
    for (const k of [0, 1]) b.log(V(1.75, y, -0.9 - k * 0.3), V(1.85, y + 1.6, -0.8 - k * 0.3), 0.025, b.wood(1.2))
    c2.col(0, y + 1.3, 0, 1.7, 1.3, 1.4)
  })
}

// ----------------------------------------------------------------------------------------------- the lakeside
/** THE FISHING HUT on the lake: a weathered board-and-batten hut, a tin roof with a stovepipe, a net drying on a rack,
 *  a long DOCK out over the water, the rowboat tied to it, a canoe upturned on the bank, barrels, crates, a rod. */
export function fishingHut(c: Ctx, waterY: number): void {
  const { b, g } = c
  const w = 4.4, d = 3.6, floor = 0.35
  if (c.model && hasPlace('fishing_hut')) { c.model('fishing_hut', 0, 0, 0); panes(b, 'fishing_hut') } else {
    foundation(b, w, d, floor, g)
    boardWalls(b, w, d, floor, 2.6, mixc(PAINTS.sage, [0.3, 0.3, 0.28], 0.4), true, C.trim)
    leanRoof(b, w + 0.8, -d / 2 - 0.4, floor + 3.3, d / 2 + 0.6, floor + 2.55, C.tin, true)
    door(b, V(0.8, floor, d / 2 + 0.06), Z, X, 0.55, 2.15, b.wood(0.8), 0.15)
    windowAt(b, V(-1.1, floor + 1.55, d / 2 + 0.06), Z, X, 0.45, 0.4, 'lit', C.trim)
    windowAt(b, V(w / 2 + 0.06, floor + 1.55, 0), X, V(0, 0, -1), 0.45, 0.4, 'dark', C.trim)
    stovepipe(b, -1.4, -0.8, floor + 2.9, floor + 4.2)
  }
  c.col(0, 1.5, 0, w / 2 + 0.1, 1.5, d / 2 + 0.1)
  c.clear(0, 0, w / 2 + 0.5, d / 2 + 0.5)
  steps(b, V(0.8, floor, d / 2 + 0.1), Z, X, 0.6, g)
  // the net rack: two poles, a rail, the net hung in a few sagging panels
  const nx = -4.2
  for (const z of [-1.4, 1.6]) b.log(V(nx, g(nx, z) - 0.2, z), V(nx, g(nx, z) + 2.1, z), 0.05, b.wood(0.75))
  b.log(V(nx, g(nx, 0) + 2.0, -1.5), V(nx, g(nx, 0) + 2.0, 1.7), 0.04, b.wood(0.8))
  b.setSurf(SURF.fabric)
  for (let i = 0; i < 4; i++) { const z0 = -1.4 + i * 0.75, z1 = z0 + 0.75; panel(b, V(nx, g(nx, 0) + 1.98, z0), V(nx, g(nx, 0) + 1.98, z1), V(nx + 0.05, g(nx, 0) + 0.7 + 0.1 * b.rnd(), z1), V(nx + 0.05, g(nx, 0) + 0.7 + 0.1 * b.rnd(), z0), [0.28, 0.3, 0.26], [0.22, 0.24, 0.2]) }
  for (let i = 0; i < 6; i++) b.box(V(nx + 0.04, g(nx, 0) + 0.8, -1.3 + i * 0.55), Z, Y, X, 0.06, 0.06, 0.02, [0.62, 0.45, 0.1])
  b.setSurf(SURF.wood)
  // the DOCK from the front, out over the water (its deck 0.45 m above it), the rowboat alongside, a rod at the end
  const len = 14, deck = waterY + 0.45
  dock(b, 0, d / 2 + 1.2, 0, len, 1.9, deck, g)
  c.col(0, deck - 0.15, d / 2 + 1.2 + len / 2, 1.0, 0.15, len / 2, true)
  rowboat(b, 1.9, waterY + 0.08, d / 2 + len - 2.5, Math.PI / 2 + 0.08, [0.22, 0.38, 0.42])
  fishingSpot(b, -0.6, d / 2 + len + 0.6, 0, () => deck - 0.04)
  barrel(b, -0.55, deck, d / 2 + 2.6, [0.24, 0.15, 0.08])
  crate(b, 0.5, deck, d / 2 + 3.4, 0.3, 0.3)
  // a canoe upturned on the bank, a couple of crates, a lantern post
  rowboat(b, 4.2, g(4.2, 2.5) + 0.62, 2.5, 0.3 + Math.PI, [0.45, 0.12, 0.06], false, true)
  crate(b, -3.0, g(-3.0, 2.8), 2.8, 0.5, 0.35); barrel(b, -3.4, g(-3.4, 1.8), 1.8, [0.3, 0.32, 0.34], false, 0, true)
  b.log(V(1.3, deck - 0.1, d / 2 + 1.5), V(1.3, deck + 2.2, d / 2 + 1.5), 0.06, b.wood(0.7)); lantern(b, 1.55, deck + 1.95, d / 2 + 1.5)
}

/** A PRIVATE DOCK at a pond (a fishing spot, kind 'dock'): a shorter dock from the bank, a canoe or a boat, a bench
 *  and a rod; on the bank a little plank SHELTER (lean-to) where someone sat out the rain. */
export function pondDock(c: Ctx, waterY: number, variant: number): void {
  const { b, g } = c
  dock(b, 0, 0, 0, 8 + (variant % 3) * 2, 1.6, waterY + 0.4, g, variant % 2 ? 0.12 : 0.03)
  c.col(0, waterY + 0.25, 4 + (variant % 3), 0.85, 0.15, 4 + (variant % 3), true)
  if (variant % 2) rowboat(b, 1.6, waterY + 0.06, 5.5, Math.PI / 2 - 0.15, [0.4, 0.28, 0.12])
  else rowboat(b, -1.7, waterY + 0.05, 4.6, Math.PI / 2 + 0.2, [0.5, 0.08, 0.05], false, true)
  fishingSpot(b, 0.4, 7.4 + (variant % 3) * 2, 0, () => waterY + 0.36)
  // the bank: a lean-to shelter, a bench, a fire's cold ring, logs
  const sx = variant % 2 ? -4.5 : 4.5
  sub(c, sx, -4, 0, (c2) => {
    const y = c2.g(0, 0)
    for (const [px, pz] of [[-1.3, -0.9], [1.3, -0.9], [-1.3, 0.9], [1.3, 0.9]]) post(b, px, pz, y + (pz < 0 ? 2.4 : 1.9), c2.g, 0.07)
    for (let i = 0; i < 8; i++) box(b, (i - 3.5) * 0.36, y + 1.2, -0.95, 0.17, 1.2, 0.03, b.wood(0.85 + 0.25 * b.rnd()))
    leanRoof(b, 3.2, -1.2, y + 2.55, 1.2, y + 2.0, C.shingle)
    box(b, 0, y + 0.45, -0.5, 1.1, 0.05, 0.22, b.wood(1.1))
    c2.col(0, y + 1.2, 0, 1.4, 1.2, 1.0)
  })
  fireRing(b, sx, -1.5, g, false)
  b.log(V(sx - 1.1, g(sx - 1.1, -0.3) + 0.2, -0.3), V(sx + 1.1, g(sx + 1.1, -0.2) + 0.2, -0.2), 0.2, b.wood(0.9))
  c.clear(sx, -3, 2.5, 3)
}

// ------------------------------------------------------------------------------------------------------ camps
/** Where a camp's fire burns (local): the flames and the fire's light (Props.ts) — every style puts its fire here. */
export const FIRE_AT = { x: 1.4, y: 0.32, z: 1.0 } as const
export type CampStyle = 'expedition' | 'hikers' | 'fishers' | 'abandoned'
/** A CAMP of a style: hikers' (two or three tents round the fire, chairs, a table, packs, a line strung between
 *  poles, their truck), fishers' (a wall tent, a tarp shelter, a canoe, rods out on the bank), ABANDONED (a tent
 *  fallen in, the fire long cold, a pack and a chair left lying). The expedition camp is Landmarks' baseCamp. */
export function camp(c: Ctx, style: CampStyle): void {
  const { b, g } = c, f = FIRE_AT
  fireRing(b, f.x, f.z, g, style !== 'abandoned')
  c.col(f.x, 0.15, f.z, 0.75, 0.15, 0.75)
  const seat = (x0: number, z0: number, x1: number, z1: number) => { b.log(V(x0, g(x0, z0) + 0.22, z0), V(x1, g(x1, z1) + 0.22, z1), 0.22, b.wood(0.85 + 0.15 * b.rnd())); c.col((x0 + x1) / 2, 0.22, (z0 + z1) / 2, Math.abs(x1 - x0) / 2 + 0.2, 0.22, Math.abs(z1 - z0) / 2 + 0.2) }
  if (style === 'hikers') {
    tentA(b, -2.8, -1.4, 0.15, g, C.canvasOrange, 1.8, 1.5, 2.0); c.col(-2.8, 1.0, -1.4, 1.6, 1.0, 1.9)
    tentDome(b, 3.6, -2.6, 0.4, g, C.canvasBlue, shade(C.canvasBlue, 0.6), 1.7, 1.75); c.col(3.6, 0.9, -2.6, 1.6, 0.9, 1.6)
    tentDome(b, 6.6, 1.4, 1.2, g, C.canvasYellow, [0.22, 0.24, 0.22], 1.5, 1.6); c.col(6.6, 0.8, 1.4, 1.4, 0.8, 1.4)
    campChair(b, f.x - 1.4, g(f.x - 1.4, f.z + 0.8), f.z + 0.8, -0.9 + Math.PI, [0.12, 0.3, 0.25])
    campChair(b, f.x + 0.2, g(f.x + 0.2, f.z + 1.6), f.z + 1.6, Math.PI + 0.1, [0.45, 0.12, 0.06])
    seat(f.x + 1.5, f.z - 0.9, f.x + 1.6, f.z + 0.9)
    campTable(b, -0.8, g(-0.8, 2.8), 2.8, 0.3)
    lantern(b, -0.8, g(-0.8, 2.8) + 0.88, 2.8)
    backpack(b, -1.2, g(-1.2, 0.2), 0.2, 0.4, [0.12, 0.22, 0.32]); backpack(b, 2.6, g(2.6, -0.6), -0.6, -0.7, [0.42, 0.1, 0.05])
    clothesline(b, V(-5.6, 2.1, 1.4), V(-4.8, 2.1, 5.8), g, [[0.55, 0.55, 0.5], [0.15, 0.3, 0.45], [0.5, 0.12, 0.06]])
    b.setSurf(SURF.plain); box(b, 0.4, g(0.4, -1.8) + 0.24, -1.8, 0.4, 0.24, 0.27, [0.1, 0.3, 0.42]); box(b, 0.4, g(0.4, -1.8) + 0.5, -1.8, 0.42, 0.03, 0.29, [0.6, 0.6, 0.6]); b.setSurf(SURF.wood)
    pickup(b, -3.5, 7.8, 0.35, g, [0.16, 0.18, 0.22], { rust: 0.05 }); c.col(-3.5, 1.1, 7.8, 2.7, 1.1, 1.0)
  } else if (style === 'fishers') {
    tentA(b, -2.9, -1.2, 0.2, g, C.canvasKhaki, 1.9, 1.6, 2.1); c.col(-2.9, 1.0, -1.2, 1.7, 1.0, 2.0)
    tarpShelter(b, 3.4, -2.8, -0.2, g, C.canvasGreen); c.col(3.4, 1.0, -1.5, 1.7, 1.0, 1.4)
    campTable(b, 3.4, g(3.4, -1.4), -1.4, -0.2); lantern(b, 3.4, g(3.4, -1.4) + 0.88, -1.4)
    campChair(b, f.x - 1.3, g(f.x - 1.3, f.z + 1.0), f.z + 1.0, Math.PI - 0.7, [0.32, 0.3, 0.15])
    seat(f.x - 0.9, f.z + 1.5, f.x + 1.0, f.z + 1.6)
    rowboat(b, 2.0, g(2.0, 5.6) + 0.6, 5.6, 0.6 + Math.PI, [0.15, 0.32, 0.18], false, true)
    for (const [x, z, r] of [[-0.8, 7.2, 0.1], [0.6, 7.6, -0.2]] as const) fishingSpot(b, x, z, r, g)
    // a fish-drying rack
    for (const s of [-1, 1]) b.log(V(-5.5 + s * 0.9, g(-5.5, 2) - 0.1, 2), V(-5.5 + s * 0.9, g(-5.5, 2) + 1.7, 2), 0.04, b.wood(0.75))
    b.log(V(-6.5, g(-5.5, 2) + 1.6, 2), V(-4.5, g(-5.5, 2) + 1.6, 2), 0.03, b.wood(0.8))
    b.setSurf(SURF.metal); for (let i = 0; i < 6; i++) b.box(V(-6.2 + i * 0.32, g(-5.5, 2) + 1.32, 2), X, Y, Z, 0.05, 0.22, 0.015, [0.42, 0.44, 0.4]); b.setSurf(SURF.wood)
    barrel(b, -4.4, g(-4.4, -3.6), -3.6, [0.25, 0.15, 0.08])
    pickup(b, -6.5, 7.2, 1.0, g, [0.38, 0.1, 0.06], { rust: 0.2 }); c.col(-6.5, 1.1, 7.2, 2.7, 1.1, 1.0)
  } else if (style === 'abandoned') {
    tentA(b, -2.6, -1.2, 0.4, g, mixc(C.canvasGreen, [0.3, 0.3, 0.26], 0.4), 1.8, 1.5, 1.9, true); c.col(-2.6, 0.6, -1.2, 1.6, 0.6, 1.9)
    tentDome(b, 4.0, -2.2, 0.2, (x, z) => g(x, z) - 0.55, [0.38, 0.32, 0.12], [0.28, 0.24, 0.1], 1.6, 1.0) // (a dome fallen in on itself)
    seat(f.x - 1.0, f.z + 1.5, f.x + 1.0, f.z + 1.4)
    // a chair on its side, a pack spilled, a torn tarp, a lantern on the ground
    b.setSurf(SURF.fabric); panel(b, V(-0.5, g(-0.5, 3.5) + 0.05, 3.0), V(0.4, g(0.4, 3.5) + 0.05, 3.2), V(0.3, g(0.3, 3.5) + 0.4, 3.9), V(-0.6, g(-0.6, 3.5) + 0.3, 3.8), [0.4, 0.12, 0.06], [0.3, 0.09, 0.05]); b.setSurf(SURF.wood)
    backpack(b, 2.9, g(2.9, 2.6) - 0.15, 2.6, 1.3, [0.25, 0.28, 0.14])
    for (let i = 0; i < 5; i++) { const a = b.rnd() * 6.28, r = 1 + 2 * b.rnd(); b.setSurf(SURF.fabric); rbox(b, 2.9 + Math.cos(a) * r, g(2.9, 2.6) + 0.04, 2.6 + Math.sin(a) * r, b.rnd() * 3, 0.15 + 0.1 * b.rnd(), 0.04, 0.1 + 0.1 * b.rnd(), [0.3 + 0.3 * b.rnd(), 0.25, 0.2]); b.setSurf(SURF.wood) }
    b.setSurf(SURF.metal); box(b, -0.3, g(-0.3, 0.6) + 0.1, 0.6, 0.08, 0.1, 0.08, [0.2, 0.2, 0.18]); b.setSurf(SURF.wood)
    tarpShelter(b, -5.5, 2.6, 1.2, (x, z) => g(x, z) - 0.6, [0.25, 0.3, 0.32], 2.6, 1.8)
  }
  c.clear(0.5, 0, 5, 4)
}

// --------------------------------------------------------------------------------------------- new places
/** A RANGER STATION: a painted cabin with a green roof, a tall radio mast, a flagpole, a notice board, the ranger's
 *  truck (gone — its tracks and an oil stain left), a water tank on a stand. */
export function rangerStation(c: Ctx): void {
  const { b, g } = c
  cabin(c, { walls: 'clap', paint: [0.42, 0.28, 0.14], trim: [0.55, 0.52, 0.42], roof: C.greenRoof, tin: true, state: 'empty', w: 9, d: 7, chimney: 'pipe', shutters: PAINTS.green, model: 'ranger' })
  radioMast(b, -7.5, -3, g, 16)
  b.setSurf(SURF.metal); b.log(V(6, g(6, 6) - 0.3, 6), V(6, g(6, 6) + 7, 6), 0.05, [0.6, 0.6, 0.6]); b.setSurf(SURF.wood)
  b.setSurf(SURF.fabric); panel(b, V(6, g(6, 6) + 6.8, 6.05), V(7.3, g(6, 6) + 6.7, 6.25), V(7.3, g(6, 6) + 6.0, 6.25), V(6, g(6, 6) + 6.0, 6.05), [0.12, 0.25, 0.45], [0.1, 0.2, 0.36]); b.setSurf(SURF.wood)
  // the notice board: a little gable roof over a board with papers pinned
  for (const s of [-0.9, 0.9]) b.log(V(-4 + s, g(-4, 7) - 0.3, 7), V(-4 + s, g(-4, 7) + 2.3, 7), 0.07, b.wood(0.7))
  box(b, -4, g(-4, 7) + 1.6, 7, 1.0, 0.6, 0.05, b.wood(0.9))
  b.setSurf(SURF.plain); for (const [x, y, k] of [[-4.5, 1.8, 0], [-3.9, 1.5, 1], [-3.4, 1.85, 2]] as const) box(b, x, g(-4, 7) + y, 7.06, 0.2, 0.26, 0.005, k === 1 ? [0.6, 0.5, 0.2] : [0.62, 0.6, 0.55]); b.setSurf(SURF.wood)
  b.box(V(-4, g(-4, 7) + 2.4, 7), X, V(0, 1, 0.3).normalize(), Z, 1.2, 0.04, 0.35, C.greenRoof)
  // the water tank on its stand
  for (const [px, pz] of [[-0.8, -0.8], [0.8, -0.8], [0.8, 0.8], [-0.8, 0.8]]) post(b, 7 + px, -5 + pz, g(7, -5) + 2.4, g, 0.09)
  barrel(b, 7, g(7, -5) + 2.4, -5, [0.3, 0.32, 0.3], false, 0, true); b.setSurf(SURF.metal); b.log(V(7, g(7, -5) + 2.4, -5), V(7, g(7, -5) + 3.6, -5), 1.0, [0.3, 0.33, 0.3]); b.setSurf(SURF.wood)
  c.col(7, 2, -5, 1.1, 2, 1.1)
  crate(b, 5.5, g(5.5, 3.4), 3.4, 0.4, 0.4); barrel(b, 5.0, g(5.0, 4.5), 4.5, [0.35, 0.1, 0.06], false, 0, true)
}

/** A ROADSIDE GARAGE: a tall gabled workshop with its big doors open (dark inside), a car on blocks before it, a
 *  fuel pump, tyres stacked, an oil drum, a lean-to with a workbench. */
export function garage(c: Ctx): void {
  const { b, g } = c
  const w = 9, d = 8, floor = 0.15
  const modelled = !!c.model && hasPlace('garage')
  if (modelled) { c.model!('garage', 0, 0, 0); panes(b, 'garage') } else {
  foundation(b, w, d, floor, g, C.stoneDark)
  boardWalls(b, w, d, floor, 4.2, PAINTS.red, true, C.trim)
  gableRoof(b, w + 0.3, d + 0.3, floor + 4.2, 2.6, 0.5, { col: C.tin, gable: PAINTS.red, tin: true })
  // the big doors open: two leaves swung out, the dark inside
  b.setSurf(SURF.plain); box(b, 0, floor + 1.7, d / 2 + 0.07, 2.2, 1.7, 0.01, C.dark); b.setSurf(SURF.wood)
  for (const s of [-1, 1]) {
    const hinge = V(s * 2.2, floor, d / 2 + 0.1), dir = V(-s, 0, 0).applyAxisAngle(Y, s * 1.9)
    for (let i = 0; i < 6; i++) b.box(hinge.clone().addScaledVector(dir, 0.185 + i * 0.37).setY(floor + 1.7), dir, Y, new GFX.Vector3().crossVectors(dir, Y), 0.17, 1.7, 0.035, shade(PAINTS.red, 0.85 + 0.25 * b.rnd()))
    beam(b, hinge.clone().setY(floor + 0.5), hinge.clone().addScaledVector(dir, 2.1).setY(floor + 2.9), 0.06, 0.12, C.trim, new GFX.Vector3().crossVectors(dir, Y))
  }
  box(b, 0, floor + 3.5, d / 2 + 0.1, 2.5, 0.12, 0.08, C.trim)
  windowAt(b, V(w / 2 + 0.06, floor + 2.0, 0), X, V(0, 0, -1), 0.7, 0.5, 'dark', C.trim)
  windowAt(b, V(-w / 2 - 0.06, floor + 2.0, -1), V(-1, 0, 0), Z, 0.7, 0.5, 'broken', C.trim)
  // the sign board over the doors
  b.setSurf(SURF.plain); box(b, 0, floor + 5.0, d / 2 + 0.2, 2.6, 0.45, 0.05, [0.6, 0.56, 0.45]); box(b, 0, floor + 5.0, d / 2 + 0.26, 2.3, 0.18, 0.01, [0.35, 0.07, 0.04]); b.setSurf(SURF.wood)
  }
  c.col(0, 2.2, 0, w / 2 + 0.1, 2.2, d / 2 + 0.1)
  c.clear(0, 3, w / 2 + 2, d / 2 + 5)
  // a car on blocks before the doors (wheels gone), its bonnet up
  pickup(b, 0.4, 9.5, Math.PI / 2 + 0.1, g, [0.18, 0.28, 0.36], { rust: 0.35, noWheel: true }); c.col(0.4, 1.1, 9.5, 1.0, 1.1, 2.7)
  // a FUEL PUMP, an oil drum, tyres stacked
  const fp = V(5.8, 0, 6.5), fy = g(fp.x, fp.z)
  b.setSurf(SURF.metal); box(b, fp.x, fy + 0.95, fp.z, 0.35, 0.95, 0.28, [0.5, 0.1, 0.05]); box(b, fp.x, fy + 2.05, fp.z, 0.3, 0.16, 0.3, [0.6, 0.58, 0.5]); b.log(V(fp.x + 0.36, fy + 1.4, fp.z), V(fp.x + 0.7, fy + 0.6, fp.z + 0.3), 0.03, C.rubber); b.setSurf(SURF.wood)
  c.col(fp.x, fy + 1, fp.z, 0.4, 1, 0.35)
  barrel(b, 6.8, g(6.8, 5.6), 5.6, [0.12, 0.2, 0.32], false, 0, true)
  for (let k = 0; k < 4; k++) wheel(b, V(-5.8, g(-5.8, 5.5) + 0.15 + k * 0.3, 5.5), Y, 0.42, 0.28)
  for (const [x, z] of [[-6.8, 4.8], [-5.0, 6.6]] as const) wheel(b, V(x, g(x, z) + 0.42, z), V(0.8, 0, 0.6).normalize(), 0.42, 0.28)
  // the lean-to on the side: a workbench, a vice, a jerrycan
  if (!modelled) {
    for (const z of [-3.2, 1.8]) post(b, w / 2 + 2.6, z, floor + 3.0, g, 0.08)
    b.box(V(w / 2 + 1.35, floor + 3.2, -0.7), V(1, -0.25, 0).normalize(), V(0.25, 1, 0).normalize(), Z, 1.45, 0.04, 2.7, C.tin)
  }
  box(b, w / 2 + 1.0, g(w / 2 + 1, -0.7) + 0.9, -0.7, 0.4, 0.05, 1.8, b.wood(1.1))
  for (const z of [-2.3, 0.9]) box(b, w / 2 + 1.0, g(w / 2 + 1, z) + 0.45, z, 0.35, 0.45, 0.05, b.wood(0.8))
  b.setSurf(SURF.metal); box(b, w / 2 + 1.0, g(w / 2 + 1, 0) + 1.05, 0, 0.1, 0.1, 0.12, C.steel); box(b, w / 2 + 1.2, g(w / 2 + 1.2, -2) + 0.27, -2, 0.18, 0.27, 0.08, [0.15, 0.25, 0.1]); b.setSurf(SURF.wood)
}

/** A RIVER SHELTER: a three-sided log lean-to facing the water, a fire before it, a log bench, firewood, a pack. */
export function riverShelter(c: Ctx): void {
  const { b, g } = c
  const w = 4.6, d = 3.2, y = g(0, 0)
  if (c.model && hasPlace('river_shelter')) c.model('river_shelter', 0, 0, 0, y)
  else {
    for (let i = 0; i < 7; i++) b.log(V(-w / 2 - 0.3, y + 0.2 + i * 0.34, -d / 2), V(w / 2 + 0.3, y + 0.2 + i * 0.34, -d / 2), 0.17, b.wood(0.85 + 0.2 * b.rnd()))
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) { const t = i / 5, h = 0.2 + i * 0.34; b.log(V(s * w / 2, y + h, -d / 2 - 0.3), V(s * w / 2, y + h, -d / 2 + d * (1 - t * 0.7) + 0.2), 0.16, b.wood(0.85 + 0.2 * b.rnd())) }
    for (const s of [-1, 1]) post(b, s * w / 2, d / 2, y + 2.1, g, 0.12)
    leanRoof(b, w + 1.0, -d / 2 - 0.5, y + 2.75, d / 2 + 0.7, y + 2.0, C.shingle)
    box(b, 0, y + 0.3, -0.5, w / 2 - 0.2, 0.08, 1.1, b.wood(1.0))
  }
  c.col(0, y + 1.2, -d / 2, w / 2 + 0.3, 1.2, 0.3); for (const s of [-1, 1]) c.col(s * w / 2, y + 1.0, 0, 0.25, 1.0, d / 2)
  c.clear(0, 0.5, w / 2 + 1, d / 2 + 2.5)
  fireRing(b, 0, d / 2 + 2.0, g, true)
  b.log(V(-1.4, g(-1.4, d / 2 + 3.4) + 0.2, d / 2 + 3.4), V(1.4, g(1.4, d / 2 + 3.5) + 0.2, d / 2 + 3.5), 0.21, b.wood(0.9))
  woodpile(b, V(w / 2 + 1.0, 0, -0.8), Math.PI / 2, 1.8, 4, g)
  backpack(b, -1.4, y + 0.38, -0.8, 0.2, [0.3, 0.12, 0.06])
}

/** A HOUSE RUIN (a broken homestead in the woods): stone walls standing to different heights, a gable end still up,
 *  the roof fallen in (a few rafters left), a chimney standing alone, the doorway empty; rubble and young trees. */
export function houseRuin(c: Ctx, big: boolean): void {
  const { b, g } = c
  const w = big ? 10 : 8, d = big ? 7.5 : 6.5
  const name = big ? 'house_ruin_big' : 'house_ruin_small'
  if (c.model && hasPlace(name)) {
    c.model(name, 0, 0, 0)
    for (const [x0, z0, x1, z1, h] of [[-w / 2, -d / 2, w / 2, -d / 2, 3.6], [w / 2, -d / 2, w / 2, d / 2, 2.2], [-w / 2, -d / 2, -w / 2, d / 2, 3.6]] as const)
      c.col((x0 + x1) / 2, h / 2, (z0 + z1) / 2, Math.abs(x1 - x0) / 2 + 0.3, h / 2, Math.abs(z1 - z0) / 2 + 0.3)
    // (the front, low, either side of the doorway at x 0.4 … 1.6)
    c.col((-w / 2 + 0.4) / 2, 1.0, d / 2, (w / 2 + 0.4) / 2, 1.0, 0.3); c.col((w / 2 + 1.6) / 2, 1.0, d / 2, (w / 2 - 1.6) / 2, 1.0, 0.3)
    c.col(w / 2 - 0.8, 3, -d / 2 + 0.9, 0.6, 3, 0.6)
    c.clear(0, 0, w / 2, d / 2)
    return
  }
  b.setSurf(SURF.stone)
  const wall = (x0: number, z0: number, x1: number, z1: number, h0: number, h1: number, gap?: [number, number]) => {
    const L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L, n = Math.round(L / 0.55)
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t
      if (gap && t * L > gap[0] && t * L < gap[1]) continue
      // its top ragged: the courses fall away toward the broken end
      const top = h0 + (h1 - h0) * t + (b.rnd() - 0.5) * 0.7, gy = g(x, z) - 0.2
      const courses = Math.max(1, Math.round((top - gy) / 0.36))
      for (let k = 0; k < courses; k++) b.box(V(x + (b.rnd() - 0.5) * 0.05, gy + 0.18 + k * 0.36, z + (b.rnd() - 0.5) * 0.05), V(ux, 0, uz), Y, V(-uz, 0, ux), L / n / 2 + 0.02 - 0.02 * b.rnd(), 0.17, 0.28, shade(C.stone, 0.62 + 0.4 * b.rnd()))
    }
    c.col((x0 + x1) / 2, Math.max(h0, h1) / 2, (z0 + z1) / 2, Math.abs(ux) * L / 2 + 0.3, Math.max(h0, h1) / 2, Math.abs(uz) * L / 2 + 0.3)
  }
  wall(-w / 2, -d / 2, w / 2, -d / 2, 3.6, 2.0)                       // the back, falling away
  wall(w / 2, -d / 2, w / 2, d / 2, 2.2, 0.6)                         // the right side, mostly down
  wall(w / 2, d / 2, -w / 2, d / 2, 0.9, 3.0, [w / 2 - 1.6, w / 2 - 0.4]) // the front, the doorway
  wall(-w / 2, d / 2, -w / 2, -d / 2, 3.4, 3.6)                       // the left gable end, still standing
  // the gable's triangle over the left wall, a window hole in it
  for (let k = 0; k < 6; k++) { const h = 3.6 + k * 0.36, half = (d / 2) * (1 - k / 6); if (half < 0.3) break; for (let z = -half; z < half; z += 0.55) if (!(k === 1 && Math.abs(z) < 0.5)) b.box(V(-w / 2, g(-w / 2, z) + h - g(-w / 2, z) + 0.0, z + 0.27), X, Y, Z, 0.28, 0.17, 0.26, shade(C.stone, 0.62 + 0.4 * b.rnd())) }
  b.setSurf(SURF.wood)
  // a few rafters left, fallen across; the ridge beam down at one end
  b.log(V(-w / 2, 5.4, 0), V(w / 2 - 2, 1.0, 0.4), 0.14, b.wood(0.6))
  for (const [z, k] of [[-2.2, 0], [-0.6, 1], [1.8, 2]] as const) beam(b, V(-w / 2 + 0.3, 3.6, z), V(-w / 2 + 2.8 + k, g(-w / 2 + 3, z) + 0.2, z + 0.6), 0.12, 0.16, b.wood(0.55 + 0.1 * k))
  // the chimney standing alone on the right, rubble in heaps, the hearth
  chimney(b, w / 2 - 0.8, -d / 2 + 0.9, g(w / 2 - 0.8, -d / 2 + 0.9) - 0.2, 6.6, 0.55)
  c.col(w / 2 - 0.8, 3, -d / 2 + 0.9, 0.6, 3, 0.6)
  for (let i = 0; i < 8; i++) { const x = (b.rnd() - 0.5) * w * 0.8, z = (b.rnd() - 0.5) * d * 0.8; orePile(b, x, z, 0.7 + 0.6 * b.rnd(), 0.35 + 0.3 * b.rnd(), C.stone, g, 20 + i) }
  c.clear(0, 0, w / 2, d / 2)
}

/** A RESEARCH CAMP (remote, on the high ground): two big dome tents, a weather mast with its cups and vane, a solar
 *  panel, instrument cases, a generator, a table with a laptop's glow, a fenced survey stake line, the snowcat-like
 *  truck. Something left in a hurry. */
export function researchCamp(c: Ctx): void {
  const { b, g } = c
  tentDome(b, -3.5, -2.0, 0.3, g, [0.55, 0.3, 0.05], [0.25, 0.25, 0.25], 2.1, 2.0); c.col(-3.5, 1.0, -2.0, 2.0, 1.0, 2.0)
  tentDome(b, 3.5, -3.0, 1.1, g, [0.55, 0.3, 0.05], [0.25, 0.25, 0.25], 1.8, 1.8); c.col(3.5, 0.9, -3.0, 1.7, 0.9, 1.7)
  // the weather mast: a pole, the anemometer's cups, a vane, a box of instruments
  const my = g(7, 2)
  b.setSurf(SURF.metal)
  b.log(V(7, my - 0.3, 2), V(7, my + 5.5, 2), 0.04, [0.6, 0.6, 0.6])
  for (let k = 0; k < 3; k++) { const a = (k * 2 * Math.PI) / 3; b.log(V(7, my + 5.6, 2), V(7 + Math.cos(a) * 0.35, my + 5.6, 2 + Math.sin(a) * 0.35), 0.01, C.steel); box(b, 7 + Math.cos(a) * 0.35, my + 5.6, 2 + Math.sin(a) * 0.35, 0.05, 0.05, 0.05, [0.6, 0.6, 0.6]) }
  b.box(V(7.3, my + 5.1, 2), X, Y, Z, 0.3, 0.12, 0.01, [0.6, 0.6, 0.6])
  box(b, 7, my + 1.4, 2.2, 0.25, 0.3, 0.1, [0.62, 0.62, 0.6])
  for (let k = 0; k < 3; k++) { const a = (k * 2 * Math.PI) / 3 + 0.4; b.log(V(7, my + 4.5, 2), V(7 + Math.cos(a) * 3, g(7 + Math.cos(a) * 3, 2 + Math.sin(a) * 3), 2 + Math.sin(a) * 3), 0.005, C.steel) }
  // the solar panel on its frame, the generator, instrument cases
  b.box(V(0, g(0, 4.5) + 1.0, 4.5), X, V(0, 1, 0.8).normalize(), Z, 1.0, 0.03, 0.6, [0.04, 0.06, 0.12])
  for (const s of [-0.8, 0.8]) b.log(V(s, g(s, 4.5), 4.6), V(s, g(s, 4.5) + 1.0, 4.4), 0.03, C.steel)
  box(b, 3.4, g(3.4, 2.2) + 0.35, 2.2, 0.55, 0.35, 0.35, [0.5, 0.36, 0.05]); box(b, 3.4, g(3.4, 2.2) + 0.72, 2.2, 0.4, 0.04, 0.25, C.steel)
  for (const [x, z, r] of [[-0.6, 2.0, 0.2], [-1.5, 2.6, -0.4], [-0.9, 3.1, 0.9]] as const) rbox(b, x, g(x, z) + 0.22, z, r, 0.45, 0.22, 0.3, [0.07, 0.07, 0.08])
  b.setSurf(SURF.wood)
  campTable(b, 0.2, g(0.2, -0.3), -0.3, 0.1)
  b.setSurf(SURF.plain); b.setGlow(0.5); rbox(b, 0.2, g(0.2, -0.3) + 0.76, -0.3, 0.1, 0.17, 0.012, 0.12, [0.25, 0.35, 0.4]); b.setGlow(0); b.setSurf(SURF.wood)
  campChair(b, 0.2, g(0.2, -1.2), -1.2, 0.1, [0.3, 0.32, 0.34])
  // the survey stakes in a line with orange flagging, off toward the ridge
  for (let k = 0; k < 6; k++) { const x = -6 - k * 3.2, z = 4 + k * 1.1, y = g(x, z); b.log(V(x, y - 0.2, z), V(x, y + 1.1, z), 0.03, b.wood(1.1)); b.setSurf(SURF.fabric); panel(b, V(x, y + 1.05, z), V(x + 0.3, y + 1.0, z + 0.05), V(x + 0.3, y + 0.92, z + 0.05), V(x, y + 0.95, z), [0.7, 0.25, 0.03]); b.setSurf(SURF.wood) }
  pickup(b, -2.0, 9.5, 0.2, g, [0.6, 0.58, 0.52], { rust: 0.05, open: true }); c.col(-2.0, 1.1, 9.5, 2.7, 1.1, 1.0)
  c.clear(0, 0, 6, 5)
}

/** AN ABANDONED HAMLET: three or four buildings round a clearing — a house ruin, a cabin falling in, a barn with its
 *  roof half gone, a well — a lane through it, fences down. */
export function hamlet(c: Ctx): void {
  const { b, g } = c
  sub(c, -12, -6, 0.5, (c2) => houseRuin(c2, true))
  sub(c, 10, -8, -0.4, (c2) => cabin(c2, { walls: 'batten', paint: PAINTS.cream, trim: C.trim, roof: C.shingleGrey, state: 'ruin', w: 7.5, d: 6, porch: false, chimney: 'pipe', model: 'hamlet_cabin' }))
  sub(c, 13, 10, -1.9, (c2) => barn(c2))
  // the WELL: a stone ring, a roof on two posts, the windlass, a bucket
  const wy = g(0, 2)
  b.setSurf(SURF.stone)
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; for (let r = 0; r < 3; r++) rbox(b, Math.cos(a) * 0.9, wy + 0.15 + r * 0.28, 2 + Math.sin(a) * 0.9, -a, 0.24, 0.13, 0.15, shade(C.stone, 0.65 + 0.35 * b.rnd())) }
  b.setSurf(SURF.plain); box(b, 0, wy + 0.82, 2, 0.6, 0.02, 0.6, C.dark); b.setSurf(SURF.wood)
  for (const s of [-1, 1]) b.log(V(s * 1.0, wy, 2), V(s * 1.0, wy + 2.4, 2), 0.07, b.wood(0.7))
  b.log(V(-1.1, wy + 1.6, 2), V(1.1, wy + 1.6, 2), 0.08, b.wood(0.8))
  for (const s of [-1, 1]) b.box(V(0, wy + 2.55, 2 + s * 0.45), X, V(0, 1, -s * 0.9).normalize(), Z, 1.3, 0.04, 0.6, C.shingleGrey)
  c.col(0, wy + 0.6, 2, 1.1, 0.6, 1.1)
  c.clear(0, 2, 4.5, 4) // (the square round the well: paved — Landmarks PAVED)
  // the lane's fences, down here and there; a cart left in the lane
  fence(b, [[-18, 6], [-6, 7], [-2, 8]], g, 0.5); fence(b, [[4, 7.5], [9, 5], [16, 4]], g, 0.6)
  const cy = g(-3, 11)
  for (const s of [-1, 1]) { b.log(V(-3 - 0.9, cy + 0.55, 11 + s * 0.8), V(-3 + 0.9, cy + 0.55, 11 + s * 0.8), 0.06, b.wood(0.7)); b.setSurf(SURF.wood); for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; b.log(V(-3, cy + 0.55, 11 + s * 0.85), V(-3 + Math.cos(a) * 0.55, cy + 0.55 + Math.sin(a) * 0.55, 11 + s * 0.85), 0.03, b.wood(0.75)) } }
  box(b, -3, cy + 0.85, 11, 1.2, 0.05, 0.7, b.wood(0.9)); beam(b, V(-1.8, cy + 0.85, 11), V(0.6, cy + 0.1, 11.4), 0.08, 0.08, b.wood(0.7))
}

/** A BARN, its roof half gone (rafters bare against the sky), its big door hanging. */
export function barn(c: Ctx): void {
  const { b, g } = c
  const w = 10, d = 13, floor = 0.1
  if (c.model && hasPlace('barn')) {
    c.model('barn', 0, 0, 0); panes(b, 'barn')
    c.col(0, 2.4, 0, w / 2 + 0.1, 2.4, d / 2 + 0.1)
    c.clear(0, 0, w / 2 + 1, d / 2 + 1)
    return
  }
  foundation(b, w, d, floor, g, C.stoneDark)
  boardWalls(b, w, d, floor, 4.8, mixc(PAINTS.red, b.wood(0.8), 0.35), true, C.trim)
  gableRoof(b, w + 0.4, d + 0.4, floor + 4.8, 3.6, 0.5, { col: C.tin, gable: mixc(PAINTS.red, b.wood(0.8), 0.35), tin: true, holes: 0.45, sag: 0.3 })
  for (let z = -d / 2 + 1; z < d / 2; z += 1.4) for (const s of [-1, 1]) beam(b, V(s * w / 2, floor + 4.8, z), V(0, floor + 8.4, z), 0.12, 0.18, b.wood(0.6))
  b.setSurf(SURF.plain); box(b, 0, floor + 1.9, d / 2 + 0.07, 1.8, 1.9, 0.01, C.dark); b.setSurf(SURF.wood)
  const hinge = V(-1.8, floor, d / 2 + 0.12), dir = V(1, 0, 0).applyAxisAngle(Y, -0.35).applyAxisAngle(Z, 0.08)
  for (let i = 0; i < 5; i++) b.box(hinge.clone().addScaledVector(dir, 0.18 + i * 0.36).setY(floor + 1.9 - i * 0.03), dir, Y, new GFX.Vector3().crossVectors(dir, Y), 0.17, 1.9, 0.04, shade(PAINTS.red, 0.8 + 0.25 * b.rnd()))
  c.col(0, 2.4, 0, w / 2 + 0.1, 2.4, d / 2 + 0.1)
  c.clear(0, 0, w / 2 + 1, d / 2 + 1)
}

/** A WRECK at a river crossing: a truck nose-down in the bank, a door off, the load spilled — crates, a barrel in the
 *  shallows; a broken plank ramp where someone tried to get it out. */
export function wreck(c: Ctx, waterY: number): void {
  const { b, g } = c
  // (on the bank, its front wheels in the shallows — never under the river)
  pickup(b, 0, 0, 0.5, (x, z) => Math.max(g(x, z), waterY - 0.5), [0.3, 0.32, 0.25], { rust: 0.55, flat: true, sunk: 0.2 })
  c.col(0, 1.0, 0, 2.7, 1.0, 1.2)
  for (let i = 0; i < 5; i++) { const x = 2 + 3 * b.rnd(), z = -2 + 4 * b.rnd(); crate(b, x, Math.max(g(x, z), waterY - 0.3), z, b.rnd() * 3, 0.35) }
  barrel(b, 4.5, Math.max(g(4.5, 1.5), waterY - 0.25), 1.5, [0.2, 0.25, 0.3], true, 1.0, true)
  for (let k = 0; k < 4; k++) rbox(b, -3.5 + k * 0.32, g(-3.5, 2.5) + 0.25, 2.5 + k * 0.1, 0.4, 0.15, 0.04, 1.6, b.wood(0.8 + 0.2 * b.rnd()))
  b.setSurf(SURF.metal); rbox(b, -2.6, g(-2.6, -2.2) + 0.05, -2.2, 1.1, 0.5, 0.04, 0.6, [0.3, 0.32, 0.25]); b.setSurf(SURF.wood)
}

// ------------------------------------------------------------------------------------------- the unsettling
/** A DEAD TREE: a bare grey trunk, leaning, its branches forking twice, a broken top. */
export function deadTree(b: Builder, x: number, z: number, g: Ground, h: number, seed: number): void {
  let s = (seed * 2654435761) >>> 0
  const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
  const bark: RGB = [0.1, 0.09, 0.085]
  const y = g(x, z), top = V(x + (rnd() - 0.5) * 1.2, y + h, z + (rnd() - 0.5) * 1.2)
  b.log(V(x, y - 0.4, z), top, 0.22 + 0.1 * rnd(), bark)
  const branch = (p: GFX.Vector3, dir: GFX.Vector3, len: number, r: number, depth: number) => {
    const e = p.clone().addScaledVector(dir, len)
    b.log(p, e, r, shade(bark, 0.9 + 0.2 * rnd()))
    if (depth > 0) for (let k = 0; k < 2; k++) {
      const d2 = dir.clone().applyAxisAngle(Y, (rnd() - 0.5) * 1.6).add(V(0, 0.25 + (rnd() - 0.5) * 0.6, 0)).normalize()
      branch(e, d2, len * 0.6, r * 0.6, depth - 1)
    }
  }
  for (let k = 0; k < 4; k++) {
    const t = 0.45 + 0.13 * k, p = V(x, y, z).lerp(top, t), a = rnd() * 6.28
    branch(p, V(Math.cos(a), 0.45 + 0.4 * rnd(), Math.sin(a)).normalize(), h * (0.28 - 0.04 * k), 0.08, 2)
  }
}
/** A small GRAVEYARD: leaning headstones, wooden crosses, an iron railing round them (gaps in it). */
export function graveyard(c: Ctx, x0: number, z0: number, rot: number): void {
  const { b, g } = c, cs = Math.cos(rot), sn = Math.sin(rot)
  const P = (lx: number, lz: number) => [x0 + lx * cs + lz * sn, z0 - lx * sn + lz * cs] as const
  for (let i = 0; i < 7; i++) {
    const [x, z] = P(-3 + (i % 4) * 2, -1 + Math.floor(i / 4) * 2.4), y = g(x, z), lean = (b.rnd() - 0.5) * 0.35
    if (i % 3 === 2) {
      b.log(V(x, y - 0.2, z), V(x + lean * 0.3, y + 1.15, z), 0.05, b.wood(0.6))
      beam(b, V(x - 0.35 * cs, y + 0.85, z + 0.35 * sn), V(x + 0.35 * cs, y + 0.85, z - 0.35 * sn), 0.07, 0.07, b.wood(0.6))
    } else {
      b.setSurf(SURF.stone)
      const up = V(lean * sn, 1, lean * cs).normalize()
      b.box(V(x, y + 0.45, z), V(cs, 0, -sn), up, V(sn, 0, cs), 0.3, 0.55, 0.08, shade(C.stone, 0.75 + 0.3 * b.rnd()))
      b.box(V(x, y + 1.0, z).addScaledVector(up, 0.02), V(cs, 0, -sn), up, V(sn, 0, cs), 0.22, 0.08, 0.07, shade(C.stone, 0.8))
      b.setSurf(SURF.wood)
      box(b, x + sn * 0.9, y + 0.06, z + cs * 0.9, 0.35, 0.06, 0.7, [0.08, 0.06, 0.04])
    }
  }
  b.setSurf(SURF.metal)
  const corners: [number, number][] = [[-4.4, -2.2], [4.4, -2.2], [4.4, 3.6], [-4.4, 3.6], [-4.4, -2.2]]
  for (let k = 0; k < 4; k++) {
    const [ax, az] = P(...corners[k]), [bx, bz] = P(...corners[k + 1]), L = Math.hypot(bx - ax, bz - az), n = Math.round(L / 0.3)
    for (let i = 0; i <= n; i++) {
      if (k === 2 && i > n * 0.4 && i < n * 0.6) continue // (the gate's gap)
      const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n, y = g(x, z)
      b.log(V(x, y - 0.1, z), V(x, y + 1.05 + (i % 4 === 0 ? 0.15 : 0), z), 0.015, [0.06, 0.06, 0.06])
    }
    for (const h of [0.25, 0.95]) b.log(V(ax, g(ax, az) + h, az), V(bx, g(bx, bz) + h, bz), 0.018, [0.06, 0.06, 0.06])
  }
  b.setSurf(SURF.wood)
}
/** THE GHOST HOUSE: a two-storey clapboard house gone grey, its roof sagging in, windows broken and boarded — and
 *  one upstairs that, from dusk, holds a cold light that gutters. Dead trees round it, a swing on a rope from one, a
 *  graveyard behind the broken fence, the gate hanging open. */
export function ghostHouse(c: Ctx): void {
  const { b, g } = c
  cabin(c, { walls: 'clap', paint: mixc(PAINTS.white, [0.3, 0.3, 0.28], 0.55), trim: [0.3, 0.29, 0.27], roof: C.shingleGrey, state: 'ruin', w: 9, d: 7, storeys: 2, chimney: 'stone', upper: ['eerie', 'broken', 'boarded'], shutters: [0.12, 0.12, 0.11], model: 'ghost_house' })
  for (const [x, z, h, s] of [[-9, 4, 9, 1], [8.5, -6, 11, 2], [10, 7, 7, 3], [-7, -9, 10, 4], [-13, -2, 8, 5]] as const) { deadTree(b, x, z, g, h, s); c.col(x, 2, z, 0.35, 2, 0.35) }
  // the swing: two ropes from the big dead tree's low branch, the seat
  const sy = g(8.5, -6)
  for (const s of [-0.35, 0.35]) b.log(V(7.1 + s, sy + 4.2, -5.0), V(7.1 + s, sy + 0.7, -5.05), 0.008, C.rope)
  b.log(V(6.4, sy + 4.25, -5.0), V(8.4, sy + 4.5, -5.6), 0.07, [0.1, 0.09, 0.085])
  box(b, 7.1, sy + 0.68, -5.05, 0.42, 0.03, 0.15, b.wood(0.7))
  graveyard(c, -6, -12, 0.25)
  fence(b, [[-11, 9], [-4, 10], [3.5, 10.5]], g, 0.6)
  fence(b, [[5.5, 10.4], [11, 9], [12, 2]], g, 0.6)
  // the gate hanging off its hinge
  b.log(V(4.3, g(4.3, 10.5) + 0.05, 10.7), V(5.3, g(5.3, 10.5) + 1.05, 10.9), 0.05, b.wood(0.7))
  b.log(V(4.2, g(4.2, 10.5) + 0.6, 10.6), V(5.4, g(5.4, 10.5) + 0.3, 11.0), 0.05, b.wood(0.7))
}

/** Old timber SCAFFOLDING against a wall (along z at x): posts, beams, a plank walk, half of it fallen. */
export function scaffold(b: Builder, x: number, z0: number, z1: number, g: Ground, h = 3.2, side = 1): void {
  const n = Math.max(2, Math.round(Math.abs(z1 - z0) / 2.4) + 1)
  for (let i = 0; i < n; i++) {
    const z = z0 + ((z1 - z0) * i) / (n - 1), y = g(x, z), broken = i === n - 1
    if (broken) { b.log(V(x, y + 0.1, z), V(x - side * 2.4, y + 0.35, z + 0.8), 0.1, b.wood(0.55)); continue }
    b.log(V(x, y - 0.2, z), V(x, y + h, z), 0.1, b.wood(0.55 + 0.1 * b.rnd()))
    b.log(V(x + side * 1.1, y - 0.2, z), V(x + side * 1.1, y + h, z), 0.1, b.wood(0.55 + 0.1 * b.rnd()))
    if (i < n - 2) beam(b, V(x, y + 0.4, z), V(x + side * 1.1, y + h - 0.3, z), 0.06, 0.1, b.wood(0.5), Z)
  }
  for (let i = 0; i < n - 2; i++) {
    const za = z0 + ((z1 - z0) * i) / (n - 1), zb = z0 + ((z1 - z0) * (i + 1)) / (n - 1), y = g(x, za) + h * 0.62
    for (let k = 0; k < 4; k++) beam(b, V(x + side * (0.15 + k * 0.27), y, za), V(x + side * (0.15 + k * 0.27), y + (b.rnd() - 0.5) * 0.1, zb), 0.25, 0.05, b.wood(0.85 + 0.25 * b.rnd()))
    beam(b, V(x, g(x, za) + h, za), V(x, g(x, zb) + h, zb), 0.12, 0.14, b.wood(0.6))
  }
  // planks fallen at its broken end
  for (let k = 0; k < 4; k++) { const zz = z1 + (z1 > z0 ? 1 : -1) * (0.5 + k * 0.4); rbox(b, x + side * (0.5 + 0.5 * b.rnd()), g(x, zz) + 0.06, zz, b.rnd() * 3, 1.0, 0.03, 0.12, b.wood(0.8)) }
}

// (THE CAVES were here — the procedural tunnel and grottos; 2026-11-07 the user had them replaced by the one modelled in
//  Blender: CaveWorld.ts, scripts/oth/caves.py)
