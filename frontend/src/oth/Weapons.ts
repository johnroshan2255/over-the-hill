import * as GFX from './gfx'
import DATA from '../../../proto/weapons.json'
import META from '../assets/models/weapons/weapons.meta.json'
import pistolUrl from '../assets/models/weapons/pistol.glb?url'
import ak47Url from '../assets/models/weapons/ak47.glb?url'
import sniperUrl from '../assets/models/weapons/sniper.glb?url'
import type { Atmosphere } from './Atmosphere'
import type { Character } from './Character'
import type { MapData } from './MapData'
import type { OthPhysics } from './Physics'
import type { TerrainShadow } from './TerrainShadow'
import { VEHICLE_FRAG_SRC } from './Vehicle'

/**
 * THE WEAPONS (2026-11-19 — docs/WEAPONS.md; each one's numbers from its spec, docs/weapons/*.md → proto/weapons.json):
 * the 9 mm PISTOL, the AK-47 and the bolt-action SNIPER rifle with its two-step scope. One in the hands at a time. The
 * models are made in Blender (scripts/oth/weapons.py). (A KATANA with a fire and a thunder blade was here till
 * 2026-11-21 — taken out whole at the user's word: "remove all katana thing from the game".)
 *
 *   THE TICK   every time is a whole number of the server's 20 Hz ticks (50 ms): a shot may leave only `fireTicks`
 *              after the last (the AK-47's 2 = its real 600 a minute).
 *   A GUN      (the user, 2026-11-21: "in first person it must be like CS:GO, in third person like GTA 5")
 *              THIRD PERSON, GTA's: CARRIED low — a pistol in the hand at his side, a rifle across him in both, its
 *              muzzle down — while he walks, runs and sprints as he does unarmed, facing where he goes; AIMED (the
 *              other button held — U, the right mouse button, AIM — or the trigger pulled, and a second after): the
 *              rifle's butt into his shoulder, the pistol out in both hands, he faces what the camera is on and the
 *              keys strafe, the camera in over his right shoulder, a dot in the middle of the screen.
 *              FIRST PERSON, CS:GO's: always up — fixed to the view at its lower right, its barrel along the view, a
 *              cross in the middle that opens with the spread.
 *              His wrists are bent onto it wherever it is (Character.handIK). A shot: the bullet leaves the muzzle
 *              for what the middle of the screen is on, lifted for the sight's zero, inside the cone of its spread;
 *              it FLIES — its speed falling as v₀·e^(−k·x), dropping under gravity — a ray a frame against the land,
 *              the solid things and whoever can be hit; what it takes falls with the energy it keeps.
 *   THE SCOPE  (the sniper) U / the right button: off → 40° → 10° → off; the wheel steps it; first person through the
 *              glass (main.ts takes `scopeFov`), out of it while the bolt is worked.
 */
export type WeaponId = 'pistol' | 'ak47' | 'sniper'
export type Zone = 'head' | 'body' | 'limb'
/** Who can be hit: their feet, whether they still stand, what a hit does to them. */
export interface Target {
  id: string
  pos: GFX.Vector3
  alive(): boolean
  hit(damage: number, zone: Zone, weapon: string, dir: GFX.Vector3): void
}
export interface ArsenalHost {
  onFoot(): boolean
  playing(): boolean
  targets(): Target[]
  /** The view kicked by a shot (rad: up, to the side) — and brought back, the same way, as the kick settles. */
  kick(up: number, side: number): void
  /** FIRST PERSON (on foot): the weapon is fixed to the view, at its lower right — where the view looks now (rad: the
   *  heading, the pitch up) and the eye's place from his feet (the world's axes). */
  fpp(): boolean
  lookYaw(): number
  lookPitch(): number
  eye(): GFX.Vector3
  toast(m: string): void
  /** Nothing in the hands: FIRE / the other button are your fists (the enemy's game: a punch, a kick). */
  fists?(what: 'fire' | 'alt'): void
  /** The phone's buttons shown with nothing in the hands (there's someone to fight). */
  fistsOn?(): boolean
  /** Where a bullet stopped (the dust it knocks up; `who`: it hit someone). */
  impact?(x: number, y: number, z: number, who: boolean): void
  /** A bullet has stopped on a solid BODY (its handle) at (x, y, z), flying along (dx, dy, dz): a car's takes it. */
  struck?(body: number, x: number, y: number, z: number, dx: number, dy: number, dz: number): void
  /** (co-op) a shot left — told to the others (and counted by the server: a hit must spend one). */
  shot?(weapon: WeaponId, from: GFX.Vector3, dir: GFX.Vector3): void
  /** (co-op) what's in the hands now (null: fists) — told to the others. */
  armed?(id: WeaponId | null): void
}

interface GunSpec {
  id: WeaponId; name: string; kind: 'gun'; hold: 'pistol' | 'rifle'; muzzleVelocity: number; drag: number; range: number; zero: number
  auto: boolean; fireTicks: number; reloadTicks: number; drawTicks: number; magazine: number; reserve: number
  damage: number; head: number; limb: number; floor: number; tracerEvery: number; pace?: number
  spread: { still: number; walk: number; run: number; perShot: number; perShotMax?: number; settleTicks: number; scopedStill?: number; scopedWalk?: number }
  recoil: { up: number; side: number; returnTicks: number; grow?: number; growShots?: number }
  scope?: { fov: number[]; settleTicks: number; pace: number }
}
const SPECS = DATA.weapons as unknown as Record<WeaponId, GunSpec>
export const TICK = 1 / DATA.tickHz
export const WEAPON_ORDER = DATA.order as WeaponId[]
export const weaponName = (id: WeaponId): string => SPECS[id].name
const PTS = META as Record<string, Record<string, number[]>>
const URLS: Record<string, string> = { pistol: pistolUrl, ak47: ak47Url, sniper: sniperUrl }
const G = 9.81
const tickNow = (): number => Math.floor(performance.now() / (1000 * TICK))

const VERT = /* glsl */ `
out vec3 vWorld;
out vec3 vLocal;
out vec3 vN;
out vec2 vUv;
out vec3 vCol;
out float vPaint;
void main() {
  // (instanced — the cars' tow eyes, Winch.ts: one draw for all of them)
#ifdef USE_INSTANCING
  mat4 mm = modelMatrix * instanceMatrix;
#else
  mat4 mm = modelMatrix;
#endif
  vec4 w = mm * vec4(position, 1.0);
  vWorld = w.xyz;
  vLocal = position;
  vN = normalize(mat3(mm) * normal);
  vUv = uv;
#ifdef USE_COLOR
  vCol = color;
#else
  vCol = vec3(1.0);
#endif
  vPaint = 0.0;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
/** An unlit glow (a tracer, the muzzle's flash, a pick-up's light): additive. */
function glowMat(hex: string, k = 1): GFX.ShaderMaterial {
  return new GFX.ShaderMaterial({
    glslVersion: GFX.GLSL3,
    uniforms: { uColor: { value: new GFX.Color(1, 1, 1).set(hex) }, uK: { value: k } },
    vertexShader: /* glsl */ `void main() { gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `layout(location = 0) out highp vec4 outColor; uniform vec3 uColor; uniform float uK; void main() { outColor = vec4(uColor * uK, 1.0); }`,
    transparent: true, depthWrite: false, blending: GFX.AdditiveBlending, side: GFX.DoubleSide,
  })
}

/** A unit box (the gfx layer has none): the tracers, the flashes. */
function boxGeometry(): GFX.BufferGeometry {
  const pos: number[] = [], idx: number[] = []
  for (let i = 0; i < 8; i++) pos.push(i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5)
  for (const f of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) idx.push(f[0], f[1], f[2], f[0], f[2], f[3])
  const g = new GFX.BufferGeometry()
  g.setAttribute('position', new GFX.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}

/** A weapon's model: its mesh (lit as the cars are, coloured by vertex). */
export interface Model { mesh: GFX.Mesh }
const modelFiles = new Map<string, Promise<{ parts: { name: string; geo: GFX.BufferGeometry }[] }>>()
function loadParts(key: string): Promise<{ parts: { name: string; geo: GFX.BufferGeometry }[] }> {
  let p = modelFiles.get(key)
  if (!p) {
    p = (async () => {
      const buf = await fetch(URLS[key]).then((r) => r.arrayBuffer()).then(GFX.unpacked)
      const gltf = await new GFX.GLTFLoader().parse(buf, URLS[key])
      const parts: { name: string; geo: GFX.BufferGeometry }[] = []
      gltf.scene.updateMatrixWorld(true)
      gltf.scene.traverse((o: GFX.Object3D) => {
        const m = o as GFX.Mesh
        if (!m.isMesh) return
        const g = m.geometry, P = g.attributes.position, N = g.attributes.normal, C = g.attributes.color
        const pos: number[] = [], nor: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = []
        for (let i = 0; i < P.count; i++) {
          pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); uv.push(0, 0)
          if (C) col.push(C.getX(i), C.getY(i), C.getZ(i)); else col.push(1, 1, 1)
        }
        if (g.index) for (const k of g.index.array) idx.push(k); else for (let i = 0; i < P.count; i++) idx.push(i)
        const geo = new GFX.BufferGeometry()
        geo.setAttribute('position', new GFX.Float32BufferAttribute(pos, 3))
        geo.setAttribute('normal', new GFX.Float32BufferAttribute(nor, 3))
        geo.setAttribute('uv', new GFX.Float32BufferAttribute(uv, 2))
        geo.setAttribute('color', new GFX.Float32BufferAttribute(col, 3))
        geo.setIndex(idx)
        geo.computeBoundingSphere()
        parts.push({ name: 'weapon', geo })
      })
      return { parts }
    })()
    modelFiles.set(key, p)
  }
  return p
}

/** The lit material every weapon is drawn with (one for all of a scene's). */
export function weaponMaterial(atmos: Atmosphere, shadow: TerrainShadow, farGrid: GFX.Vector4): GFX.ShaderMaterial {
  const uniforms = { ...atmos.uniforms, ...shadow.uniforms, uFarGrid: { value: farGrid }, uMap: { value: null }, uPaintMask: { value: null }, uPaint: { value: new GFX.Color(1, 1, 1) }, uSunHere: { value: 1 },
    uCoat: { value: 0 }, uCoatColor: { value: new GFX.Color(0.55, 0.45, 0.33) }, uCarBase: { value: 0 } }
  return new GFX.ShaderMaterial({ glslVersion: GFX.GLSL3, uniforms, defines: { OTH_SPEC: '', MIST_K: '0.45', NO_GRAIN: '' }, vertexShader: VERT, fragmentShader: VEHICLE_FRAG_SRC(), vertexColors: true })
}
export async function weaponModel(key: string, mat: GFX.ShaderMaterial): Promise<Model> {
  const { parts } = await loadParts(key)
  const m = new GFX.Mesh(parts[0].geo, mat)
  m.frustumCulled = false
  m.matrixAutoUpdate = false
  m.visible = false
  return { mesh: m }
}

/**
 * HOW EACH GUN IS HELD (the user, 2026-11-21: "it must be exactly the same as in CS:GO"). The weapon's own space: its
 * grip at the origin, the muzzle toward −z, up +y, his right +x.
 *   THIRD PERSON  a rifle's BUTT in the pocket of his right shoulder — wherever the stride and the aim have put that
 *                 shoulder — the barrel along the aim, his chest turned a quarter to the right (the left shoulder
 *                 forward), the left hand under the fore-end; a pistol out before his face in both hands, turning
 *                 about his shoulders as he aims up and down.
 *   FIRST PERSON  fixed to the VIEW at its lower right, the barrel along the view — so it points at the cross from
 *                 below — as CS:GO's view model: `vm` is the grip from the eye (m: right, up, −forward).
 * Each hand: where its palm's middle lies on the weapon, the way its fingers run and its palm faces.
 * The view in first person with a weapon is FPP_ARMED_FOV wide — CS:GO's world is 74° tall on a 16:9 screen; the game's
 * own 55° brought the weapon a third closer and bigger than its view model.
 */
export const FPP_ARMED_FOV = 68
interface Hold {
  butt: number[]; vm: number[]
  /** the right palm on the grip, the left on the fore-end (a pistol: round the right hand) */
  right: { palm: number[]; F: number[]; P: number[] }
  left: { palm: number[]; F: number[]; P: number[] }
}
const HOLDS: Record<string, Hold> = {
  pistol: { butt: [0, 0, 0], vm: [0.10, -0.165, -0.40],
    right: { palm: [0.0135, -0.030, 0.050], F: [0, -0.22, -0.975], P: [-1, 0, 0] },
    left: { palm: [-0.020, -0.046, 0.036], F: [0.26, -0.46, -0.85], P: [1, 0.1, 0.25] } },
  ak47: { butt: [0, -0.023, 0.372], vm: [0.14, -0.15, -0.36],
    right: { palm: [0.014, -0.036, 0.028], F: [0, -0.30, -0.954], P: [-1, 0, 0] },
    left: { palm: [0, 0.012, -0.185], F: [0.80, 0.16, -0.58], P: [0.22, 0.96, 0.1] } },
  sniper: { butt: [0, -0.007, 0.432], vm: [0.155, -0.19, -0.31],
    right: { palm: [0.017, -0.032, 0.030], F: [0, -0.30, -0.954], P: [-1, 0, 0] },
    left: { palm: [0, 0.024, -0.165], F: [0.80, 0.16, -0.58], P: [0.22, 0.96, 0.1] } },
}
/** A hand's turn from its bind pose (the T-pose: its fingers out along ±x, the palm down, the thumb forward) that lays
 *  the fingers along F with the palm facing P — and where its wrist is then, for the palm's middle at `palm`: 8.5 cm
 *  back along the fingers, 2.5 cm off the palm (Character.grip). */
function handOn(right: boolean, o: { palm: number[]; F: number[]; P: number[] }): { q: GFX.Quaternion; wrist: GFX.Vector3 } {
  const f = new GFX.Vector3(o.F[0], o.F[1], o.F[2]).normalize(), pn = new GFX.Vector3(o.P[0], o.P[1], o.P[2])
  pn.addScaledVector(f, -pn.dot(f)).normalize()
  const t = right ? new GFX.Vector3().crossVectors(f, pn) : new GFX.Vector3().crossVectors(pn, f)
  const m = new GFX.Matrix4().makeBasis(right ? f.clone() : f.clone().negate(), pn.clone().negate(), t.clone().negate())
  return { q: new GFX.Quaternion().setFromRotationMatrix(m), wrist: new GFX.Vector3(o.palm[0], o.palm[1], o.palm[2]).addScaledVector(f, -0.085).addScaledVector(pn, -0.025) }
}
const HANDS: Record<string, { r: ReturnType<typeof handOn>; l: ReturnType<typeof handOn> }> = Object.fromEntries(Object.entries(HOLDS).map(([k, h]) => [k, { r: handOn(true, h.right), l: handOn(false, h.left) }]))
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a))
const smooth = (a: number, b: number, x: number): number => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k) }

const _va = new GFX.Vector3(), _vb = new GFX.Vector3(), _vc = new GFX.Vector3(), _vd = new GFX.Vector3()
const _qa = new GFX.Quaternion(), _qb = new GFX.Quaternion(), _e3 = new GFX.Euler(), _one = new GFX.Vector3(1, 1, 1)
const _gp = new GFX.Vector3(), _gq = new GFX.Quaternion()
/** THIRD PERSON'S HOLD (GTA's) — the gun's place and turn in HIS space (`gp`, `gq`): AIMED (`k` → 1) at the view's
 *  heading `aimY` and pitch `aimP` — a rifle's butt in his right shoulder's pocket, a pistol out before his face in both
 *  hands —, CARRIED (`k` → 0) — a pistol where the stride's own right hand has it, a rifle across him in both, its
 *  muzzle down to the front and left —; lowered by `low` (drawn, reloaded), kicked back by `rc`, a rifle rolled as it's
 *  reloaded (`rl` 0 … 1; −1 not). Yours (Arsenal) and each co-op player's (Remotes, `holdOther`). Inside `handIK`. */
function holdThird(h: Character, g: GunSpec, aimY: number, aimP: number, k: number, low: number, rc: number, rl: number, gp: GFX.Vector3, gq: GFX.Quaternion): void {
  const H = HOLDS[g.id], K = HANDS[g.id], rifle = g.hold === 'rifle'
  const yaw = wrap(aimY - h.heading), pitch = Math.max(-1.2, Math.min(1.2, aimP))
  if (rifle) {
    // a rifle: its butt in his right shoulder's pocket — a hand in from the joint, before it
    gq.setFromEuler(_e3.set(pitch - low * 0.85 + rc * 0.03, yaw, rl >= 0 ? -0.35 * Math.sin(Math.PI * rl) : 0, 'YXZ'))
    h.jointAt('RightArm', _va)
    _va.x -= 0.05; _va.z -= 0.07
    gp.set(-H.butt[0], -H.butt[1], -H.butt[2] + rc * 0.03).applyQuaternion(gq).add(_va)
  } else {
    // a pistol: out before his face in both hands, turning about the middle of his shoulders
    gq.setFromEuler(_e3.set(pitch - low * 0.9 + rc * 0.12, yaw, 0, 'YXZ'))
    h.jointAt('LeftArm', _va); h.jointAt('RightArm', _vb)
    _va.add(_vb).multiplyScalar(0.5)
    gp.set(0.03, 0.085, -0.56 + low * 0.2 + rc * 0.03).applyQuaternion(gq).add(_va)
  }
  if (k >= 0.999) return
  if (rifle) {
    h.jointAt('RightArm', _vd)
    _vd.x -= 0.06; _vd.y -= 0.29; _vd.z -= 0.27
    _qa.setFromEuler(_e3.set(-0.44, 0.52, 0.2, 'YXZ'))
  } else {
    h.handTurn(1, _qa).multiply(_qb.copy(K.r.q).invert())
    h.jointAt('RightHand', _vd)
    _vd.sub(_vc.copy(K.r.wrist).applyQuaternion(_qa))
  }
  const e = k * k * (3 - 2 * k)
  gp.lerpVectors(_vd, gp, e)
  gq.copy(_qb.copy(_qa).slerp(gq, e))
}
/** HIS HANDS ON IT (the gun at `gp` / `gq` in his space; `up` 0 carried … 1 aimed): the right on the grip; the left
 *  under the fore-end / round the right — reloading (`rl` 0 … 1), down to the belt for the magazine and back. (A pistol
 *  carried is simply in the stride's own hand: no arm is bent to it; his left hand comes to it as it's raised.) */
function handsOn(h: Character, g: GunSpec, fp: boolean, up: number, rl: number, gp: GFX.Vector3, gq: GFX.Quaternion): void {
  const G = h.grip, K = HANDS[g.id], rifle = g.hold === 'rifle', both = rifle ? 1 : smooth(0.25, 0.9, up)
  if (rifle || up > 0.01) {
    _vc.copy(K.r.wrist).applyQuaternion(gq).add(gp)
    G.r[0] = _vc.x; G.r[1] = _vc.y; G.r[2] = _vc.z
    _qb.copy(gq).multiply(K.r.q)
    G.rq[0] = _qb.x; G.rq[1] = _qb.y; G.rq[2] = _qb.z; G.rq[3] = _qb.w
    // (the elbow: down and out aimed; back and out, the rifle carried)
    const c = rifle && !fp ? 1 - up : 0
    G.rp[0] = fp ? 0.8 : 0.6; G.rp[1] = (fp ? -0.55 : -0.75) + c * 0.45; G.rp[2] = 0.3 + c * 0.5
    G.rOn = G.rqOn = true
  }
  if (both < 0.01) return
  _vc.copy(K.l.wrist).applyQuaternion(gq).add(gp)
  let free = 1 - both
  if (rl >= 0) {
    const kk = rl < 0.3 ? rl / 0.3 : rl < 0.5 ? 1 : rl < 0.8 ? 1 - (rl - 0.5) / 0.3 : 0
    free = Math.max(free, kk * kk * (3 - 2 * kk))
    _vc.lerp(_vd.set(-0.2, 0.98, -0.12), kk * kk * (3 - 2 * kk))
  } else if (free > 0) { h.jointAt('LeftHand', _vd); _vc.lerp(_vd, free) }
  G.l[0] = _vc.x; G.l[1] = _vc.y; G.l[2] = _vc.z
  G.lp[0] = rifle ? -0.45 : -0.7; G.lp[1] = rifle ? -0.85 : -0.65; G.lp[2] = 0.15
  G.lOn = true
  if (free < 0.3) {
    _qb.copy(gq).multiply(K.l.q)
    G.lq[0] = _qb.x; G.lq[1] = _qb.y; G.lq[2] = _qb.z; G.lq[3] = _qb.w
    G.lqOn = true
  }
}
/** A CO-OP PLAYER'S GUN (Remotes.ts — call it as their walker is posed: inside his `handIK`): third person's hold, at
 *  the heading they face and `pitch`, aimed by `k` (0 carried … 1 up), kicked by `recoil`; `gunL` is where it is in
 *  his space (the world's: his root's matrix × it). Also the turn of his body for it (his chest, the spine's tip). */
export function holdOther(h: Character, id: WeaponId, pitch: number, k: number, recoil: number, gunL: GFX.Matrix4): void {
  const g = SPECS[id]
  holdThird(h, g, h.heading, pitch, k, 0, recoil, -1, _gp, _gq)
  gunL.compose(_gp, _gq, _one)
  handsOn(h, g, false, k, -1, _gp, _gq)
}
/** How a co-op player stands with a gun: the hands' pose, the chest turned for a rifle, the aim's pitch in the spine. */
export function standOther(h: Character, id: WeaponId | null, pitch: number, k: number): void {
  const g = id ? SPECS[id] : null
  h.holdPose = g ? 'grip' : null
  h.torsoYaw = g?.hold === 'rifle' ? -0.42 * k : 0
  h.aimPitch = g ? Math.max(-1.1, Math.min(1.1, pitch)) * 0.6 * k : 0
}
export const isGun = (id: string): id is WeaponId => !!SPECS[id as WeaponId]

/** A bullet in the air: where, how fast, how far gone; `off`: the muzzle from the sight line it flies along (its trace
 *  is drawn that much aside at first); `ghost`: a co-op player's — drawn, stopped by what's solid, hitting nobody (their
 *  game says what it hit). */
interface Bullet { p: GFX.Vector3; v: GFX.Vector3; gone: number; spec: GunSpec; tracer: number; off: GFX.Vector3; ghost?: boolean }
interface Saved { owned: WeaponId[]; ammo: Record<string, [number, number]> }
const KEY = 'overhill.weapons.v1'

export class Arsenal {
  /** What's been found; the rounds (in the gun, carried). */
  readonly owned = new Set<WeaponId>()
  readonly ammo: Record<string, [number, number]> = {}
  /** In the hands now (null: his fists). */
  current: WeaponId | null = null
  /** The sniper's scope: 0 off, 1, 2 — and the lens main.ts must use (null: its own). */
  scope = 0
  get scopeFov(): number | null { const s = this.gun?.scope; return s && this.scoped ? s.fov[this.scope - 1] : null }
  /** The lens the world's detail must be drawn for (LodEye.ts): the scope's magnification over the game's own view —
   *  kept while the bolt is worked (the eye out of the glass for a moment: the land it was on is still what's wanted);
   *  1: no lens. */
  get lens(): number {
    const s = this.gun?.scope
    return s && this.scope > 0 && this.host.onFoot() ? Math.tan((55 * Math.PI) / 360) / Math.tan((s.fov[this.scope - 1] * Math.PI) / 360) : 1
  }
  /** In the glass now (not while the bolt is worked). */
  get scoped(): boolean { return this.current === 'sniper' && this.scope > 0 && tickNow() >= this.boltUntil && tickNow() >= this.busyUntil }
  /** (the harness) shots fired, hits landed; where the last bullet stopped. */
  readonly stats = { shots: 0, hits: 0 }
  readonly lastImpact = new GFX.Vector3(NaN, 0, 0)
  /** AIMING (third person, GTA's): the other button held; `aiming`: the gun is up — held, or fired a moment ago, or
   *  first person (always); `aimK`: how far up it is (0 carried … 1 aimed), eased. */
  aimHeld = false
  aiming = false
  aimK = 0
  private readonly group = new GFX.Group()
  private readonly mat: GFX.ShaderMaterial
  private readonly models = new Map<string, Model>()
  private readonly bullets: Bullet[] = []
  private readonly tracers: GFX.Mesh[] = []
  private readonly flash: GFX.Mesh
  private readonly fx: { mesh: GFX.Mesh; until: number }[] = []
  private trigger = false
  private nextFire = 0
  private busyUntil = 0
  private reloadFrom = 0
  private reloading = false
  private boltUntil = 0
  private lastShot = -99
  private burst = 0
  private recoil = 0
  /** The gun's place: in the world (`gunM`), and — set as he is posed (hold) — in HIS space or, in first person, in the
   *  VIEW's (`gunL`, `gunInView`); `held`: posed with it this frame. */
  private readonly gunM = new GFX.Matrix4()
  private readonly gunL = new GFX.Matrix4()
  private gunInView = false
  private held = false
  private readonly gp = new GFX.Vector3()
  private readonly gq = new GFX.Quaternion()
  private readonly qa = new GFX.Quaternion()
  private readonly e3 = new GFX.Euler()
  private readonly one = new GFX.Vector3(1, 1, 1)
  private readonly va = new GFX.Vector3()
  /** The view's kick: what's still to be given (a shot's is spread over a few frames — given at once the view jumped,
   *  ten times a second with the AK-47: a stutter), and what's been given and must come back (rad: up, aside). */
  private kickUp = 0
  private kickSide = 0
  private punchUp = 0
  private punchSide = 0
  private readonly v = new GFX.Vector3()
  private readonly v2 = new GFX.Vector3()
  private readonly q = new GFX.Quaternion()
  private readonly s3 = new GFX.Vector3()
  private readonly off3 = new GFX.Vector3()
  private readonly fwd = new GFX.Vector3(0, 0, 1)
  private readonly fa = new GFX.Vector3()
  private readonly fb = new GFX.Vector3()
  private readonly fc = new GFX.Vector3()
  private readonly fd = new GFX.Vector3()
  private readonly fe = new GFX.Vector3()
  private readonly hud: HTMLDivElement
  private readonly hudName: HTMLDivElement
  private readonly hudBig: HTMLSpanElement
  private readonly hudRest: HTMLSpanElement
  private readonly cross: HTMLDivElement
  private readonly bars: HTMLDivElement[]
  private readonly dot: HTMLDivElement
  private readonly glass: HTMLDivElement
  private phone = false
  private prime = 3
  private ray: any = null
  private readonly off: (() => void)[] = []

  constructor(
    private readonly host: ArsenalHost,
    private readonly hero: Character,
    private readonly camera: GFX.PerspectiveCamera,
    scene: GFX.Scene,
    _map: MapData,
    private readonly physics: OthPhysics,
    atmos: Atmosphere,
    shadow: TerrainShadow,
    farGrid: GFX.Vector4,
    private readonly save = true,
  ) {
    this.mat = weaponMaterial(atmos, shadow, farGrid)
    scene.add(this.group)
    const box = boxGeometry()
    for (let i = 0; i < 10; i++) { const t = new GFX.Mesh(box, glowMat('#ffd9a0', 1.6)); t.frustumCulled = false; t.matrixAutoUpdate = false; t.visible = false; t.renderOrder = 4; this.group.add(t); this.tracers.push(t) }
    this.flash = new GFX.Mesh(box, glowMat('#ffc070', 3)); this.flash.frustumCulled = false; this.flash.matrixAutoUpdate = false; this.flash.visible = false; this.flash.renderOrder = 4
    this.group.add(this.flash)
    // THE HUD: what's in the middle of the screen — FIRST PERSON, CS:GO's cross: four green bars round a gap that
    // opens with the spread (none with the sniper rifle out of its scope: CS:GO's has none); THIRD PERSON, GTA's dot,
    // while the gun is aimed — the rounds bottom right; the scope's glass.
    // (plain boxes: the first cross was drawn with `mix-blend-mode: difference` — over a canvas that makes the browser
    //  composite the whole page through another full-screen surface, every frame the gun is out: on a phone, frames)
    const el = (css: string, parent?: HTMLElement): HTMLDivElement => { const d = document.createElement('div'); d.style.cssText = css; parent?.appendChild(d); return d }
    this.cross = el('position:fixed;left:50%;top:50%;width:0;height:0;pointer-events:none;z-index:4;display:none')
    const bar = 'position:absolute;background:#4dff4d;box-shadow:0 0 0 1px rgba(0,0,0,.6)'
    this.bars = [el(`${bar};width:9px;height:2px;top:-1px`, this.cross), el(`${bar};width:9px;height:2px;top:-1px`, this.cross), el(`${bar};width:2px;height:9px;left:-1px`, this.cross), el(`${bar};width:2px;height:9px;left:-1px`, this.cross)]
    this.dot = el('position:absolute;left:-2px;top:-2px;width:4px;height:4px;border-radius:50%;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.6)', this.cross)
    this.hud = el("position:fixed;right:24px;bottom:150px;padding:8px 12px;background:rgba(8,8,8,.72);border-left:3px solid #e0a040;color:#fff;font:700 15px/1.25 'Barlow Condensed','Arial Narrow',sans-serif;letter-spacing:.06em;text-transform:uppercase;text-align:right;pointer-events:none;z-index:4;display:none")
    // (a phone: the right of the screen is the thumb's buttons — the read-out one line, bottom middle)
    this.phone = document.body.classList.contains('touch') || matchMedia('(pointer: coarse)').matches
    if (this.phone) this.hud.style.cssText += ';right:auto;left:50%;bottom:8px;transform:translateX(-50%);padding:4px 12px;border-left:0;border-bottom:2px solid #e0a040;text-align:center;display:none;white-space:nowrap;font-size:13px'
    this.hudName = el(this.phone ? 'display:inline;margin-right:10px' : '', this.hud)
    const line = el(this.phone ? 'display:inline' : '', this.hud)
    this.hudBig = document.createElement('span'); this.hudBig.style.fontSize = this.phone ? '18px' : '26px'
    this.hudRest = document.createElement('span')
    line.append(this.hudBig, this.hudRest)
    // THE SCOPE'S GLASS: the lens — a square, its ring's soft edge and the fine cross — and four black bars round it
    // (opaque: only the lens's square is blended over the game, not the whole screen)
    this.glass = el('position:fixed;inset:0;pointer-events:none;z-index:3;display:none')
    const R = '46vmin', blk = 'position:absolute;background:#000'
    el(`${blk};left:0;top:0;bottom:0;width:calc(50% - ${R})`, this.glass); el(`${blk};right:0;top:0;bottom:0;width:calc(50% - ${R})`, this.glass)
    el(`${blk};left:calc(50% - ${R});width:calc(2 * ${R});top:0;height:calc(50% - ${R})`, this.glass); el(`${blk};left:calc(50% - ${R});width:calc(2 * ${R});bottom:0;height:calc(50% - ${R})`, this.glass)
    el(`position:absolute;left:calc(50% - ${R});top:calc(50% - ${R});width:calc(2 * ${R});height:calc(2 * ${R});background:linear-gradient(#000,#000) 50% 50%/1px 100% no-repeat,linear-gradient(#000,#000) 50% 50%/100% 1px no-repeat,linear-gradient(#000,#000) 50% calc(50% + 6vmin)/14px 1px no-repeat,linear-gradient(#000,#000) 50% calc(50% + 14vmin)/22px 1px no-repeat,linear-gradient(#000,#000) 50% calc(50% + 26vmin)/30px 1px no-repeat,radial-gradient(circle closest-side,transparent 0,transparent 91%,rgba(0,0,0,.55) 94%,#000 99%)`, this.glass)
    document.body.append(this.cross, this.hud, this.glass)
    // (the glow's pipelines made now, under the loading screen — a first shot's flash and tracer drawn for three frames,
    //  no bigger than a point: made at the first shot they were that shot's stall)
    this.flash.matrix.compose(this.v.set(0, -1e4, 0), this.q.set(0, 0, 0, 1), this.s3.set(0, 0, 0)); this.flash.matrixWorld.copy(this.flash.matrix)
    this.tracers[0].matrix.copy(this.flash.matrix); this.tracers[0].matrixWorld.copy(this.flash.matrix)
    this.flash.visible = this.tracers[0].visible = true
    const on = <K extends keyof WindowEventMap>(t: K, f: (e: WindowEventMap[K]) => void, o?: AddEventListenerOptions) => { window.addEventListener(t, f, o); this.off.push(() => window.removeEventListener(t, f, o)) }
    on('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !this.active) return
      if (e.code === 'KeyJ') this.press('fire', true)
      else if (e.code === 'KeyU') this.press('alt', true)
      else if (e.code === 'KeyR') this.press('reload', true)
    })
    on('keyup', (e) => { if (e.code === 'KeyJ') this.press('fire', false); else if (e.code === 'KeyU') this.press('alt', false) })
    on('mousedown', (e) => { if (!this.active || !document.pointerLockElement) return; if (e.button === 0) this.press('fire', true); else if (e.button === 2) this.press('alt', true) })
    on('mouseup', (e) => { if (e.button === 0) this.press('fire', false); else if (e.button === 2) this.press('alt', false) })
    on('wheel', (e) => { if (this.active && this.current === 'sniper') this.setScope(this.scope + (e.deltaY < 0 ? 1 : -1), true) }, { passive: true })
    on('blur', () => { this.trigger = false; this.aimHeld = false })
    if (save) this.load()
    // THE PHONE'S BUTTONS (right thumb, on foot): FIRE (held: the AK-47 goes on), AIM / the scope / a kick, RELOAD —
    // the page's own pads (index.html `.oth-wpad`: round the right thumb, placed for a phone sideways, a short one, and
    // upright; `phonepads.mjs` checks none leaves the screen or lies on another. The third stood 318 px up from the
    // bottom at first: off the top of a phone held sideways)
    if (document.body.classList.contains('touch') || matchMedia('(pointer: coarse)').matches) {
      const mk = (what: string, down: () => void, up?: () => void) => {
        const b = document.createElement('button')
        b.className = 'oth-wpad'
        b.dataset.wp = what
        b.dataset.weaponPad = '1'
        b.style.display = 'none'
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); down() })
        if (up) for (const t of ['pointerup', 'pointercancel', 'pointerleave'] as const) b.addEventListener(t, (e) => { e.preventDefault(); up() })
        this.pads.push(b)
        return b
      }
      mk('fire', () => (this.current ? this.press('fire', true) : this.host.fists?.('fire')), () => this.press('fire', false))
      // (a thumb can't hold AIM and turn the view: with a pistol or the AK-47 it stays on till pressed again)
      mk('alt', () => (!this.current ? this.host.fists?.('alt') : this.current === 'sniper' ? this.press('alt', true) : this.press('alt', !this.aimHeld)))
      mk('third', () => this.press('reload', true))
    }
  }
  private readonly pads: HTMLButtonElement[] = []
  private padKey = ''
  /** The phone's buttons: shown on foot with a weapon (or fists and someone to fight), named for what's in the hands. */
  private drawPads(): void {
    if (!this.pads.length) return
    // (with the page's other pads, once they are there: their look, hidden with them under the wheel and the map)
    if (!this.padsIn) {
      const host = document.querySelector('.oth-touch')
      if (!host) return
      for (const b of this.pads) host.appendChild(b)
      this.padsIn = true
    }
    const on = this.host.onFoot() && this.host.playing() && (!!this.current || !!this.host.fistsOn?.())
    const key = `${on}${this.current}${this.aimHeld}`
    if (key === this.padKey) return
    this.padKey = key
    const [fire, alt, third] = this.pads
    fire.style.display = alt.style.display = on ? 'grid' : 'none'
    third.style.display = on && this.current ? 'grid' : 'none'
    fire.textContent = this.current ? 'FIRE' : 'PUNCH'
    alt.textContent = this.current === 'sniper' ? 'SCOPE' : this.current ? 'AIM' : 'KICK'
    alt.classList.toggle('on', this.aimHeld)
    third.textContent = 'RELOAD'
  }
  private padsIn = false

  private get gun(): GunSpec | null { return this.current ? SPECS[this.current] ?? null : null }
  /** Armed and able to use it: on foot, in play, not down. */
  get active(): boolean { return !!this.current && this.host.onFoot() && this.host.playing() && !this.hero.isDown }

  // ------------------------------------------------------------------------------------------------ what you have
  private load(): void {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null
      if (!s) return
      for (const id of s.owned ?? []) if (SPECS[id]) this.owned.add(id)
      for (const [k, v] of Object.entries(s.ammo ?? {})) this.ammo[k] = [v[0] | 0, v[1] | 0]
    } catch { /* (nothing kept) */ }
  }
  private store(): void {
    if (!this.save) return
    try { localStorage.setItem(KEY, JSON.stringify({ owned: [...this.owned], ammo: this.ammo } satisfies Saved)) } catch { /* (not kept) */ }
  }
  /** A weapon found: yours, loaded; again: its rounds filled. */
  give(id: WeaponId): void {
    const s = SPECS[id]
    this.owned.add(id)
    this.ammo[id] = [s.magazine, s.reserve]
    this.store()
  }
  /** What the wheel shows: each weapon found. */
  list(): { id: WeaponId | null; name: string; on: boolean }[] {
    return [{ id: null, name: 'Fists', on: this.current === null }, ...WEAPON_ORDER.filter((id) => this.owned.has(id)).map((id) => ({ id, name: weaponName(id), on: this.current === id }))]
  }

  /** Into the hands (null: put away). The new one's draw before it can be used. */
  equip(id: WeaponId | null): void {
    if (id && !this.owned.has(id)) return
    if (id === this.current) return
    this.current = id
    this.setScope(0)
    this.trigger = false
    this.aimHeld = false
    this.reloading = false
    const now = tickNow()
    this.busyUntil = id ? now + SPECS[id].drawTicks : now
    this.host.armed?.(id)
    if (!id) return
    if (!this.models.has(id)) void weaponModel(id, this.mat).then((m) => { this.models.set(id, m); this.group.add(m.mesh) })
  }

  // ------------------------------------------------------------------------------------------------ the keys
  /** A key or a button: fire (held: the AK-47 goes on), AIM / the scope, reload. */
  press(what: 'fire' | 'alt' | 'reload', down: boolean): void {
    if (what === 'fire') { this.trigger = down; return }
    // (the other button with a pistol or the AK-47: AIM while it's held)
    if (what === 'alt' && this.current && this.current !== 'sniper') { this.aimHeld = down && this.active; return }
    if (!down || !this.active) return
    if (what === 'alt') this.setScope((this.scope + 1) % 3)
    else this.reload()
  }
  private setScope(n: number, clampIt = false): void {
    const max = this.gun?.scope ? this.gun.scope.fov.length : 0
    this.scope = clampIt ? Math.max(0, Math.min(max, n)) : max ? ((n % (max + 1)) + max + 1) % (max + 1) : 0
  }
  private reload(): void {
    const g = this.gun, a = g ? this.ammo[g.id] : null
    if (!g || !a || this.reloading || a[0] >= g.magazine || a[1] <= 0 || tickNow() < this.busyUntil) return
    this.reloading = true
    this.reloadFrom = tickNow()
    this.busyUntil = this.reloadFrom + g.reloadTicks
  }

  // ------------------------------------------------------------------------------------------------ a shot
  /** What the middle of the screen is on: the first solid thing along the view's line — from as far along it as the
   *  muzzle is (third person's camera stands behind him: what lies between it and him is not what he aims at; a
   *  bullet sent at it left sideways). */
  private aimPoint(out: GFX.Vector3, range: number, muzzle: GFX.Vector3): GFX.Vector3 {
    const d = this.camera.getWorldDirection(this.v2), o = this.camera.position
    const t0 = Math.max(0, (muzzle.x - o.x) * d.x + (muzzle.y - o.y) * d.y + (muzzle.z - o.z) * d.z) + 0.3
    const hit = this.castWorld(out.copy(o).addScaledVector(d, t0), d, range)
    return out.copy(o).addScaledVector(d, t0 + (hit ?? range))
  }
  /** The cone a shot leaves in (° — its half angle): by how he moves, the shots just fired, the scope. */
  private cone(g: GunSpec, burst: number): number {
    const sp = this.hero.speed, S = g.spread
    const c = this.scope > 0 && g.scope ? (sp < 0.5 ? S.scopedStill ?? S.still : S.scopedWalk ?? S.walk) : sp < 0.5 ? S.still : sp < 3 ? S.walk : S.run
    return c + Math.min(S.perShotMax ?? 99, S.perShot * burst)
  }
  /** The first solid thing along a ray (m; null: none within `len`) — the land, the rocks, the trees, the cars, the walls. */
  private castWorld(o: GFX.Vector3, d: GFX.Vector3, len: number): number | null {
    const pw = this.physics.pw
    const r = (this.ray ??= new pw.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }))
    r.origin.x = o.x; r.origin.y = o.y; r.origin.z = o.z
    r.dir.x = d.x; r.dir.y = d.y; r.dir.z = d.z
    const hit = pw.world.castRay(r, len, true, undefined, undefined, undefined, this.hero.rigid as never)
    this.wallBody = hit ? (hit.collider.parent()?.handle ?? -1) : -1
    return hit ? hit.timeOfImpact : null
  }
  /** The body of what the last ray stopped on (its handle; −1: none, or the land). */
  private wallBody = -1
  private fire(g: GunSpec, now: number): void {
    const a = this.ammo[g.id]
    if (!a || a[0] <= 0) { if (a && a[1] > 0) this.reload(); return }
    a[0]--
    this.stats.shots++
    this.nextFire = now + g.fireTicks
    if (g.id === 'sniper') this.boltUntil = now + 18
    // the cone: by how he moves, the shots just fired, the scope
    this.burst = now - this.lastShot <= (g.spread.settleTicks || 0) ? this.burst + 1 : 0
    this.lastShot = now
    const cone = this.cone(g, this.burst)
    // IT FLIES ALONG THE SIGHT LINE — from the point on it abeam the muzzle, to what the middle of the screen is on: so
    // it lands on the cross whatever stands beside the line (out of the muzzle itself — half a metre to one side of a
    // third-person view — it clipped whoever stood just off the cross). Its trace is drawn out of the muzzle, closing
    // on the line over its first metres.
    const muzzle = this.muzzle(this.v)
    const cd = this.camera.getWorldDirection(this.v2), co = this.camera.position
    const start = this.fe.copy(co).addScaledVector(cd, Math.max(0, (muzzle.x - co.x) * cd.x + (muzzle.y - co.y) * cd.y + (muzzle.z - co.z) * cd.z))
    const aim = this.aimPoint(this.fa, g.range, muzzle)
    const d = aim.sub(start).normalize()
    // (lifted for the sight's zero: the drop at that range, as an angle)
    const t0 = (Math.exp(g.drag * g.zero) - 1) / (g.drag * g.muzzleVelocity)
    d.y += (0.5 * G * t0 * t0) / g.zero
    const ang = Math.random() * Math.PI * 2, rad = Math.tan((cone * Math.PI) / 180) * Math.sqrt(Math.random())
    const up = Math.abs(d.y) > 0.95 ? this.fb.set(1, 0, 0) : this.fb.set(0, 1, 0)
    const sx = this.fc.crossVectors(d, up).normalize(), sy = this.fd.crossVectors(sx, d)
    d.addScaledVector(sx, Math.cos(ang) * rad).addScaledVector(sy, Math.sin(ang) * rad).normalize()
    this.bullets.push({ p: start.clone(), v: d.clone().multiplyScalar(g.muzzleVelocity), gone: 0, spec: g, tracer: g.tracerEvery && this.stats.shots % g.tracerEvery === 0 ? 1 : 0, off: muzzle.clone().sub(start) })
    this.host.shot?.(g.id, muzzle, d)
    // the kick: the view up and aside (more as a burst goes on), the gun back in the hands; the flash
    const R = g.recoil, grow = R.grow && R.growShots ? 1 + (R.grow - 1) * Math.min(1, this.burst / R.growShots) : 1
    const kup = (R.up * grow * Math.PI) / 180, aside = ((Math.random() * 2 - 1) * R.side * grow * Math.PI) / 180
    this.kickUp += kup; this.kickSide += aside
    this.recoil = 1
    this.fx.push({ mesh: this.flash, until: performance.now() + 45 })
  }
  private muzzle(out: GFX.Vector3): GFX.Vector3 {
    const p = PTS[this.current ?? 'pistol']?.muzzle ?? [0, 0, -0.3]
    return out.set(p[0], p[1], p[2]).applyMatrix4(this.gunM)
  }
  /** The bullets flown this frame: each a straight piece, slowed and dropped; the first thing in its way stops it. */
  private fly(dt: number): void {
    const all = this.host.targets(), none: Target[] = []
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i], g = b.spec, T = b.ghost ? none : all
      const sp = b.v.length(), step = sp * dt
      const d = this.v.copy(b.v).multiplyScalar(1 / sp)
      const wall = this.castWorld(b.p, d, step), wallBody = this.wallBody
      let best = wall ?? step, who: Target | null = null, zone: Zone = 'body'
      for (const t of T) {
        if (!t.alive()) continue
        // (a capsule: 0.36 m round his middle line, 1.8 m tall — the nearest the piece comes to that line)
        const ox = b.p.x - t.pos.x, oz = b.p.z - t.pos.z, A = d.x * d.x + d.z * d.z, Bq = ox * d.x + oz * d.z
        // (… within this piece, or just past what stopped it: his own solid body is that "wall")
        const reach = (wall ?? step) + 0.5
        const s = A > 1e-9 ? Math.max(0, Math.min(reach, -Bq / A)) : 0
        const hx = ox + d.x * s, hz = oz + d.z * s, hy = b.p.y + d.y * s - t.pos.y
        if (hx * hx + hz * hz > 0.36 * 0.36 || hy < 0 || hy > 1.85 || s >= reach || (who && s >= best)) continue
        // (where it goes IN — his side, not the middle of him: the mark it leaves, and which of two it reaches first)
        best = A > 1e-9 ? Math.max(0, s - Math.sqrt(Math.max(0, 0.36 * 0.36 - hx * hx - hz * hz) / A)) : s
        who = t; zone = hy >= DATA.zones.head ? 'head' : hy <= DATA.zones.limb ? 'limb' : 'body'
      }
      if (who) {
        const keep = Math.max(g.floor, Math.exp(-2 * g.drag * (b.gone + best)))
        who.hit(g.damage * (zone === 'head' ? g.head : zone === 'limb' ? g.limb : 1) * keep, zone, g.id, d)
        this.stats.hits++
        this.marker()
      }
      if (who || wall !== null) {
        this.lastImpact.copy(b.p).addScaledVector(d, best)
        this.host.impact?.(this.lastImpact.x, this.lastImpact.y, this.lastImpact.z, !!who)
        // (a round that stops on a car: a hole in it, its glass, its tyre, its engine — Damage.ts)
        if (!who && wallBody >= 0) this.host.struck?.(wallBody, this.lastImpact.x, this.lastImpact.y, this.lastImpact.z, d.x, d.y, d.z)
      }
      if (who || wall !== null || b.gone + step > g.range) { this.bullets.splice(i, 1); continue }
      b.p.addScaledVector(d, step)
      b.gone += step
      b.v.multiplyScalar(Math.exp(-g.drag * step))
      b.v.y -= G * dt
    }
  }

  // ------------------------------------------------------------------------------------------------ each frame
  /** After the character's own update: the trigger, the bullets; the weapon put in his hands. */
  private idle = false
  private heldNow = false
  update(dt: number): void {
    if (this.prime > 0 && --this.prime === 0) this.flash.visible = this.tracers[0].visible = false
    // (nothing in the hands, nothing in the air: nothing to do — after one pass that puts the character back as he was)
    const quiet = !this.current && !this.bullets.length && !this.fx.length && this.punchUp === 0 && this.punchSide === 0 && this.kickUp === 0 && this.kickSide === 0
    if (quiet && this.idle) { this.drawPads(); return }
    this.idle = quiet
    const now = tickNow(), h = this.hero, g = this.gun, active = this.active
    const shown = !!this.current && this.host.onFoot() && h.visible && !h.isDown
    // (the gun where his hands hold it now — set as he was posed, a moment ago: hold)
    this.heldNow = shown && !!g && this.held
    this.held = false
    if (this.heldNow) this.gunM.multiplyMatrices(h.root.matrixWorld, this.gunL)
    if (this.host.playing()) {
      if (active && g) {
        if (this.reloading && now >= this.busyUntil) { const a = this.ammo[g.id], n = Math.min(g.magazine - a[0], a[1]); a[0] += n; a[1] -= n; this.reloading = false; this.store() }
        // (third person: the gun comes up first — a twentieth of a second from the carry)
        if (this.trigger && now >= this.nextFire && now >= this.busyUntil && this.heldNow && this.aimK > 0.6) { this.fire(g, now); if (!g.auto) this.trigger = false }
      }
      this.fly(dt)
      this.settle(dt, now, g)
    }
    this.recoil = Math.max(0, this.recoil - dt * 9)
    // what the character must do with it — his hands are asked for as he is posed next (hold)
    h.handIK = shown ? this.holdFn : null
    h.aimYaw = null
    h.aimPitch = 0
    h.holdPose = null
    h.paceK = 1
    h.torsoYaw = 0
    for (const m of this.models.values()) m.mesh.visible = false
    const fp = this.host.fpp()
    // UP OR CARRIED: first person — always up (CS:GO's); third person (GTA's) — up while the other button is held,
    // the trigger pulled, the scope on, it's reloaded, and for a second after a shot; carried low otherwise
    this.aiming = shown && !!g && (fp || this.aimHeld || this.trigger || this.reloading || this.scope > 0 || now - this.lastShot <= 22)
    this.aimK += ((this.aiming ? 1 : 0) - this.aimK) * Math.min(1, dt * (this.aiming ? 16 : 7))
    if (!shown || !g) { this.aimK = 0; this.aimHeld = false }
    if (shown && g) {
      // (where the view looks — in play only: a free camera, a menu leave him as he stood)
      if (this.host.playing()) {
        if (fp) { this.aimP = this.host.lookPitch(); this.aimY = this.host.lookYaw() }
        else { const cd = this.camera.getWorldDirection(this.v2); this.aimP = Math.asin(Math.max(-0.95, Math.min(0.95, cd.y))); this.aimY = Math.atan2(-cd.x, -cd.z) }
      }
      const k = this.aimK
      // (aimed: he faces what the view is on and the keys strafe; carried: he goes as he does unarmed)
      h.aimYaw = this.aiming || k > 0.5 ? this.aimY : null
      h.aimPitch = Math.max(-1.1, Math.min(1.1, this.aimP)) * 0.6 * k
      h.holdPose = 'grip'
      // (a rifle at the right shoulder: the chest a quarter turn to the right, the left shoulder forward)
      h.torsoYaw = g.hold === 'rifle' ? (fp ? -0.2 : -0.42) * k : 0
      // (its weight; the scope; aimed in third person he moves at GTA's aiming jog)
      h.paceK = (g.pace ?? 1) * (this.scope > 0 && g.scope ? g.scope.pace : 1) * (this.aiming && !fp ? 0.72 : 1)
      const model = this.models.get(g.id)
      if (model && this.heldNow) {
        model.mesh.visible = !this.scoped
        model.mesh.matrix.copy(this.gunM); model.mesh.matrixWorld.copy(this.gunM)
      }
      this.placeFlash(g)
    }
    // the tracers, the flashes
    let k = 0
    for (const b of this.bullets) {
      if (!b.tracer || k >= this.tracers.length) continue
      const t = this.tracers[k++], len = Math.min(b.gone, 14)
      this.v.copy(b.v).normalize()
      t.matrix.compose(this.s3.copy(b.p).addScaledVector(this.v, -len / 2).addScaledVector(b.off, Math.max(0, 1 - b.gone / 30)), this.q.setFromUnitVectors(this.fwd, this.v), this.off3.set(0.025, 0.025, Math.max(0.5, len)))
      t.matrixWorld.copy(t.matrix)
      t.visible = true
    }
    for (; k < this.tracers.length; k++) this.tracers[k].visible = false
    const t = performance.now()
    let flash = false
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]
      if (t < f.until) { f.mesh.visible = true; if (f.mesh === this.flash) flash = true; continue }
      f.mesh.visible = false
      this.fx.splice(i, 1)
    }
    if (!flash) this.flash.visible = false
    this.drawHud(now, active)
    this.drawPads()
  }

  /** AFTER THE CAMERAS (main.ts): in first person the gun is fixed to the VIEW — put exactly where this frame's
   *  camera has it (his hands were bent to where the view was about to be: millimetres off, at most). */
  afterCamera(): void {
    if (!this.heldNow || !this.gunInView) return
    const g = this.gun
    if (!g) return
    this.gunM.multiplyMatrices(this.camera.matrixWorld, this.gunV)
    const model = this.models.get(g.id)
    if (model?.mesh.visible) { model.mesh.matrix.copy(this.gunM); model.mesh.matrixWorld.copy(this.gunM) }
    this.placeFlash(g)
  }
  private readonly gunV = new GFX.Matrix4()

  /** The view's kick comes back once the firing stops (CS:GO's: the aim returns to where it was — less whatever your
   *  hand took out of it), over the weapon's `returnTicks`. */
  private settle(dt: number, now: number, g: GunSpec | null): void {
    if (this.kickUp !== 0 || this.kickSide !== 0) {
      // (a shot's kick, eased in over ~40 ms)
      const k = Math.min(1, dt * 28)
      let u = this.kickUp * k, sd = this.kickSide * k
      if (Math.abs(this.kickUp - u) < 1e-4 && Math.abs(this.kickSide - sd) < 1e-4) { u = this.kickUp; sd = this.kickSide }
      this.kickUp -= u; this.kickSide -= sd
      this.punchUp += u; this.punchSide += sd
      this.host.kick(u, sd)
    }
    if (this.punchUp === 0 && this.punchSide === 0) return
    // (held up for two ticks after a shot — and all through a burst)
    if (g && (now - this.lastShot < 2 || (now - this.lastShot <= g.fireTicks + 1 && this.trigger && g.auto))) return
    const k = Math.min(1, (dt * 3) / Math.max(0.05, (g?.recoil.returnTicks ?? 6) * TICK))
    let du = this.punchUp * k, ds = this.punchSide * k
    if (Math.abs(this.punchUp - du) < 2e-4 && Math.abs(this.punchSide - ds) < 2e-4) { du = this.punchUp; ds = this.punchSide }
    this.punchUp -= du; this.punchSide -= ds
    this.host.kick(-du, -ds)
  }

  /** The flash at the muzzle. */
  private placeFlash(g: GunSpec): void {
    if (!this.flash.visible && !this.fx.some((f) => f.mesh === this.flash)) return
    const mz = this.muzzle(this.v), s = g.hold === 'rifle' ? 0.16 : 0.1
    this.flash.matrix.compose(mz, this.q.setFromRotationMatrix(this.gunM), this.s3.set(s, s, s * 2.2)); this.flash.matrixWorld.copy(this.flash.matrix)
  }

  /** WHAT HE HOLDS, POSED WITH HIM (Character.handIK: asked while his bones are set — after the clip and his spine's
   *  turns, before his arms are bent — so what this reads of him is THIS frame's: nothing trails as he runs or
   *  turns): where the weapon is, where his wrists go on it, how his hands lie. */
  private readonly holdFn = (): void => {
    const g = this.gun
    if (g) this.holdGun(g)
  }
  /** The eye in his own space and the view's turn there (first person). */
  private viewInHim(eye: GFX.Vector3, turn: GFX.Quaternion): void {
    const h = this.hero, c = Math.cos(h.heading), s = Math.sin(h.heading), e = this.host.eye()
    eye.set(e.x * c - e.z * s, e.y, e.x * s + e.z * c)
    turn.setFromEuler(this.e3.set(Math.max(-1.45, Math.min(1.45, this.host.lookPitch())), wrap(this.host.lookYaw() - h.heading), 0, 'YXZ'))
  }
  private holdGun(g: GunSpec): void {
    const h = this.hero, G = h.grip, H = HOLDS[g.id], rifle = g.hold === 'rifle', now = tickNow()
    const draw = Math.max(0, Math.min(1, 1 - (this.busyUntil - now) / Math.max(1, g.drawTicks)))
    const rl = this.reloading ? Math.min(1, (now - this.reloadFrom) / g.reloadTicks) : -1
    // (lowered while it's drawn or reloaded)
    const low = this.reloading ? Math.sin(Math.PI * rl) * 0.5 : now < this.busyUntil ? 1 - draw : 0
    const fp = this.host.fpp(), rc = this.recoil
    this.gunInView = fp
    if (fp) {
      // FIRST PERSON: in the view's own space — the grip `vm` from the eye, the barrel along the view; it rocks a
      // little with the stride, comes back and up with a shot, dips as it's drawn or reloaded
      const sp = Math.min(1, h.speed / 4.6), ph = h.stridePhase * Math.PI * 2
      this.gp.set(H.vm[0] + Math.sin(ph) * 0.006 * sp, H.vm[1] - Math.abs(Math.sin(ph)) * 0.007 * sp - low * 0.17, H.vm[2] + rc * (rifle ? 0.03 : 0.045) + low * 0.03)
      this.gq.setFromEuler(this.e3.set(rc * (rifle ? 0.025 : 0.09) - low * 0.8, low * 0.3, rifle && this.reloading ? -0.3 * Math.sin(Math.PI * rl) : 0, 'YXZ'))
      this.gunV.compose(this.gp, this.gq, this.one)
      G.stretch = 1.3
      // (→ his own space, for his hands: the eye, the view's turn)
      this.viewInHim(this.va, this.qa)
      this.gp.applyQuaternion(this.qa).add(this.va)
      this.gq.premultiply(this.qa)
    } else holdThird(h, g, this.aimY, this.aimP, this.aimK, low, rc, rl, this.gp, this.gq)
    this.gunL.compose(this.gp, this.gq, this.one)
    this.held = true
    handsOn(h, g, fp, fp ? 1 : this.aimK, rl, this.gp, this.gq)
  }

  /** A HIT MARKER: the cross (or the dot) red for a moment — a co-op player or the enemy hit. */
  private markT = 0
  private marker(): void {
    for (const b of [...this.bars, this.dot]) b.style.background = '#ff4040'
    clearTimeout(this.markT)
    this.markT = window.setTimeout(() => { for (const b of this.bars) b.style.background = '#4dff4d'; this.dot.style.background = '#fff' }, 140)
  }

  /** A CO-OP PLAYER'S SHOT as everyone sees it (Session's `shot`): their bullet flown from their muzzle — a tracer —
   *  stopped by what's solid, hitting nobody (their game said what it hit). A round that stops on your car is still a
   *  hole in it (`struck`). */
  ghost(weapon: string, p: GFX.Vector3, d: GFX.Vector3): void {
    if (!isGun(weapon)) return
    const g = SPECS[weapon]
    this.bullets.push({ p: p.clone(), v: d.clone().normalize().multiplyScalar(g.muzzleVelocity), gone: 0, spec: g, tracer: g.tracerEvery ? 1 : 0, off: new GFX.Vector3(), ghost: true })
    this.idle = false
  }

  private hudA = ''
  private hudB = ''
  private hudC = ''
  private aimP = 0
  /** (co-op) the aim's pitch — our pose carries it while the gun is up (FLAG_AIM: the others raise theirs to it). */
  get aimPitch(): number { return this.aimP }
  private aimY = 0
  private crossMode = -1
  private gapPx = -1
  private drawHud(now: number, active: boolean): void {
    const g = this.gun
    const show = active ? 'block' : 'none'
    if (this.hud.style.display !== show) this.hud.style.display = show
    // the middle of the screen: 0 nothing, 1 the cross (first person), 2 the dot (third person, aimed)
    const fp = this.host.fpp()
    const mode = !active || !g || this.scoped ? 0 : fp ? (g.id === 'sniper' ? 0 : 1) : this.aimK > 0.5 ? 2 : 0
    if (mode !== this.crossMode) {
      this.crossMode = mode
      this.cross.style.display = mode ? 'block' : 'none'
      for (const b of this.bars) b.style.display = mode === 1 ? 'block' : 'none'
      this.dot.style.display = mode === 2 ? 'block' : 'none'
      this.gapPx = -1
    }
    if (mode === 1 && g) {
      // (the gap: the cone's own size on the screen — the shot lands inside what the cross shows)
      const cone = this.cone(g, now - this.lastShot <= (g.spread.settleTicks || 0) ? this.burst + 1 : 0)
      const gap = Math.max(3, Math.min(60, Math.round((Math.tan((cone * Math.PI) / 180) * innerHeight) / (2 * Math.tan((this.camera.fov * Math.PI) / 360)) + 2)))
      if (gap !== this.gapPx) {
        this.gapPx = gap
        const [l, r, u, d] = this.bars
        l.style.left = `${-gap - 9}px`; r.style.left = `${gap}px`; u.style.top = `${-gap - 9}px`; d.style.top = `${gap}px`
      }
    }
    const glass = active && this.scoped ? 'block' : 'none'
    if (this.glass.style.display !== glass) this.glass.style.display = glass
    if (!active) return
    // (each part's text set only when it changes — no HTML parsed a shot)
    let a = '', b = '', c = ''
    if (g) { const am = this.ammo[g.id] ?? [0, 0]; a = g.name; b = this.reloading ? 'RELOAD' : String(am[0]); c = ` / ${am[1]}` }
    if (a !== this.hudA) { this.hudA = a; this.hudName.textContent = a }
    if (b !== this.hudB) { this.hudB = b; this.hudBig.textContent = b }
    if (c !== this.hudC) { this.hudC = c; this.hudRest.textContent = c }
  }

  dispose(): void {
    for (const f of this.off) f()
    this.group.removeFromParent()
    this.hero.handIK = null; this.hero.aimYaw = null; this.hero.aimPitch = 0; this.hero.holdPose = null; this.hero.paceK = 1; this.hero.torsoYaw = 0
    this.cross.remove(); this.hud.remove(); this.glass.remove()
    for (const b of this.pads) b.remove()
  }
}

/** A place a weapon lies (a ruin), what lies there, whether you've seen it, when it gives rounds again. */
export interface PickupSite { id: string; weapon: WeaponId; x: number; y: number; z: number; place: string; seen: boolean; readyAt: number }
export interface PickupHost {
  onFoot(): boolean
  pos(): GFX.Vector3
  toast(m: string, ms?: number): void
  /** The top of what's solid at (x, z) (the land, a ruin's floor). */
  surface(x: number, z: number): number
}
/** What lies where: nearest the start a pistol, then by turns — the rarer the further out. */
const LAID: WeaponId[] = ['pistol', 'ak47', 'pistol', 'sniper', 'ak47', 'pistol', 'sniper', 'ak47', 'pistol', 'sniper']
const SEEN_KEY = 'overhill.weaponsites.v1'

/**
 * THE WEAPONS IN THE RUINS (docs/WEAPONS.md): each of the map's ruins nearest the start holds one — turning slowly over
 * a low amber light, seen from 150 m; all of them are marked on the map and the minimap; walk up to it, E (or
 * tap it on a phone: the prompt) takes it — yours for good, loaded; the site gives its rounds again every 5 minutes.
 * Only the nearest one is drawn: one mesh and its light.
 */
export class Pickups {
  readonly sites: PickupSite[] = []
  private readonly group = new GFX.Group()
  private readonly mat: GFX.ShaderMaterial
  private readonly models = new Map<string, Model>()
  private readonly beam: GFX.Mesh
  private near: PickupSite | null = null
  private readonly asked = new Set<string>()
  private turn = 0
  private prompt: HTMLDivElement
  private readonly off: () => void

  constructor(
    private readonly arsenal: Arsenal,
    private readonly host: PickupHost,
    landmarks: readonly { id: number; kind: string; name: string; x: number; z: number }[],
    start: { x: number; z: number },
    half: number,
    world: string,
    scene: GFX.Scene,
    atmos: Atmosphere,
    shadow: TerrainShadow,
    farGrid: GFX.Vector4,
    private readonly keep = true,
  ) {
    this.mat = weaponMaterial(atmos, shadow, farGrid)
    scene.add(this.group)
    this.beam = new GFX.Mesh(boxGeometry(), glowMat('#e0a040', 0.55))
    this.beam.frustumCulled = false; this.beam.matrixAutoUpdate = false; this.beam.visible = false; this.beam.renderOrder = 4
    this.group.add(this.beam)
    // the ruins, nearest the start first: the VALLEY's own (a ruin, the ghost house, a tower, a wreck — inside the box:
    // on the map as it opens) hold the first four; the Wardens' ruins out in the outland the rest
    const near = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - start.x, a.z - start.z) - Math.hypot(b.x - start.x, b.z - start.z)
    const inBox = (l: { x: number; z: number }) => Math.abs(l.x) < half - 60 && Math.abs(l.z) < half - 60
    const own = landmarks.filter((l) => (l.kind === 'ruin' || l.kind === 'ghost' || l.kind === 'tower' || l.kind === 'wreck') && inBox(l)).sort(near).slice(0, 4)
    const ruins = [...own, ...landmarks.filter((l) => l.kind === 'warden').sort(near)]
    let seen: string[] = []
    if (keep) try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[] } catch { /* (none) */ }
    ruins.slice(0, LAID.length).forEach((l, i) => {
      const weapon = LAID[i], id = `${world}:${l.id}`
      // (a few steps off its middle: clear of a tower's own walls)
      this.sites.push({ id, weapon, x: l.x + 3.2, y: NaN, z: l.z + 2.4, place: l.name, seen: seen.includes(id), readyAt: 0 })
    })
    this.prompt = document.createElement('div')
    this.prompt.style.cssText = "position:fixed;left:50%;top:62%;transform:translateX(-50%);padding:8px 14px;background:rgba(8,8,8,.78);border-left:3px solid #e0a040;color:#fff;font:700 16px 'Barlow Condensed','Arial Narrow',sans-serif;letter-spacing:.06em;text-transform:uppercase;z-index:5;display:none"
    this.prompt.addEventListener('pointerdown', (e) => { e.preventDefault(); this.take() })
    document.body.appendChild(this.prompt)
    const onKey = (e: KeyboardEvent) => { if (e.code === 'KeyE' && !e.repeat) this.take() }
    window.addEventListener('keydown', onKey)
    this.off = () => window.removeEventListener('keydown', onKey)
  }

  /** Every site, for the map and the minimap (the user: "show it in maps") — each named for what lies there. */
  marks(): readonly { x: number; z: number; name: string; colour: string; heading: number; site: boolean }[] {
    // (made once: the minimap asks every frame — ten objects and their names a frame was garbage)
    return (this.marksOut ??= this.sites.map((s) => ({ site: true, x: s.x, z: s.z, name: weaponName(s.weapon), colour: '#e0a040', heading: 0 })))
  }
  private marksOut: { x: number; z: number; name: string; colour: string; heading: number; site: boolean }[] | null = null

  private inReach(): PickupSite | null {
    const s = this.near, p = this.host.pos()
    return s && this.host.onFoot() && Math.hypot(s.x - p.x, s.z - p.z) < 2.6 && Math.abs(s.y - p.y) < 3 ? s : null
  }
  private take(): void {
    const s = this.inReach()
    if (!s) return
    const had = this.arsenal.owned.has(s.weapon)
    if (had && performance.now() < s.readyAt) { this.host.toast(`Nothing more here yet — ${Math.ceil((s.readyAt - performance.now()) / 60000)} min`); return }
    this.arsenal.give(s.weapon)
    this.arsenal.equip(s.weapon)
    s.readyAt = performance.now() + 5 * 60000
    this.host.toast(had ? `${weaponName(s.weapon)}: rounds taken` : `${weaponName(s.weapon)} — yours (Q › weapons)`, 3500)
  }

  private scanT = 0
  private readonly tap = document.body.classList.contains('touch') || matchMedia('(pointer: coarse)').matches
  private readonly q = new GFX.Quaternion()
  private readonly e = new GFX.Euler()
  private readonly p3 = new GFX.Vector3()
  private readonly s3 = new GFX.Vector3()
  update(dt: number): void {
    const p = this.host.pos()
    // (which site is nearest: looked for twice a second — nothing near, nothing else is done)
    if ((this.scanT -= dt) <= 0) {
      this.scanT = 0.5
      let b: PickupSite | null = null, d0 = 150
      for (const s of this.sites) { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < d0) { d0 = d; b = s } }
      if (b !== this.near) { for (const m of this.models.values()) m.mesh.visible = false; this.beam.visible = false }
      this.near = b
    }
    const best = this.near, bd = best ? Math.hypot(best.x - p.x, best.z - p.z) : Infinity
    if (!best) { if (this.prompt.style.display !== 'none') this.prompt.style.display = 'none'; return }
    if (bd < 60 && !best.seen) {
      best.seen = true
      this.host.toast(`A weapon lies at ${best.place}`, 3500)
      if (this.keep) try { localStorage.setItem(SEEN_KEY, JSON.stringify(this.sites.filter((s) => s.seen).map((s) => s.id))) } catch { /* (not kept) */ }
    }
    // (its height: what's solid there — asked once you're near enough for the physics to hold that ground)
    if (Number.isNaN(best.y) || bd < 40) best.y = this.host.surface(best.x, best.z)
    const key = best.weapon
    const m = this.models.get(key)
    if (!m && !this.asked.has(key)) { this.asked.add(key); void weaponModel(key, this.mat).then((mm) => { this.models.set(key, mm); this.group.add(mm.mesh) }) }
    this.turn += dt * 1.4
    const y = best.y + 1.05 + Math.sin(this.turn * 1.3) * 0.05
    if (m?.mesh) {
      // (stood on its butt / its point up, turning)
      const q = this.q.setFromEuler(this.e.set(0.25, this.turn, 0, 'YXZ'))
      m.mesh.matrix.compose(this.p3.set(best.x, y, best.z), q, this.s3.set(1.6, 1.6, 1.6)); m.mesh.matrixWorld.copy(m.mesh.matrix)
      m.mesh.visible = true
    }
    this.beam.matrix.compose(this.p3.set(best.x, best.y + 6, best.z), this.q.set(0, 0, 0, 1), this.s3.set(0.16, 12, 0.16)); this.beam.matrixWorld.copy(this.beam.matrix)
    this.beam.visible = true
    const r = this.inReach(), txt = r ? `${this.tap ? 'TAP' : 'E'} · TAKE THE ${weaponName(r.weapon)}` : ''
    if (this.prompt.textContent !== txt) this.prompt.textContent = txt
    const disp = r ? 'block' : 'none'
    if (this.prompt.style.display !== disp) this.prompt.style.display = disp
  }

  dispose(): void { this.off(); this.group.removeFromParent(); this.prompt.remove() }
}
