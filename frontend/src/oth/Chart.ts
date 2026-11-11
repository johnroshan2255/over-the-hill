import type { Landmark, MapData, MapMeta, OutPlace } from './MapData'
import { WORLDS, type WorldId } from './World'

/**
 * THE CHART: a world's ground painted top-down once — hillshade (light from the north-west), 40 m contours, the colour
 * fields (meadow green → golden straw, forest, rock, snow, water, mud) under a warm paper tint — for the MAP (MapView)
 * and the RADAR (Radar). The tracks, bridges, places and the route are drawn over it as lines each time (sharp at any
 * zoom, and never stale).
 *
 * Painted a SLICE A FRAME (`step(ms)`: the heights, then the colours, a few rows at a time) from the moment a world is
 * entered — no hitch; the map opened before it's done finishes it at once (~60 ms on a PC at 1024²).
 * The OTHER world's chart (the map's other tab, before it's ever built) is the baked `chart.webp` beside its map files
 * (scripts/harness/chartbake.mjs — re-run it after a map is rebuilt).
 */
export class Chart {
  readonly canvas = document.createElement('canvas')
  /** THE OUTLAND's chart (2026-11-11 — the playable land beyond the box, MapData.play): the same paper, coarser — its
   *  relief, rock, the early snow — FAR_S² over ± `farHalf`; null for a world that is all box. The map lays the box's
   *  chart over its middle. */
  readonly far: HTMLCanvasElement | null = null
  readonly farHalf: number = 0
  ready = false
  private readonly gen: Generator<void, void, void>

  constructor(map: MapData, readonly S: number) {
    this.canvas.width = this.canvas.height = S
    if (map.play > map.half + 100) { this.far = document.createElement('canvas'); this.far.width = this.far.height = FAR_S; this.farHalf = map.play }
    this.gen = this.paint(map)
  }

  /** Paint for up to `ms`. */
  step(ms: number): void {
    if (this.ready) return
    const t = performance.now()
    while (performance.now() - t < ms) if (this.gen.next().done) { this.ready = true; return }
  }

  finish(): void { while (!this.ready) this.step(1e9) }

  private *paint(map: MapData): Generator<void, void, void> {
    const S = this.S, g = this.canvas.getContext('2d')!, img = g.createImageData(S, S), half = map.half, mk: [number, number, number, number] = [0, 0, 0, 0]
    const cell = (2 * half) / S
    const H = new Float32Array(S * S)
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) H[j * S + i] = map.height(-half + (i + 0.5) * cell, -half + (j + 0.5) * cell)
      if ((j & 15) === 15) yield
    }
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const x = -half + (i + 0.5) * cell, z = -half + (j + 0.5) * cell, h = H[j * S + i]
        const m = map.maskAt(x, z, mk), mud = map.mudAt(x, z)
        // the colour fields
        const dry = m[1]
        let r = 0.44 + (0.83 - 0.44) * dry, gg = 0.58 + (0.72 - 0.58) * dry, b = 0.33 + (0.45 - 0.33) * dry
        const f = m[3]; r += (0.24 - r) * f; gg += (0.4 - gg) * f; b += (0.25 - b) * f
        const rk = Math.min(1, m[0] * 1.3); r += (0.6 - r) * rk; gg += (0.59 - gg) * rk; b += (0.57 - b) * rk
        const sn = Math.max(0, Math.min(1, (h - 470) / 80)); r += (0.94 - r) * sn; gg += (0.95 - gg) * sn; b += (0.97 - b) * sn
        r += (0.42 - r) * mud; gg += (0.31 - gg) * mud; b += (0.2 - b) * mud
        if (m[2] > 0.9) { r = 0.47; gg = 0.67; b = 0.79 }
        // hillshade (light from the north-west; scaled to the 640² chart's 6.4 m cells) and 40 m contours
        const hx = H[j * S + Math.min(S - 1, i + 1)] - H[j * S + Math.max(0, i - 1)], hz = H[Math.min(S - 1, j + 1) * S + i] - H[Math.max(0, j - 1) * S + i]
        const sh = Math.max(0.55, Math.min(1.25, 1 + (-hx - hz) * 0.06 * (6.4 / cell)))
        let k = sh
        if (m[2] <= 0.9 && Math.floor(h / 40) !== Math.floor(H[j * S + Math.min(S - 1, i + 1)] / 40)) k *= 0.9
        if (m[2] <= 0.9 && Math.floor(h / 40) !== Math.floor(H[Math.min(S - 1, j + 1) * S + i] / 40)) k *= 0.9
        // a warm paper tint over all
        const o = (j * S + i) * 4
        img.data[o] = Math.min(255, (r * k * 0.86 + 0.95 * 0.14) * 255)
        img.data[o + 1] = Math.min(255, (gg * k * 0.86 + 0.9 * 0.14) * 255)
        img.data[o + 2] = Math.min(255, (b * k * 0.86 + 0.78 * 0.14) * 255)
        img.data[o + 3] = 255
      }
      if ((j & 7) === 7) yield
    }
    g.putImageData(img, 0, 0)
    if (this.far) yield* this.paintFar(map, this.far)
  }

  /** The outland: meadow, rock where it's steep, the early snow (meta.outland.snow) and the far ranges', hillshade, 80 m contours. */
  private *paintFar(map: MapData, canvas: HTMLCanvasElement): Generator<void, void, void> {
    const S = FAR_S, g = canvas.getContext('2d')!, img = g.createImageData(S, S), half = map.play, cell = (2 * half) / S
    const H = new Float32Array(S * S), sn0 = map.meta.outland?.snow
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) H[j * S + i] = map.height(-half + (i + 0.5) * cell, -half + (j + 0.5) * cell)
      if ((j & 31) === 31) yield
    }
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const x = -half + (i + 0.5) * cell, z = -half + (j + 0.5) * cell, h = H[j * S + i]
        const hx = H[j * S + Math.min(S - 1, i + 1)] - H[j * S + Math.max(0, i - 1)], hz = H[Math.min(S - 1, j + 1) * S + i] - H[Math.max(0, j - 1) * S + i]
        const slope = Math.hypot(hx, hz) / (2 * cell)
        let r = 0.66, gg = 0.66, b = 0.41
        const low = Math.max(0, Math.min(1, (330 - h) / 160)); r += (0.5 - r) * low * 0.6; gg += (0.6 - gg) * low * 0.6; b += (0.34 - b) * low * 0.6   // (the valley floors greener)
        const rk = Math.max(0, Math.min(1, (slope - 0.5) / 0.4)); r += (0.6 - r) * rk; gg += (0.59 - gg) * rk; b += (0.57 - b) * rk
        let line = 900
        if (sn0) { const d = Math.hypot(x - sn0.x, z - sn0.z), t = Math.max(0, Math.min(1, (d - 0.45 * sn0.r) / (0.55 * sn0.r))); line = sn0.line + (900 - sn0.line) * t * t * (3 - 2 * t) }
        const sn = Math.max(0, Math.min(1, (h - line - 40) / 150)) * (1 - 0.6 * rk); r += (0.95 - r) * sn; gg += (0.96 - gg) * sn; b += (0.98 - b) * sn
        if (map.lakeAt(x, z) !== null) { r = 0.47; gg = 0.67; b = 0.79 }
        let k = Math.max(0.55, Math.min(1.25, 1 + (-hx - hz) * 0.06 * (6.4 / cell)))
        if (Math.floor(h / 80) !== Math.floor(H[j * S + Math.min(S - 1, i + 1)] / 80) || Math.floor(h / 80) !== Math.floor(H[Math.min(S - 1, j + 1) * S + i] / 80)) k *= 0.92
        const o = (j * S + i) * 4
        img.data[o] = Math.min(255, (r * k * 0.86 + 0.95 * 0.14) * 255)
        img.data[o + 1] = Math.min(255, (gg * k * 0.86 + 0.9 * 0.14) * 255)
        img.data[o + 2] = Math.min(255, (b * k * 0.86 + 0.78 * 0.14) * 255)
        img.data[o + 3] = 255
      }
      if ((j & 15) === 15) yield
    }
    g.putImageData(img, 0, 0)
  }
}
const FAR_S = 768

/** The other world's baked chart (null if it isn't there: the map draws its tracks on plain paper). */
const baked = new Map<WorldId, Promise<HTMLImageElement | null>>()
export function bakedChart(id: WorldId): Promise<HTMLImageElement | null> {
  let p = baked.get(id)
  if (!p) baked.set(id, (p = new Promise((resolve) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => resolve(null)
    im.src = `${WORLDS[id].path}/chart.webp`
  })))
  return p
}

// ------------------------------------------------------------------------------------------------- shared drawing
export const ICON: Record<Landmark['kind'], string> = { tower: '♜', view: '◭', cabin: '⌂', shack: '⌂', sawmill: '▤', mine: '⛏', meteorite: '✶', falls: '≋', meadow: '✿', camp: '▲', oasis: '≈', aqueduct: '⌓', arch: '⌒', spires: '▴', gorge: '≍', ksar: '▦', dunes: '∿', slickrock: '◒', cave: '◖', ghost: '☗', ruin: '⌂', ranger: '⚑', garage: '⚙', shelter: '⌂', hamlet: '⌂', research: '◬', dock: '⚓', wreck: '✕' }
/** The route's colour (GTA's waypoint violet: it reads on green and on sand). */
export const ROUTE = '#a24dff'

/** A projection: world (x, z) → canvas px. */
export type Project = (x: number, z: number) => [number, number]

/** THE OUTLAND'S ROADS (meta.outland.trails): gravel roads — drawn as the tracks are, a little wider. */
export function drawRoads(g: CanvasRenderingContext2D, meta: MapMeta, P: Project, w: number): void {
  const lines = meta.outland?.trails?.lines
  if (!lines) return
  g.lineJoin = g.lineCap = 'round'; g.setLineDash([])
  for (const pass of [0, 1]) {
    g.strokeStyle = pass ? 'rgba(150, 100, 58, 0.95)' : 'rgba(250, 236, 205, 0.9)'; g.lineWidth = pass ? w : w * 2
    g.beginPath()
    for (const L of lines) L.forEach(([x, z], k) => { const [px, py] = P(x, z); if (k) g.lineTo(px, py); else g.moveTo(px, py) })
    g.stroke()
  }
}
/** THE STAGES (meta.outland.stages): each road's own line drawn again in the rally's red, a start flag where it
 *  begins, its name and length at its middle (`names`: when the map is close enough to read them). */
export function drawStages(g: CanvasRenderingContext2D, meta: MapMeta, P: Project, w: number, k: number, names: boolean): void {
  const lines = meta.outland?.trails?.lines
  for (const s of meta.outland?.stages ?? []) {
    const L = lines?.[s.line]
    if (!L) continue
    g.lineJoin = g.lineCap = 'round'; g.setLineDash([w * 2.2, w * 1.6]); g.strokeStyle = 'rgba(196, 44, 30, 0.9)'; g.lineWidth = w * 0.7
    g.beginPath()
    L.forEach(([x, z], i) => { const [px, py] = P(x, z); if (i) g.lineTo(px, py); else g.moveTo(px, py) })
    g.stroke(); g.setLineDash([])
    const [sx, sy] = P(L[Math.min(3, L.length - 1)][0], L[Math.min(3, L.length - 1)][1])
    g.fillStyle = '#c42c1e'; g.font = `600 ${Math.round(13 * k)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('⚑', sx, sy - 6 * k)
    if (names) { const m = L[L.length >> 1], [mx, my] = P(m[0], m[1]); label(g, `${s.name} · ${s.km.toFixed(1)} km`, mx, my - 9 * k, '#a02216', Math.round(10 * k), true) }
  }
}

/** A place of the outland (the World Tree, the crater, the mesa, the arch, a view, a lake) and a peak: its mark. */
const OUT_ICON: Record<OutPlace['kind'], string> = { worldtree: '♣', crater: '◎', mesa: '▬', arch: '∩', peak: '▲', view: '◭', pass: '⇡', lake: '≈', canyon: '⋁', rocks: '∎', bog: '∴', ford: '≋' }
export function drawOutPlace(g: CanvasRenderingContext2D, kind: OutPlace['kind'], x: number, y: number, k: number): void {
  const big = kind === 'worldtree'
  g.fillStyle = big ? 'rgba(232, 246, 214, 0.97)' : 'rgba(255, 246, 228, 0.95)'
  g.beginPath(); g.arc(x, y, (big ? 11 : 9) * k, 0, Math.PI * 2); g.fill()
  g.strokeStyle = big ? '#2f6a22' : '#8a3a1c'; g.lineWidth = 1.6 * k; g.stroke()
  g.fillStyle = big ? '#2a5a1e' : '#5a2a14'
  g.font = `600 ${Math.round((big ? 15 : 12) * k)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText(OUT_ICON[kind], x, y + 0.5 * k)
}

/** The tracks (rock-crawling routes dashed) and the bridges, `w` px wide, the ones whose box meets the view. */
export function drawTracks(g: CanvasRenderingContext2D, meta: MapMeta, P: Project, w: number, view: { x0: number; z0: number; x1: number; z1: number }): void {
  const rough = new Set(meta.trails.rough ?? [])
  const boxes = trackBoxes(meta)
  g.lineJoin = g.lineCap = 'round'
  for (const pass of [0, 1]) {
    meta.trails.lines.forEach((L, i) => {
      const b = boxes[i]
      if (b[2] < view.x0 || b[0] > view.x1 || b[3] < view.z0 || b[1] > view.z1) return
      g.beginPath()
      L.forEach(([x, z], k) => { const [px, py] = P(x, z); if (k) g.lineTo(px, py); else g.moveTo(px, py) })
      g.setLineDash(rough.has(i) ? [w * 1.3, w] : [])
      g.strokeStyle = pass ? (rough.has(i) ? 'rgba(110, 70, 40, 0.95)' : 'rgba(135, 88, 50, 0.95)') : 'rgba(250, 236, 205, 0.9)'
      g.lineWidth = pass ? w : w * 2
      g.stroke()
    })
  }
  g.setLineDash([])
  for (const br of meta.bridges ?? []) {
    const [ax, ay] = P(br.x0, br.z0), [bx, by] = P(br.x1, br.z1)
    g.strokeStyle = '#3b2616'; g.lineWidth = w * 2.2
    g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke()
  }
}
const boxCache = new WeakMap<MapMeta, [number, number, number, number][]>()
function trackBoxes(meta: MapMeta): [number, number, number, number][] {
  let b = boxCache.get(meta)
  if (!b) {
    b = meta.trails.lines.map((L) => {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
      for (const [x, z] of L) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z) }
      return [x0, z0, x1, z1] as [number, number, number, number]
    })
    boxCache.set(meta, b)
  }
  return b
}

/** A route: the part still ahead (from route point `from` and the car's spot on it), a dark edge under the violet, the
 *  off-road legs dashed. */
export function drawRoute(g: CanvasRenderingContext2D, pts: Float32Array, off: Uint8Array, P: Project, w: number, from = 0, start?: [number, number]): void {
  const n = pts.length / 2
  if (n < 2) return
  g.lineJoin = g.lineCap = 'round'
  for (const pass of [0, 1]) {
    g.strokeStyle = pass ? ROUTE : 'rgba(30, 10, 50, 0.75)'
    g.lineWidth = pass ? w : w + 2.5
    // (runs of the same kind in one path each)
    let s = from
    while (s < n - 1) {
      const kind = off[s]
      g.setLineDash(kind ? [w * 1.6, w * 1.3] : [])
      g.beginPath()
      const [ax, ay] = s === from && start ? P(start[0], start[1]) : P(pts[2 * s], pts[2 * s + 1])
      g.moveTo(ax, ay)
      while (s < n - 1 && off[s] === kind) { const [bx, by] = P(pts[2 * s + 2], pts[2 * s + 3]); g.lineTo(bx, by); s++ }
      g.stroke()
    }
  }
  g.setLineDash([])
}

/** The WAYPOINT: a violet pin (its point at x, y). */
export function drawPin(g: CanvasRenderingContext2D, x: number, y: number, k: number): void {
  g.save()
  g.translate(x, y)
  g.fillStyle = ROUTE; g.strokeStyle = '#fff'; g.lineWidth = 2 * k
  g.beginPath()
  g.moveTo(0, 0)
  g.bezierCurveTo(-3 * k, -6 * k, -8 * k, -9 * k, -8 * k, -15 * k)
  g.arc(0, -15 * k, 8 * k, Math.PI, 0)
  g.bezierCurveTo(8 * k, -9 * k, 3 * k, -6 * k, 0, 0)
  g.closePath(); g.fill(); g.stroke()
  g.fillStyle = '#fff'
  g.beginPath(); g.arc(0, -15 * k, 3 * k, 0, Math.PI * 2); g.fill()
  g.restore()
}

/** The PASS to the other world: a dark square with a double chevron (up = the way out). */
export function drawGate(g: CanvasRenderingContext2D, x: number, y: number, k: number, heading: number, upright = 0): void {
  g.save()
  g.translate(x, y)
  g.rotate(upright)
  g.fillStyle = '#16120d'; g.strokeStyle = '#f2a93b'; g.lineWidth = 2 * k
  g.fillRect(-9 * k, -9 * k, 18 * k, 18 * k); g.strokeRect(-9 * k, -9 * k, 18 * k, 18 * k)
  // (the chevrons point the way out: heading 0 = −z = up the chart)
  g.rotate(-heading - upright)
  g.strokeStyle = '#f4efe6'; g.lineWidth = 2.2 * k; g.lineJoin = 'miter'
  for (const o of [-2.5, 2.5]) { g.beginPath(); g.moveTo(-5 * k, (o + 3) * k); g.lineTo(0, (o - 2) * k); g.lineTo(5 * k, (o + 3) * k); g.stroke() }
  g.restore()
}

/** A map label with a pale halo (legible on any ground). */
/** (co-op) a claim on a map: its circle tinted and edged dashed in its owner's colour, a little flag at its middle. */
export function drawClaim(g: CanvasRenderingContext2D, x: number, y: number, rPx: number, colour: string, k: number, mine: boolean): void {
  g.save()
  g.globalAlpha = 0.22
  g.fillStyle = colour
  g.beginPath(); g.arc(x, y, rPx, 0, Math.PI * 2); g.fill()
  g.globalAlpha = 1
  g.strokeStyle = colour; g.lineWidth = (mine ? 2.6 : 2) * k
  g.setLineDash([5 * k, 3.5 * k])
  g.stroke()
  g.setLineDash([])
  // the flag: a pole and a pennant
  g.strokeStyle = '#16120d'; g.lineWidth = 1.6 * k
  g.beginPath(); g.moveTo(x, y + 6 * k); g.lineTo(x, y - 9 * k); g.stroke()
  g.fillStyle = colour; g.strokeStyle = '#fff'; g.lineWidth = 1.2 * k
  g.beginPath(); g.moveTo(x, y - 9 * k); g.lineTo(x + 9 * k, y - 6 * k); g.lineTo(x, y - 3 * k); g.closePath(); g.fill(); g.stroke()
  g.restore()
}

/** (co-op) whose land it is, over its flag: a dark tag with the owner's colour down its left edge (the HUD's look). */
export function claimTag(g: CanvasRenderingContext2D, t: string, x: number, y: number, colour: string, k: number): void {
  g.save()
  g.font = `700 ${Math.round(11.5 * k)}px 'Barlow Condensed', system-ui`
  const w = g.measureText(t.toUpperCase()).width + 12 * k, h = 15 * k
  g.fillStyle = 'rgba(8, 8, 10, 0.82)'; g.fillRect(x - w / 2, y - h, w, h)
  g.fillStyle = colour; g.fillRect(x - w / 2, y - h, 3 * k, h)
  g.fillStyle = '#f4efe6'; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText(t.toUpperCase(), x + 1.5 * k, y - h / 2 + 0.5 * k)
  g.restore()
}

/** (co-op) a claim as the maps get it. */
export interface ClaimMark { x: number; z: number; r: number; colour: string; name: string; mine: boolean }

export function label(g: CanvasRenderingContext2D, t: string, x: number, y: number, color: string, size: number, italic: boolean): void {
  g.font = `${italic ? 'italic ' : ''}600 ${size}px 'Barlow Condensed', system-ui`
  g.textAlign = 'center'; g.textBaseline = 'middle'
  g.lineWidth = 3; g.strokeStyle = 'rgba(255, 248, 232, 0.85)'; g.strokeText(t, x, y)
  g.fillStyle = color; g.fillText(t, x, y)
}

/** A place's icon: a pale disc with its glyph once found, a dark one with "?" until then. */
export function drawPlace(g: CanvasRenderingContext2D, l: Landmark, found: boolean, x: number, y: number, k: number): void {
  g.fillStyle = found ? 'rgba(255, 246, 228, 0.95)' : 'rgba(60, 42, 30, 0.75)'
  g.beginPath(); g.arc(x, y, 9 * k, 0, Math.PI * 2); g.fill()
  g.strokeStyle = found ? '#8a3a1c' : 'rgba(255, 240, 220, 0.85)'; g.lineWidth = 1.6 * k; g.stroke()
  g.fillStyle = found ? '#5a2a14' : '#fff6ea'
  g.font = `${Math.round(11 * k)}px system-ui`
  g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText(found ? ICON[l.kind] : '?', x, y + 0.5 * k)
}

/** The places found in a world (Landmarks.ts keeps them per map id). */
export function foundIn(id: string): Set<number> {
  try { return new Set(JSON.parse(localStorage.getItem(`oth.found.${id}`) ?? '[]') as number[]) } catch { return new Set() }
}
