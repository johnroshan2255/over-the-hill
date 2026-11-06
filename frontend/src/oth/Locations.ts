import * as GFX from './gfx'
import { type Builder, SURF } from './Bridges'
import {
  backpack, barrel, beam, box, C, campChair, campTable, chimney, chopBlock, clothesline, crate, dock, door, fence, fireRing, fishingSpot,
  foundation, gableRoof, type Ground, headframe, lantern, leanRoof, logWalls, mailbox, oreCart, orePile, panel, pickup, porch, post,
  radioMast, rails, rbox, type RGB, rock, rowboat, shade, steps, stovepipe, tarpShelter, tentA, tentDome, V, warningSign, windowAt,
  type WinState, woodpile, wheel, X, Y, Z, boardWalls, mixc,
} from './Kit'

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
  }
  f(c2)
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
}
/** A CABIN on its foundation (centre 0, 0, its front +z): walls, a real roof, framed windows (lit when lived in;
 *  broken / boarded when not), a door (ajar in a ruin), a porch with steps, a chimney. The colliders, the clearing. */
export function cabin(c: Ctx, o: CabinOpts): void {
  const { b, g } = c
  const w = o.w ?? 8.5, d = o.d ?? 6.5, floor = 0.5, H = 3.3 * (o.storeys ?? 1), ruin = o.state === 'ruin'
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
  foundation(b, w, d, floor, g)
  boardWalls(b, w, d, floor, 2.6, mixc(PAINTS.sage, [0.3, 0.3, 0.28], 0.4), true, C.trim)
  leanRoof(b, w + 0.8, -d / 2 - 0.4, floor + 3.3, d / 2 + 0.6, floor + 2.55, C.tin, true)
  door(b, V(0.8, floor, d / 2 + 0.06), Z, X, 0.55, 2.15, b.wood(0.8), 0.15)
  windowAt(b, V(-1.1, floor + 1.55, d / 2 + 0.06), Z, X, 0.45, 0.4, 'lit', C.trim)
  windowAt(b, V(w / 2 + 0.06, floor + 1.55, 0), X, V(0, 0, -1), 0.45, 0.4, 'dark', C.trim)
  stovepipe(b, -1.4, -0.8, floor + 2.9, floor + 4.2)
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
  cabin(c, { walls: 'clap', paint: [0.42, 0.28, 0.14], trim: [0.55, 0.52, 0.42], roof: C.greenRoof, tin: true, state: 'empty', w: 9, d: 7, chimney: 'pipe', shutters: PAINTS.green })
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
  for (const z of [-3.2, 1.8]) post(b, w / 2 + 2.6, z, floor + 3.0, g, 0.08)
  b.box(V(w / 2 + 1.35, floor + 3.2, -0.7), V(1, -0.25, 0).normalize(), V(0.25, 1, 0).normalize(), Z, 1.45, 0.04, 2.7, C.tin)
  box(b, w / 2 + 1.0, g(w / 2 + 1, -0.7) + 0.9, -0.7, 0.4, 0.05, 1.8, b.wood(1.1))
  for (const z of [-2.3, 0.9]) box(b, w / 2 + 1.0, g(w / 2 + 1, z) + 0.45, z, 0.35, 0.45, 0.05, b.wood(0.8))
  b.setSurf(SURF.metal); box(b, w / 2 + 1.0, g(w / 2 + 1, 0) + 1.05, 0, 0.1, 0.1, 0.12, C.steel); box(b, w / 2 + 1.2, g(w / 2 + 1.2, -2) + 0.27, -2, 0.18, 0.27, 0.08, [0.15, 0.25, 0.1]); b.setSurf(SURF.wood)
}

/** A RIVER SHELTER: a three-sided log lean-to facing the water, a fire before it, a log bench, firewood, a pack. */
export function riverShelter(c: Ctx): void {
  const { b, g } = c
  const w = 4.6, d = 3.2, y = g(0, 0)
  for (let i = 0; i < 7; i++) b.log(V(-w / 2 - 0.3, y + 0.2 + i * 0.34, -d / 2), V(w / 2 + 0.3, y + 0.2 + i * 0.34, -d / 2), 0.17, b.wood(0.85 + 0.2 * b.rnd()))
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) { const t = i / 5, h = 0.2 + i * 0.34; b.log(V(s * w / 2, y + h, -d / 2 - 0.3), V(s * w / 2, y + h, -d / 2 + d * (1 - t * 0.7) + 0.2), 0.16, b.wood(0.85 + 0.2 * b.rnd())) }
  for (const s of [-1, 1]) post(b, s * w / 2, d / 2, y + 2.1, g, 0.12)
  leanRoof(b, w + 1.0, -d / 2 - 0.5, y + 2.75, d / 2 + 0.7, y + 2.0, C.shingle)
  box(b, 0, y + 0.3, -0.5, w / 2 - 0.2, 0.08, 1.1, b.wood(1.0))
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
  sub(c, 10, -8, -0.4, (c2) => cabin(c2, { walls: 'batten', paint: PAINTS.cream, trim: C.trim, roof: C.shingleGrey, state: 'ruin', w: 7.5, d: 6, porch: false, chimney: 'pipe' }))
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
  cabin(c, { walls: 'clap', paint: mixc(PAINTS.white, [0.3, 0.3, 0.28], 0.55), trim: [0.3, 0.29, 0.27], roof: C.shingleGrey, state: 'ruin', w: 9, d: 7, storeys: 2, chimney: 'stone', upper: ['eerie', 'broken', 'boarded'], shutters: [0.12, 0.12, 0.11] })
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

/** CRYSTALS on a cave's wall (glowing day and night, SURF.lamp): a cluster of long pointed prisms out of the rock. */
export function crystals(b: Builder, c: GFX.Vector3, n: Vec, col: RGB, seed: number, size = 1): void {
  let s = (seed * 2654435761) >>> 0
  const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
  b.setSurf(SURF.lamp)
  for (let k = 0; k < 6; k++) {
    const d = n.clone().add(V((rnd() - 0.5) * 1.1, (rnd() - 0.3) * 1.0, (rnd() - 0.5) * 1.1)).normalize()
    const L = (0.45 + 0.7 * rnd()) * size, r = (0.07 + 0.06 * rnd()) * size
    const base = c.clone().add(V((rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.4).multiplyScalar(size))
    const u = new GFX.Vector3().crossVectors(d, Math.abs(d.y) < 0.9 ? Y : X).normalize(), w = new GFX.Vector3().crossVectors(d, u)
    const ring = (t: number, rr: number) => [0, 1, 2, 3, 4, 5].map((i) => base.clone().addScaledVector(d, t).addScaledVector(u, Math.cos(i * 1.047) * rr).addScaledVector(w, Math.sin(i * 1.047) * rr))
    const r0 = ring(0, r), r1 = ring(L * 0.75, r), tip = base.clone().addScaledVector(d, L)
    const k2 = shade(col, 0.8 + 0.4 * rnd())
    for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; b.quad(r0[i], r0[j], r1[j], r1[i], k2); b.tri(r1[i], r1[j], tip, shade(k2, 1.15)) }
  }
  b.setSurf(SURF.wood)
}
type Vec = GFX.Vector3
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

// ===================================================================================================== THE CAVES
// (2026-11-06, the user: "a real cave — grass above it, actual land above it"; "not lots of rocks: the rock texture
//  the terrain uses, inside and out"; "some caves bigger, different shapes, one way in and no way out, big ones with
//  small pines inside and a small opening in the top — no two caves the same"). Every cave is LAND: a hill of turf in
//  the field's own paint over it, its rock one continuous shell in the terrain's cliff paint (SURF.cliff), never a pile
//  of blocks. Built as smooth surfaces (their own normals), one mesh with the place.
type V3 = [number, number, number]
const ss = (e0: number, e1: number, v: number) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t) }
/** A smooth wobble ≈ −1…1 over two coordinates, its own for each seed (sums of three slanted sines). */
function wobble(seed: number): (u: number, v: number) => number {
  let s = (seed * 2654435761) >>> 0
  const r = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
  const k = Array.from({ length: 9 }, r)
  return (u, v) => 0.5 * Math.sin(u * (0.31 + 0.2 * k[0]) + v * (0.17 + 0.2 * k[1]) + 6.28 * k[2]) + 0.3 * Math.sin(u * (0.83 + 0.4 * k[3]) - v * (0.61 + 0.3 * k[4]) + 6.28 * k[5]) + 0.2 * Math.sin(-u * (1.9 + 0.6 * k[6]) + v * (1.5 + 0.5 * k[7]) + 6.28 * k[8])
}
/** A SMOOTH SURFACE: positions (xyz …) and triangles; each triangle turned to face `want` (a direction at its centre),
 *  normals accumulated per vertex; colours from `col` (the vertex, its normal). */
function smoothMesh(b: Builder, P: number[], I: number[], want: (x: number, y: number, z: number) => V3, col: (i: number, n: V3) => V3, surf: number): void {
  const N = new Float32Array(P.length)
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], c1 = I[t + 1], c2 = I[t + 2]
    const ux = P[c1 * 3] - P[a * 3], uy = P[c1 * 3 + 1] - P[a * 3 + 1], uz = P[c1 * 3 + 2] - P[a * 3 + 2]
    const vx = P[c2 * 3] - P[a * 3], vy = P[c2 * 3 + 1] - P[a * 3 + 1], vz = P[c2 * 3 + 2] - P[a * 3 + 2]
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const [wx, wy, wz] = want((P[a * 3] + P[c1 * 3] + P[c2 * 3]) / 3, (P[a * 3 + 1] + P[c1 * 3 + 1] + P[c2 * 3 + 1]) / 3, (P[a * 3 + 2] + P[c1 * 3 + 2] + P[c2 * 3 + 2]) / 3)
    if (nx * wx + ny * wy + nz * wz < 0) { I[t + 1] = c2; I[t + 2] = c1; nx = -nx; ny = -ny; nz = -nz }
    for (const v of [a, c1, c2]) { N[v * 3] += nx; N[v * 3 + 1] += ny; N[v * 3 + 2] += nz }
  }
  const C: number[] = []
  for (let i = 0; i < P.length / 3; i++) {
    const L = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2])
    if (L < 1e-9) { N[i * 3 + 1] = 1 } else { N[i * 3] /= L; N[i * 3 + 1] /= L; N[i * 3 + 2] /= L }
    C.push(...col(i, [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]]))
  }
  b.setSurf(surf)
  b.raw(P, Array.from(N), C, I)
  b.setSurf(SURF.wood)
}
/** The rock's tint (SURF.cliff: the terrain's slab paint × this). */
const CLIFF: V3 = [1.0, 0.97, 0.93]
const cliffCol = (k = 1): V3 => [CLIFF[0] * k, CLIFF[1] * k, CLIFF[2] * k]
/** GRASS TUFTS over a hill: blades in the turf's paint, lit as the ground, lighter to their tips (x, y, z, height,
 *  lean: 0 any way, ±1 out over a brow toward ±z). */
function tuftMesh(b: Builder, tufts: [number, number, number, number, number][], paint: (x: number, z: number) => [number, number]): void {
  const tp: number[] = [], tn: number[] = [], tc: number[] = [], ti: number[] = []
  for (const [x, y, z, h, out] of tufts) {
    const [dry, forest] = paint(x, z)
    for (let q = 0; q < 4; q++) {
      const ang = b.rnd() * 6.283, w = 0.07 + 0.05 * b.rnd(), hh = h * (0.7 + 0.5 * b.rnd())
      const lx = (b.rnd() - 0.5) * 0.5 * hh, lz = out ? out * (0.4 + 0.5 * b.rnd()) * hh : (b.rnd() - 0.5) * 0.5 * hh
      const ox = (b.rnd() - 0.5) * 0.3, oz = (b.rnd() - 0.5) * 0.3, ux = Math.cos(ang) * w, uz = Math.sin(ang) * w
      const tipY = out ? y + hh * 0.35 : y + hh, base = tp.length / 3
      tp.push(x + ox - ux, y - 0.05, z + oz - uz, x + ox + ux, y - 0.05, z + oz + uz, x + ox + lx, tipY, z + oz + lz)
      for (let v = 0; v < 3; v++) { tn.push(0, 1, 0); tc.push(dry, forest, v < 2 ? -0.1 : -1) }
      ti.push(base, base + 1, base + 2, base, base + 2, base + 1)
    }
  }
  b.setSurf(SURF.turf); b.raw(tp, tn, tc, ti); b.setSurf(SURF.wood)
}
/** Tufts scattered over a hill y(x, z) (null: none there) within a box, `per` a square metre, kept off its steep. */
function scatterTufts(b: Builder, out: [number, number, number, number, number][], y: (x: number, z: number) => number | null, g: Ground, x0: number, x1: number, z0: number, z1: number, per: number): void {
  const n = Math.round((x1 - x0) * (z1 - z0) * per)
  for (let q = 0; q < n; q++) {
    const x = x0 + (x1 - x0) * b.rnd(), z = z0 + (z1 - z0) * b.rnd(), hy = y(x, z)
    if (hy === null || hy - g(x, z) < 0.15) continue
    const ya = y(x + 0.6, z), yb = y(x - 0.6, z), yc = y(x, z + 0.6), yd = y(x, z - 0.6)
    if (ya === null || yb === null || yc === null || yd === null || Math.hypot(ya - yb, yc - yd) / 1.2 > 1.1) continue
    out.push([x, hy - 0.05, z, 0.35 + 0.4 * b.rnd() * Math.min(1, (hy - g(x, z)) / 2), 0])
  }
}
/** STALACTITES from a roof y(x, z) (the shell's), their tips ≥ `clear` m over the floor; in the cliff paint. */
function stalactites(b: Builder, n: number, at: () => [number, number], roof: (x: number, z: number) => number, g: Ground, clear: number): void {
  b.setSurf(SURF.cliff)
  for (let k = 0; k < n; k++) {
    const [x, z] = at(), y0 = roof(x, z) + 0.25
    const len = Math.min(0.5 + 1.8 * b.rnd() * b.rnd() + 0.4, y0 - g(x, z) - clear), r = 0.16 + 0.22 * b.rnd()
    if (len < 0.4) continue
    const tip = V(x + (b.rnd() - 0.5) * 0.2, y0 - len, z), col = cliffCol(0.75 + 0.3 * b.rnd())
    const ring = [0, 1, 2, 3, 4].map((q) => V(x + Math.cos(q * 1.2566) * r, y0, z + Math.sin(q * 1.2566) * r))
    for (let q = 0; q < 5; q++) b.tri(ring[(q + 1) % 5], ring[q], tip, col)
  }
  b.setSurf(SURF.wood)
}

/** THE TUNNEL'S HILL: the land over the track, in the tunnel's frame (z the track, the ground g). Its height at (x, z)
 *  — a broad crest ~5.5 m over the vault, falling to the land 10–32 m out each side and steeply past the mouths;
 *  dipping just under the land at its rim (the field's own grass meets it there); null in the road's cut beyond the
 *  mouths. World.ts lifts the trees and bushes that stood here onto it (Sites.dressHills). */
export interface TunnelHill { L: number; Zp: number; Z: number; X: number; Wc: number; a: number; b: number; y: (x: number, z: number) => number | null; gRoad: (z: number) => number }
export function tunnelHill(L: number, g: Ground): TunnelHill {
  const top = 7.2, Zp = L / 2 + 1, Z = Zp + 14, X = 32, Wc = 7.0, a = 6.8, b = 8.0
  let gMid = -Infinity
  for (let z = -Zp; z <= Zp; z += 3) gMid = Math.max(gMid, g(0, z))
  const y = (x: number, z: number) => {
    if (Math.abs(z) > Zp + 1e-3 && Math.abs(x) < Wc - 1e-3) return null
    if (Math.abs(x) > X || Math.abs(z) > Z) return null
    const gt = g(x, z)
    const crest = gMid + top + 5.5 + 0.9 * Math.sin(x * 0.23 + z * 0.11) + 0.6 * Math.sin(z * 0.31 - x * 0.07)
    const f = (1 - ss(10, X, Math.abs(x))) * (1 - ss(Zp - 3, Z, Math.abs(z)))
    return crest > gt ? gt + (crest - gt) * f - 0.5 * (1 - f) : gt - 0.5
  }
  return { L, Zp, Z, X, Wc, a, b, y, gRoad: (z: number) => g(0, z) }
}

/** THE DRIVE-THROUGH TUNNEL: a cave through a HILL over the track (local z its line, the track down the middle): the
 *  hill's turf with grass tufts on it (and World's trees and bushes lifted onto it); each mouth a cliff face over its
 *  arch, the road's cut beyond walled in rock that leans and bulges; inside, ONE vault of rock (uneven, the terrain's
 *  cliff paint, its beds), stalactites, the dark (Atmosphere caveK), CRYSTALS glowing on the walls, lanterns on old
 *  timbers, the miners' broken SCAFFOLDING, a FIRE in an alcove; vines over the mouths; a fence along one approach.
 *  `paint` (local x, z) → the land's [dryness, forest] there. */
export function tunnel(c: Ctx, L: number, paint: (x: number, z: number) => [number, number] = () => [0.7, 0]): void {
  const { b, g } = c
  const W = 5.4, top = 7.2
  const H = tunnelHill(L, g), { Zp, Z, X, Wc, a, b: B } = H
  const wob = wobble(c.seed), wob2 = wobble(c.seed + 7)
  const archY = (x: number, z: number) => H.gRoad(z) - 0.6 + (B + 0.6) * Math.sqrt(Math.max(0, 1 - (x / a) ** 2))
  // the cut's walls: leaning back, bulging (none at the mouth: they meet its face there)
  const cutX = (s: number, z: number, y: number) => { const k = ss(Zp, Zp + 3, Math.abs(z)); return s * (Wc + k * (0.12 * Math.max(0, y - g(s * Wc, z)) + 0.5 * wob(z * 0.8, s * 3) + 0.25 * wob2(z * 1.7, y * 0.9))) }

  // ---- THE HILL: a grid (finer across the road), the cut's edge vertices on its walls
  const xs: number[] = []
  for (let x = -X; x < -Wc - 2.9; x += 1.5) xs.push(x)
  for (let k = 0; k <= 16; k++) xs.push(-Wc + (2 * Wc * k) / 16)
  for (let x = Wc + 3; x <= X + 1e-3; x += 1.5) xs.push(x)
  const zs: number[] = []
  for (let z = -Z; z < -Zp - 0.5; z += 1.5) zs.push(z)
  for (let z = -Zp; z < Zp - 0.5; z += 1.5) zs.push(z)
  zs.push(Zp)
  for (let z = Zp + 1.5; z <= Z + 1e-3; z += 1.5) zs.push(z)
  const nx = xs.length, nz = zs.length, kW0 = xs.indexOf(-Wc), kW1 = xs.indexOf(Wc)
  const TP: number[] = [], TI: number[] = []
  for (let j = 0; j < nz; j++) for (let k = 0; k < nx; k++) {
    const x = xs[k], z = zs[j], y = H.y(x, z) ?? H.y(Math.sign(x || 1) * Wc, z) ?? g(x, z) - 0.5
    const edge = (k === kW0 || k === kW1) && Math.abs(z) > Zp
    TP.push(edge ? cutX(Math.sign(x), z, y) : x, y, z)
  }
  for (let j = 0; j < nz - 1; j++) for (let k = 0; k < nx - 1; k++) {
    if (Math.abs((zs[j] + zs[j + 1]) / 2) > Zp && Math.abs((xs[k] + xs[k + 1]) / 2) < Wc) continue // (the road's cut)
    const p = j * nx + k
    TI.push(p, p + nx, p + 1, p + 1, p + nx, p + nx + 1)
  }
  smoothMesh(b, TP, TI, () => [0, 1, 0], (i, n) => {
    const [dry, forest] = paint(TP[i * 3], TP[i * 3 + 2])
    return [dry, forest, Math.min(1, Math.max(0, (0.62 - n[1]) / 0.2))]
  }, SURF.turf)
  const at = (k: number, j: number) => TP[(j * nx + k) * 3 + 1]

  // ---- THE ROCK: each mouth's face (the arch up to the turf) and the cut's walls (4 rows up, to the turf's edge)
  {
    const P: number[] = [], I: number[] = []
    const quadStrip = (rows: V3[][]) => { // rows[r][q]: a grid of points → triangles
      const base = P.length / 3, w = rows[0].length
      for (const row of rows) for (const p of row) P.push(...p)
      for (let r = 0; r < rows.length - 1; r++) for (let q = 0; q < w - 1; q++) { const o = base + r * w + q; I.push(o, o + w, o + 1, o + 1, o + w, o + w + 1) }
    }
    for (const e of [-1, 1]) {
      const z = e * Zp, j = zs.indexOf(z), bottom: V3[] = [], mid: V3[] = [], topRow: V3[] = []
      for (let k = kW0; k <= kW1; k++) {
        const x = xs[k], y0 = Math.abs(x) < a ? archY(x, z) : g(x, z) - 0.5, y1 = at(k, j)
        bottom.push([x, y0, z]); mid.push([x, (y0 + y1) / 2, z + e * 0.35 * wob(x * 0.7, 1)]); topRow.push([x, y1, z])
      }
      quadStrip([bottom, mid, topRow])
      for (const s of [-1, 1]) {
        const k = s < 0 ? kW0 : kW1, rows: V3[][] = [[], [], [], [], []]
        for (let jj = 0; jj < nz; jj++) {
          const zz = zs[jj]
          if (e * zz < Zp - 1e-3) continue
          const y0 = g(s * Wc, zz) - 0.5, y1 = at(k, jj)
          for (let r = 0; r <= 4; r++) { const y = y0 + ((y1 - y0) * r) / 4; rows[r].push([r === 4 ? TP[(jj * nx + k) * 3] : cutX(s, zz, y), y, zz]) }
        }
        quadStrip(rows)
      }
    }
    smoothMesh(b, P, I, (x, _y, z) => (Math.abs(z) <= Zp + 0.6 ? [0, 0, Math.sign(z)] : [-Math.sign(x), 0, 0]), () => cliffCol(0.9 + 0.15 * b.rnd()), SURF.cliff)
  }

  // ---- THE VAULT: one uneven shell of rock, facing in (no seams, no blocks: the cliff's paint and beds do the rest)
  const shellR = (th: number, z: number) => 1 + 0.085 * ss(Zp, Zp - 2.5, Math.abs(z)) * (wob(th * 2.2, z * 0.55) + 0.6 * wob2(th * 5, z * 1.3))
  {
    const P: number[] = [], I: number[] = [], S = 22
    const zv: number[] = []
    for (let z = -Zp; z < Zp - 0.4; z += 1.2) zv.push(z)
    zv.push(Zp)
    for (const z of zv) for (let t = 0; t <= S; t++) {
      const th = (Math.PI * t) / S, r = shellR(th, z), x = a * Math.cos(th) * r
      P.push(x, t === 0 || t === S ? Math.min(H.gRoad(z) - 0.6, g(x, z) - 1.0) : H.gRoad(z) - 0.6 + (B + 0.6) * Math.sin(th) * r, z)
    }
    for (let r = 0; r < zv.length - 1; r++) for (let t = 0; t < S; t++) { const p = r * (S + 1) + t; I.push(p, p + S + 1, p + 1, p + 1, p + S + 1, p + S + 2) }
    smoothMesh(b, P, I, (x, y, z) => [-x, H.gRoad(z) + 1 - y, 0], () => cliffCol(0.85 + 0.2 * b.rnd()), SURF.cliff)
  }
  const roof = (x: number, z: number) => archY(x, z)
  stalactites(b, 22, () => [(b.rnd() - 0.5) * 8, -Zp + 2.5 + (2 * Zp - 5) * b.rnd()], roof, g, 5)
  // the walls' colliders (the car keeps to the floor)
  for (let z = -Zp + 1.3; z <= Zp - 1; z += 2.6) for (const s of [-1, 1]) c.col(s * (W + 1.3), g(s * W, z) + 2, z, 1.5, 2.2, 1.4)

  // ---- GRASS: on the hill, and a fringe over each mouth's brow
  const tufts: [number, number, number, number, number][] = []
  for (const e of [-1, 1]) for (let x = -Wc - 3; x <= Wc + 3; x += 0.6) {
    const hy = H.y(Math.max(Math.abs(x), Wc) * Math.sign(x || 1), e * (Zp - 0.3))
    if (hy !== null) tufts.push([x, hy - 0.1, e * (Zp + 0.05), 1.0, e])
  }
  scatterTufts(b, tufts, H.y, g, -X, X, -Z, Z, 1.4)
  tuftMesh(b, tufts, paint)
  // the mouths' vines: hanging from the arch's rim
  b.setSurf(SURF.fabric)
  const moss: RGB = [0.1, 0.17, 0.07]
  for (const e of [-1, 1]) for (let k = 0; k < 14; k++) {
    const x = (b.rnd() - 0.5) * 2 * (a - 1.2), z = e * (Zp + 0.15), y0 = archY(x, z) + 0.1, len = 0.8 + 2.4 * b.rnd() * Math.sqrt(1 - (x / a) ** 2)
    panel(b, V(x - 0.12, y0, z), V(x + 0.12, y0, z), V(x + 0.07, y0 - len, z + e * 0.05), V(x - 0.07, y0 - len, z + e * 0.05), shade(moss, 1.1 + 0.4 * b.rnd()), shade(moss, 0.7))
  }
  b.setSurf(SURF.wood)
  // ---- THE HILL'S BULK for the car: a box per 3 m row each side, out to where the bank is under ~1.5 m; the cut's walls
  for (let z = -Z + 1.5; z <= Z - 1.5; z += 3) {
    for (const s of [-1, 1]) {
      const x0 = Math.abs(z) > Zp ? Wc + 2.6 : W + 2.8
      let x1 = x0, hi = -Infinity, lo = Infinity
      for (let x = x0; x <= X; x += 1) { const hy = H.y(s * x, z), gy = g(s * x, z); if (hy === null || hy - gy < 1.5) break; x1 = x; hi = Math.max(hi, hy); lo = Math.min(lo, gy) }
      if (x1 - x0 >= 0.9) c.col(s * (x0 + x1) / 2, (hi + lo) / 2, z, (x1 - x0) / 2, (hi - lo) / 2, 1.5)
      if (Math.abs(z) > Zp) { const hy = H.y(s * Wc, z), gy = g(s * Wc, z); if (hy !== null && hy - gy > 0.8) c.col(s * (Wc + 1.3), (gy + hy) / 2, z, 1.3, Math.max(0.5, (hy - gy) / 2), 1.5) }
    }
  }
  c.col(0, top + 2.2, 0, Wc + 3, 1.6, Zp)

  // ---- INSIDE: crystals in clusters on both walls (teal and amber), lanterns on timber posts, the scaffolding, the fire
  for (let k = 0; k < 7; k++) {
    const s = k % 2 ? 1 : -1, z = -L / 2 + 4 + k * ((L - 8) / 6)
    crystals(b, V(s * (W + 0.3), g(s * W, z) + 1.0 + 1.6 * b.rnd(), z), V(-s, 0.3, 0), k % 3 === 2 ? [0.6, 0.38, 0.12] : [0.12, 0.48, 0.52], c.seed * 17 + k, 1.2)
  }
  for (const z of [-L / 4, L / 4]) { b.log(V(-4.3, g(-4.3, z) - 0.2, z), V(-4.3, g(-4.3, z) + 3.4, z), 0.1, b.wood(0.6)); lantern(b, -4.0, g(-4.3, z) + 3.0, z) }
  scaffold(b, -4.6, -L / 2 + 4, -2, g, 3.2, 1)
  fireRing(b, 3.9, 3, g, true)
  b.log(V(4.4, g(4.4, 4.5) + 0.2, 4.5), V(4.6, g(4.6, 6.4) + 0.2, 6.4), 0.2, b.wood(0.9))
  backpack(b, 4.5, g(4.5, 1.0), 1.0, Math.PI / 2, [0.3, 0.12, 0.06])
  // ---- THE APPROACH: an old rail fence along one side of the road into the near mouth
  fence(b, [[-Wc - 0.8, Z - 2], [-Wc - 1.2, Z + 6], [-Wc - 0.6, Z + 14]], g, 0.15)
  c.clear(0, 0, W, L / 2 + 1)
}

// --------------------------------------------------------------------------------------------- the one-way caves
/** A CAVERN's make (Landmark.style): `sky` a great chamber with a hole in its roof — a shaft of daylight, grass and
 *  young pines growing in it; `hall` a long gallery the old survey camped in, its crystals; `den` a small low cave an
 *  animal keeps. Each one way in, no way out; its shape varied again by its seed (the mouth's line, the walls' bulge). */
export type CaveStyle = 'sky' | 'hall' | 'den'
interface CaveSpec { Rx: number; Rz: number; Ry: number; aw: number; ah: number; pass: number; sky: number }
const CAVE: Record<CaveStyle, CaveSpec> = {
  sky: { Rx: 16, Rz: 14, Ry: 11, aw: 6.2, ah: 7.6, pass: 7, sky: 3.4 },
  hall: { Rx: 9, Rz: 19, Ry: 8.5, aw: 5.6, ah: 6.8, pass: 5, sky: 0 },
  den: { Rx: 7, Rz: 7.5, Ry: 5.2, aw: 4.6, ah: 4.6, pass: 4, sky: 0 },
}
/** THE CAVERN'S LAND (shared by the builder and Sites.dressHills): in its frame (the mouth at the origin facing +z,
 *  the chamber behind at z = zc): the hill's height (null past it or in the roof's hole), the chamber's shape, the
 *  skylight (its centre (0, zc), radius). */
export interface CavernLand { spec: CaveSpec; X: number; zb: number; zc: number; y0: number; yc: number; y: (x: number, z: number) => number | null; inside: (x: number, z: number) => boolean }
export function cavernLand(style: CaveStyle, seed: number, g: Ground): CavernLand {
  const sp = { ...CAVE[style] }
  // (no two the same: the seed stretches it a little every way)
  let s = (seed * 2654435761) >>> 0
  const r = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
  sp.Rx *= 0.85 + 0.3 * r(); sp.Rz *= 0.85 + 0.3 * r(); sp.Ry *= 0.9 + 0.2 * r(); sp.aw *= 0.9 + 0.2 * r(); sp.ah *= 0.9 + 0.2 * r()
  const zc = -(sp.pass + sp.Rz), X = sp.Rx + 14, zb = zc - sp.Rz - 13, y0 = g(0, 0) - 0.6
  let yc = -Infinity
  for (let k = 0; k < 9; k++) yc = Math.max(yc, g(Math.cos(k * 0.7) * sp.Rx * 0.6, zc + Math.sin(k * 0.7) * sp.Rz * 0.6))
  yc -= 0.6
  const crest0 = yc + sp.Ry + 3.2, hx = sp.sky * 1.35, hz = sp.sky * 1.35 * (sp.Rz / sp.Rx)
  const y = (x: number, z: number) => {
    if (Math.abs(x) > X || z < zb || z > 0.01) return null
    const gt = g(x, z)
    const crest = Math.max(crest0, y0 + sp.ah + 3) + 0.9 * Math.sin(x * 0.21 + z * 0.13) + 0.6 * Math.sin(z * 0.29 - x * 0.09)
    const f = (1 - ss(sp.Rx * 0.85, X, Math.abs(x))) * (1 - ss(zc - sp.Rz * 0.7, zb, z))
    let v = crest > gt ? gt + (crest - gt) * f - 0.5 * (1 - f) : gt - 0.5
    if (sp.sky > 0) { const d = Math.hypot(x / hx, (z - zc) / hz); if (d < 1) return null; v -= 0.6 * (1 - ss(1, 1.8, d)) } // (the rim dips to the hole)
    return v
  }
  const inside = (x: number, z: number) => (z <= 1 && z >= zc && Math.abs(x) < sp.aw + 1.5) || ((x / (sp.Rx + 1.5)) ** 2 + ((z - zc) / (sp.Rz + 1.5)) ** 2 < 1)
  return { spec: sp, X, zb, zc, y0, yc, y, inside }
}

/** A ONE-WAY CAVE in its own hill: the hill's front a CLIFF FACE (leaning back, bulging) with the mouth in it, a short
 *  passage, then the CHAMBER — a dome of rock (the cliff paint), its floor the land; a skylight's shaft (`sky`) up
 *  through the hill to the turf; turf and tufts over all of it (the trees lifted onto it, pines in the shaft: World).
 *  `paint` (local x, z) → the land's [dryness, forest]. Returns where the fire is (if any). */
export function cavern(c: Ctx, style: CaveStyle, paint: (x: number, z: number) => [number, number]): [number, number] | null {
  const { b, g } = c
  const land = cavernLand(style, c.seed, g), { spec: sp, X, zb, zc, y0, yc } = land
  const wob = wobble(c.seed), wob2 = wobble(c.seed + 3)
  const hx = sp.sky * 1.35, hz = sp.sky * 1.35 * (sp.Rz / sp.Rx)
  // the mouth's outline at angle φ (0 right foot … π left foot): an arch, its line wandering
  const mr = (ph: number) => 1 + 0.12 * wob(ph * 2.3, 0.5) + 0.06 * wob2(ph * 6, 1.1)
  const mouthAt = (ph: number, sc = 1): [number, number] => [sp.aw * sc * mr(ph) * Math.cos(ph), y0 + sp.ah * sc * mr(ph) * Math.sin(ph)]
  const wallZ = (x: number, y: number) => Math.max(-7.2, -0.32 * Math.max(0, y - y0) + 1.5 * wob(x * 0.22, y * 0.2) + 0.55 * wob2(x * 0.8, y * 0.75) + 0.6 * Math.sin(y * 1.1 + x * 0.15))

  // ---- THE HILL: a grid back from the face (its front row the face's top edge), the hole pushed out to its rim
  const xs: number[] = [], zs: number[] = []
  for (let x = -X; x <= X + 1e-3; x += 1.5) xs.push(x)
  for (let z = zb; z < -8.9; z += 1.5) zs.push(z)
  zs.push(0)
  const nx = xs.length, nz = zs.length
  const TP: number[] = [], TI: number[] = []
  for (let j = 0; j < nz; j++) for (let k = 0; k < nx; k++) {
    let x = xs[k], z = zs[j]
    if (sp.sky > 0) { const d = Math.hypot(x / hx, (z - zc) / hz); if (d < 1) { const q = 1.0001 / Math.max(d, 1e-3); x *= q; z = zc + (z - zc) * q } }
    const y = land.y(x, Math.min(z, -2)) ?? land.y(x * 1.02, zc + (z - zc) * 1.02) ?? g(x, z) - 0.5
    TP.push(x, y, j === nz - 1 ? wallZ(x, y) : z)
  }
  for (let j = 0; j < nz - 1; j++) for (let k = 0; k < nx - 1; k++) { const p = j * nx + k; TI.push(p, p + nx, p + 1, p + 1, p + nx, p + nx + 1) }
  smoothMesh(b, TP, TI, () => [0, 1, 0], (i, n) => {
    const [dry, forest] = paint(TP[i * 3], TP[i * 3 + 2])
    return [dry, forest, Math.min(1, Math.max(0, (0.62 - n[1]) / 0.2))]
  }, SURF.turf)

  // ---- THE FACE: from the mouth's line out to the hill's front edge (each edge vertex its own ray), leaning, bulging
  const front: [number, number][] = []
  for (let k = 0; k < nx; k++) front.push([TP[((nz - 1) * nx + k) * 3], TP[((nz - 1) * nx + k) * 3 + 1]])
  const angle = (x: number, y: number) => Math.min(Math.PI, Math.max(0, Math.atan2((y - y0) / sp.ah, x / sp.aw)))
  const inner: [number, number][] = front.map(([x, y]) => mouthAt(angle(x, y)))
  {
    const P: number[] = [], I: number[] = [], R = 5
    for (let r = 0; r <= R; r++) for (let k = 0; k < nx; k++) {
      const t = (r / R) ** 1.4, [xi, yi] = inner[k], [xo, yo] = front[k]
      const x = xi + (xo - xi) * t, y = r === R ? yo : yi + (yo - yi) * t
      // (the foot of the face on the land; its top edge the hill's own front row)
      const yy = r > 0 && r < R && (k === 0 || k === nx - 1) ? Math.min(y, g(x, 0) - 0.5) : y
      P.push(x, yy, r === R ? TP[((nz - 1) * nx + k) * 3 + 2] : wallZ(x, yy) * (r === 0 ? 0.6 : 1))
    }
    for (let r = 0; r < R; r++) for (let k = 0; k < nx - 1; k++) { const o = r * nx + k; I.push(o, o + nx, o + 1, o + 1, o + nx, o + nx + 1) }
    smoothMesh(b, P, I, () => [0, 0, 1], () => cliffCol(0.88 + 0.2 * b.rnd()), SURF.cliff)
  }
  // ---- THE PASSAGE: the mouth's line carried back into the chamber, widening, its walls wandering
  const zEnd = zc + sp.Rz * 0.82, J = Math.max(3, Math.ceil(-zEnd / 1.5))
  {
    const P: number[] = [], I: number[] = []
    for (let j = 0; j <= J; j++) {
      const t = j / J, sc = 1 + 0.25 * t * t
      for (let k = 0; k < nx; k++) {
        const ph = angle(front[k][0], front[k][1])
        if (j === 0) { P.push(inner[k][0], inner[k][1], wallZ(inner[k][0], inner[k][1]) * 0.6); continue }
        const q = 1 + 0.07 * wob2(ph * 3, t * 4) * Math.sin(Math.PI * t)
        const [x, y] = mouthAt(ph, sc * q)
        // (its end just inside the chamber's wall there: the dome's front at this x, y, less a margin for its bulge)
        const zd = zc + sp.Rz * Math.sqrt(Math.max(0, 1 - (x / sp.Rx) ** 2 - ((y - yc) / sp.Ry) ** 2)) - 1.6, z = Math.max(zd, zc) * t
        P.push(x, ph <= 1e-3 || ph >= Math.PI - 1e-3 ? g(x, z) - 0.6 : y, z)
      }
    }
    for (let j = 0; j < J; j++) for (let k = 0; k < nx - 1; k++) { const o = j * nx + k; I.push(o, o + nx, o + 1, o + 1, o + nx, o + nx + 1) }
    smoothMesh(b, P, I, (x, y) => [-x, y0 + sp.ah * 0.35 - y, 0], () => cliffCol(0.82 + 0.2 * b.rnd()), SURF.cliff)
  }
  // ---- THE CHAMBER: a dome (rows from under the floor to its crown or the skylight's ring), the passage's way in cut
  const T = 36, rowsPh: number[] = []
  const phTop = sp.sky > 0 ? Math.acos(Math.min(0.95, sp.sky / sp.Rx)) : Math.PI / 2
  for (let i = 0; i <= 10; i++) rowsPh.push(-0.12 + ((phTop + 0.12) * i) / 10)
  const domeR = (th: number, ph: number) => 1 + 0.09 * wob(th * 3.1, ph * 4) + 0.05 * wob2(th * 7, ph * 9)
  const domeAt = (th: number, ph: number): V3 => {
    const r = domeR(th, ph)
    return [sp.Rx * Math.cos(ph) * Math.sin(th) * r, yc + sp.Ry * Math.sin(ph) * r, zc + sp.Rz * Math.cos(ph) * Math.cos(th) * r]
  }
  {
    const P: number[] = [], I: number[] = []
    for (const ph of rowsPh) for (let t = 0; t <= T; t++) {
      const v = domeAt((2 * Math.PI * t) / T, ph)
      if (ph === rowsPh[0]) v[1] = Math.min(v[1], g(v[0], v[2]) - 1.2) // (its foot always under the land: no light under it)
      P.push(...v)
    }
    const wayIn = (x: number, y: number, z: number) => z > zc && Math.abs(x) < sp.aw * 1.12 && y < y0 + sp.ah * 1.12 * Math.sqrt(Math.max(0, 1 - (x / (sp.aw * 1.12)) ** 2))
    for (let i = 0; i < rowsPh.length - 1; i++) for (let t = 0; t < T; t++) {
      const o = i * (T + 1) + t, quad = [o, o + T + 1, o + 1, o + T + 2]
      if (quad.every((v) => wayIn(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]))) continue
      I.push(o, o + T + 1, o + 1, o + 1, o + T + 1, o + T + 2)
    }
    smoothMesh(b, P, I, (x, y, z) => [-x, yc + 1 - y, zc - z], () => cliffCol(0.8 + 0.22 * b.rnd()), SURF.cliff)
  }
  // ---- THE SKYLIGHT'S SHAFT: from the dome's top ring up through the hill to a lip over the turf's hole
  if (sp.sky > 0) {
    const P: number[] = [], I: number[] = []
    for (let t = 0; t <= T; t++) {
      const th = (2 * Math.PI * t) / T, [x0, y0d, z0] = domeAt(th, phTop)
      const x1 = hx * 1.02 * Math.sin(th), z1 = zc + hz * 1.02 * Math.cos(th), y1 = (land.y(x1 * 1.05, zc + (z1 - zc) * 1.05) ?? y0d + 3) + 0.15
      const xm = (x0 + x1) / 2 + 0.4 * wob(th * 3, 2) * Math.sin(th), zm = (z0 + z1) / 2 + 0.4 * wob(th * 3, 2) * Math.cos(th)
      P.push(x0, y0d, z0, xm, (y0d + y1) / 2, zm, x1, y1, z1)
    }
    for (let t = 0; t < T; t++) for (let r = 0; r < 2; r++) { const o = t * 3 + r; I.push(o, o + 3, o + 1, o + 1, o + 3, o + 4) }
    smoothMesh(b, P, I, (x, _y, z) => [-x, 0, zc - z], () => cliffCol(0.85 + 0.2 * b.rnd()), SURF.cliff)
  }
  const roof = (x: number, z: number) => {
    if (z > zEnd) { const ph = Math.acos(Math.min(1, Math.abs(x) / sp.aw)); return mouthAt(ph)[1] }
    const u = x / sp.Rx, v = (z - zc) / sp.Rz
    return yc + sp.Ry * Math.sqrt(Math.max(0, 1 - u * u - v * v))
  }
  const inChamber = () => { for (;;) { const u = (b.rnd() - 0.5) * 1.6, v = (b.rnd() - 0.5) * 1.6; if (u * u + v * v < 0.6) return [u * sp.Rx, zc + v * sp.Rz] as [number, number] } }
  stalactites(b, style === 'den' ? 6 : style === 'hall' ? 26 : 18, () => {
    for (;;) { const p = inChamber(); if (!sp.sky || Math.hypot(p[0] / hx, (p[1] - zc) / hz) > 1.4) return p }
  }, roof, g, style === 'den' ? 2.6 : 4.5)

  // ---- GRASS on the hill, a fringe over the face's brow
  const tufts: [number, number, number, number, number][] = []
  for (let k = 0; k < nx; k++) for (let q = 0; q < 3; q++) {
    const [x, y] = front[k], xx = x + (b.rnd() - 0.5) * 1.5
    if (y - g(x, 0) > 0.6) tufts.push([xx, y - 0.1, TP[((nz - 1) * nx + k) * 3 + 2] + 0.05, 0.9, 1])
  }
  scatterTufts(b, tufts, land.y, g, -X, X, zb, 0, 1.4)
  tuftMesh(b, tufts, paint)
  // vines over the mouth
  b.setSurf(SURF.fabric)
  const moss: RGB = [0.1, 0.17, 0.07]
  for (let k = 0; k < 12; k++) {
    const ph = 0.5 + (Math.PI - 1) * b.rnd(), [x, y] = mouthAt(ph), z = wallZ(x, y) * 0.6 + 0.1, len = 0.6 + 2.2 * b.rnd() * Math.sin(ph)
    panel(b, V(x - 0.12, y, z), V(x + 0.12, y, z), V(x + 0.07, y - len, z + 0.05), V(x - 0.07, y - len, z + 0.05), shade(moss, 1.1 + 0.4 * b.rnd()), shade(moss, 0.7))
  }
  b.setSurf(SURF.wood)

  // ---- FOR THE CAR: the chamber's and passage's walls, the hill's bulk (rows), the face beside the mouth
  for (let k = 0; k < 26; k++) {
    const th = (2 * Math.PI * k) / 26, x = (sp.Rx + 1.2) * Math.sin(th), z = zc + (sp.Rz + 1.2) * Math.cos(th)
    if (z > zc && Math.abs(x) < sp.aw * 1.3) continue
    c.col(x, g(x, z) + 2.5, z, 1.4, 2.6, 1.4)
  }
  for (let z = -1.5; z > zEnd; z -= 2.5) for (const s of [-1, 1]) c.col(s * (sp.aw * (1 + 0.25 * (z / zEnd) ** 2) + 1.2), g(s * sp.aw, z) + 2, z, 1.2, 2.2, 1.3)
  for (let z = zb + 1.5; z <= -1.5; z += 3) for (const s of [-1, 1]) {
    const v = (z - zc) / sp.Rz, xin = z > zEnd ? sp.aw * 1.3 + 2.4 : Math.abs(v) < 1 ? sp.Rx * Math.sqrt(1 - v * v) + 2.6 : 0
    let x1 = xin, hi = -Infinity, lo = Infinity
    for (let x = Math.max(xin, 0.5); x <= X; x += 1) { const hy = land.y(s * x, z), gy = g(s * x, z); if (hy === null || hy - gy < 1.5) break; x1 = x; hi = Math.max(hi, hy); lo = Math.min(lo, gy) }
    if (x1 - xin >= 0.9) c.col(s * (xin + x1) / 2, (hi + lo) / 2, z, (x1 - xin) / 2, (hi - lo) / 2, 1.5)
  }
  c.col(0, yc + sp.Ry + 1.6, zc, sp.Rx, 1.2, sp.Rz) // (nothing drives onto its roof)

  // ---- INSIDE, its own: the grass kept off the floor (but under the skylight), and what's there
  const rs = sp.sky * 1.2
  if (sp.sky > 0) {
    c.clear(-(sp.Rx + rs) / 2, zc, (sp.Rx - rs) / 2, sp.Rz); c.clear((sp.Rx + rs) / 2, zc, (sp.Rx - rs) / 2, sp.Rz)
    c.clear(0, zc + (sp.Rz + rs) / 2, rs, (sp.Rz - rs) / 2); c.clear(0, zc - (sp.Rz + rs) / 2, rs, (sp.Rz - rs) / 2)
  } else c.clear(0, zc, sp.Rx, sp.Rz)
  c.clear(0, zEnd / 2, sp.aw, -zEnd / 2)
  let fire: [number, number] | null = null
  if (style === 'sky') {
    // fallen trunks, mossy, in the light; ferns and young pines there (World)
    for (let k = 0; k < 3; k++) { const a = b.rnd() * 6.28, d = rs + 1 + 3 * b.rnd(), x = Math.sin(a) * d, z = zc + Math.cos(a) * d, a2 = a + 1.2 + b.rnd(); b.log(V(x, g(x, z) + 0.25, z), V(x + Math.sin(a2) * 4, g(x + Math.sin(a2) * 4, z + Math.cos(a2) * 4) + 0.3, z + Math.cos(a2) * 4), 0.3, b.wood(0.7)) }
    crystals(b, V(-sp.Rx * 0.75, g(-sp.Rx * 0.75, zc - 3) + 1.4, zc - 3), V(1, 0.4, 0.2), [0.12, 0.48, 0.52], c.seed * 29, 1.5)
  } else if (style === 'hall') {
    // the survey's camp: fire, bedroll, crates, a lantern; crystals down both walls; timbers propping the roof
    const fz = zc + sp.Rz * 0.35
    fireRing(b, -1.2, fz, g, true); fire = [-1.2, fz]
    b.setSurf(SURF.fabric); rbox(b, -3.4, g(-3.4, fz - 0.5) + 0.12, fz - 0.5, 0.3, 0.45, 0.12, 1.0, [0.3, 0.12, 0.08]); b.setSurf(SURF.wood)
    crate(b, -3.8, g(-3.8, fz - 3), fz - 3, 0.4, 0.4); crate(b, -3.0, g(-3, fz - 3.4), fz - 3.4, 0.1, 0.32); lantern(b, -3.8, g(-3.8, fz - 3) + 0.95, fz - 3)
    for (let k = 0; k < 9; k++) {
      const s = k % 2 ? 1 : -1, z = zc + sp.Rz * (0.6 - 1.25 * (k / 8)), w = sp.Rx * Math.sqrt(Math.max(0.05, 1 - ((z - zc) / sp.Rz) ** 2)) - 0.6
      crystals(b, V(s * w, g(s * w, z) + 0.8 + 2 * b.rnd(), z), V(-s, 0.3, 0.1), k % 3 === 1 ? [0.45, 0.2, 0.55] : [0.12, 0.48, 0.52], c.seed * 19 + k, 1.3)
    }
    for (const [x, z] of [[-3.4, zc + 4], [3.4, zc - 2]] as const) { const h = roof(x, z) - g(x, z) - 0.3; b.log(V(x, g(x, z) - 0.2, z), V(x, g(x, z) + h, z), 0.14, b.wood(0.55)); beam(b, V(x - 0.9, g(x, z) + h, z), V(x + 0.9, g(x, z) + h, z), 0.2, 0.2, b.wood(0.5)) }
    scaffold(b, sp.Rx * 0.55, zc - 3, zc + 4, g, 3.0, -1)
  } else {
    // the den: a nest of broken branches at the back, old bones, a torn pack
    const nz0 = zc - sp.Rz * 0.4
    for (let k = 0; k < 14; k++) { const a = b.rnd() * 6.28, r = 0.8 + 1.4 * b.rnd(), x = Math.sin(a) * r, z = nz0 + Math.cos(a) * r, a2 = b.rnd() * 6.28; b.log(V(x, g(x, z) + 0.1 + 0.2 * b.rnd(), z), V(x + Math.sin(a2) * 1.6, g(x, z) + 0.15 + 0.2 * b.rnd(), z + Math.cos(a2) * 1.6), 0.05, b.wood(0.8)) }
    for (let k = 0; k < 6; k++) { const x = (b.rnd() - 0.5) * 6, z = nz0 + 2 + 3 * b.rnd(), a2 = b.rnd() * 6.28; b.setSurf(SURF.plain); b.log(V(x, g(x, z) + 0.05, z), V(x + Math.sin(a2) * 0.5, g(x, z) + 0.06, z + Math.cos(a2) * 0.5), 0.035, [0.6, 0.57, 0.5]); b.setSurf(SURF.wood) }
    backpack(b, 2.2, g(2.2, nz0 + 3), nz0 + 3, 1.2, [0.18, 0.2, 0.1])
  }
  return fire
}
