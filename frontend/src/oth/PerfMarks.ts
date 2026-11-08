/**
 * PERF MARKS (2026-11-08, the user: "make a tool in game that will mark places with sudden fps drops — then drive around
 * all the places and you'll see why the drop happened"). On (F9 — it stays on across loads — or ?perfmark=1), it
 * watches the frame rate as you play and MARKS the spot when it falls:
 *   slow  — half a second's average frame ≥ 1.5× the run's usual one (its 30 % quantile over the last 30 s) and slower
 *           than 2.2 ms (450 fps): a place that is costly to look at
 *   hitch — one frame ≥ 6× the usual and ≥ 40 ms: a stall (a bake, a compile, a garbage collection)
 * Each mark keeps where the camera was and where it looked (the harness flies back to it: `scripts/harness/perfmarks.mjs`),
 * the frame against the usual, the CPU's share, the GPU's time and passes where the browser gives them, and what was
 * drawn (draw calls, triangles, grass blades, terrain patches, trees) — the why. Marks within 30 m of one already made
 * merge (the worse kept, counted). Kept in localStorage (`overhill.perfmarks.v1`, ≤ 300), shown on the map (Tab) as red
 * ✕ with their fps, read back with `__oth.perfMarks()` / cleared with Shift F9.
 * Not counted: the first 6 s after a load or a resume, a paused or hidden page, a menu or the map open, a jump of
 * the camera (a teleport, a respawn).
 * Cost: off — nothing; on — a few comparisons a frame, the snapshot only when a mark is made.
 */
export interface PerfMark {
  kind: 'slow' | 'hitch'
  world: string
  /** the camera: place, and the way it looked (yaw: forward = (−sin, −cos); pitch up +) */
  cx: number; cy: number; cz: number; yaw: number; pitch: number
  /** the camera's height over the ground (m) — the fly camera's `agl` */
  agl: number
  /** the vehicle / the character (where the player was) */
  px: number; pz: number
  /** chase · fpp · foot · fly · bike */
  mode: string
  /** the frame (ms) at the drop, the usual one, and the fps of each */
  ms: number; baseMs: number; fps: number; baseFps: number
  /** the page's JavaScript per frame (ms, smoothed) */
  cpuMs: number
  /** the GPU's frame and passes (ms) — where the browser has timestamp queries */
  gpuMs?: number; passes?: Record<string, number>
  /** what was drawn */
  drawn: Record<string, unknown>
  hour: number; weather: string; zoom?: number
  at: number
  count: number
}

const KEY = 'overhill.perfmarks.v1'
const ON_KEY = 'overhill.perfmarks.on'

export interface PerfSnap {
  world: string
  camera: { position: { x: number; y: number; z: number }; matrixWorld: { elements: ArrayLike<number> } }
  ground: number
  player: { x: number; z: number }
  mode: string
  cpuMs: number
  gpu: () => { frame: number | undefined; passes: Record<string, number> }
  drawn: () => Record<string, unknown>
  hour: number
  weather: string
  zoom?: number
}

export class PerfMarks {
  on: boolean
  readonly marks: PerfMark[]
  private winT = 0
  private winN = 0
  private readonly wins: number[] = []
  private quiet = 0
  private lastX = NaN
  private lastZ = NaN
  private lastMark = 0
  private readonly tag: HTMLDivElement

  constructor(private readonly onMark: (m: PerfMark, merged: boolean) => void) {
    const q = new URLSearchParams(location.search)
    this.on = q.get('perfmark') === '1' || (q.get('perfmark') !== '0' && localStorage.getItem(ON_KEY) === '1')
    let saved: PerfMark[] = []
    try { saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { /* none */ }
    this.marks = Array.isArray(saved) ? saved : []
    this.tag = document.createElement('div')
    this.tag.className = 'oth-perftag'
    document.body.appendChild(this.tag)
    this.showTag()
    this.hold(6000)
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'F9') return
      e.preventDefault()
      if (e.shiftKey) { this.marks.length = 0; this.save(); this.showTag(); return }
      this.on = !this.on
      localStorage.setItem(ON_KEY, this.on ? '1' : '0')
      this.reset(); this.hold(1500); this.showTag()
    })
  }

  /** No counting for `ms` (a load, a resume, a teleport): the frame settles first. */
  hold(ms: number): void { this.quiet = performance.now() + ms; this.winT = 0; this.winN = 0 }

  private reset(): void { this.wins.length = 0; this.winT = 0; this.winN = 0 }

  private showTag(): void {
    this.tag.style.display = this.on ? '' : 'none'
    this.tag.textContent = `PERF MARK · ${this.marks.length} · F9 off · ⇧F9 clear`
  }

  private save(): void {
    try { localStorage.setItem(KEY, JSON.stringify(this.marks.slice(-300))) } catch { /* full */ }
  }

  /** The usual frame: the 30 % quantile of the last 30 s of half-second windows (a drop barely moves it). */
  private base(): number {
    if (this.wins.length < 6) return NaN
    const s = [...this.wins].sort((a, b) => a - b)
    return s[Math.floor(s.length * 0.3)]
  }

  /** Each frame: its interval (ms), and a way to snapshot the moment if it's a drop. `blocked`: a menu / the map open. */
  frame(now: number, dtMs: number, blocked: () => boolean, snap: () => PerfSnap, cam: { x: number; z: number }): void {
    if (!this.on) return
    // (a jump of the camera — a teleport, a respawn, a swap of worlds: settle again)
    if (!Number.isNaN(this.lastX) && (cam.x - this.lastX) ** 2 + (cam.z - this.lastZ) ** 2 > 60 * 60) this.hold(4000)
    this.lastX = cam.x; this.lastZ = cam.z
    if (blocked() || dtMs > 250 || document.hidden) { this.hold(1500); return }
    if (now < this.quiet) return
    const base = this.base()
    // HITCH: one long frame
    if (!Number.isNaN(base) && dtMs >= Math.max(40, base * 6)) this.mark('hitch', dtMs, base, snap())
    this.winT += dtMs; this.winN++
    if (this.winT < 500) return
    const avg = this.winT / this.winN
    this.winT = 0; this.winN = 0
    // SLOW: the half second's average against the usual
    if (!Number.isNaN(base) && avg >= base * 1.5 && avg > 2.2 && now - this.lastMark > 1500) this.mark('slow', avg, base, snap())
    this.wins.push(avg)
    if (this.wins.length > 60) this.wins.shift()
  }

  private mark(kind: PerfMark['kind'], ms: number, baseMs: number, s: PerfSnap): void {
    this.lastMark = performance.now()
    const e = s.camera.matrixWorld.elements
    const fx = -e[8], fy = -e[9], fz = -e[10]
    const g = s.gpu()
    const m: PerfMark = {
      kind, world: s.world,
      cx: +s.camera.position.x.toFixed(1), cy: +s.camera.position.y.toFixed(1), cz: +s.camera.position.z.toFixed(1),
      yaw: +Math.atan2(-fx, -fz).toFixed(3), pitch: +Math.asin(Math.max(-1, Math.min(1, fy))).toFixed(3),
      agl: +(s.camera.position.y - s.ground).toFixed(1),
      px: Math.round(s.player.x), pz: Math.round(s.player.z), mode: s.mode,
      ms: +ms.toFixed(2), baseMs: +baseMs.toFixed(2), fps: Math.round(1000 / ms), baseFps: Math.round(1000 / baseMs),
      cpuMs: +s.cpuMs.toFixed(2),
      ...(g.frame !== undefined ? { gpuMs: +g.frame.toFixed(2), passes: Object.fromEntries(Object.entries(g.passes).map(([k, v]) => [k, +(+v).toFixed(2)])) } : {}),
      drawn: s.drawn(), hour: +s.hour.toFixed(2), weather: s.weather, ...(s.zoom !== undefined ? { zoom: +s.zoom.toFixed(1) } : {}),
      at: Date.now(), count: 1,
    }
    const near = this.marks.find((o) => o.world === m.world && o.kind === m.kind && (o.cx - m.cx) ** 2 + (o.cz - m.cz) ** 2 < 30 * 30)
    if (near) {
      const n = near.count + 1
      if (m.ms > near.ms) Object.assign(near, m)
      near.count = n
    } else this.marks.push(m)
    this.save()
    this.showTag()
    this.onMark(near ?? m, !!near)
  }
}
