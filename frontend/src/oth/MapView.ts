import * as GFX from './gfx'
import type { Camp } from '../save'
import { bakedChart, type Chart, drawGate, drawPin, drawPlace, drawRoute, drawTracks, foundIn, ICON, label, ROUTE } from './Chart'
import type { Landmarks } from './Landmarks'
import type { Landmark, MapMeta } from './MapData'
import { fmtDist, fmtTime, type Guide, type Waypoint, worldMeta } from './Nav'
import { WORLDS, type WorldId } from './World'

/**
 * THE MAP and THE COMPASS (2026-10-27, the user: "add those" — OTH's map with its highlighted places; 2026-11-03, the
 * user: "like GTA 5 — mark a destination on the map and it shows the fastest route like Google Maps"):
 *
 * Tab (or the MAP button) opens the CHART (Chart.ts) with the tracks (rock-crawling routes dashed), the bridges, every
 * LANDMARK (its icon and name once discovered, a "?" until then), your camp, the car as an arrow, and the PASS to the
 * other world (the crossing's gate: double chevrons on an amber square). Two TABS — THE VALLEY · THE DESERT — show
 * either world (the other one's chart is baked: chart.webp), so a place over there can be picked from here.
 *   click / tap   set the WAYPOINT there (on a place or the pass: that place); on the waypoint: clear it
 *   drag          move the chart · wheel, + / −: zoom (about the pointer) · Z: the whole map ⇄ 800 m round the car
 *   right-click, Delete: clear the waypoint · Tab / Esc: close
 * The ROUTE (Nav.ts: the fastest way, along the tracks) is drawn violet, off-road legs dashed; the foot says how far and
 * how long. A waypoint in the other world routes to this world's pass, its leg over there drawn on its own tab.
 * The COMPASS (always on, top centre): the heading's letters and ticks, the landmarks ahead (within 2.5 km, ±80°) — a
 * "?" for the ones not found yet — the pass (⇑), the waypoint (violet ◆), and the waypoint's distance (else the
 * nearest place's). It redraws ten times a second (DOM, no canvas); the open map five times.
 */
export interface MapViewOptions {
  world: WorldId
  lm: Landmarks
  meta: MapMeta
  chart: Chart
  guide: Guide
  camera: GFX.Camera
  carPos: () => GFX.Vector3
  carHeading: () => number
  /** Your own camp in this world. */
  myCamp: () => Camp | null
}

export class MapView {
  private readonly root: HTMLDivElement
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly info: HTMLDivElement
  private readonly foot: HTMLDivElement
  private readonly tabs = new Map<WorldId, HTMLButtonElement>()
  private readonly goBtn: HTMLButtonElement
  private readonly clearBtn: HTMLButtonElement
  private open = false
  /** The world shown, and each one's view (centre, half width — m). */
  private tab: WorldId
  private readonly views = new Map<WorldId, { cx: number; cz: number; v: number }>()
  private readonly other: WorldId
  private otherMeta: MapMeta | null = null
  private otherChart: HTMLImageElement | null = null
  private readonly compass: HTMLDivElement
  private readonly strip: HTMLDivElement
  private readonly marks = new Map<number, HTMLDivElement>()
  private readonly ticks: HTMLDivElement[] = []
  private readonly wpMark: HTMLDivElement
  private readonly gateMark: HTMLDivElement
  private readonly near: HTMLDivElement
  private compassT = 0
  private drawT = 0
  private readonly dir = new GFX.Vector3()
  private readonly off = new AbortController()

  /** Off the page (another world gets its own map: main.ts). */
  dispose(): void {
    this.off.abort()
    document.body.classList.remove('oth-map-open')
    this.root.remove()
    this.compass.remove()
  }

  constructor(private readonly o: MapViewOptions) {
    this.tab = o.world
    this.other = o.world === 'valley' ? 'desert' : 'valley'
    void worldMeta(this.other).then((m) => { this.otherMeta = m; if (this.open) this.draw() })
    const sig = { signal: this.off.signal }
    this.root = document.createElement('div')
    this.root.className = 'oth-map'
    // the bar: the worlds' tabs, the places found, zoom
    const bar = document.createElement('div')
    bar.className = 'oth-map-bar'
    const tabs = document.createElement('div')
    tabs.className = 'oth-map-tabs'
    for (const id of ['valley', 'desert'] as WorldId[]) {
      const b = document.createElement('button')
      b.textContent = WORLDS[id].name
      b.addEventListener('click', () => this.show(id), sig)
      tabs.appendChild(b)
      this.tabs.set(id, b)
    }
    this.info = document.createElement('div')
    this.info.className = 'oth-map-info'
    const zoom = document.createElement('div')
    zoom.className = 'oth-map-zoom'
    for (const [t, k] of [['−', 1.6], ['+', 1 / 1.6]] as const) {
      const b = document.createElement('button')
      b.textContent = t
      b.addEventListener('click', () => this.zoomBy(k), sig)
      zoom.appendChild(b)
    }
    bar.append(tabs, this.info, zoom)
    this.canvas = document.createElement('canvas')
    this.ctx = this.canvas.getContext('2d')!
    // the foot: the route, ROUTE TO THE OTHER WORLD, CLEAR
    const foot = document.createElement('div')
    foot.className = 'oth-map-foot'
    this.foot = document.createElement('div')
    this.foot.className = 'oth-map-route'
    this.goBtn = document.createElement('button')
    this.goBtn.textContent = `Route to ${WORLDS[this.other].name}`
    this.goBtn.addEventListener('click', () => this.routeToOther(), sig)
    this.clearBtn = document.createElement('button')
    this.clearBtn.textContent = 'Clear'
    this.clearBtn.addEventListener('click', () => this.setWaypoint(null), sig)
    foot.append(this.foot, this.goBtn, this.clearBtn)
    const hint = document.createElement('div')
    hint.className = 'oth-map-hint'
    hint.textContent = 'Click: set waypoint · drag: move · wheel / Z: zoom · right-click / Del: clear · Tab: close'
    this.root.append(bar, this.canvas, foot, hint)
    document.body.appendChild(this.root)
    this.pointer(sig)
    // (no button of its own: the round map button shows the minimap, and tapping that opens this — main.ts)
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') { e.preventDefault(); this.toggle() }
      if (!this.open) return
      if (e.code === 'KeyZ') this.zoomToggle()
      if (e.code === 'Delete' || e.code === 'Backspace') this.setWaypoint(null)
      // (Esc closes the map and nothing else: the pause menu's listener must not see it)
      if (e.code === 'Escape') { e.stopImmediatePropagation(); this.toggle() }
    }, sig)
    // the compass: a strip of ticks / letters every 15° and a marker per landmark, laid out by bearing each update
    this.compass = document.createElement('div')
    this.compass.className = 'oth-compass'
    this.strip = document.createElement('div')
    this.strip.className = 'oth-compass-strip'
    this.compass.appendChild(this.strip)
    const LET: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }
    for (let a = 0; a < 360; a += 15) {
      const t = document.createElement('div')
      t.className = LET[a] ? 'oth-tick oth-tick-l' : 'oth-tick'
      t.textContent = LET[a] ?? '·'
      t.dataset.a = String(a)
      this.strip.appendChild(t)
      this.ticks.push(t)
    }
    for (const l of o.lm.list) {
      const m = document.createElement('div')
      m.className = 'oth-mark'
      this.strip.appendChild(m)
      this.marks.set(l.id, m)
    }
    this.gateMark = document.createElement('div')
    this.gateMark.className = 'oth-mark oth-mark-gate'
    this.gateMark.textContent = '⇑'
    this.wpMark = document.createElement('div')
    this.wpMark.className = 'oth-mark oth-mark-wp'
    this.wpMark.textContent = '◆'
    this.strip.append(this.gateMark, this.wpMark)
    this.near = document.createElement('div')
    this.near.className = 'oth-compass-near'
    this.compass.appendChild(this.near)
    document.body.appendChild(this.compass)
  }

  get isOpen(): boolean { return this.open }

  toggle(): void {
    this.open = !this.open
    this.root.classList.toggle('on', this.open)
    // (the HUD under it hidden — index.html)
    document.body.classList.toggle('oth-map-open', this.open)
    if (this.open) {
      this.o.chart.finish()
      this.show(this.o.world)
    }
  }

  /** Per frame: the chart painted a slice at a time, the compass (10 Hz), the open map (5 Hz). */
  update(dt: number): void {
    this.o.chart.step(2.5)
    if (this.open && (this.drawT -= dt) <= 0) { this.drawT = 0.2; this.draw() }
    if ((this.compassT -= dt) > 0) return
    this.compassT = 0.1
    this.o.camera.getWorldDirection(this.dir)
    const head = (Math.atan2(this.dir.x, -this.dir.z) * 180) / Math.PI // (0 = north = −z, 90 = east = +x)
    const W = 420, span = 160 // (the strip shows ±80°)
    const at = (bearing: number) => { let d = bearing - head; d = ((d + 540) % 360) - 180; return Math.abs(d) <= span / 2 ? W / 2 + (d / span) * W : null }
    const place = (el: HTMLElement, x: number | null) => {
      el.style.display = x === null ? 'none' : ''
      if (x !== null) el.style.transform = `translateX(${x.toFixed(1)}px)`
    }
    for (const t of this.ticks) place(t, at(Number(t.dataset.a)))
    const p = this.o.carPos(), lm = this.o.lm
    const bearing = (x: number, z: number) => (Math.atan2(x - p.x, -(z - p.z)) * 180) / Math.PI
    let best: { l: Landmark; d: number } | null = null
    for (const l of lm.list) {
      const m = this.marks.get(l.id)!, d = Math.hypot(l.x - p.x, l.z - p.z)
      const x = d < 2500 ? at(bearing(l.x, l.z)) : null
      place(m, x)
      if (x === null) continue
      const found = lm.found.has(l.id)
      m.textContent = found ? ICON[l.kind] : '?'
      m.classList.toggle('found', found)
      if (!best || d < best.d) best = { l, d }
    }
    const G = this.o.meta.gate
    place(this.gateMark, G && Math.hypot(G.x - p.x, G.z - p.z) < 2500 ? at(bearing(G.x, G.z)) : null)
    // the waypoint (or the pass on the way to it): its marker, and its distance in place of the nearest place's
    const gd = this.o.guide, w = gd.waypoint, tgt = w ? (gd.viaGate ? G : w) : null
    place(this.wpMark, tgt ? at(bearing(tgt.x, tgt.z)) : null)
    if (w) this.near.innerHTML = `<b>◆</b> ${esc(w.name)}${gd.viaGate ? ' · via the pass' : ''} · ${fmtDist(gd.remaining)}`
    else this.near.textContent = best ? `${lm.found.has(best.l.id) ? best.l.name : '? Unexplored'} · ${fmtDist(best.d)}` : ''
  }

  // ------------------------------------------------------------------------------------------------- the map
  private half(id: WorldId): number {
    if (id === this.o.world) return -this.o.meta.inner.origin
    return this.otherMeta ? -this.otherMeta.inner.origin : 2048
  }

  private view(id: WorldId): { cx: number; cz: number; v: number } {
    let v = this.views.get(id)
    if (!v) this.views.set(id, (v = { cx: 0, cz: 0, v: this.half(id) }))
    return v
  }

  private show(id: WorldId): void {
    this.tab = id
    for (const [k, b] of this.tabs) b.classList.toggle('sel', k === id)
    if (id === this.other && !this.otherChart) void bakedChart(id).then((im) => { this.otherChart = im; if (this.open) this.draw() })
    this.draw()
  }

  private clampView(id: WorldId): void {
    const V = this.view(id), H = this.half(id)
    V.v = Math.max(150, Math.min(H, V.v))
    V.cx = Math.max(-H + V.v, Math.min(H - V.v, V.cx))
    V.cz = Math.max(-H + V.v, Math.min(H - V.v, V.cz))
  }

  /** Zoom by k (< 1 in) about the canvas point (px, py) — its centre by default. */
  private zoomBy(k: number, px?: number, py?: number): void {
    const V = this.view(this.tab)
    const [wx, wz] = px === undefined ? [V.cx, V.cz] : this.unproject(px, py!)
    const v = Math.max(150, Math.min(this.half(this.tab), V.v * k)), f = v / V.v
    V.cx = wx - (wx - V.cx) * f
    V.cz = wz - (wz - V.cz) * f
    V.v = v
    this.clampView(this.tab)
    this.draw()
  }

  /** Z: the whole map ⇄ 800 m round the car (this world) / the centre (the other). */
  private zoomToggle(): void {
    const V = this.view(this.tab), H = this.half(this.tab)
    if (V.v > 900) {
      const p = this.o.carPos()
      V.v = 800
      if (this.tab === this.o.world) { V.cx = p.x; V.cz = p.z }
    } else { V.v = H; V.cx = V.cz = 0 }
    this.clampView(this.tab)
    this.draw()
  }

  private unproject(px: number, py: number): [number, number] {
    const V = this.view(this.tab), S = this.canvas.width
    return [V.cx - V.v + (px / S) * 2 * V.v, V.cz - V.v + (py / S) * 2 * V.v]
  }

  private pointer(sig: { signal: AbortSignal }): void {
    const c = this.canvas
    let down: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null
    const dpr = () => c.width / c.clientWidth
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      const V = this.view(this.tab)
      down = { x: e.clientX, y: e.clientY, cx: V.cx, cz: V.cz, moved: false }
      c.setPointerCapture(e.pointerId)
    }, sig)
    c.addEventListener('pointermove', (e) => {
      if (!down) return
      const dx = e.clientX - down.x, dy = e.clientY - down.y
      if (!down.moved && Math.hypot(dx, dy) < 6) return
      down.moved = true
      c.style.cursor = 'grabbing'
      const V = this.view(this.tab), mpp = (2 * V.v) / c.clientWidth
      V.cx = down.cx - dx * mpp
      V.cz = down.cz - dy * mpp
      this.clampView(this.tab)
      this.draw()
    }, sig)
    c.addEventListener('pointerup', (e) => {
      const d = down
      down = null
      c.style.cursor = ''
      if (!d || d.moved) return
      const r = c.getBoundingClientRect()
      this.clickAt((e.clientX - r.left) * dpr(), (e.clientY - r.top) * dpr())
    }, sig)
    c.addEventListener('pointercancel', () => { down = null }, sig)
    c.addEventListener('wheel', (e) => {
      e.preventDefault()
      const r = c.getBoundingClientRect()
      this.zoomBy(e.deltaY > 0 ? 1.25 : 0.8, (e.clientX - r.left) * dpr(), (e.clientY - r.top) * dpr())
    }, { ...sig, passive: false })
    c.addEventListener('contextmenu', (e) => { e.preventDefault(); this.setWaypoint(null) }, sig)
  }

  /** The shown world's meta, places and their found set (null: the other world's meta not here yet). */
  private shown(): { meta: MapMeta; places: Landmark[]; found: Set<number> } | null {
    if (this.tab === this.o.world) return { meta: this.o.meta, places: this.o.lm.list, found: this.o.lm.found }
    const m = this.otherMeta
    return m ? { meta: m, places: m.landmarks ?? [], found: foundIn(m.id) } : null
  }

  /** A click on the chart: on the waypoint → clear it; on a place / the pass → that; anywhere else → a waypoint there. */
  private clickAt(px: number, py: number): void {
    const s = this.shown()
    if (!s) return
    const V = this.view(this.tab), S = this.canvas.width, k = S / 640
    const P = (x: number, z: number): [number, number] => [((x - V.cx + V.v) / (2 * V.v)) * S, ((z - V.cz + V.v) / (2 * V.v)) * S]
    const hit = (x: number, z: number, r = 14) => { const [a, b] = P(x, z); return Math.hypot(a - px, b - py) < r * k }
    const w = this.o.guide.waypoint
    if (w && w.world === this.tab && hit(w.x, w.z - 15 * k * ((2 * V.v) / S), 16)) { this.setWaypoint(null); return }
    const G = s.meta.gate
    if (G && hit(G.x, G.z)) {
      // the pass: to the other world (from this tab's world) — the waypoint where you come out over there
      if (this.tab === this.o.world) this.routeToOther()
      else this.setWaypoint({ world: this.tab, x: G.x, z: G.z, name: WORLDS[this.tab].name })
      return
    }
    for (const l of s.places) if (hit(l.x, l.z)) { this.setWaypoint({ world: this.tab, x: l.x, z: l.z, name: s.found.has(l.id) ? l.name : 'Unexplored place' }); return }
    const [x, z] = this.unproject(px, py)
    this.setWaypoint({ world: this.tab, x, z, name: 'Waypoint' })
  }

  /** The waypoint where the other world's pass lets you out. */
  private routeToOther(): void {
    const m = this.otherMeta
    if (!m?.gate) return
    this.setWaypoint({ world: this.other, x: m.gate.x, z: m.gate.z, name: WORLDS[this.other].name })
  }

  private setWaypoint(w: Waypoint | null): void {
    this.o.guide.set(w, this.o.carPos())
    this.draw()
  }

  private draw(): void {
    if (!this.open) return
    // (the bar, the foot and the hint round it — no hint on a phone)
    const css = Math.max(220, Math.round(Math.min(innerWidth * 0.94, innerHeight - (document.body.classList.contains('touch') ? 84 : 132))))
    const dpr = Math.min(devicePixelRatio, 2), S = Math.round(css * dpr)
    if (this.canvas.width !== S) { this.canvas.width = this.canvas.height = S; this.canvas.style.width = this.canvas.style.height = `${css}px` }
    const g = this.ctx, k = S / 640, here = this.tab === this.o.world
    const V = this.view(this.tab), half = this.half(this.tab)
    this.clampView(this.tab)
    const P = (x: number, z: number): [number, number] => [((x - V.cx + V.v) / (2 * V.v)) * S, ((z - V.cz + V.v) / (2 * V.v)) * S]
    // the ground: this world's chart, the other's baked one (plain paper until it's here)
    g.fillStyle = '#e6d6b8'
    g.fillRect(0, 0, S, S)
    const src: HTMLCanvasElement | HTMLImageElement | null = here ? this.o.chart.canvas : this.otherChart
    if (src) {
      const cs = src.width
      g.imageSmoothingEnabled = true
      g.drawImage(src, ((V.cx - V.v + half) / (2 * half)) * cs, ((V.cz - V.v + half) / (2 * half)) * cs, (V.v / half) * cs, (V.v / half) * cs, 0, 0, S, S)
    }
    const s = this.shown()
    const gd = this.o.guide, w = gd.waypoint
    if (s) {
      const zoomK = 1 + 0.8 * (1 - V.v / half)
      drawTracks(g, s.meta, P, 1.6 * k * zoomK, { x0: V.cx - V.v, z0: V.cz - V.v, x1: V.cx + V.v, z1: V.cz + V.v })
      const ms = s.meta.mud?.marsh
      if (ms) { const [mx, my] = P(ms.x, ms.z); label(g, 'The Bog', mx, my, '#4a3423', Math.round(12 * k), true) }
      // the route: this world's leg from the car on, or the other world's from its pass
      if (here && gd.route) drawRoute(g, gd.route.pts, gd.route.off, P, 3.2 * k * zoomK, gd.route.seg, gd.route.pos())
      if (!here && w?.world === this.tab && gd.otherLeg) drawRoute(g, gd.otherLeg.pts, gd.otherLeg.off, P, 3.2 * k * zoomK)
      // the places
      for (const l of s.places) {
        const [x, y] = P(l.x, l.z), found = s.found.has(l.id)
        drawPlace(g, l, found, x, y, k)
        if (found) label(g, l.name, x, y + 17 * k, '#3a2414', Math.round(10.5 * k), false)
      }
      // the pass to the other world
      const G = s.meta.gate
      if (G) {
        const [gx, gy] = P(G.x, G.z), to = WORLDS[this.tab === 'valley' ? 'desert' : 'valley'].name
        drawGate(g, gx, gy, k, G.heading)
        label(g, `Pass to ${to}`, gx, gy + 19 * k, '#16120d', Math.round(11.5 * k), false)
      }
      // the camp (the spawn), your own
      const [sx, sy] = P(s.meta.spawn.x, s.meta.spawn.z)
      // (the desert's camp is at its pass: the label above the pass's)
      const byGate = G && Math.hypot(G.x - s.meta.spawn.x, G.z - s.meta.spawn.z) < 120
      label(g, '⛺ Camp', sx, byGate ? sy - 20 * k : sy, '#3a2414', Math.round(10.5 * k), false)
      const mine = here ? this.o.myCamp() : null
      if (mine) { const [cx, cy] = P(mine.x, mine.z); label(g, '⛺ Your camp', cx, cy, '#5a2a14', Math.round(10.5 * k), false) }
    }
    // the waypoint
    if (w?.world === this.tab) {
      const [wx, wy] = P(w.x, w.z)
      drawPin(g, wx, wy, k)
    }
    // the car
    if (here) {
      const p = this.o.carPos(), [px, py] = P(p.x, p.z), h = this.o.carHeading()
      g.save(); g.translate(px, py); g.rotate(-h)
      g.fillStyle = '#e8492b'; g.strokeStyle = '#fff'; g.lineWidth = 2 * k
      g.beginPath(); g.moveTo(0, -11 * k); g.lineTo(7 * k, 8 * k); g.lineTo(0, 4 * k); g.lineTo(-7 * k, 8 * k); g.closePath(); g.fill(); g.stroke()
      g.restore()
    }
    // the bar and the foot
    const found = s ? s.places.filter((l) => s.found.has(l.id)).length : 0
    this.info.textContent = s ? `${found} / ${s.places.length} places found` : ''
    this.goBtn.style.display = this.o.meta.gate && !(w?.world === this.other && w.name === WORLDS[this.other].name) ? '' : 'none'
    this.clearBtn.style.display = w ? '' : 'none'
    this.foot.innerHTML = w
      ? `<b style="color:${ROUTE}">◆</b> ${esc(w.name)}${w.world !== this.o.world ? ` <small>in ${WORLDS[w.world].name}</small>` : ''}<span>${gd.route ? `${fmtDist(gd.remaining)} · ${fmtTime(gd.remainingTime)}` : ''}${gd.viaGate ? ' · via the pass' : ''}</span>`
      : '<small>No waypoint — click the map to set one</small>'
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
