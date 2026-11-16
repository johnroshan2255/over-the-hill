import * as GFX from './gfx'
import { ATMOS_GLSL, FRAG_OUT } from './Atmosphere'
import type { CockpitPart } from '../assets/loadModels'
import type { GaugeSpec } from '../gameplay/vehicle/catalogue'

/**
 * THE COCKPIT THAT WORKS (2026-11-16 — the user: "in first person the cars don't have their gear parts, no animation of
 * a gear change, no speedometer — nothing … make the inside like the original"; docs/VEHICLES.md §6 has each car's
 * notes). The models bring the parts (scripts/oth/carkit.py, offroader.py): each dial's FACE (`dial_k`, its UVs one
 * cell of a 4 × 2 canvas), each dial's NEEDLE, the GEAR LEVER with how it moves (the floor's H, a column manual's, an
 * automatic's selector on the column or the console), the transfer case's RANGE lever and the HANDBRAKE's. This file is what they do:
 *
 *  - `dialTexture`: the faces DRAWN, once a car — the scale each real dial has (85 mph on a 1984 GMC, 180 km/h on a
 *    Niva, a rev counter where the real car has one, fuel / temperature / oil / charge), white on black or black on
 *    cream; lit by the cabin's light, and by their own lamps when the headlights are on.
 *  - `CockpitAnim`: the needles follow the car (the speed in the dial's own unit, the engine's revs, the oil pressure
 *    with them, the temperature warming up over the first minute); the gear lever goes through its GATE — out of the
 *    gear to neutral, across, into the next — as the gearbox shifts; the range lever goes back in low range; the
 *    handbrake comes up. `grip`: where the lever's knob is and how far the driver's hand has gone to it (main.ts moves
 *    his right hand there for the shift, and back to the wheel).
 *
 * Cost: one small mesh (≤ 8 discs) and ≤ 9 small moving parts more, drawn only from inside or within 14 m, as the rest
 * of the cockpit; a 1024 × 512 canvas texture a car (2 MB), drawn once. Nothing a frame but a few quaternions.
 */

const CELL = 256

/** Each dial's face drawn into its cell (k: 4 across, 2 down). Model angles: counter-clockwise from 3 o'clock. */
export function dialTexture(gauges: readonly GaugeSpec[]): GFX.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = CELL * 4; cv.height = CELL * 2
  const g = cv.getContext('2d')!
  g.fillStyle = '#101113'; g.fillRect(0, 0, cv.width, cv.height)
  for (const d of gauges) {
    const cx = (d.k % 4) * CELL + CELL / 2, cy = Math.floor(d.k / 4) * CELL + CELL / 2, R = CELL / 2 - 3
    const pale = d.face === 'cream' || d.face === 'white'
    const ink = pale ? '#16171a' : '#ecebe4', dim = pale ? '#55504a' : '#9a9a94'
    g.save()
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip()
    g.fillStyle = pale ? (d.face === 'cream' ? '#e6dfc8' : '#eeeeea') : '#0e0f11'; g.fillRect(cx - R, cy - R, R * 2, R * 2)
    const at = (f: number, r: number): [number, number] => { const a = d.a0 + d.sweep * f; return [cx + Math.cos(a) * r, cy - Math.sin(a) * r] }
    const tick = (f: number, r0: number, r1: number, w: number, col = ink) => { const [x0, y0] = at(f, r0), [x1, y1] = at(f, r1); g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke() }
    const label = (t: string, x: number, y: number, px: number, col = ink) => { g.fillStyle = col; g.font = `700 ${px}px "Barlow Condensed", "Arial Narrow", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x, y) }
    if (d.kind === 'speed' || d.kind === 'rpm') {
      const big = d.kind === 'speed' ? (d.max <= 120 ? 10 : 20) : 1000, n = Math.round(d.max / big)
      // (the red band: the revs past the line)
      if (d.kind === 'rpm' && d.red > 0) {
        g.strokeStyle = '#c8281e'; g.lineWidth = R * 0.09
        g.beginPath(); g.arc(cx, cy, R * 0.9, -(d.a0 + d.sweep * (d.red / d.max)), -(d.a0 + d.sweep), d.sweep < 0); g.stroke()
      }
      for (let i = 0; i <= n * 2; i++) tick(i / (n * 2), R * (i % 2 ? 0.86 : 0.8), R * 0.96, i % 2 ? 2 : 4)
      for (let i = 0; i <= n; i++) { const [x, y] = at(i / n, R * 0.62); label(String(d.kind === 'speed' ? i * big : i), x, y, d.kind === 'speed' && d.max >= 160 ? 26 : 30) }
      label(d.kind === 'speed' ? (d.unit === 'mph' ? 'MPH' : 'km/h') : 'RPM ×1000', cx, cy + R * 0.36, 20, dim)
    } else {
      // a small gauge: an arc of five ticks between its two letters, its name under it
      for (let i = 0; i <= 4; i++) tick(i / 4, R * 0.62, R * 0.9, i % 4 === 0 ? 9 : i === 2 ? 7 : 4, d.kind === 'temp' && i === 4 ? '#c8281e' : d.kind === 'fuel' && i === 0 ? '#c8281e' : ink)
      const [lo, hi, name] = d.kind === 'fuel' ? ['E', 'F', 'FUEL'] : d.kind === 'temp' ? ['C', 'H', 'TEMP'] : d.kind === 'oil' ? ['L', 'H', 'OIL'] : ['−', '+', 'AMP']
      const [x0, y0] = at(0, R * 0.36), [x1, y1] = at(1, R * 0.36)
      label(lo, x0, y0, 56); label(hi, x1, y1, 56)
      label(name, cx, cy + R * 0.6, 44, dim)
    }
    g.restore()
    g.strokeStyle = pale ? '#8d8a80' : '#3a3b3e'; g.lineWidth = 5; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke()
  }
  const t = new GFX.CanvasTexture(cv)
  t.minFilter = GFX.LinearMipmapLinearFilter; t.magFilter = GFX.LinearFilter; t.generateMipmaps = true
  t.wrapS = t.wrapT = GFX.ClampToEdgeWrapping
  t.flipY = false
  t.needsUpdate = true
  return t
}

/** The dials' material: the drawn faces in the cabin's light (the sky's, a little of the sun's), and their own lamps'
 *  warm glow when the headlights are on (the atmosphere's `uLamps`); `uniforms`: the car's (the atmosphere's in them). */
export function dialMaterial(uniforms: Record<string, GFX.IUniform>, tex: GFX.Texture): GFX.ShaderMaterial {
  return new GFX.ShaderMaterial({
    glslVersion: GFX.GLSL3,
    uniforms: { ...uniforms, uDial: { value: tex } },
    vertexShader: /* glsl */ `
out vec2 vUv;
out vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
    fragmentShader: /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
uniform sampler2D uDial;
in vec2 vUv;
in vec3 vWorld;
void main() {
  vec3 a = texture(uDial, vUv).rgb;
  a *= a;
  vec3 c = a * (ambient(vec3(0.0, 1.0, 0.0)) * 0.9 + uSunColor * 0.1);
  c += a * vec3(1.0, 0.8, 0.5) * 0.55 * uLamps;
  gl_FragColor = vec4(applyAtmos(c, vWorld), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    side: GFX.DoubleSide,
  })
}

/** What the car is doing (Vehicle.ts fills it from the simulation each frame). */
export interface CockpitState {
  /** m/s (its size is shown) */
  speed: number
  /** the engine's revs (rpm); 0: off */
  rpm: number
  /** the gear the box is in or going to: 1 … n; −1 reverse; 0 neutral / parked */
  gear: number
  /** forward gears */
  gears: number
  /** an automatic's selector */
  selector: 'P' | 'R' | 'N' | 'D'
  lowRange: boolean
  handbrake: boolean
}

type Part = { kind: string; g: GFX.Group; axis: GFX.Vector3; src?: CockpitPart }

const _q1 = new GFX.Quaternion(), _q2 = new GFX.Quaternion(), _v = new GFX.Vector3()
const X = new GFX.Vector3(1, 0, 0), Z = new GFX.Vector3(0, 0, 1)
const ease = (cur: number, to: number, rate: number, dt: number) => cur + Math.max(-rate * dt, Math.min(rate * dt, to - cur))

/** A floor lever's place in its gate for a gear: [across (− = toward the driver's side … left), along (+ = forward)]. */
function floorSlot(gear: number, n: number): [number, number] {
  if (gear === 0) return [0, 0]
  if (n <= 3) return gear < 0 ? [-0.5, 1] : gear === 1 ? [-0.5, -1] : gear === 2 ? [0.5, 1] : [0.5, -1]          // (three speeds: R over 1st)
  if (n === 4) return gear < 0 ? [-1.5, 1] : [gear <= 2 ? -0.5 : 0.5, gear % 2 ? 1 : -1]                          // (R out to the left and forward)
  return gear < 0 ? [1, -1] : [Math.min(1, Math.floor((gear - 1) / 2) - 1), gear % 2 ? 1 : -1]                     // (five: R under 5th)
}
/** A column manual's place: [toward the driver (−) / away (+), up (+) / down (−)] — three on the tree. */
function columnSlot(gear: number): [number, number] {
  return gear === 0 ? [0, 0] : gear < 0 ? [-1, 1] : gear === 1 ? [-1, -1] : gear === 2 ? [1, 1] : [1, -1]
}

export class CockpitAnim {
  private readonly needles: { p: Part; f: number }[] = []
  private lever: Part | null = null
  private range: Part | null = null
  private hand: Part | null = null
  /** the lever's place in its gate now (across, along) and the automatic's selector angle */
  private at: [number, number] = [0, 0]
  private sel = 0
  private rangeK = 0
  private handK = 0
  private warm = 0.15
  private reach = 0
  private hold = 0
  private readonly knob0 = new GFX.Vector3()
  private readonly knob = new GFX.Vector3()
  private readonly col = new GFX.Vector3(0, -0.37, -0.93)
  private readonly up = new GFX.Vector3()
  private readonly out = { k: 0, pos: this.knob }

  constructor(parts: Part[]) {
    for (const p of parts) {
      if (p.kind.startsWith('needle_')) this.needles.push({ p, f: 0 })
      else if (p.kind === 'gear_lever') this.lever = p
      else if (p.kind === 'lever_transfer') this.range = p
      else if (p.kind === 'lever_hand') this.hand = p
    }
    const s = this.lever?.src
    if (s?.knob) this.knob0.set(s.knob[0] - s.pivot[0], s.knob[1] - s.pivot[1], s.knob[2] - s.pivot[2])
    if (s?.col) this.col.set(...s.col).normalize()
    // (a column lever's "up": across the column and the lever — the way its knob rises as it is lifted)
    this.up.crossVectors(this.col, _v.copy(this.knob0).normalize()).normalize()
    if (this.up.y < 0) this.up.negate()
  }

  /** Where the gear lever's knob is (car space) and how far the driver's hand is to it: 0 on the wheel … 1 on the knob. */
  get grip(): { k: number; pos: GFX.Vector3 } | null { return this.lever?.src?.knob ? this.out : null }

  update(dt: number, s: CockpitState): void {
    // THE NEEDLES: each to its value, damped as a real one is
    this.warm = Math.min(0.5, this.warm + (s.rpm > 300 ? dt / 170 : -dt / 900))
    for (const n of this.needles) {
      const src = n.p.src, max = src?.max || 1, kind = n.p.kind
      const want = kind === 'needle_speed' ? (Math.abs(s.speed) * 3.6 * (src?.unit === 'mph' ? 0.621371 : 1)) / max
        : kind === 'needle_rpm' ? s.rpm / max
        : kind === 'needle_fuel' ? 0.72
        : kind === 'needle_temp' ? (s.rpm > 300 ? this.warm : Math.max(0.12, this.warm - 0.05))
        : kind === 'needle_oil' ? (s.rpm > 300 ? 0.3 + 0.45 * Math.min(1, s.rpm / 3000) : 0)
        : s.rpm > 300 ? 0.62 : 0.45
      n.f += (Math.max(0, Math.min(1.04, want)) - n.f) * Math.min(1, dt * (kind === 'needle_speed' || kind === 'needle_rpm' ? 9 : 2.5))
      n.p.g.quaternion.setFromAxisAngle(n.p.axis, (src?.sweep ?? -4.7) * n.f)
    }
    // THE GEAR LEVER
    const L = this.lever
    let moving = false
    if (L) {
      const kind = L.src?.shift ?? 'floor'
      if (kind === 'autofloor') {
        // an automatic's selector on the console: P R N D in a line, front to back
        const want = s.selector === 'P' ? 0 : s.selector === 'R' ? 1 : s.selector === 'N' ? 2 : 3
        moving = Math.abs(want - this.sel) > 0.02
        this.sel = ease(this.sel, want, 6, dt)
        L.g.quaternion.setFromAxisAngle(X, (this.sel - 1.5) * 0.11)
      } else if (kind === 'auto') {
        // an automatic's selector on the column: P R N D down its quadrant (the gears change in the box, not here)
        const want = s.selector === 'P' ? 0 : s.selector === 'R' ? 1 : s.selector === 'N' ? 2 : 3
        moving = Math.abs(want - this.sel) > 0.02
        this.sel = ease(this.sel, want, 6, dt)
        L.g.quaternion.setFromAxisAngle(this.col, -(0.3 - this.sel * 0.15) * Math.sign(this.up.dot(_v.crossVectors(this.col, this.knob0)) || 1))
      } else {
        const gear = s.selector === 'P' || s.selector === 'N' ? 0 : s.selector === 'R' ? -1 : s.gear
        const [tc, tr] = kind === 'column' ? columnSlot(gear) : floorSlot(gear, s.gears)
        // through the gate: out of the gear to neutral, across, into the next
        const a = this.at
        if (Math.abs(a[0] - tc) > 0.01) { a[1] = ease(a[1], 0, 9, dt); if (Math.abs(a[1]) < 0.03) a[0] = ease(a[0], tc, 9, dt) }
        else { a[0] = tc; a[1] = ease(a[1], tr, 9, dt) }
        moving = Math.abs(a[0] - tc) > 0.01 || Math.abs(a[1] - tr) > 0.02
        if (kind === 'column') {
          // up / down about the column, toward / away along it
          _q1.setFromAxisAngle(this.col, -a[1] * 0.26 * Math.sign(this.up.dot(_v.crossVectors(this.col, this.knob0)) || 1))
          _q2.setFromAxisAngle(this.up, a[0] * 0.1)
          L.g.quaternion.copy(_q1).multiply(_q2)
        } else {
          // (car space: −z forward, +x right — forward is a turn of −x, to the left a turn of +z)
          _q1.setFromAxisAngle(Z, -a[0] * 0.1)
          _q2.setFromAxisAngle(X, -a[1] * 0.17)
          L.g.quaternion.copy(_q1).multiply(_q2)
        }
      }
      // the hand: to the knob as the lever starts, on it while it moves, a moment more, then back to the wheel
      if (moving) this.hold = 0.16
      else this.hold = Math.max(0, this.hold - dt)
      this.reach = ease(this.reach, moving || this.hold > 0 ? 1 : 0, moving ? 9 : 5.5, dt)
      this.knob.copy(this.knob0).applyQuaternion(L.g.quaternion).add(L.g.position)
      this.out.k = this.reach
    }
    // THE RANGE LEVER (back in low) and THE HANDBRAKE (up when it's on, and when the box is parked)
    if (this.range) { this.rangeK = ease(this.rangeK, s.lowRange ? 1 : 0, 4, dt); this.range.g.quaternion.setFromAxisAngle(this.range.axis, 0.42 * this.rangeK - 0.1) }
    if (this.hand) { this.handK = ease(this.handK, s.handbrake || s.selector === 'P' ? 1 : 0, 5, dt); this.hand.g.quaternion.setFromAxisAngle(this.hand.axis, 0.42 * this.handK) }
  }
}
