import * as GFX from './gfx'
import type { Camp } from '../save'
import { type Chart, drawGate, drawPin, drawPlace, drawRoute, drawTracks } from './Chart'
import type { Landmarks } from './Landmarks'
import type { MapMeta } from './MapData'
import { fmtDist, fmtTime, type Guide, turnArrow } from './Nav'

/**
 * THE RADAR (2026-11-03, the user: "like GTA 5 … using the map we can get there"): the minimap, bottom left (top left on
 * a phone) — the chart round the car turned with the camera (what's ahead is up), the car a red arrow a little below
 * the middle (more ahead than behind), the tracks, the places, the pass, your camp, the ROUTE in violet and the
 * WAYPOINT (held at the edge when it's off the radar), N on the rim. It zooms out with speed. Under it a plate: the
 * next turn (arrow + distance), a rock crawl coming up, how far and how long to go.
 *
 * Cheap: the picture is drawn into a canvas a few times a second (north up, centred on the car, a margin round it);
 * between those, each frame only turns and slides that canvas with a CSS transform (the compositor's work — no layout,
 * no paint) and turns the car's arrow and the N. A redraw: when the car's slid > 12 px off its centre, the zoom has
 * changed, the heading's turned > 4° (the icons stay upright), the route moved on (≤ 4×/s), or the chart's done.
 */
export interface RadarOptions {
  lm: Landmarks
  meta: MapMeta
  chart: Chart
  guide: Guide
  camera: GFX.Camera
  carPos: () => GFX.Vector3
  carHeading: () => number
  myCamp: () => Camp | null
}

/** The car's place in the box (fractions of its width / height). */
const AX = 0.5, AY = 0.64
const M = 24 // css px of margin round the turning disc

export class Radar {
  private readonly root: HTMLDivElement
  private readonly box: HTMLDivElement
  private readonly cv: HTMLCanvasElement
  private readonly g: CanvasRenderingContext2D
  private readonly arrow: HTMLDivElement
  private readonly north: HTMLDivElement
  private readonly plate: HTMLDivElement
  private W = 0
  private H = 0
  private D = 0
  private dpr = 1
  /** The drawn picture: its centre (m), metres per css px, the heading it was drawn at. */
  private x0 = 0
  private z0 = 0
  private mpp0 = 0
  private head0 = 0
  private mpp = 1.7
  private chartWas = false
  private routeT = 0
  private plateT = 0
  private plateKey = ''
  private routeKey: unknown = null
  private visible = true
  private readonly dir = new GFX.Vector3()
  private readonly off = new AbortController()

  constructor(private readonly o: RadarOptions) {
    this.root = document.createElement('div')
    this.root.className = 'oth-radar'
    this.box = document.createElement('div')
    this.box.className = 'oth-radar-box'
    this.cv = document.createElement('canvas')
    this.g = this.cv.getContext('2d')!
    this.arrow = document.createElement('div')
    this.arrow.className = 'oth-radar-car'
    this.north = document.createElement('div')
    this.north.className = 'oth-radar-n'
    this.north.textContent = 'N'
    this.box.append(this.cv, this.arrow, this.north)
    this.plate = document.createElement('div')
    this.plate.className = 'oth-radar-plate'
    this.root.append(this.box, this.plate)
    document.body.appendChild(this.root)
    this.layout()
    addEventListener('resize', () => this.layout(), { signal: this.off.signal })
  }

  dispose(): void {
    this.off.abort()
    this.root.remove()
  }

  /** The box's size (CSS: bigger on a PC, smaller on a phone) → the canvas: the disc the box's corners sweep as it
   *  turns round the car, plus the margin. */
  private layout(): void {
    this.W = this.box.clientWidth
    this.H = this.box.clientHeight
    const r = Math.hypot(Math.max(AX, 1 - AX) * this.W, Math.max(AY, 1 - AY) * this.H)
    this.D = Math.ceil(2 * (r + M))
    this.dpr = Math.min(devicePixelRatio, 2)
    this.cv.width = this.cv.height = Math.round(this.D * this.dpr)
    Object.assign(this.cv.style, { width: `${this.D}px`, height: `${this.D}px`, left: `${AX * this.W - this.D / 2}px`, top: `${AY * this.H - this.D / 2}px` })
    this.arrow.style.left = `${AX * this.W}px`
    this.arrow.style.top = `${AY * this.H}px`
    this.mpp0 = 0 // (redraw)
  }

  /** Per frame (after the cameras): `show` — driving, the map shut. */
  update(dt: number, show: boolean, speedKmh: number): void {
    if (show !== this.visible) { this.visible = show; this.root.style.display = show ? '' : 'none' }
    if (!show || !this.W) return
    const p = this.o.carPos()
    this.o.camera.getWorldDirection(this.dir)
    const head = Math.atan2(this.dir.x, -this.dir.z) // (clockwise from north)
    // the zoom: ~1.7 m a pixel standing, ~3.4 at 90 km/h
    const want = 1.7 + 1.7 * GFX.MathUtils.smoothstep(Math.abs(speedKmh), 15, 90)
    this.mpp += (want - this.mpp) * Math.min(1, dt * 0.8)
    const gd = this.o.guide, r = gd.route
    const dx = (p.x - this.x0) / this.mpp0, dz = (p.z - this.z0) / this.mpp0
    const turned = Math.abs(Math.atan2(Math.sin(head - this.head0), Math.cos(head - this.head0)))
    const key = r ?? gd.waypoint
    const routeMoved = !!r && (this.routeT -= dt) <= 0
    if (!this.mpp0 || Math.hypot(dx, dz) > 12 || Math.abs(this.mpp / this.mpp0 - 1) > 0.04 || turned > 0.07 || key !== this.routeKey || routeMoved || this.o.chart.ready !== this.chartWas) {
      this.redraw(p.x, p.z, head)
      this.routeKey = key
      this.routeT = 0.25
    }
    // the slide and the turn since the redraw (CSS: translate first, then turn about the car)
    const tx = (p.x - this.x0) / this.mpp0, tz = (p.z - this.z0) / this.mpp0
    this.cv.style.transform = `rotate(${(-head).toFixed(4)}rad) translate(${(-tx).toFixed(2)}px, ${(-tz).toFixed(2)}px)`
    this.arrow.style.transform = `translate(-50%, -50%) rotate(${(-this.o.carHeading() - head).toFixed(4)}rad)`
    // N on the rim: north's direction on the screen, out to the box's edge
    const nx = -Math.sin(head), ny = -Math.cos(head)
    const ex = nx > 0 ? (1 - AX) * this.W - 9 : AX * this.W - 9, ey = ny > 0 ? (1 - AY) * this.H - 9 : AY * this.H - 9
    const t = Math.min(ex / Math.max(1e-3, Math.abs(nx)), ey / Math.max(1e-3, Math.abs(ny)))
    this.north.style.transform = `translate(${(AX * this.W + nx * t).toFixed(1)}px, ${(AY * this.H + ny * t).toFixed(1)}px) translate(-50%, -50%)`
    // the plate (4×/s)
    if ((this.plateT -= dt) <= 0) { this.plateT = 0.25; this.writePlate() }
  }

  private redraw(cx: number, cz: number, head: number): void {
    this.x0 = cx; this.z0 = cz; this.mpp0 = this.mpp; this.head0 = head
    this.chartWas = this.o.chart.ready
    const g = this.g, D = this.D, dp = this.dpr, mpp = this.mpp, C = D / 2
    g.setTransform(dp, 0, 0, dp, 0, 0)
    const P = (x: number, z: number): [number, number] => [C + (x - cx) / mpp, C + (z - cz) / mpp]
    const meta = this.o.meta, half = -meta.inner.origin
    const view = { x0: cx - C * mpp, z0: cz - C * mpp, x1: cx + C * mpp, z1: cz + C * mpp }
    // the ground: beyond the box a dark olive; the chart over the part of it that's in the box
    g.fillStyle = '#3b3a31'
    g.fillRect(0, 0, D, D)
    const chart = this.o.chart
    if (chart.ready) {
      const x0 = Math.max(-half, view.x0), z0 = Math.max(-half, view.z0), x1 = Math.min(half, view.x1), z1 = Math.min(half, view.z1)
      if (x1 > x0 && z1 > z0) {
        const cs = chart.S / (2 * half), [ax, ay] = P(x0, z0)
        g.drawImage(chart.canvas, (x0 + half) * cs, (z0 + half) * cs, (x1 - x0) * cs, (z1 - z0) * cs, ax, ay, (x1 - x0) / mpp, (z1 - z0) / mpp)
      }
    }
    drawTracks(g, meta, P, 2.2, view)
    // the route ahead
    const gd = this.o.guide, r = gd.route
    if (r) drawRoute(g, r.pts, r.off, P, 3.6, r.seg, r.pos())
    // upright icons (the canvas turns by −head on the screen)
    const up = (x: number, y: number, f: () => void) => { g.save(); g.translate(x, y); g.rotate(head); f(); g.restore() }
    const inView = (x: number, z: number) => x > view.x0 && x < view.x1 && z > view.z0 && z < view.z1
    for (const l of this.o.lm.list) if (inView(l.x, l.z)) { const [x, y] = P(l.x, l.z); up(x, y, () => drawPlace(g, l, this.o.lm.found.has(l.id), 0, 0, 0.62)) }
    const G = meta.gate
    if (G && inView(G.x, G.z)) { const [x, y] = P(G.x, G.z); drawGate(g, x, y, 0.62, G.heading, head) }
    const mine = this.o.myCamp()
    if (mine && inView(mine.x, mine.z)) {
      const [x, y] = P(mine.x, mine.z)
      up(x, y, () => { g.font = '13px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText('⛺', 0, 0) })
    }
    // the waypoint (or the pass on the way to it), held inside the box's edge when it's off the radar
    const w = gd.waypoint, tgt = w ? (gd.viaGate ? G : w) : null
    if (tgt) {
      const c = Math.cos(head), s = Math.sin(head)
      const vx = (tgt.x - cx) / mpp, vz = (tgt.z - cz) / mpp
      // (on the screen: turned by −head)
      let sx = vx * c + vz * s, sy = -vx * s + vz * c
      const lx = AX * this.W - 12, rx = (1 - AX) * this.W - 12, ty = AY * this.H - 26, by = (1 - AY) * this.H - 6
      const f = Math.max(sx < 0 ? -sx / lx : sx / rx, sy < 0 ? -sy / ty : sy / by, 1)
      sx /= f; sy /= f
      const [x, y] = [C + sx * c - sy * s, C + sx * s + sy * c]
      if (gd.viaGate && G) drawGate(g, x, y, 0.7, G.heading, head)
      else up(x, y, () => drawPin(g, 0, 0, 0.75))
    }
  }

  private writePlate(): void {
    const gd = this.o.guide, r = gd.route
    let html = ''
    const w = gd.waypoint
    if (w && r) {
      // the next turn (its arrow, how far) — or, none left on this leg, where it ends; then how far / long in all
      const n = r.next()
      const what = r.roughAhead(150) ? 'rock crawl — slow' : n ? (n.m.kind === 'leave' ? 'leave the track' : n.m.kind === 'join' ? 'onto the track' : '') : ''
      const lead = (n ? `<i>${turnArrow(n.m.turn)}</i><b>${fmtDist(n.dist)}</b>` : `<i>${gd.viaGate ? '⇑' : '◆'}</i><b>${gd.viaGate ? 'The pass' : esc(w.name)}</b>`) + (what ? `<small>${what}</small>` : '')
      html = `${lead}<span>${fmtDist(gd.remaining)} · ${fmtTime(gd.remainingTime)}</span>`
    }
    if (html === this.plateKey) return
    this.plateKey = html
    this.plate.innerHTML = html
    this.plate.classList.toggle('on', !!html)
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
