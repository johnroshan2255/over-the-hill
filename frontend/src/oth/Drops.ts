import * as GFX from './gfx'
import type { TruckModel } from '../assets/loadModels'
import { isMobileDevice } from '../rendering/quality/DeviceProfile'
import { gameParams } from '../settings'
import type { Atmosphere } from './Atmosphere'
import type { Tier } from './quality'

/**
 * THE RAIN ON THE CAR (2026-11-27, the user: "while raining, in a car, on a PC at ULTRA I need the water droplets on
 * the car — they move over the windows and the front glass and the wiper wipes them; in first person I see the drops
 * on the windows, moving naturally, wiped by the wiper. And on every device: a muddy car in the rain, or driven
 * through water, comes clean. The water's movement and the drops must look natural").
 *
 * THE DROPS (ULTRA on a PC — `dropsFor`; `?drops=0 / 1` the A/B): drawn in the car's own shader (Vehicle.ts FRAG,
 * `DROPS`), no texture, no extra draw — on each face a pattern fixed to that face, in metres:
 *   BEADS   one in each cell of a grid, where and how big its own; each lands, sits its while, is gone, and another
 *           lands — on the rain's own clock. Two sizes: fine ones seen from the seat, big ones from the chase camera
 *           (each fades out as it shrinks to a pixel: no shimmer).
 *   RUNS    on the glass and the steep panels: down each column of the face a drop slides after a drop — it sticks,
 *           lets go, runs, sticks again — along a path that wanders, a wet thread behind it that thins and breaks
 *           into beads. At speed the wind leans the side windows' runs back and pushes the windscreen's up.
 *   A drop is a small lens: from outside it carries the sky's light on its shoulder and a glint of the sun; from the
 *   seat it shows the world turned over — the sky in its foot, the ground in its head — as water on glass does.
 * THE WIPERS (P): each blade's fan — its pivot, its reach, its sweep, from the model's own wiper — is clear where the
 *   blade has passed; the beads come back first, then the runs, the longer since it passed. The stroke's place is the
 *   same sum the blade is drawn by (Vehicle.update), so the water goes where the rubber goes.
 * HOW WET (every tier — the state; the drops are drawn only where they are on): the car wets in a few seconds of rain,
 *   dries in a minute (sooner at speed); the drops' number follows.
 * THE MUD (every device — `MUD`): the mud painted into a car's texture (carkit.paint_texture: thrown up its flanks) is
 *   found in the shader by its colour and taken back to the clean paint where it has been washed — by the RAIN from
 *   the top down (a line that comes down the flanks in streaks, ~50 s of full rain), by a FORD from the bottom up to
 *   where the water stood (a couple of seconds). Driving through mud brings it back. (The dust coat — Vehicle.weather —
 *   washes as before, sooner.)
 */

/** The drops are drawn (decided once, by the player's car: `dropsFor`). */
let dropsOn = false
/** ULTRA on a PC — not a phone, not a weak GPU; `?drops=1` anywhere, `?drops=0` nowhere. */
export function dropsFor(tier: Tier): boolean {
  const q = gameParams().get('drops'), mobile = gameParams().get('mobile') === '1' || (gameParams().get('mobile') !== '0' && isMobileDevice())
  dropsOn = q === '1' || (q !== '0' && tier.name === 'ultra' && !tier.weakGpu && !mobile)
  return dropsOn
}
export function dropsDrawn(): boolean { return dropsOn }
/** The texture's mud is washed (every device; `?mud=0`: never — the cost's A/B). */
export const MUD_WASH = typeof location === 'undefined' || gameParams().get('mud') !== '0'

/** The wipers' sweep (rad) and its period (s): Vehicle.update draws the blades by these. */
export const WIPE_SWEEP = 1.45, WIPE_PERIOD = 1.1
/** Where the blade is in its sweep (rad) at `t` s of the wipers' clock. */
export const wipeAngle = (t: number): number => (0.5 - 0.5 * Math.cos((t / WIPE_PERIOD) * Math.PI * 2)) * WIPE_SWEEP

/** One car's rain: how wet it is, its drops' clocks, its wipers' fans, how much of its mud is washed — the uniforms
 *  its body's and its glass's shaders read. */
export class CarRain {
  readonly uniforms: Record<string, GFX.IUniform>
  /** How wet the car is (0 dry … 1 wet through). */
  private readonly wetU = { value: 0 }
  /** x: the rain's clock (s — it runs while it rains, slowly after), y: how far the wind leans the side windows' runs
   *  back (m back per m down), z: how far it has pushed the windscreen's up (m). */
  private readonly clock = new GFX.Vector4()
  private readonly wipA = new GFX.Vector4(0, -1e4, 0, 0)
  private readonly wipB = new GFX.Vector4(0, -1e4, 0, 0)
  private readonly wipAxis = new GFX.Vector3(0, 0, 1)
  private readonly restA = new GFX.Vector3(1, 0, 0)
  private readonly restB = new GFX.Vector3(1, 0, 0)
  /** x: where the sweep is in its period (s), y: how long the wipers have stood (s), z: the period, w: the sweep (0: no wipers). */
  private readonly wipe = new GFX.Vector4(0, 1e3, WIPE_PERIOD, 0)
  /** x: the height (m above the car's wheels' ground) above which the rain has washed the mud off, y: … below which
   *  a ford has, z: that ground's height in the world. */
  private readonly mud = new GFX.Vector3(1e3, -1e3, 0)
  /** The mud's band on this car (m above its wheels' ground). */
  private band: [number, number] = [0.2, 1.2]
  private rained = 0
  private forded = -1
  private idle = 1e3

  constructor() {
    this.uniforms = { uCarWet: this.wetU, uDropT: { value: this.clock }, uWipA: { value: this.wipA }, uWipB: { value: this.wipB }, uWipAxis: { value: this.wipAxis },
      uWipRestA: { value: this.restA }, uWipRestB: { value: this.restB }, uWipe: { value: this.wipe }, uMud: { value: this.mud } }
  }

  /** A car taken: its wipers' fans (each blade's pivot, the way it lies at rest, its reach — the model's own wiper,
   *  its geometry about its pivot), its mud's band; dry, as painted. */
  setCar(model: TruckModel): void {
    const W = model.controls.filter((c) => c.kind.startsWith('wiper')).slice(0, 2)
    this.wipA.set(0, -1e4, 0, 0); this.wipB.set(0, -1e4, 0, 0); this.wipe.w = 0
    W.forEach((c, k) => {
      const axis = new GFX.Vector3(...c.axis).normalize(), p = (c.geo.getAttribute('position') as GFX.BufferAttribute).array as Float32Array
      // (the blade's tip: the vertex furthest from the axis — the geometry is about the pivot)
      const v = new GFX.Vector3(), tip = new GFX.Vector3()
      let far = 0
      for (let i = 0; i < p.length; i += 3) {
        v.set(p[i], p[i + 1], p[i + 2]).addScaledVector(axis, -(p[i] * axis.x + p[i + 1] * axis.y + p[i + 2] * axis.z))
        const d = v.lengthSq()
        if (d > far) { far = d; tip.copy(v) }
      }
      const reach = Math.sqrt(far)
      if (reach < 0.1) return
      ;(k ? this.wipB : this.wipA).set(c.pivot[0], c.pivot[1], c.pivot[2], reach)
      ;(k ? this.restB : this.restA).copy(tip).normalize()
      if (!k) this.wipAxis.copy(axis)
      this.wipe.w = WIPE_SWEEP
    })
    if (W.length === 1) this.wipB.set(0, -1e4, 0, 0)
    // (carkit paints it from the sills to half a metre up them)
    this.band = [model.bottom - 0.05, model.bottom + 0.65]
    this.wetU.value = 0
    this.rained = 0; this.forded = -1; this.idle = 1e3
    this.wipe.set(0, 1e3, WIPE_PERIOD, this.wipe.w)
    this.setMud(0)
  }

  /** A frame. `speed`: the car's, forward (m/s); `wipeT`: the wipers' clock (Vehicle's — null: none sweeping, another
   *  player's car); `carY`: its wheels' ground (the world's); `ford`: how deep the water it stands in is at it (m above
   *  that ground; ≤ 0: none); `inMud`: how muddy the ground under it is (0 … 1). */
  update(dt: number, atmos: Atmosphere, speed: number, wipeT: number | null, carY: number, ford = 0, inMud = 0): void {
    const rain = atmos.uniforms.uRain.value as number, sp = Math.abs(speed)
    // HOW WET: wet through in ~5 s of full rain, at once out of a ford; dry in ~50 s, sooner in the wind of its speed
    if (ford > 0.3) this.wetU.value = 1
    else if (rain > 0.04) this.wetU.value = Math.min(1, this.wetU.value + (dt / 5) * rain)
    else this.wetU.value = Math.max(0, this.wetU.value - (dt / 50) * (1 + sp / 8))
    // THE DROPS' CLOCKS: the rain's (slow once it has stopped: what is left sits, merges, dries); the wind's lean on
    // the side windows (eased: a second or two to follow the speed), its push up the windscreen (from ~50 km/h)
    const c = this.clock
    c.x = (c.x + dt * Math.max(rain, 0.12)) % 3600
    c.y += (Math.max(-1.6, Math.min(1.6, speed * 0.09)) - c.y) * Math.min(1, dt * 0.7)
    c.z = (c.z + dt * 0.012 * Math.max(0, sp - 14)) % 64
    // THE WIPERS: where the sweep is in its period; how long they have stood since their last
    if (wipeT !== null) {
      const tau = wipeT % WIPE_PERIOD, moving = wipeT > 0 && tau > 0.02 && tau < WIPE_PERIOD - 0.005
      if (moving) this.idle = 0
      else if (this.idle < 1e3) this.idle = Math.min(1e3, this.idle + dt)
      this.wipe.x = moving ? tau : 0
      this.wipe.y = this.idle
    }
    this.wash(dt, rain, ford, inMud, sp)
    this.mud.z = carY
  }

  /** THE MUD: the rain's line comes down the flanks (all of it in ~50 s of full rain), a ford's goes up to where the
   *  water stands (~1 m/s); in mud, at speed, both go back. */
  wash(dt: number, rain: number, ford: number, inMud: number, speed: number): void {
    const [b0, b1] = this.band
    this.rained = Math.max(0, Math.min(1, this.rained + (dt / 50) * rain - (dt / 30) * inMud * Math.min(1, speed / 6)))
    if (ford > 0.05) this.forded = Math.min(Math.max(this.forded, b0 - 0.2) + dt * (0.6 + speed * 0.15), Math.max(this.forded, Math.min(ford, 1.8)))
    else if (inMud > 0.05) this.forded = Math.max(-1, this.forded - (dt / 30) * inMud * Math.min(1, speed / 6) * (b1 - b0))
    this.setMud(this.rained)
  }
  private setMud(rained: number): void {
    const [b0, b1] = this.band
    // (not a drop of rain yet: as painted, whatever stands above the band)
    this.mud.x = rained <= 0 ? 1e3 : b1 + 0.1 - rained * (b1 - b0 + 0.25)
    this.mud.y = this.forded
  }

  /** There is water on it (the drops' shader is the one to draw it by — Vehicle `RainShell`). */
  get wet(): boolean { return this.wetU.value > 0 }
  /** Some of its mud has been washed off (the mud's shader is). */
  get washed(): boolean { return this.rained > 0 || this.forded > -1 }
  /** (a harness's — scripts/harness/rainshot.mjs) wet through at once. */
  settle(): void { this.wetU.value = 1 }
  /** (the harness) the state, in numbers. */
  state(): Record<string, number | boolean> {
    return { drops: dropsOn, wet: +this.wetU.value.toFixed(2), clock: +this.clock.x.toFixed(1), lean: +this.clock.y.toFixed(2), up: +this.clock.z.toFixed(2), wipeAt: +this.wipe.x.toFixed(2), wipeIdle: +Math.min(999, this.wipe.y).toFixed(1),
      wipers: this.wipe.w > 0 ? (this.wipB.y > -1e3 ? 2 : 1) : 0, reach: +this.wipA.w.toFixed(2), mudRain: +this.rained.toFixed(2), mudLine: +this.mud.x.toFixed(2), mudFord: +this.forded.toFixed(2) }
  }
}

/** THE DROPS' GLSL (the car's fragment shader, under DROPS). Uses the shared `uRain`. */
export const DROPS_GLSL = /* glsl */ `
#ifdef DROPS
uniform float uCarWet;
uniform vec4 uDropT;
uniform vec4 uWipA;
uniform vec4 uWipB;
uniform vec3 uWipAxis;
uniform vec3 uWipRestA;
uniform vec3 uWipRestB;
uniform vec4 uWipe;
float dHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 dHash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
// BEADS (p: metres on the face; s: cells a metre; t: the rain's clock; amount 0 … 1: how many of the cells hold one).
// Its tilt (how its skin leans from the face's, −1 … 1 each way) and how much of the pixel it covers.
vec3 dropBeads(vec2 p, float s, float t, float amount) {
  vec2 g = p * s, id = floor(g), f = g - id;
  float own = dHash(id + 17.7);
  // (each lands, sits its while, is gone — and the next lands elsewhere in the cell: its own count on the rain's clock)
  float age = t * (0.05 + 0.09 * own) + own * 11.0, gen = floor(age), life = age - gen;
  vec2 rn = dHash2(id + gen * 13.1);
  float rad = (0.1 + 0.17 * rn.x * rn.x) * step(rn.y, amount) * smoothstep(0.0, 0.05, life) * (1.0 - smoothstep(0.82, 1.0, life));
  // (its place from the same two numbers, turned over: no third look-up)
  vec2 q = (f - (0.3 + 0.4 * fract(rn.yx * vec2(7.31, 5.17) + own))) / max(rad, 1e-4);
  float m = (1.0 - smoothstep(0.72, 1.0, dot(q, q))) * step(0.01, rad);
  return vec3(q * m, m);
}
// RUNS down a face (p: metres — x across, y up along it; t: the rain's clock): the face cut in columns; down each a drop
// slides after a drop — it sticks, lets go, runs, sticks — along a path that wanders (by the face's own height: the
// thread lies where the drop went), a wet thread behind it that thins and breaks into beads. Its tilt (xy), its cover
// (z), its thread (w).
vec4 dropRuns(vec2 p, float t, float amount) {
  const float W = 0.05;
  float col = floor(p.x / W), xo = p.x - col * W;
  vec2 cc = dHash2(vec2(col, 3.1));
  float c1 = cc.x, c2 = cc.y;
  float L = 0.26 + 0.22 * c1;
  float y = p.y + t * (0.03 + 0.045 * c2) + c1 * 9.0;
  float cell = floor(y / L), f = y / L - cell;
  vec2 rn = dHash2(vec2(col, cell));
  if (rn.x > amount) return vec4(0.0);
  float ph = t * (0.5 + 0.5 * rn.y) + rn.x * 6.2832;
  float head = 0.34 + 0.2 * sin(ph) + 0.05 * sin(ph * 2.7 + c1 * 5.0);   // where the drop is in its stretch (0 its foot … 1 its top)
  float up = (f - head) * L;                                               // metres above the drop
  float mid = W * (0.5 + 0.22 * (c1 - 0.5)), yh = p.y - up;
  // (one wander for the two — the thread's place here, the drop's at its own height: sin a + b sin 2.7a, by the sum)
  vec2 wa = vec2(p.y, yh) * 31.0 + c1 * 40.0;
  vec2 wv = mid + 0.008 * sin(wa + 0.55 * sin(wa * 2.7 + c2 * 17.0));
  float path = wv.x, pathHead = wv.y;
  float rad = 0.0055 + 0.004 * rn.y;
  vec2 q = vec2(xo - pathHead, up * 0.72) / rad;                            // (a little longer than wide: it hangs)
  float m = 1.0 - smoothstep(0.7, 1.0, dot(q, q));
  vec3 o = vec3(q * m, m);
  // the thread above it: thinner the further behind, broken into beads past a hand's width
  float k = clamp(up / max(L * (1.0 - head), 1e-3), 0.0, 1.0);
  float tw = rad * 0.5 * (1.0 - 0.75 * k), dx = xo - path;
  float th = step(0.0, up) * (1.0 - smoothstep(0.45, 0.9, k)) * (1.0 - smoothstep(tw * 0.6, tw, abs(dx)));
  th *= mix(1.0, smoothstep(0.35, 0.75, 0.5 + 0.5 * sin(p.y * 520.0 + rn.x * 30.0)), smoothstep(0.1, 0.45, k));
  // (the thread a thin film, not a drop: half as much of the pixel)
  if (th * 0.5 > o.z) o = vec3(vec2(dx / tw, 0.0) * (th * 0.5), th * 0.5);
  return vec4(o, th);
}
// How long since a wiper's blade passed P (the car's space; s — 1000: never, or not on the windscreen). The blade is
// at a(t) = A (1 − cos 2πt/T) / 2 about its pivot (Vehicle.update): the up-stroke passes the angle φ at t1, the
// down-stroke at T − t1.
float wipedBy(vec3 P, vec4 piv, vec3 rest, float r0) {
  vec3 v = P - piv.xyz;
  float off = dot(v, uWipAxis);
  v -= uWipAxis * off;
  float r = length(v), phi = atan(dot(cross(rest, v), uWipAxis), dot(rest, v));
  if (abs(off) > 0.09 || r < r0 || r > piv.w || phi < 0.0 || phi > uWipe.w) return 1000.0;
  float t1 = acos(clamp(1.0 - 2.0 * phi / uWipe.w, -1.0, 1.0)) * uWipe.z / 6.2832, tau = uWipe.x;
  return (tau >= uWipe.z - t1 ? tau - (uWipe.z - t1) : tau >= t1 ? tau - t1 : tau + t1) + uWipe.y;
}
float wipedAgo(vec3 P) {
  // (no wipers; or they have stood half a minute: every drop is back — not asked)
  if (uWipe.w <= 0.0 || uWipe.y > 30.0) return 1000.0;
  return min(wipedBy(P, uWipA, uWipRestA, uWipA.w * 0.13), wipedBy(P, uWipB, uWipRestB, uWipB.w * 0.13));
}
// THE DROPS at this pixel of a face: its tilt (xy), its cover (z), a run's thread (w); the face's own two ways in the
// world (Tw across, Bw up it) for the tilt. dlx, dly, wx, wy: the pixel's steps in the car's space and the world's
// (taken by the caller, outside any branch); glass: 1 a pane (runs, the wipers), 0 the paint (beads, a few runs).
vec4 dropsOn(vec3 L, vec3 dlx, vec3 dly, vec3 wx, vec3 wy, float glass, out vec3 Tw, out vec3 Bw) {
  Tw = vec3(1.0, 0.0, 0.0); Bw = vec3(0.0, 1.0, 0.0);
  float px = sqrt(length(dlx) * length(dly));
  if (uCarWet < 0.01 || px > 0.024) return vec4(0.0);
  vec3 an = abs(normalize(cross(dlx, dly) + 1e-9));
  // the face's own map, in metres: across it, and up it (a flat top: its length)
  bool side = an.x > max(an.y, an.z), top = an.y > 0.92;
  float steep = max(sqrt(1.0 - an.y * an.y), 0.3);
  vec2 p, dpx, dpy;
  if (top) { p = L.xz; dpx = dlx.xz; dpy = dly.xz; }
  else {
    p = vec2(side ? L.z : L.x, L.y / steep);
    dpx = vec2(side ? dlx.z : dlx.x, dlx.y / steep);
    dpy = vec2(side ? dly.z : dly.x, dly.y / steep);
  }
  float t = uDropT.x, ago = 1000.0;
  // (pr: the runs' own map — the wind leans the side windows' back, pushes the windscreen's up it; the beads sit
  //  where they landed)
  vec2 pr = p;
  if (glass > 0.5 && !top) {
    ago = wipedAgo(L);
    if (side) pr.x += uDropT.y * p.y;
    else if (abs(dot(L - uWipA.xyz, uWipAxis)) < 0.09) pr.y -= uDropT.z;
  }
  float det = dpx.x * dpy.y - dpx.y * dpy.x;
  if (abs(det) < 1e-12) return vec4(0.0);
  Tw = normalize((wx * dpy.y - wy * dpx.y) / det);
  Bw = normalize((wy * dpx.x - wx * dpy.x) / det);
  // how many: by how wet the car is — and, where a blade has passed, by how long since (the beads back in ~5 s of full
  // rain, the runs after)
  float rate = 0.2 + 0.8 * uRain;
  float beadsN = uCarWet * clamp(ago * rate / 5.0, 0.0, 1.0), runsN = uCarWet * clamp((ago * rate - 1.2) / 7.0, 0.0, 1.0);
  // EACH SIZE WHERE IT CAN BE SEEN (px: this pixel's width on the face, m): the fine beads from the seat, the middling
  // ones within a few metres, and from the chase camera's distance BIG ones — and the runs twice as broad — drawn
  // larger than water is, as a painter would, so the rain on the car still reads from there; each fades out as it
  // shrinks toward a pixel (no shimmer), the next in as it does
  vec4 o = vec4(0.0);
  float runN = runsN * (0.5 + 0.35 * glass), tR = t * (0.6 + 0.4 * glass);
  float wR = 1.0 - smoothstep(0.005, 0.009, px), wR2 = smoothstep(0.005, 0.009, px) * (1.0 - smoothstep(0.016, 0.024, px));
  if (!top && wR > 0.0) o = dropRuns(pr, tR, runN) * vec4(1.0, 1.0, wR, wR);
  if (!top && wR2 > 0.0) { vec4 r2 = dropRuns(pr / 2.4 + 5.3, tR * 0.6, runN * 0.8) * vec4(1.0, 1.0, wR2, wR2); if (r2.z > o.z) o = r2; }
  // (a run takes the beads in its way)
  float keep = 1.0 - o.w;
  float wF = (1.0 - smoothstep(0.0012, 0.0025, px)) * keep, wC = (1.0 - smoothstep(0.004, 0.007, px)) * keep;
  float wB = smoothstep(0.004, 0.007, px) * (1.0 - smoothstep(0.014, 0.022, px)) * keep;
  // (fewer on the paint than on a pane: it sheds them)
  if (wB > 0.0) { vec3 b = dropBeads(p + 1.9, 10.0, t * 0.8, beadsN * (0.32 + 0.3 * glass)); b.z *= wB; if (b.z > o.z) o.xyz = b; }
  if (wC > 0.0) { vec3 b = dropBeads(p, 26.0, t, beadsN * (0.4 + 0.3 * glass)); b.z *= wC; if (b.z > o.z) o.xyz = b; }
  if (wF > 0.0) { vec3 b = dropBeads(p + 3.7, 85.0, t * 1.3, beadsN * (0.35 + 0.2 * glass)); b.z *= wF; if (b.z > o.z) o.xyz = b; }
  // (the blade's own wet: fine arcs it leaves, gone in half a second)
  if (ago < 0.6) o.w = max(o.w, (1.0 - ago / 0.6) * 0.5 * (0.5 + 0.5 * sin(length(L - uWipA.xyz) * 700.0)));
  return o;
}
#endif
`
