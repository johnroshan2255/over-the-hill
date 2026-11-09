import * as GFX from './gfx'
import type { Claims } from './Claims'
import { GroundRing, linearOf } from './GroundRing'
import type { MapData } from './MapData'
import { lookBy, releaseMouse } from './mouseLook'
import type { Session } from '../net/Session'
import type { Builder } from './Builder'

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

/** THE GROUND'S TOOLS (step 5 — docs/MULTIPLAYER.md §3; the server's `shape` / `pave` / `pond`): what each does, its
 *  brush (m: least, most, to start), its colour. Hold the button to work (shaping: a pass every 0.16 s; paving: a
 *  stroke each time the brush has moved on); a pond is one click. */
type ToolId = 'raise' | 'lower' | 'flatten' | 'smooth' | 'stone' | 'gravel' | 'dirt' | 'erase' | 'pond'
const TOOLS: { id: ToolId; name: string; hint: string; r: [number, number, number]; col: string }[] = [
  { id: 'raise', name: 'Raise', hint: 'heap the ground up', r: [2, 12, 4], col: '#f2a93b' },
  { id: 'lower', name: 'Lower', hint: 'dig it down', r: [2, 12, 4], col: '#d9874a' },
  { id: 'flatten', name: 'Flatten', hint: 'level it to where you first pressed — a yard, a floor', r: [2, 12, 5], col: '#f2d23b' },
  { id: 'smooth', name: 'Smooth', hint: 'ease the bumps and edges', r: [2, 12, 5], col: '#c9d86a' },
  { id: 'stone', name: 'Pave: stone', hint: 'flagstones · 1 stone a stroke', r: [1, 6, 2], col: '#b9b4aa' },
  { id: 'gravel', name: 'Pave: gravel', hint: 'a gravel path · 1 stone a stroke', r: [1, 6, 1.5], col: '#a8957a' },
  { id: 'dirt', name: 'Pave: earth', hint: 'bare earth, a garden bed · free', r: [1, 6, 2], col: '#8a6a4a' },
  { id: 'erase', name: 'Erase', hint: 'the ground back as it was', r: [1, 6, 2], col: '#7fb2c9' },
  { id: 'pond', name: 'Dig a pond', hint: 'a bowl, water up to its rim · inside your land', r: [3, 15, 6], col: '#4fb0d8' },
]

export class Build {
  on = false
  /** CLAIM (the brush: your land) or PIECES (building on it — Builder.ts); B opens on pieces once you have land. */
  mode: 'claim' | 'pieces' | 'ground' = 'claim'
  builder: Builder | null = null
  /** The ground's tool (TOOLS) and each one's brush. */
  tool = 0
  private readonly toolR = TOOLS.map((t) => t.r[2])
  /** Held down (the ground's tools work while it is), where it was pressed (flatten's height), the last stroke. */
  private holding = false
  private flatY = NaN
  private workT = 0
  private digT = 0
  private readonly lastStroke = new GFX.Vector3(Infinity, 0, 0)
  private inFlight = 0
  /** The builder's work seen (main.ts: the hero swings / stoops, the dust): dig or lay at (x, z), a brush r. */
  onWork: ((kind: 'dig' | 'lay', x: number, z: number, r: number, hit: () => void) => void) | null = null
  private claimKeys!: HTMLDivElement
  private pieceKeys!: HTMLDivElement
  private groundKeys!: HTMLDivElement
  private readonly tagEl: HTMLElement
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
    const tag = (this.tagEl = document.createElement('b'))
    tag.textContent = 'Build'
    this.line = document.createElement('span')
    this.why = document.createElement('em')
    head.append(tag, this.line, this.why)
    let keys = (this.claimKeys = document.createElement('div'))
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
    // THE PIECES' keys (Builder.ts)
    keys = this.pieceKeys = document.createElement('div')
    keys.className = 'oth-build-keys'
    const B = () => this.builder
    if (document.body.classList.contains('touch')) {
      const btn = (t: string, cls: string, go: () => void) => {
        const b = document.createElement('button'); b.className = cls; b.textContent = t
        b.addEventListener('click', (e) => { e.stopPropagation(); go() }); keys.append(b)
      }
      keys.classList.add('touch')
      btn('◀', 'sz', () => B()?.cycle(-1)); btn('▶', 'sz', () => B()?.cycle(1)); btn('Turn', '', () => B()?.rotate())
      btn('Place', 'go', () => B()?.place()); btn('Take down', '', () => B()?.remove()); btn('Ground', '', () => this.setMode('ground')); btn('Land', '', () => this.setMode('claim')); btn('Done', '', () => this.toggle(false))
    } else {
      key('Click', 'Place', () => B()?.place())
      key('Wheel / [ ]', 'Piece', () => B()?.cycle(1))
      key('Tab', 'Next kind', () => B()?.nextGroup())
      key('R', 'Turn', () => B()?.rotate())
      key('X', 'Take down', () => B()?.remove())
      key('C', 'Your land', () => this.setMode('claim'))
      key('G', 'The ground', () => this.setMode('ground'))
      key('Right-drag', 'Look')
      key('B', 'Done', () => this.toggle(false))
    }
    // THE GROUND'S keys
    keys = this.groundKeys = document.createElement('div')
    keys.className = 'oth-build-keys'
    if (document.body.classList.contains('touch')) {
      const btn = (t: string, cls: string, go: () => void) => {
        const b = document.createElement('button'); b.className = cls; b.textContent = t
        b.addEventListener('click', (e) => { e.stopPropagation(); go() }); keys.append(b)
      }
      keys.classList.add('touch')
      btn('◀', 'sz', () => this.cycleTool(-1)); btn('▶', 'sz', () => this.cycleTool(1))
      btn('Work', 'go', () => this.groundOnce()); btn('−', 'sz', () => this.size(-1)); btn('+', 'sz', () => this.size(1))
      btn('Build', '', () => this.setMode('pieces')); btn('Done', '', () => this.toggle(false))
    } else {
      key('Hold', 'Work', () => this.groundOnce())
      key('Tab / 1–9', 'Tool', () => this.cycleTool(1))
      key('Wheel / [ ]', 'Size', () => this.size(1))
      key('G', 'Pieces', () => this.setMode('pieces'))
      key('Right-drag', 'Look')
      key('B', 'Done', () => this.toggle(false))
    }
    this.panel.append(head, this.claimKeys, this.pieceKeys, this.groundKeys)
    this.panel.style.display = 'none'
    document.body.appendChild(this.panel)

    const sig = { signal: this.off.signal }
    // the cursor over the game moves the brush; a tap (touch) puts it there
    canvas.addEventListener('pointermove', (e) => { if (this.on && e.pointerType === 'mouse') { this.mx = e.clientX; this.my = e.clientY } }, sig)
    let down: { x: number; y: number; b: number; id: number } | null = null
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.on) return
      down = { x: e.clientX, y: e.clientY, b: e.button, id: e.pointerId }; this.mx = e.clientX; this.my = e.clientY
      if (this.mode === 'ground' && e.button === 0 && e.pointerType === 'mouse') this.press()
    }, sig)
    window.addEventListener('pointermove', (e) => {
      if (!this.on || !down || down.id !== e.pointerId || down.b !== 2) return
      lookBy(e.movementX, e.movementY)
    }, sig)
    window.addEventListener('pointerup', (e) => {
      if (this.holding && e.pointerType === 'mouse') this.holding = false
      if (!this.on || !down || down.id !== e.pointerId) return
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), b = down.b
      down = null
      if (moved > 8) return
      if (e.pointerType !== 'mouse') { this.mx = e.clientX; this.my = e.clientY; return } // (a tap: the brush there; PLANT is the button)
      if (b === 0 && e.target === canvas) { if (this.mode === 'pieces') this.builder?.place(); else if (this.mode === 'claim') this.claim() }
    }, sig)
    canvas.addEventListener('contextmenu', (e) => { if (this.on) e.preventDefault() }, sig)
    window.addEventListener('wheel', (e) => { if (!this.on) return; e.stopPropagation(); if (this.mode === 'pieces') this.builder?.cycle(e.deltaY > 0 ? 1 : -1); else this.size(e.deltaY > 0 ? (this.mode === 'ground' ? -1 : -2) : this.mode === 'ground' ? 1 : 2) }, { capture: true, passive: true, signal: this.off.signal })
    window.addEventListener('keydown', (e) => {
      if (e.repeat || (e.target as HTMLElement | null)?.tagName === 'INPUT') return
      if (e.code === 'KeyB' && !document.querySelector('.oh-front')) { e.stopPropagation(); this.toggle(); return }
      if (!this.on) return
      if (e.code === 'Escape') { e.stopPropagation(); e.preventDefault(); this.toggle(false); return }
      if (this.mode === 'ground') {
        const k = e.code
        if (k === 'Tab') { e.preventDefault(); this.cycleTool(e.shiftKey ? -1 : 1) }
        else if (/^Digit[1-9]$/.test(k)) this.setTool(Number(k.slice(5)) - 1)
        else if (k === 'BracketRight' || k === 'Equal' || k === 'NumpadAdd') this.size(1)
        else if (k === 'BracketLeft' || k === 'Minus' || k === 'NumpadSubtract') this.size(-1)
        else if (k === 'KeyG' || k === 'KeyP') this.setMode('pieces')
        else if (k === 'KeyC') this.setMode('claim')
        else if (k === 'Enter') this.groundOnce()
        else return
        e.stopPropagation()
        return
      }
      if (this.mode === 'pieces') {
        const b = this.builder
        if (!b) return
        const k = e.code
        if (k === 'BracketRight' || k === 'Equal' || k === 'NumpadAdd') b.cycle(1)
        else if (k === 'BracketLeft' || k === 'Minus' || k === 'NumpadSubtract') b.cycle(-1)
        else if (k === 'Tab') { e.preventDefault(); b.nextGroup() }
        else if (k === 'KeyR') b.rotate()
        else if (k === 'KeyX' || k === 'Delete') b.remove()
        else if (k === 'Enter') b.place()
        else if (k === 'KeyC') this.setMode('claim')
        else if (k === 'KeyG') this.setMode('ground')
        else return
        e.stopPropagation()
        return
      }
      if (e.code === 'KeyC' && this.mine()) { e.stopPropagation(); this.setMode('pieces') }
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
    if (on) this.setMode(this.mine() && this.builder ? 'pieces' : 'claim')
    else if (this.builder) this.builder.ghost.visible = false
    this.claims.showEdges = on
    if (on) {
      releaseMouse()
      // (no cursor yet: the brush starts in the middle of the view)
      if (Number.isNaN(this.mx)) { this.mx = innerWidth / 2; this.my = innerHeight * 0.62 }
    }
  }

  private mine() { return [...this.session.claims.values()].find((c) => c.owner === this.session.me.id) ?? null }
  /** Claim (the brush) or pieces (the builder). */
  setMode(m: 'claim' | 'pieces' | 'ground'): void {
    if ((m === 'pieces' && !this.builder) || !this.mine()) m = 'claim'
    this.mode = m
    this.holding = false
    this.claimKeys.style.display = m === 'claim' ? '' : 'none'
    this.pieceKeys.style.display = m === 'pieces' ? '' : 'none'
    this.groundKeys.style.display = m === 'ground' ? '' : 'none'
    this.tagEl.textContent = m === 'pieces' ? 'Build' : m === 'ground' ? 'Ground' : 'Land'
    if (this.builder) this.builder.ghost.visible = false
    this.brush.visible = false
  }

  private size(d: number): void {
    if (this.mode === 'ground') {
      const T = TOOLS[this.tool]
      this.toolR[this.tool] = Math.max(T.r[0], Math.min(T.r[1], this.toolR[this.tool] + d * (T.r[1] > 6 ? 1 : 0.5)))
      return
    }
    const R = this.session.world.rules
    this.r = Math.max(R.claim_min_r, Math.min(R.claim_max_r, this.r + d))
  }

  // ================================================================================================ THE GROUND
  /** The ground's tool by its place in TOOLS (or its id). */
  setTool(i: number | ToolId): void {
    const k = typeof i === 'number' ? i : TOOLS.findIndex((t) => t.id === i)
    if (k >= 0 && k < TOOLS.length) { this.tool = k; this.holding = false; this.lastStroke.set(Infinity, 0, 0) }
  }
  private cycleTool(d: number): void { this.setTool((this.tool + d + TOOLS.length) % TOOLS.length) }
  /** The ground's brush now (m). */
  get toolRadius(): number { return this.toolR[this.tool] }
  set toolRadius(r: number) { const T = TOOLS[this.tool]; this.toolR[this.tool] = Math.max(T.r[0], Math.min(T.r[1], r)) }

  /** Why the ground's tool can't work at (x, z) ('' — it can). The server checks the same (world.rs shape / pave / pond). */
  private groundCheck(x: number, z: number): string {
    const c = this.mine(), T = TOOLS[this.tool], r = this.toolRadius, map = this.map()
    if (!c) return 'Plant your flag first — the ground is yours to work inside your land'
    const d = Math.hypot(c.x - x, c.z - z)
    if (d > c.r) return 'Outside your land'
    const p = this.player()
    if (Math.hypot(p.x - c.x, p.z - c.z) > c.r + 40) return 'Too far from your land — get closer'
    if (T.id === 'pond') {
      if (d + r > c.r) return 'The pond must be inside your land — smaller, or nearer the middle'
      if ([...this.session.ponds.values()].filter((q) => q.claim === c.id).length >= 4) return 'That\'s enough ponds'
      for (const q of this.session.ponds.values()) if (Math.hypot(q.x - x, q.z - z) < q.r + r) return 'There\'s a pond there'
      for (const pc of this.session.pieces.values()) if (pc.claim === c.id && Math.hypot(pc.x - x, pc.z - z) < r + 1) return 'Something is built there'
    }
    if ((T.id === 'stone' || T.id === 'gravel')) {
      const need = Math.max(1, Math.ceil((Math.PI * r * r) / 8))
      if (c.stock.stone < need && !this.session.world.rules.creative) return `Paving here takes ${need} stone — you have ${c.stock.stone} in your stockpile`
    }
    if (map.waterAt(x, z) !== null && T.id !== 'raise' && T.id !== 'smooth') return T.id === 'pond' ? 'Not in the water' : 'Under water'
    return ''
  }

  /** The button pressed (mouse) on the ground: hold to work. */
  private press(): void {
    if (!this.hitOk) return
    this.flatY = this.hit.y
    this.lastStroke.set(Infinity, 0, 0)
    this.workT = 0
    if (TOOLS[this.tool].id === 'pond') { this.groundOnce(); return }
    this.holding = true
  }

  /** One pass of the tool where the brush is (a tap, Enter, the touch screen's WORK). */
  groundOnce(): void {
    if (!this.on || this.mode !== 'ground' || !this.hitOk) return
    if (Number.isNaN(this.flatY) || TOOLS[this.tool].id !== 'flatten') this.flatY = this.hit.y
    this.workT = 0
    this.lastStroke.set(Infinity, 0, 0)
    this.groundWork(true)
  }

  /** While held: the tool's next pass (shaping every 0.16 s; paving where the brush has moved on). */
  private groundWork(force = false): void {
    const T = TOOLS[this.tool], x = this.hit.x, z = this.hit.z, r = this.toolRadius
    const why = this.groundCheck(x, z)
    if (why) { if (force) this.toast(why, 2200); return }
    if (this.inFlight >= 3) return
    const S = this.session
    const sent = (p: Promise<void>) => { this.inFlight++; p.catch((e: Error) => { this.toast(e.message, 2600); this.holding = false }).finally(() => { this.inFlight-- }) }
    switch (T.id) {
      case 'raise': case 'lower': case 'flatten': case 'smooth': {
        if (!force && this.workT > 0) return
        this.workT = 0.16
        const op = T.id, strength = op === 'raise' || op === 'lower' ? 0.16 : 0.45
        sent(S.ask({ t: 'shape', op, x, z, r, strength, y: op === 'flatten' ? this.flatY : null }))
        // (he swings the pick into it now and then — not every pass; the dust where it moves)
        if (this.digT <= 0) { this.digT = 1.1; this.onWork?.('dig', x, z, r, () => {}) }
        break
      }
      case 'stone': case 'gravel': case 'dirt': case 'erase': {
        if (!force && this.lastStroke.x !== Infinity && Math.hypot(this.lastStroke.x - x, this.lastStroke.z - z) < r * 0.6) return
        this.lastStroke.set(x, 0, z)
        sent(S.ask({ t: 'pave', mat: T.id, x, z, r }))
        if (this.digT <= 0) { this.digT = 1.3; this.onWork?.('lay', x, z, r, () => {}) }
        break
      }
      case 'pond': {
        const depth = Math.min(2.4, 0.7 + r * 0.12)
        this.onWork?.('dig', x, z, r, () => {})
        sent(S.ask({ t: 'pond', x, z, r, depth }).then(() => this.toast('A pond — the water\'s coming up', 2600)))
        break
      }
    }
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
    if (this.mode === 'pieces' && this.builder) {
      this.brush.visible = false
      this.builder.update(dt, this.hitOk ? this.hit : null)
      const t = this.builder.text()
      if (this.line.textContent !== t.line) this.line.textContent = t.line
      const touch = document.body.classList.contains('touch')
      const why = !this.hitOk ? (touch ? 'Tap your land where it goes' : 'Point at your land') : t.why
      const shown = why || (touch ? 'Ready — tap Place' : 'Ready — click to place')
      if (this.why.textContent !== shown) { this.why.textContent = shown; this.why.className = why ? 'no' : '' }
      return
    }
    if (this.digT > 0) this.digT -= dt
    if (this.mode === 'ground') {
      this.brush.visible = this.hitOk
      if (this.workT > 0) this.workT -= dt
      const T = TOOLS[this.tool], r = this.toolRadius
      let why = this.hitOk ? this.groundCheck(this.hit.x, this.hit.z) : 'Point at your land'
      if (this.hitOk) {
        this.brush.set(this.hit.x, this.hit.z, r, Math.max(0.3, r * 0.05))
        this.brush.uniforms.uTime.value += dt
        linearOf(why ? NO : T.col, this.col)
        this.brush.uniforms.uColor.value.copy(this.col)
        this.brush.uniforms.uDashes.value = Math.max(16, Math.round((2 * Math.PI * r) / 1.2))
        if (this.holding && !why) this.groundWork()
      }
      const touch = document.body.classList.contains('touch')
      const text = `${T.name} · ${(r * 2).toFixed(r < 3 ? 1 : 0)} m · ${T.hint}${T.id === 'flatten' && this.holding ? ` · to ${this.flatY.toFixed(1)} m` : ''}`
      if (!why) why = touch ? 'Ready — tap WORK' : T.id === 'pond' ? 'Ready — click to dig it' : 'Ready — hold the button to work'
      if (this.line.textContent !== text) this.line.textContent = text
      if (this.why.textContent !== why) { this.why.textContent = why; this.why.className = why.startsWith('Ready') ? '' : 'no' }
      return
    }
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
