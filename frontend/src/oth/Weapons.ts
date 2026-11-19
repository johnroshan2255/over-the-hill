import * as GFX from './gfx'
import DATA from '../../../proto/weapons.json'
import META from '../assets/models/weapons/weapons.meta.json'
import pistolUrl from '../assets/models/weapons/pistol.glb?url'
import ak47Url from '../assets/models/weapons/ak47.glb?url'
import sniperUrl from '../assets/models/weapons/sniper.glb?url'
import katanaFireUrl from '../assets/models/weapons/katana_fire.glb?url'
import katanaThunderUrl from '../assets/models/weapons/katana_thunder.glb?url'
import type { Atmosphere } from './Atmosphere'
import type { Character, FightClip } from './Character'
import type { MapData } from './MapData'
import type { OthPhysics } from './Physics'
import type { TerrainShadow } from './TerrainShadow'
import { VEHICLE_FRAG_SRC } from './Vehicle'

/**
 * THE WEAPONS (2026-11-19 — docs/WEAPONS.md; each one's numbers from its spec, docs/weapons/*.md → proto/weapons.json):
 * the 9 mm PISTOL, the AK-47, the bolt-action SNIPER rifle with its two-step scope, and the KATANA — the fire blade or
 * the thunder blade, its ability woken with a key. One in the hands at a time. The models and the katana's cuts are
 * made in Blender (scripts/oth/weapons.py, scripts/oth/fight.py).
 *
 *   THE TICK   every time is a whole number of the server's 20 Hz ticks (50 ms): a shot may leave only `fireTicks`
 *              after the last (the AK-47's 2 = its real 600 a minute), a cut's edge is its own ticks.
 *   A GUN      held where the game puts it (before the chest, tipped to where the camera looks), both wrists bent onto
 *              it (Character.handIK); he faces where he aims and the keys strafe. A shot: the bullet leaves the muzzle
 *              toward what the middle of the screen is on, lifted for the sight's zero, inside the cone of its spread;
 *              it FLIES — its speed falling as v₀·e^(−k·x), dropping under gravity — a ray a frame against the land,
 *              the solid things and whoever can be hit; what it takes falls with the energy it keeps.
 *   THE SCOPE  (the sniper) U / the right button: off → 40° → 10° → off; the wheel steps it; first person through the
 *              glass (main.ts takes `scopeFov`), out of it while the bolt is worked.
 *   THE KATANA in his right fist as the clips turn it, the left hand put under it; J: cut 1 → 2 → 3, U: the heavy cut —
 *              whoever is in the arc during the edge's ticks is cut once; I wakes the blade (fire: sets alight, the
 *              heavy cut throws a wave of fire; thunder: arcs to those near and stuns, the heavy cut calls a bolt).
 */
export type WeaponId = 'pistol' | 'ak47' | 'sniper' | 'katana'
export type KatanaType = 'fire' | 'thunder'
export type Zone = 'head' | 'body' | 'limb'
/** Who can be hit: their feet, whether they still stand, what a hit does to them. */
export interface Target {
  id: string
  pos: GFX.Vector3
  alive(): boolean
  hit(damage: number, zone: Zone, weapon: string, dir: GFX.Vector3): void
  stun?(seconds: number): void
}
export interface ArsenalHost {
  onFoot(): boolean
  playing(): boolean
  targets(): Target[]
  /** The view kicked by a shot (rad: up, to the side). */
  kick(up: number, side: number): void
  toast(m: string): void
  /** Nothing in the hands: FIRE / the other button are your fists (the enemy's game: a punch, a kick). */
  fists?(what: 'fire' | 'alt'): void
  /** The phone's buttons shown with nothing in the hands (there's someone to fight). */
  fistsOn?(): boolean
  /** (co-op) a shot left / a hit landed — told to the others. */
  shot?(weapon: string, from: GFX.Vector3, dir: GFX.Vector3): void
}

interface GunSpec {
  id: WeaponId; name: string; kind: 'gun'; hold: 'pistol' | 'rifle'; muzzleVelocity: number; drag: number; range: number; zero: number
  auto: boolean; fireTicks: number; reloadTicks: number; drawTicks: number; magazine: number; reserve: number
  damage: number; head: number; limb: number; floor: number; tracerEvery: number; pace?: number
  spread: { still: number; walk: number; run: number; perShot: number; settleTicks: number; scopedStill?: number; scopedWalk?: number }
  recoil: { up: number; side: number; returnTicks: number; grow?: number; growShots?: number }
  scope?: { fov: number[]; settleTicks: number; pace: number }
}
interface Cut { id: string; windup: number; edge: number; recover: number; arc: number; reach: number; damage: number; head?: boolean }
interface BladeSpec {
  id: 'katana'; name: string; kind: 'blade'; drawTicks: number; comboTicks: number; head: number; cuts: Cut[]
  types: Record<KatanaType, { name: string; awakeTicks: number; restTicks: number; glow: string
    burn?: { damage: number; everyTicks: number; forTicks: number }; wave?: { length: number; width: number; speed: number; damage: number }
    arc?: { radius: number; rainRadius: number; damage: number; stunTicks: number }; bolt?: { ahead: number; radius: number; damage: number; stunTicks: number; delayTicks: number } }>
}
const SPECS = DATA.weapons as unknown as Record<WeaponId, GunSpec | BladeSpec>
export const TICK = 1 / DATA.tickHz
export const WEAPON_ORDER = DATA.order as WeaponId[]
export const weaponName = (id: WeaponId, katana: KatanaType | null = null): string => (id === 'katana' && katana ? (SPECS.katana as BladeSpec).types[katana].name : SPECS[id].name)
const PTS = META as Record<string, Record<string, number[]>>
const URLS: Record<string, string> = { pistol: pistolUrl, ak47: ak47Url, sniper: sniperUrl, katana_fire: katanaFireUrl, katana_thunder: katanaThunderUrl }
const CUT_CLIP: Record<string, FightClip> = { cut1: 'cut1', cut2: 'cut2', cut3: 'cut3', heavy: 'cut_heavy' }
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
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vLocal = position;
  vN = normalize(mat3(modelMatrix) * normal);
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
/** An unlit glow (the blade awake, a tracer, the muzzle's flash, the fire, the bolt): additive. */
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

/** A weapon's model: its mesh (lit as the cars are, coloured by vertex) and, the katana's, its glow shell. */
interface Model { mesh: GFX.Mesh; glow: GFX.Mesh | null }
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
        parts.push({ name: (o.name || m.parent?.name || '').startsWith('glow') ? 'glow' : 'weapon', geo })
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
export async function weaponModel(key: string, mat: GFX.ShaderMaterial, glow?: string): Promise<Model> {
  const { parts } = await loadParts(key)
  let mesh: GFX.Mesh | null = null, g: GFX.Mesh | null = null
  for (const p of parts) {
    const m = new GFX.Mesh(p.geo, p.name === 'glow' ? glowMat(glow ?? '#ffffff', 0) : mat)
    m.frustumCulled = false
    m.matrixAutoUpdate = false
    m.visible = false
    if (p.name === 'glow') { g = m; m.renderOrder = 4 } else mesh = m
  }
  return { mesh: mesh!, glow: g }
}
export const modelKey = (id: WeaponId, katana: KatanaType | null): string => (id === 'katana' ? `katana_${katana ?? 'fire'}` : id)

interface Bullet { p: GFX.Vector3; v: GFX.Vector3; gone: number; spec: GunSpec; tracer: number }
interface Saved { owned: WeaponId[]; katana: KatanaType | null; ammo: Record<string, [number, number]> }
const KEY = 'overhill.weapons.v1'

export class Arsenal {
  /** What's been found, the katana's kind, the rounds (in the gun, carried). */
  readonly owned = new Set<WeaponId>()
  katana: KatanaType | null = null
  readonly ammo: Record<string, [number, number]> = {}
  /** In the hands now (null: his fists). */
  current: WeaponId | null = null
  /** The sniper's scope: 0 off, 1, 2 — and the lens main.ts must use (null: its own). */
  scope = 0
  get scopeFov(): number | null { const s = this.gun?.scope; return s && this.scoped ? s.fov[this.scope - 1] : null }
  /** In the glass now (not while the bolt is worked). */
  get scoped(): boolean { return this.current === 'sniper' && this.scope > 0 && tickNow() >= this.boltUntil && tickNow() >= this.busyUntil }
  /** (the harness) shots fired, hits landed, cuts thrown. */
  readonly stats = { shots: 0, hits: 0, cuts: 0, cutHits: 0 }
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
  // the katana
  private cut: { spec: Cut; start: number; hit: Set<string>; idx: number; fx: boolean } | null = null
  private combo = 0
  awakeUntil = 0
  restUntil = 0
  private readonly burning = new Map<string, { t: Target; until: number; next: number }>()
  private wave: { p: GFX.Vector3; d: GFX.Vector3; gone: number; hit: Set<string> } | null = null
  private bolts: { at: GFX.Vector3; tick: number }[] = []
  private readonly sword = new GFX.Matrix4()
  private readonly swordFix = new GFX.Matrix4()
  private readonly gunM = new GFX.Matrix4()
  private readonly wrists: [GFX.Vector3 | null, GFX.Vector3 | null] = [null, null]
  private readonly wl = new GFX.Vector3()
  private readonly wr = new GFX.Vector3()
  private readonly v = new GFX.Vector3()
  private readonly v2 = new GFX.Vector3()
  private readonly m = new GFX.Matrix4()
  private readonly m2 = new GFX.Matrix4()
  private readonly q = new GFX.Quaternion()
  private readonly s3 = new GFX.Vector3()
  private readonly off3 = new GFX.Vector3()
  private readonly fwd = new GFX.Vector3(0, 0, 1)
  private readonly ikOut = (): [GFX.Vector3 | null, GFX.Vector3 | null] => this.wrists
  private readonly hud: HTMLDivElement
  private readonly cross: HTMLDivElement
  private readonly glass: HTMLDivElement
  private ray: any = null
  private clipsAsked = false
  private readonly off: (() => void)[] = []

  constructor(
    private readonly host: ArsenalHost,
    private readonly hero: Character,
    private readonly camera: GFX.PerspectiveCamera,
    scene: GFX.Scene,
    private readonly map: MapData,
    private readonly physics: OthPhysics,
    atmos: Atmosphere,
    shadow: TerrainShadow,
    farGrid: GFX.Vector4,
    private readonly fightUrl: string,
    private readonly save = true,
  ) {
    this.mat = weaponMaterial(atmos, shadow, farGrid)
    scene.add(this.group)
    const box = boxGeometry()
    for (let i = 0; i < 10; i++) { const t = new GFX.Mesh(box, glowMat('#ffd9a0', 1.6)); t.frustumCulled = false; t.matrixAutoUpdate = false; t.visible = false; t.renderOrder = 4; this.group.add(t); this.tracers.push(t) }
    this.flash = new GFX.Mesh(box, glowMat('#ffc070', 3)); this.flash.frustumCulled = false; this.flash.matrixAutoUpdate = false; this.flash.visible = false; this.flash.renderOrder = 4
    this.group.add(this.flash)
    // the HUD: the cross in the middle, the rounds / the blade's state bottom right, the scope's glass
    this.cross = document.createElement('div')
    this.cross.style.cssText = 'position:fixed;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;pointer-events:none;z-index:4;display:none;background:linear-gradient(#fff,#fff) 50% 50%/2px 18px no-repeat,linear-gradient(#fff,#fff) 50% 50%/18px 2px no-repeat;opacity:.85;mix-blend-mode:difference'
    this.hud = document.createElement('div')
    this.hud.style.cssText = "position:fixed;right:24px;bottom:150px;padding:8px 12px;background:rgba(8,8,8,.72);border-left:3px solid #e0a040;color:#fff;font:700 15px/1.25 'Barlow Condensed','Arial Narrow',sans-serif;letter-spacing:.06em;text-transform:uppercase;text-align:right;pointer-events:none;z-index:4;display:none"
    this.glass = document.createElement('div')
    this.glass.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:3;display:none;background:linear-gradient(#000,#000) 50% 50%/1px 100% no-repeat,linear-gradient(#000,#000) 50% 50%/100% 1px no-repeat,linear-gradient(#000,#000) 50% calc(50% + 6vh)/14px 1px no-repeat,linear-gradient(#000,#000) 50% calc(50% + 14vh)/22px 1px no-repeat,linear-gradient(#000,#000) 50% calc(50% + 26vh)/30px 1px no-repeat,radial-gradient(circle at 50% 50%,transparent 0,transparent 41vh,rgba(0,0,0,.55) 42vh,#000 44vh)'
    document.body.append(this.cross, this.hud, this.glass)
    const on = <K extends keyof WindowEventMap>(t: K, f: (e: WindowEventMap[K]) => void, o?: AddEventListenerOptions) => { window.addEventListener(t, f, o); this.off.push(() => window.removeEventListener(t, f, o)) }
    on('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !this.active) return
      if (e.code === 'KeyJ') this.press('fire', true)
      else if (e.code === 'KeyU') this.press('alt', true)
      else if (e.code === 'KeyR') this.press('reload', true)
      else if (e.code === 'KeyI') this.press('ability', true)
    })
    on('keyup', (e) => { if (e.code === 'KeyJ') this.press('fire', false) })
    on('mousedown', (e) => { if (!this.active || !document.pointerLockElement) return; if (e.button === 0) this.press('fire', true); else if (e.button === 2) this.press('alt', true) })
    on('mouseup', (e) => { if (e.button === 0) this.press('fire', false) })
    on('wheel', (e) => { if (this.active && this.current === 'sniper') this.setScope(this.scope + (e.deltaY < 0 ? 1 : -1), true) }, { passive: true })
    on('blur', () => { this.trigger = false })
    if (save) this.load()
    // THE PHONE'S BUTTONS (right thumb, on foot): FIRE (held: the AK-47 goes on), the scope / the heavy cut / a kick,
    // and RELOAD — with the katana, its ability
    if (document.body.classList.contains('touch') || matchMedia('(pointer: coarse)').matches) {
      const mk = (label: string, right: number, bottom: number, size: number, down: () => void, up?: () => void) => {
        const b = document.createElement('button')
        b.textContent = label
        b.style.cssText = `position:fixed;right:${right}px;bottom:${bottom}px;width:${size}px;height:${size}px;border-radius:50%;border:2px solid rgba(255,255,255,.35);background:rgba(8,8,8,.55);color:#fff;font:700 12px 'Barlow Condensed','Arial Narrow',sans-serif;letter-spacing:.06em;z-index:6;display:none;touch-action:none;user-select:none;-webkit-user-select:none`
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); down() })
        if (up) for (const t of ['pointerup', 'pointercancel', 'pointerleave'] as const) b.addEventListener(t, (e) => { e.preventDefault(); up() })
        document.body.appendChild(b)
        this.pads.push(b)
        return b
      }
      mk('FIRE', 22, 232, 76, () => (this.current ? this.press('fire', true) : this.host.fists?.('fire')), () => this.press('fire', false))
      mk('AIM', 108, 208, 60, () => (this.current ? this.press('alt', true) : this.host.fists?.('alt')))
      mk('RELOAD', 30, 318, 56, () => this.press(this.current === 'katana' ? 'ability' : 'reload', true))
    }
  }
  private readonly pads: HTMLButtonElement[] = []
  private padKey = ''
  /** The phone's buttons: shown on foot with a weapon (or fists and someone to fight), named for what's in the hands. */
  private drawPads(): void {
    if (!this.pads.length) return
    const on = this.host.onFoot() && this.host.playing() && (!!this.current || !!this.host.fistsOn?.())
    const key = `${on}${this.current}`
    if (key === this.padKey) return
    this.padKey = key
    const [fire, alt, third] = this.pads
    fire.style.display = alt.style.display = on ? 'block' : 'none'
    third.style.display = on && this.current ? 'block' : 'none'
    fire.textContent = this.current === 'katana' ? 'CUT' : this.current ? 'FIRE' : 'PUNCH'
    alt.textContent = this.current === 'sniper' ? 'SCOPE' : this.current === 'katana' ? 'HEAVY' : this.current ? '' : 'KICK'
    if (this.current && this.current !== 'sniper' && this.current !== 'katana') alt.style.display = 'none'
    third.textContent = this.current === 'katana' ? 'WAKE' : 'RELOAD'
  }

  private get gun(): GunSpec | null { const s = this.current ? SPECS[this.current] : null; return s && s.kind === 'gun' ? s : null }
  private get blade(): BladeSpec { return SPECS.katana as BladeSpec }
  /** Armed and able to use it: on foot, in play, not down. */
  get active(): boolean { return !!this.current && this.host.onFoot() && this.host.playing() && !this.hero.isDown }
  get awake(): boolean { return this.current === 'katana' && tickNow() < this.awakeUntil }

  // ------------------------------------------------------------------------------------------------ what you have
  private load(): void {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null
      if (!s) return
      for (const id of s.owned ?? []) if (SPECS[id]) this.owned.add(id)
      this.katana = s.katana === 'fire' || s.katana === 'thunder' ? s.katana : null
      for (const [k, v] of Object.entries(s.ammo ?? {})) this.ammo[k] = [v[0] | 0, v[1] | 0]
    } catch { /* (nothing kept) */ }
  }
  private store(): void {
    if (!this.save) return
    try { localStorage.setItem(KEY, JSON.stringify({ owned: [...this.owned], katana: this.katana, ammo: this.ammo } satisfies Saved)) } catch { /* (not kept) */ }
  }
  /** A weapon found (a katana: its kind — the one you had is left): yours, loaded; again: its rounds filled. */
  give(id: WeaponId, katana?: KatanaType): void {
    const s = SPECS[id]
    this.owned.add(id)
    if (s.kind === 'gun') this.ammo[id] = [s.magazine, s.reserve]
    if (id === 'katana') { this.katana = katana ?? this.katana ?? 'fire'; if (this.current === 'katana') { this.current = null; this.equip('katana') } }
    this.store()
  }
  /** What the wheel shows: each weapon found (the katana by its kind's name). */
  list(): { id: WeaponId | null; name: string; on: boolean }[] {
    return [{ id: null, name: 'Fists', on: this.current === null }, ...WEAPON_ORDER.filter((id) => this.owned.has(id)).map((id) => ({ id, name: weaponName(id, this.katana), on: this.current === id }))]
  }

  /** Into the hands (null: put away). The new one's draw before it can be used. */
  equip(id: WeaponId | null): void {
    if (id && !this.owned.has(id)) return
    if (id === this.current) return
    this.current = id
    this.setScope(0)
    this.trigger = false
    this.reloading = false
    this.cut = null
    this.combo = 0
    const now = tickNow()
    this.busyUntil = id ? now + SPECS[id].drawTicks : now
    if (!id) return
    const key = modelKey(id, this.katana)
    if (!this.models.has(key)) void weaponModel(key, this.mat, id === 'katana' ? this.blade.types[this.katana ?? 'fire'].glow : undefined).then((m) => { this.models.set(key, m); this.group.add(m.mesh); if (m.glow) this.group.add(m.glow) })
    if (id === 'katana') {
      if (!this.clipsAsked) { this.clipsAsked = true; void this.hero.loadClips(this.fightUrl).then(() => { if (this.current === 'katana' && this.host.onFoot()) this.hero.strike('katana_draw', { force: true }) }) }
      else this.hero.strike('katana_draw', { force: true })
    }
  }

  // ------------------------------------------------------------------------------------------------ the keys
  /** A key or a button: fire / cut (held: the AK-47 goes on), the scope / the heavy cut, reload, the blade's ability. */
  press(what: 'fire' | 'alt' | 'reload' | 'ability', down: boolean): void {
    if (what === 'fire') { this.trigger = down; if (down && this.current === 'katana') this.slash(false); return }
    if (!down || !this.active) return
    if (what === 'alt') { if (this.current === 'sniper') this.setScope((this.scope + 1) % 3); else if (this.current === 'katana') this.slash(true) }
    else if (what === 'reload') this.reload()
    else if (what === 'ability') this.wake()
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
  private aimPoint(out: GFX.Vector3, range: number): GFX.Vector3 {
    const d = this.camera.getWorldDirection(this.v2), o = this.camera.position
    const hit = this.castWorld(o, d, range)
    return out.copy(o).addScaledVector(d, hit ?? range)
  }
  /** The first solid thing along a ray (m; null: none within `len`) — the land, the rocks, the trees, the cars, the walls. */
  private castWorld(o: GFX.Vector3, d: GFX.Vector3, len: number): number | null {
    const pw = this.physics.pw
    const r = (this.ray ??= new pw.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }))
    r.origin.x = o.x; r.origin.y = o.y; r.origin.z = o.z
    r.dir.x = d.x; r.dir.y = d.y; r.dir.z = d.z
    const hit = pw.world.castRay(r, len, true, undefined, undefined, undefined, this.hero.rigid as never)
    return hit ? hit.timeOfImpact : null
  }
  private fire(g: GunSpec, now: number): void {
    const a = this.ammo[g.id]
    if (!a || a[0] <= 0) { if (a && a[1] > 0) this.reload(); return }
    a[0]--
    this.stats.shots++
    this.nextFire = now + g.fireTicks
    if (g.id === 'sniper') this.boltUntil = now + 18
    // the cone: by how he moves, the shots just fired, the scope
    const sp = this.hero.speed, S = g.spread
    this.burst = now - this.lastShot <= (S.settleTicks || 0) ? this.burst + 1 : 0
    this.lastShot = now
    let cone = this.scope > 0 && g.scope ? (sp < 0.5 ? S.scopedStill ?? S.still : S.scopedWalk ?? S.walk) : sp < 0.5 ? S.still : sp < 3 ? S.walk : S.run
    cone += S.perShot * this.burst
    const muzzle = this.muzzle(this.v)
    const aim = this.aimPoint(new GFX.Vector3(), g.range)
    const d = aim.sub(muzzle).normalize()
    // (lifted for the sight's zero: the drop at that range, as an angle)
    const t0 = (Math.exp(g.drag * g.zero) - 1) / (g.drag * g.muzzleVelocity)
    d.y += (0.5 * G * t0 * t0) / g.zero
    const ang = Math.random() * Math.PI * 2, rad = Math.tan((cone * Math.PI) / 180) * Math.sqrt(Math.random())
    const up = Math.abs(d.y) > 0.95 ? new GFX.Vector3(1, 0, 0) : new GFX.Vector3(0, 1, 0)
    const sx = new GFX.Vector3().crossVectors(d, up).normalize(), sy = new GFX.Vector3().crossVectors(sx, d)
    d.addScaledVector(sx, Math.cos(ang) * rad).addScaledVector(sy, Math.sin(ang) * rad).normalize()
    this.bullets.push({ p: muzzle.clone(), v: d.clone().multiplyScalar(g.muzzleVelocity), gone: 0, spec: g, tracer: g.tracerEvery && this.stats.shots % g.tracerEvery === 0 ? 1 : 0 })
    this.host.shot?.(g.id, muzzle, d)
    // the kick: the view up and aside (more as a burst goes on), the gun back in the hands; the flash
    const R = g.recoil, grow = R.grow && R.growShots ? 1 + (R.grow - 1) * Math.min(1, this.burst / R.growShots) : 1
    this.host.kick((R.up * grow * Math.PI) / 180, ((Math.random() * 2 - 1) * R.side * grow * Math.PI) / 180)
    this.recoil = 1
    this.fx.push({ mesh: this.flash, until: performance.now() + 45 })
  }
  private muzzle(out: GFX.Vector3): GFX.Vector3 {
    const p = PTS[this.current ?? 'pistol']?.muzzle ?? [0, 0, -0.3]
    return out.set(p[0], p[1], p[2]).applyMatrix4(this.gunM)
  }
  /** The bullets flown this frame: each a straight piece, slowed and dropped; the first thing in its way stops it. */
  private fly(dt: number): void {
    const T = this.host.targets()
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i], g = b.spec
      const sp = b.v.length(), step = sp * dt
      const d = this.v.copy(b.v).multiplyScalar(1 / sp)
      const wall = this.castWorld(b.p, d, step)
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
        best = s; who = t; zone = hy >= DATA.zones.head ? 'head' : hy <= DATA.zones.limb ? 'limb' : 'body'
      }
      if (who) {
        const keep = Math.max(g.floor, Math.exp(-2 * g.drag * (b.gone + best)))
        who.hit(g.damage * (zone === 'head' ? g.head : zone === 'limb' ? g.limb : 1) * keep, zone, g.id, d)
        this.stats.hits++
      }
      if (who || wall !== null || b.gone + step > g.range) { this.bullets.splice(i, 1); continue }
      b.p.addScaledVector(d, step)
      b.gone += step
      b.v.multiplyScalar(Math.exp(-g.drag * step))
      b.v.y -= G * dt
    }
  }

  // ------------------------------------------------------------------------------------------------ the katana
  private slash(heavy: boolean): void {
    if (!this.active || this.current !== 'katana' || !this.hero.has('cut1')) return
    const now = tickNow(), B = this.blade
    if (now < this.busyUntil && !this.cut) return
    const c = this.cut
    if (c) {
      const t = now - c.start
      // (only out of a cut's recovery — and a heavy cut ends the run)
      if (t < c.spec.windup + c.spec.edge || c.spec.id === 'heavy') return
    }
    const idx = heavy ? 3 : c && now - c.start <= c.spec.windup + c.spec.edge + c.spec.recover + B.comboTicks ? (this.combo + 1) % 3 : 0
    const spec = B.cuts[idx]
    if (!this.hero.strike(CUT_CLIP[spec.id], { force: true })) return
    if (!heavy) this.combo = idx
    this.cut = { spec, start: now, hit: new Set(), idx, fx: false }
    this.busyUntil = now + spec.windup + spec.edge
    this.stats.cuts++
  }
  private wake(): void {
    const now = tickNow()
    if (this.current !== 'katana' || !this.katana) return
    if (now < this.restUntil) { this.host.toast(`${this.blade.types[this.katana].name.split(' — ')[0]} rests ${Math.ceil((this.restUntil - now) * TICK)} s more`); return }
    const t = this.blade.types[this.katana]
    this.awakeUntil = now + t.awakeTicks
    this.restUntil = now + t.restTicks
    this.hero.strike('katana_wake', { force: true })
  }
  /** The cut's edge: whoever is in its arc and its reach, once. Awake: the fire's burning, the thunder's arc; the heavy
   *  cut's wave of fire / bolt. */
  private edge(now: number): void {
    const c = this.cut
    if (!c) return
    const t = now - c.start, s = c.spec
    if (t >= s.windup + s.edge + s.recover + this.blade.comboTicks) { this.cut = null; this.combo = 0; return }
    if (t < s.windup || t >= s.windup + s.edge) return
    const h = this.hero, fx = -Math.sin(h.heading), fz = -Math.cos(h.heading), awake = this.awake, type = this.katana ? this.blade.types[this.katana] : null
    const cosHalf = Math.cos((s.arc * Math.PI) / 360)
    let first: Target | null = null
    const all = this.host.targets()
    for (const tg of all) {
      if (!tg.alive() || c.hit.has(tg.id)) continue
      const dx = tg.pos.x - h.pos.x, dz = tg.pos.z - h.pos.z, d = Math.hypot(dx, dz)
      if (d > s.reach || Math.abs(tg.pos.y - h.pos.y) > 1.6 || (d > 0.3 && (dx * fx + dz * fz) / d < cosHalf)) continue
      c.hit.add(tg.id)
      first ??= tg
      this.stats.cutHits++
      tg.hit(s.damage * (s.head ? this.blade.head : 1), s.head ? 'head' : 'body', 'katana', this.v.set(dx, 0, dz).normalize())
      if (awake && type?.burn) this.burning.set(tg.id, { t: tg, until: now + type.burn.forTicks, next: now + type.burn.everyTicks })
      if (awake && type?.arc) {
        tg.stun?.(type.arc.stunTicks * TICK)
        for (const o of all) if (o !== tg && o.alive() && o.pos.distanceTo(tg.pos) < type.arc.radius) o.hit(type.arc.damage, 'body', 'thunder', this.v.copy(o.pos).sub(tg.pos).normalize())
      }
    }
    if (awake && s.id === 'heavy' && !c.fx && type) {
      c.fx = true
      if (type.wave) this.wave = { p: h.pos.clone(), d: new GFX.Vector3(fx, 0, fz), gone: 0, hit: new Set(c.hit) }
      if (type.bolt) this.bolts.push({ at: first ? first.pos.clone() : h.pos.clone().add(new GFX.Vector3(fx * type.bolt.ahead, 0, fz * type.bolt.ahead)), tick: now + type.bolt.delayTicks })
    }
  }
  private effects(now: number, dt: number): void {
    const type = this.katana ? this.blade.types[this.katana] : null
    // the burning: its damage every so many ticks
    for (const [id, b] of this.burning) {
      if (now >= b.until || !b.t.alive()) { this.burning.delete(id); continue }
      if (now >= b.next && type?.burn) { b.next = now + type.burn.everyTicks; b.t.hit(type.burn.damage, 'body', 'fire', this.v.set(0, 0, 0)) }
    }
    // the wave of fire along the ground
    const w = this.wave
    if (w && type?.wave) {
      const step = type.wave.speed * dt
      w.p.addScaledVector(w.d, step)
      w.gone += step
      for (const t of this.host.targets()) {
        if (!t.alive() || w.hit.has(t.id)) continue
        const dx = t.pos.x - w.p.x, dz = t.pos.z - w.p.z
        if (Math.abs(dx * w.d.x + dz * w.d.z) < 1 && Math.abs(dx * w.d.z - dz * w.d.x) < type.wave.width / 2) {
          w.hit.add(t.id)
          t.hit(type.wave.damage, 'body', 'fire', w.d)
          if (type.burn) this.burning.set(t.id, { t, until: now + type.burn.forTicks, next: now + type.burn.everyTicks })
        }
      }
      this.spark(w.p.x, this.map.height(w.p.x, w.p.z) + 0.5, w.p.z, type.wave.width, 1.0, 0.5, '#ff7a1a', 120)
      if (w.gone >= type.wave.length) this.wave = null
    }
    // the bolts called down
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]
      if (now < b.tick || !type?.bolt) continue
      this.bolts.splice(i, 1)
      for (const t of this.host.targets()) if (t.alive() && t.pos.distanceTo(b.at) < type.bolt.radius) { t.hit(type.bolt.damage, 'body', 'thunder', this.v.set(0, -1, 0)); t.stun?.(type.bolt.stunTicks * TICK) }
      this.spark(b.at.x, b.at.y + 20, b.at.z, 0.5, 40, 0.5, '#cfe6ff', 140)
      this.spark(b.at.x, b.at.y + 0.6, b.at.z, 3, 1.2, 3, '#9fd0ff', 110)
    }
  }
  /** A glowing box for a moment (the fire's front, the bolt, its flash on the ground). */
  private spark(x: number, y: number, z: number, sx: number, sy: number, sz: number, hex: string, ms: number): void {
    const m = new GFX.Mesh(this.flash.geometry, glowMat(hex, 1.4))
    m.frustumCulled = false; m.matrixAutoUpdate = false; m.renderOrder = 4
    m.matrix.compose(new GFX.Vector3(x, y, z), new GFX.Quaternion(), new GFX.Vector3(sx, sy, sz)); m.matrixWorld.copy(m.matrix)
    this.group.add(m)
    this.fx.push({ mesh: m, until: performance.now() + ms })
  }

  // ------------------------------------------------------------------------------------------------ each frame
  /** After the character's own update: the trigger, the bullets, the cut's edge; the weapon put in his hands. */
  private idle = false
  update(dt: number): void {
    // (nothing in the hands, nothing in the air: nothing to do — after one pass that puts the character back as he was)
    const quiet = !this.current && !this.bullets.length && !this.fx.length && !this.burning.size && !this.wave && !this.bolts.length
    if (quiet && this.idle) { this.drawPads(); return }
    this.idle = quiet
    const now = tickNow(), h = this.hero, g = this.gun, active = this.active
    if (this.host.playing()) {
      if (active && g) {
        if (this.reloading && now >= this.busyUntil) { const a = this.ammo[g.id], n = Math.min(g.magazine - a[0], a[1]); a[0] += n; a[1] -= n; this.reloading = false; this.store() }
        if (this.trigger && now >= this.nextFire && now >= this.busyUntil) { this.fire(g, now); if (!g.auto) this.trigger = false }
      }
      this.fly(dt)
      if (active && this.current === 'katana') this.edge(now)
      this.effects(now, dt)
    }
    this.recoil = Math.max(0, this.recoil - dt * 9)
    // what the character must do with it
    h.handIK = null
    h.aimYaw = null
    h.aimPitch = 0
    h.holdPose = null
    h.paceK = 1
    for (const m of this.models.values()) { m.mesh.visible = false; if (m.glow) m.glow.visible = false }
    const shown = !!this.current && this.host.onFoot() && h.visible && !h.isDown
    const cd = this.camera.getWorldDirection(this.v2)
    if (shown && g) {
      // (where the camera looks — in play only: a free camera, a menu leave him as he stood)
      if (this.host.playing()) { this.aimP = Math.asin(Math.max(-0.9, Math.min(0.9, cd.y))); this.aimY = Math.atan2(-cd.x, -cd.z) }
      const pitch = this.aimP
      h.aimYaw = this.aimY
      h.aimPitch = pitch * 0.6
      h.holdPose = 'grip'
      h.paceK = (g.pace ?? 1) * (this.scoped && g.scope ? g.scope.pace : 1)
      this.placeGun(g, pitch, now)
    } else if (shown && this.current === 'katana') {
      h.stance = 'katana_idle'
      h.holdPose = 'grip'
      this.placeSword(now)
    }
    if (this.current !== 'katana' && h.stance === 'katana_idle') h.stance = null
    // the tracers, the flashes
    let k = 0
    for (const b of this.bullets) {
      if (!b.tracer || k >= this.tracers.length) continue
      const t = this.tracers[k++], len = Math.min(b.gone, 14)
      this.v.copy(b.v).normalize()
      t.matrix.compose(this.s3.copy(b.p).addScaledVector(this.v, -len / 2), this.q.setFromUnitVectors(this.fwd, this.v), this.off3.set(0.025, 0.025, Math.max(0.5, len)))
      t.matrixWorld.copy(t.matrix)
      t.visible = true
    }
    for (; k < this.tracers.length; k++) this.tracers[k].visible = false
    const t = performance.now()
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]
      if (t < f.until) { f.mesh.visible = true; continue }
      if (f.mesh === this.flash) f.mesh.visible = false; else f.mesh.removeFromParent()
      this.fx.splice(i, 1)
    }
    if (this.fx.every((f) => f.mesh !== this.flash)) this.flash.visible = false
    this.drawHud(now, active)
    this.drawPads()
  }

  /** The gun before his chest, tipped to where he aims; his wrists onto its grip and its fore-end (reloading: the left
   *  hand down to the belt and back); the kick of a shot; the flash at its muzzle. */
  private placeGun(g: GunSpec, pitch: number, now: number): void {
    const h = this.hero, rifle = g.hold === 'rifle', model = this.models.get(modelKey(g.id, null))
    const draw = Math.max(0, Math.min(1, 1 - (this.busyUntil - now) / Math.max(1, g.drawTicks)))
    const rl = this.reloading ? (now - this.reloadFrom) / g.reloadTicks : -1
    // (lowered while it's drawn or reloaded; up at the eye's line otherwise)
    const low = this.reloading ? Math.sin(Math.PI * Math.min(1, rl)) * 0.5 : !this.reloading && now < this.busyUntil ? 1 - draw : 0
    const off = rifle ? this.off3.set(0.13, -0.11 - low * 0.12, g.id === 'sniper' ? -0.16 : -0.22) : this.off3.set(0.07, -0.02 - low * 0.14, -0.46 + low * 0.14)
    off.z += this.recoil * (rifle ? 0.035 : 0.05)
    const root = this.m.makeRotationY(h.heading).setPosition(h.pos.x, h.pos.y, h.pos.z)
    const tip = pitch - low * 0.7 + this.recoil * (rifle ? 0.03 : 0.12)
    this.gunM.copy(root).multiply(this.m2.makeTranslation(0, 1.47, -0.03)).multiply(this.m2.makeRotationX(tip)).multiply(this.m2.makeTranslation(off.x, off.y, off.z))
    if (this.reloading && rifle) this.gunM.multiply(this.m2.makeRotationZ(-0.35 * Math.sin(Math.PI * Math.min(1, rl))))
    const P = PTS[g.id]
    this.wr.set(0, -0.045, 0.07).applyMatrix4(this.gunM)
    // (the left hand: under the pistol's butt / on the fore-end — reloading, down to the belt for the magazine and back)
    this.wl.set(P.left[0] - (rifle ? 0 : 0.03), P.left[1] - 0.03, P.left[2] + (rifle ? 0 : 0.05)).applyMatrix4(this.gunM)
    if (this.reloading) {
      const belt = this.v.set(-0.2, 0.98, -0.12).applyMatrix4(root), kk = rl < 0.3 ? rl / 0.3 : rl < 0.5 ? 1 : rl < 0.8 ? 1 - (rl - 0.5) / 0.3 : 0
      this.wl.lerp(belt, kk * kk * (3 - 2 * kk))
    }
    this.wrists[0] = this.wl; this.wrists[1] = this.wr
    h.handIK = this.ikOut
    if (model) {
      const hide = this.scoped
      model.mesh.visible = !hide
      model.mesh.matrix.copy(this.gunM); model.mesh.matrixWorld.copy(this.gunM)
    }
    if (this.flash.visible || this.fx.some((f) => f.mesh === this.flash)) {
      const mz = this.muzzle(this.v), s = rifle ? 0.16 : 0.1
      this.flash.matrix.compose(mz, this.q.setFromRotationMatrix(this.gunM), this.s3.set(s, s, s * 2.2)); this.flash.matrixWorld.copy(this.flash.matrix)
    }
  }
  /** The katana in his right fist — fixed to the hand's bone as the clips turn it (fight.py's `blade`) — and his left
   *  hand under it on the grip; the glow's shell when the blade is awake. */
  private placeSword(now: number): void {
    const h = this.hero, key = modelKey('katana', this.katana), model = this.models.get(key)
    if (!h.boneWorld('RightHand', this.sword)) return
    // (the sword's place in the hand: its bind pose's turn undone, the sword stood as fight.py's SWORD_REST has it —
    //  a quarter turn about the way it points — at the palm's middle)
    const bind = h.handBind[1], e = bind.elements
    const grip = this.v.set(e[12] + 0.085, e[13] - 0.025, e[14])
    this.swordFix.copy(bind).invert().multiply(this.m2.makeRotationZ(Math.PI / 2).setPosition(grip.x, grip.y, grip.z))
    this.sword.multiply(this.swordFix)
    const L = PTS[key]?.left ?? [0, 0, 0.085]
    this.wl.set(L[0], L[1], L[2] + 0.04).applyMatrix4(this.sword)
    this.wrists[0] = this.wl; this.wrists[1] = null
    h.handIK = this.ikOut
    if (!model) return
    model.mesh.visible = true
    model.mesh.matrix.copy(this.sword); model.mesh.matrixWorld.copy(this.sword)
    if (model.glow) {
      const on = now < this.awakeUntil
      model.glow.visible = on
      if (on) {
        model.glow.matrix.copy(this.sword); model.glow.matrixWorld.copy(this.sword)
        ;(model.glow.material as GFX.ShaderMaterial).uniforms.uK.value = 0.55 + 0.25 * Math.sin(performance.now() / 60) + (this.katana === 'thunder' && Math.random() < 0.12 ? 0.8 : 0)
      }
    }
  }

  private hudText = ''
  private aimP = 0
  private aimY = 0
  private drawHud(now: number, active: boolean): void {
    const g = this.gun
    const show = active ? 'block' : 'none'
    if (this.hud.style.display !== show) this.hud.style.display = show
    const cross = active && g && !this.scoped ? 'block' : 'none'
    if (this.cross.style.display !== cross) this.cross.style.display = cross
    const glass = active && this.scoped ? 'block' : 'none'
    if (this.glass.style.display !== glass) this.glass.style.display = glass
    if (!active) return
    let text = ''
    if (g) { const a = this.ammo[g.id] ?? [0, 0]; text = `${g.name}<br><span style="font-size:26px">${this.reloading ? 'RELOAD' : a[0]}</span> / ${a[1]}` }
    else if (this.current === 'katana' && this.katana) {
      const nm = this.blade.types[this.katana].name.split(' — ')[0]
      const st = now < this.awakeUntil ? `AWAKE ${Math.ceil((this.awakeUntil - now) * TICK)} s` : now < this.restUntil ? `RESTS ${Math.ceil((this.restUntil - now) * TICK)} s` : 'I · WAKE'
      text = `${nm}<br><span style="color:${this.blade.types[this.katana].glow}">${st}</span>`
    }
    if (text !== this.hudText) { this.hudText = text; this.hud.innerHTML = text }
  }

  dispose(): void {
    for (const f of this.off) f()
    this.group.removeFromParent()
    this.hero.handIK = null; this.hero.aimYaw = null; this.hero.aimPitch = 0; this.hero.holdPose = null; this.hero.paceK = 1
    this.cross.remove(); this.hud.remove(); this.glass.remove()
    for (const b of this.pads) b.remove()
  }
}

/** A place a weapon lies (a ruin), what lies there, whether you've seen it, when it gives rounds again. */
export interface PickupSite { id: string; weapon: WeaponId; katana?: KatanaType; x: number; y: number; z: number; place: string; seen: boolean; readyAt: number }
export interface PickupHost {
  onFoot(): boolean
  pos(): GFX.Vector3
  toast(m: string, ms?: number): void
  /** The top of what's solid at (x, z) (the land, a ruin's floor). */
  surface(x: number, z: number): number
}
/** What lies where: nearest the start a pistol, then by turns — the rarer the further out. */
const LAID: [WeaponId, KatanaType?][] = [['pistol'], ['ak47'], ['katana', 'fire'], ['pistol'], ['sniper'], ['katana', 'thunder'], ['ak47'], ['pistol'], ['sniper'], ['ak47']]
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
      const [weapon, katana] = LAID[i], id = `${world}:${l.id}`
      // (a few steps off its middle: clear of a tower's own walls)
      this.sites.push({ id, weapon, katana, x: l.x + 3.2, y: NaN, z: l.z + 2.4, place: l.name, seen: seen.includes(id), readyAt: 0 })
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
  marks(): { x: number; z: number; name: string; colour: string; heading: number; site: boolean }[] {
    return this.sites.map((s) => ({ site: true, x: s.x, z: s.z, name: weaponName(s.weapon, s.katana ?? null).split(' — ')[0], colour: s.weapon === 'katana' ? (s.katana === 'thunder' ? '#9fd0ff' : '#ff7a1a') : '#e0a040', heading: 0 }))
  }

  private inReach(): PickupSite | null {
    const s = this.near, p = this.host.pos()
    return s && this.host.onFoot() && Math.hypot(s.x - p.x, s.z - p.z) < 2.6 && Math.abs(s.y - p.y) < 3 ? s : null
  }
  private take(): void {
    const s = this.inReach()
    if (!s) return
    const had = this.arsenal.owned.has(s.weapon) && (s.weapon !== 'katana' || this.arsenal.katana === s.katana)
    if (had && performance.now() < s.readyAt) { this.host.toast(`Nothing more here yet — ${Math.ceil((s.readyAt - performance.now()) / 60000)} min`); return }
    this.arsenal.give(s.weapon, s.katana)
    this.arsenal.equip(s.weapon)
    s.readyAt = performance.now() + 5 * 60000
    this.host.toast(had ? `${weaponName(s.weapon, s.katana ?? null).split(' — ')[0]}: rounds taken` : `${weaponName(s.weapon, s.katana ?? null)} — yours (Q › weapons)`, 3500)
  }

  private scanT = 0
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
    const key = modelKey(best.weapon, best.katana ?? null)
    const m = this.models.get(key)
    if (!m && !this.asked.has(key)) { this.asked.add(key); void weaponModel(key, this.mat).then((mm) => { this.models.set(key, mm); this.group.add(mm.mesh) }) }
    this.turn += dt * 1.4
    const y = best.y + 1.05 + Math.sin(this.turn * 1.3) * 0.05
    if (m?.mesh) {
      // (stood on its butt / its point up, turning)
      const q = this.q.setFromEuler(this.e.set(best.weapon === 'katana' ? Math.PI / 2 : 0.25, this.turn, 0, 'YXZ'))
      m.mesh.matrix.compose(this.p3.set(best.x, y, best.z), q, this.s3.set(1.6, 1.6, 1.6)); m.mesh.matrixWorld.copy(m.mesh.matrix)
      m.mesh.visible = true
    }
    this.beam.matrix.compose(this.p3.set(best.x, best.y + 6, best.z), this.q.set(0, 0, 0, 1), this.s3.set(0.16, 12, 0.16)); this.beam.matrixWorld.copy(this.beam.matrix)
    this.beam.visible = true
    const r = this.inReach(), txt = r ? `E · TAKE THE ${weaponName(r.weapon, r.katana ?? null).split(' — ')[0]}` : ''
    if (this.prompt.textContent !== txt) this.prompt.textContent = txt
    const disp = r ? 'block' : 'none'
    if (this.prompt.style.display !== disp) this.prompt.style.display = disp
  }

  dispose(): void { this.off(); this.group.removeFromParent(); this.prompt.remove() }
}
