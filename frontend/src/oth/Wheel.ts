/**
 * THE ACTION WHEEL (2026-11-05, the user: "the keys are congested and overlapping … make it like GTA 5, all inside a
 * round thing we can select from"): everything that isn't driving lives in one ring — pause, map, minimap, bike / car,
 * winch, reset, lights, time, weather, sound (and on desktop the free camera). Its round button sits top right beside
 * full screen; Q opens it on a keyboard. The screen keeps only the pads you drive with.
 *
 * Tap the button then a sector, or hold the button and slide onto one and let go (GTA's way); a tap outside or in the
 * middle closes it, so does Esc / Q. The ring is one SVG (sectors as paths) built when it opens: nothing of it runs
 * while it's shut. Square UI elsewhere; the controls round (index.html).
 */
export interface WheelItem {
  id: string
  label: string | (() => string)
  /** An SVG path in a 24-unit box (stroked). */
  icon: string | (() => string)
  /** The key that does the same (shown in the middle on a keyboard). */
  key?: string
  run: () => void
  /** Shown only when this is true (e.g. the winch only in the car). */
  show?: () => boolean
  /** Lit amber when true (a toggle that's on). */
  on?: () => boolean
}

const NS = 'http://www.w3.org/2000/svg'
const R = 96, r = 44, LIP = 1.25 // (outer / inner radius in the 200-unit box; a release within LIP × R still picks)

export const ICONS = {
  menu: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 3v5.5M12 15.5V21M3 12h5.5M15.5 12H21',
  pause: 'M8 5v14M16 5v14',
  map: 'M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z M9 4v13.5M15 6.5V20',
  radar: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 12l6-5 M12 7.5a4.5 4.5 0 1 0 0.01 0',
  bike: 'M5.5 14a3.5 3.5 0 1 0 0.01 0z M18.5 14a3.5 3.5 0 1 0 0.01 0z M5.5 17.5 9 10h7l2.5 7.5 M9 10l3.5 7.5 M15 6h2.5l-1.5 4',
  car: 'M3 12l2.2-5h13.6L21 12v4.5H3z M3 12h18 M7 16.5v2.5M17 16.5v2.5',
  moto: 'M5 14.5a3 3 0 1 0 0.01 0z M19 14.5a3 3 0 1 0 0.01 0z M5 17.5l4-5h5.5l2-3.5h2.5 M9 12.5 7.5 9h3.5 M14.5 12.5 19 17.5 M11 12.5l2 3h3',
  winch: 'M12 2v9 M12 11a4 4 0 1 0 4 4 M16 15l-2.2-1.6 M8.5 2h7',
  reset: 'M4.5 12a7.5 7.5 0 1 0 2.4-5.5 M4.5 4v5h5',
  lights: 'M11 5.5c-4.5 0-7 2.8-7 6.5s2.5 6.5 7 6.5h1v-13z M15.5 8h5.5 M15.5 12h5.5 M15.5 16h5.5',
  time: 'M12 8a4 4 0 1 0 0.01 0z M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8',
  weather: 'M7 18.5h10a4 4 0 0 0 .6-8 6 6 0 0 0-11.6 1.6A3.4 3.4 0 0 0 7 18.5z',
  sound: 'M4 9v6h4l5 4V5L8 9z M16.5 8.5a5 5 0 0 1 0 7 M19 6a8.5 8.5 0 0 1 0 12',
  mute: 'M4 9v6h4l5 4V5L8 9z M16 9l5 6M21 9l-5 6',
  camera: 'M3 7h12v10H3z M15 10.5 21 7v10l-6-3.5',
  eye: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z M12 9a3 3 0 1 0 0.01 0z',
  tpp: 'M12 3a2.2 2.2 0 1 0 0.01 0z M9 21l1.5-7-2-1 1-5h5l1 5-2 1 1.5 7 M4 21h16',
  walk: 'M13 4a1.6 1.6 0 1 0 0.01 0z M10 21l2.5-6 2.5 2v4 M8 11l3-3 3 2 2.5 2.5 M11 8l1 5-3 3',
}

export function iconSvg(d: string, size = 20): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`
}

export class ActionWheel {
  readonly button = document.createElement('button')
  private readonly root = document.createElement('div')
  private svg: SVGSVGElement | null = null
  private shown: WheelItem[] = []
  private sel = -1
  private openedAt = 0

  constructor(private readonly items: WheelItem[], private readonly keyboard: boolean) {
    this.button.className = 'oth-menubtn'
    this.button.title = keyboard ? 'Menu (Q)' : 'Menu'
    this.button.setAttribute('aria-label', 'Menu')
    this.button.innerHTML = iconSvg(ICONS.menu, 22)
    this.button.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation()
      if (this.isOpen) this.close(); else this.open()
    })
    this.root.className = 'oth-wheel'
    this.root.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.pick(e, false) })
    this.root.addEventListener('pointermove', (e) => this.hover(e))
    this.root.addEventListener('pointerup', (e) => { e.stopPropagation(); this.pick(e, true) })
    // (the button's own press, held and slid onto a sector: the release lands on the ring — pointer capture is the
    //  button's, so follow it there too)
    this.button.addEventListener('pointermove', (e) => { if (this.isOpen) this.hover(e) })
    this.button.addEventListener('pointerup', (e) => { if (this.isOpen && performance.now() - this.openedAt > 180) this.pick(e, true) })
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.code === 'KeyQ' && !e.repeat && !document.querySelector('.oh-front, .oth-map.on')) { this.isOpen ? this.close() : this.open(); e.preventDefault() }
      else if (this.isOpen && e.code === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); this.close() }
    }, true)
    document.body.append(this.button, this.root)
  }

  get isOpen(): boolean { return this.root.classList.contains('on') }

  open(): void {
    this.shown = this.items.filter((it) => it.show?.() ?? true)
    this.sel = -1
    this.build()
    this.openedAt = performance.now()
    this.root.classList.add('on')
    this.button.classList.add('on')
    document.body.classList.add('oth-wheel-open')
  }

  close(): void {
    this.root.classList.remove('on')
    this.button.classList.remove('on')
    document.body.classList.remove('oth-wheel-open')
    this.root.replaceChildren()
    this.svg = null
  }

  private build(): void {
    const n = this.shown.length, step = (Math.PI * 2) / n, gap = 0.012
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('viewBox', '-100 -100 200 200')
    const pt = (rad: number, a: number) => `${(Math.sin(a) * rad).toFixed(2)} ${(-Math.cos(a) * rad).toFixed(2)}`
    this.shown.forEach((it, i) => {
      const a0 = (i - 0.5) * step + gap, a1 = (i + 0.5) * step - gap, big = a1 - a0 > Math.PI ? 1 : 0, am = i * step
      const g = document.createElementNS(NS, 'g')
      g.setAttribute('class', 'sec' + (it.on?.() ? ' lit' : ''))
      const p = document.createElementNS(NS, 'path')
      p.setAttribute('class', 'bg')
      p.setAttribute('d', `M${pt(R, a0)}A${R} ${R} 0 ${big} 1 ${pt(R, a1)}L${pt(r, a1)}A${r} ${r} 0 ${big} 0 ${pt(r, a0)}Z`)
      const mid = (R + r) / 2 + 1, cx = Math.sin(am) * mid, cy = -Math.cos(am) * mid
      const ic = document.createElementNS(NS, 'path')
      ic.setAttribute('d', typeof it.icon === 'function' ? it.icon() : it.icon)
      ic.setAttribute('class', 'ic')
      ic.setAttribute('transform', `translate(${(cx - 9).toFixed(2)} ${(cy - 14).toFixed(2)}) scale(0.75)`)
      const t = document.createElementNS(NS, 'text')
      t.setAttribute('x', cx.toFixed(2)); t.setAttribute('y', (cy + 13).toFixed(2))
      t.textContent = this.label(it)
      g.append(p, ic, t)
      svg.append(g)
    })
    const hub = document.createElementNS(NS, 'circle')
    hub.setAttribute('r', String(r - 5)); hub.setAttribute('class', 'hub')
    const title = document.createElementNS(NS, 'text'), sub = document.createElementNS(NS, 'text')
    title.setAttribute('class', 'hub-t'); title.setAttribute('y', '2')
    sub.setAttribute('class', 'hub-s'); sub.setAttribute('y', '15')
    svg.append(hub, title, sub)
    this.svg = svg
    this.root.replaceChildren(svg)
    this.mark()
  }

  private label(it: WheelItem): string { return (typeof it.label === 'function' ? it.label() : it.label).toUpperCase() }

  /** The sector under the pointer (−1: the middle; −2: off the ring). */
  private at(e: PointerEvent): number {
    if (!this.svg) return -2
    const b = this.svg.getBoundingClientRect(), k = 200 / b.width
    const x = (e.clientX - (b.left + b.width / 2)) * k, y = (e.clientY - (b.top + b.height / 2)) * k, d = Math.hypot(x, y)
    if (d < r) return -1
    if (d > R * LIP) return -2
    const n = this.shown.length, a = (Math.atan2(x, -y) + Math.PI * 2 + Math.PI / n) % (Math.PI * 2)
    return Math.floor(a / ((Math.PI * 2) / n)) % n
  }

  private hover(e: PointerEvent): void {
    const i = this.at(e)
    const s = i >= 0 ? i : -1
    if (s !== this.sel) { this.sel = s; this.mark() }
  }

  /** A press picks the sector under it (lit); its release runs it. A press off the ring or in the middle closes. */
  private pick(e: PointerEvent, up: boolean): void {
    const i = this.at(e)
    if (!up) { if (i < 0) this.close(); else { this.sel = i; this.mark() }; return }
    if (i >= 0) {
      const it = this.shown[i]
      this.close()
      it.run()
    }
  }

  private mark(): void {
    if (!this.svg) return
    this.svg.querySelectorAll('.sec').forEach((g, i) => g.classList.toggle('sel', i === this.sel))
    const it = this.shown[this.sel]
    const [t, s] = this.svg.querySelectorAll('.hub-t, .hub-s')
    t.textContent = it ? this.label(it) : 'MENU'
    s.textContent = it ? (this.keyboard && it.key ? `KEY ${it.key.toUpperCase()}` : '') : this.keyboard ? 'Q · ESC CLOSE' : 'TAP TO CLOSE'
  }
}
