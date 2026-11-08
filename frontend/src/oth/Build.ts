import * as GFX from './gfx'
import type { Claims } from './Claims'
import { GroundRing, linearOf } from './GroundRing'
import type { MapData } from './MapData'
import { lookBy, releaseMouse } from './mouseLook'
import type { Session } from '../net/Session'

/**
 * BUILD MODE (B — docs/MULTIPLAYER.md §2, the user: "like in Blender we can mark a place in a dashed rounded brush …
 * mark a territory"): the cursor is freed and THE BRUSH — a dashed ring on the ground with its falloff ring and a faint
 * fill, Blender's — follows it over the land (a ray from the camera through the cursor to the ground; on a touch screen,
 * where you tap). The wheel (or [ ], or − +) sizes it; a click PLANTS YOUR FLAG: the land inside is yours (the server
 * says yes or why not). Right-drag still turns the camera; B or Esc leaves. On your own land, Delete twice gives it up.
 *
 * The brush shows, before you click, what the server would say: amber — yours to take; red — and the reason (too far,
 * too close to someone's land, on the water, you already have land).
 */
const OK = '#f2a93b', NO = '#e0523a'

export class Build {
  on = false
  private readonly brush: GroundRing
  private r: number
  private readonly hit = new GFX.Vector3()
  private hitOk = false
  private mx = NaN
  private my = NaN
  private readonly panel: HTMLDivElement
  private readonly line: HTMLSpanElement
  private readonly why: HTMLSpanElement
  private busy = false
  private delArmed = 0
  private reason = ''
  private readonly off = new AbortController()
  private readonly ray = new GFX.Vector3()
  private readonly col = new GFX.Color()

  constructor(
    private readonly session: Session,
    private readonly claims: Claims,
    private readonly map: () => MapData,
    private readonly camera: GFX.PerspectiveCamera,
    scene: GFX.Scene,
    canvas: HTMLElement,
    private readonly player: () => GFX.Vector3,
    private readonly toast: (m: string, ms?: number) => void,
    /** Every car and person here (ours and the others'): the flag's spot must be clear of them. */
    private readonly blockers: () => GFX.Vector3[],
  ) {
    const R = session.world.rules
    this.r = Math.round((R.claim_min_r + R.claim_max_r) / 2)
    this.brush = new GroundRing(map, { inner: 0.5, fill: true, lift: 0.14, renderOrder: 6 })
    this.brush.visible = false
    scene.add(this.brush.mesh, this.brush.fill!)
    // the HUD: what the brush does, its size, why not; the keys (touch: buttons)
    this.panel = document.createElement('div')
    this.panel.className = 'oth-build'
    const head = document.createElement('div')
    head.className = 'oth-build-head'
    const tag = document.createElement('b')
    tag.textContent = 'Build'
    this.line = document.createElement('span')
    this.why = document.createElement('em')
    head.append(tag, this.line, this.why)
    const keys = document.createElement('div')
    keys.className = 'oth-build-keys'
    const key = (k: string, t: string, go?: () => void) => {
      const b = document.createElement('button')
      b.innerHTML = `<kbd>${k}</kbd>${t}`
      if (go) b.addEventListener('click', (e) => { e.stopPropagation(); go() })
      keys.append(b)
    }
    // (a touch screen: big buttons — tap the ground for the brush, PLANT, the size, give up, done; a keyboard: the keys)
    if (document.body.classList.contains('touch')) {
      const btn = (t: string, cls: string, go: () => void) => {
        const b = document.createElement('button')
        b.className = cls
        b.textContent = t
        b.addEventListener('click', (e) => { e.stopPropagation(); go() })
        keys.append(b)
      }
      keys.classList.add('touch')
      btn('Plant flag', 'go', () => this.claim())
      btn('−', 'sz', () => this.size(-4))
      btn('+', 'sz', () => this.size(4))
      btn('Give up land', '', () => this.unclaim())
      btn('Done', '', () => this.toggle(false))
    } else {
      key('Click', 'Plant your flag', () => this.claim())
      key('Wheel', 'Size', () => this.size(4))
      key('Right-drag', 'Look')
      key('Del', 'Give up your land', () => this.unclaim())
      key('B', 'Done', () => this.toggle(false))
    }
    this.panel.append(head, keys)
    this.panel.style.display = 'none'
    document.body.appendChild(this.panel)

    const sig = { signal: this.off.signal }
    // the cursor over the game moves the brush; a tap (touch) puts it there
    canvas.addEventListener('pointermove', (e) => { if (this.on && e.pointerType === 'mouse') { this.mx = e.clientX; this.my = e.clientY } }, sig)
    let down: { x: number; y: number; b: number; id: number } | null = null
    canvas.addEventListener('pointerdown', (e) => { if (this.on) { down = { x: e.clientX, y: e.clientY, b: e.button, id: e.pointerId }; this.mx = e.clientX; this.my = e.clientY } }, sig)
    window.addEventListener('pointermove', (e) => {
      if (!this.on || !down || down.id !== e.pointerId || down.b !== 2) return
      lookBy(e.movementX, e.movementY)
    }, sig)
    window.addEventListener('pointerup', (e) => {
      if (!this.on || !down || down.id !== e.pointerId) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), b = down.b
      down = null
      if (moved > 8) return
      if (e.pointerType !== 'mouse') { this.mx = e.clientX; this.my = e.clientY; return } // (a tap: the brush there; PLANT is the button)
      if (b === 0 && e.target === canvas) this.claim()
    }, sig)
    canvas.addEventListener('contextmenu', (e) => { if (this.on) e.preventDefault() }, sig)
    window.addEventListener('wheel', (e) => { if (!this.on) return; e.stopPropagation(); this.size(e.deltaY > 0 ? -2 : 2) }, { capture: true, passive: true, signal: this.off.signal })
    window.addEventListener('keydown', (e) => {
      if (e.repeat || (e.target as HTMLElement | null)?.tagName === 'INPUT') return
      if (e.code === 'KeyB' && !document.querySelector('.oh-front')) { e.stopPropagation(); this.toggle(); return }
      if (!this.on) return
      if (e.code === 'Escape') { e.stopPropagation(); e.preventDefault(); this.toggle(false) }
      else if (e.code === 'BracketRight' || e.code === 'Equal' || e.code === 'NumpadAdd') { e.stopPropagation(); this.size(2) }
      else if (e.code === 'BracketLeft' || e.code === 'Minus' || e.code === 'NumpadSubtract') { e.stopPropagation(); this.size(-2) }
      else if (e.code === 'Delete' || e.code === 'Backspace') { e.stopPropagation(); this.unclaim() }
      else if (e.code === 'Enter') { e.stopPropagation(); this.claim() }
    }, { capture: true, signal: this.off.signal })
  }

  /** What stands at (x, z) that a flag can't go in (main.ts: a tree's trunk, a boulder) — its reason, or ''. */
  obstacle: ((x: number, z: number) => string) | null = null
  /** BUILD mode on / off (main.ts: the camera up for the builder's view). */
  onToggle: ((on: boolean) => void) | null = null

  toggle(on = !this.on): void {
    if (on === this.on) return
    this.on = on
    this.onToggle?.(on)
    document.body.classList.toggle('oth-build', on)
    this.panel.style.display = on ? '' : 'none'
    this.brush.visible = false
    this.claims.showEdges = on
    if (on) {
      releaseMouse()
      // (no cursor yet: the brush starts in the middle of the view)
      if (Number.isNaN(this.mx)) { this.mx = innerWidth / 2; this.my = innerHeight * 0.62 }
    }
  }

  private size(d: number): void {
    const R = this.session.world.rules
    this.r = Math.max(R.claim_min_r, Math.min(R.claim_max_r, this.r + d))
  }

  /** The ground under the screen point (x, y): a ray from the camera, marched then halved down to it. */
  private ground(x: number, y: number, out: GFX.Vector3): boolean {
    const cam = this.camera, map = this.map()
    this.ray.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1, 0.5).unproject(cam).sub(cam.position).normalize()
    const o = cam.position, d = this.ray
    let t0 = 0, t = 0
    for (let k = 0; k < 400 && t < 900; k++) {
      const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t
      const above = py - map.height(px, pz)
      if (above < 0) break
      t0 = t
      t += Math.max(0.5, above * 0.5)
    }
    if (t >= 900) return false
    let a = t0, b = t
    for (let k = 0; k < 14; k++) {
      const m = (a + b) / 2, px = o.x + d.x * m, py = o.y + d.y * m, pz = o.z + d.z * m
      if (py - map.height(px, pz) > 0) a = m; else b = m
    }
    out.set(o.x + d.x * b, 0, o.z + d.z * b)
    out.y = map.height(out.x, out.z)
    return true
  }

  /** Why the brush can't be planted here ('' — it can). The server checks the same (backend world.rs `claim`). */
  private check(x: number, z: number): string {
    const S = this.session, map = this.map(), half = -map.meta.inner.origin
    const mine = [...S.claims.values()].find((c) => c.owner === S.me.id)
    if (mine) return Math.hypot(mine.x - x, mine.z - z) <= mine.r ? 'Your land — Del gives it up' : 'You have land already — Del on it to give it up'
    const p = this.player()
    if (Math.hypot(p.x - x, p.z - z) > this.r + 30) return 'Too far — get closer'
    if (Math.abs(x) > half - this.r || Math.abs(z) > half - this.r) return 'Too near the edge of the valley'
    for (const c of S.claims.values()) if (Math.hypot(c.x - x, c.z - z) < c.r + this.r + 4) return `Too close to ${c.owner_name}'s land`
    if (map.waterAt(x, z) !== null) return 'Not on the water'
    for (const b of this.blockers()) if (Math.hypot(b.x - x, b.z - z) < 4) return 'The flag goes in the ground — not under a car or a person'
    return this.obstacle?.(x, z) ?? ''
  }

  /** Every frame (after the cameras): the brush to the cursor, its colour and words. */
  update(dt: number): void {
    if (!this.on) return
    this.hitOk = !Number.isNaN(this.mx) && this.ground(this.mx, this.my, this.hit)
    this.brush.visible = this.hitOk
    if (this.delArmed > 0) this.delArmed -= dt
    let text = `Claim land · ${this.r * 2} m across`
    if (this.hitOk) {
      this.brush.set(this.hit.x, this.hit.z, this.r, Math.max(0.7, this.r * 0.035))
      this.brush.uniforms.uTime.value += dt
      this.reason = this.busy ? '' : this.check(this.hit.x, this.hit.z)
      linearOf(this.reason ? NO : OK, this.col)
      this.brush.uniforms.uColor.value.copy(this.col)
      this.brush.uniforms.uDashes.value = Math.max(24, Math.round((2 * Math.PI * this.r) / 1.6))
    } else {
      this.reason = 'Point at the ground'
    }
    if (this.busy) text = 'Planting your flag…'
    if (this.line.textContent !== text) this.line.textContent = text
    const touch = document.body.classList.contains('touch')
    const why = this.delArmed > 0 ? (touch ? 'Tap again to give up your land' : 'Del again to give up your land') : !this.hitOk && touch ? 'Tap the ground to put the brush there' : this.reason
    if (this.why.textContent !== why) { this.why.textContent = why; this.why.className = why ? 'no' : '' }
  }

  private claim(): void {
    if (!this.on || this.busy || !this.hitOk) return
    if (this.reason) { this.toast(this.reason, 2200); return }
    this.busy = true
    const x = this.hit.x, z = this.hit.z
    this.session.ask({ t: 'claim', x, z, r: this.r })
      .then(() => { this.toast('Your land — your flag is up', 3500); this.toggle(false) })
      .catch((e: Error) => this.toast(e.message, 3000))
      .finally(() => { this.busy = false })
  }

  private unclaim(): void {
    const S = this.session, mine = [...S.claims.values()].find((c) => c.owner === S.me.id)
    if (!mine) { this.toast("You don't have land yet", 2000); return }
    if (this.delArmed <= 0) { this.delArmed = 2.5; return }
    this.delArmed = 0
    S.ask({ t: 'unclaim', claim: mine.id }).then(() => this.toast('Your land is free again', 3000)).catch((e: Error) => this.toast(e.message, 3000))
  }

  dispose(): void {
    this.toggle(false)
    this.off.abort()
    this.brush.dispose()
    this.panel.remove()
  }
}
