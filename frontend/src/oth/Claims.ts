import * as GFX from './gfx'
import type RAPIER from '@dimforge/rapier3d-compat'
import { ATMOS_GLSL, FRAG_OUT, type Atmosphere } from './Atmosphere'
import { Builder, woodMaterial } from './Bridges'
import { GroundRing, linearOf } from './GroundRing'
import type { Horizon } from './Horizon'
import { type Ground, type RGB, rock, shade, V } from './Kit'
import type { MapData } from './MapData'
import type { OthPhysics } from './Physics'
import type { Tier } from './quality'
import { SHADOW_GLSL, type TerrainShadow } from './TerrainShadow'
import { group, Groups } from '../physics/PhysicsWorld'
import { colourOf, type Session } from '../net/Session'
import type { Claim } from '../net/wire'

/**
 * THE LAND PLAYERS HAVE MADE THEIR OWN (docs/MULTIPLAYER.md §2 — the user: "mark a territory … mark a flag there"):
 * every claim in the session drawn where it is —
 *  - THE FLAG at its centre: a stone cairn, a steel pole (6.5 m) with a brass finial, and a CLOTH in the owner's colour
 *    with a pale emblem, streaming down the wind and waving (its own shader, lit as everything is: the sun, the sky,
 *    the terrain's shadow, the haze); the pole solid (a car stops at it);
 *  - THE BOUNDS: a stake every ~9 m round the edge, each topped in the owner's colour, a rope between them sagging
 *    low; and, near it (or building), the edge as a dashed ring on the ground in their colour.
 * Walking or driving onto someone's land says whose it is (and whether it's guarded — the owner home).
 *
 * The flag's pole, cairn and stakes are one mesh a claim (the places' material — Bridges.woodMaterial), the cloth
 * one; built once when the claim comes, dropped when it goes.
 */
const POLE_H = 6.5
const CLOTH_W = 2.2, CLOTH_H = 1.4

const CLOTH_VERT = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
uniform float uSeed;
out vec3 vWorld;
out vec3 vN;
out vec2 vUv;
void main() {
  // the cloth: x 0 … W from the pole (uv.x 0 … 1), y down from the top; it waves along x, more toward the free end
  float wind = clamp(length(uWind) / 4.0, 0.25, 1.0);
  float u = uv.x;
  float ph = uTime * (4.0 + 3.0 * wind) - u * 6.5 + uv.y * 1.4 + uSeed;
  float amp = u * (0.1 + 0.16 * wind);
  vec3 p = position;
  p.z += sin(ph) * amp + sin(ph * 2.3 + 1.7) * amp * 0.25;
  p.y -= u * u * 0.22 * (1.0 - wind); // (a little droop in a light wind)
  // (the wave's slope along x → the normal)
  float dz = (cos(ph) * -6.5 * amp + sin(ph) * (0.1 + 0.16 * wind)) / ${CLOTH_W.toFixed(2)};
  vec3 n = normalize(vec3(-dz, 0.0, 1.0));
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * n);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}`
const CLOTH_FRAG = /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
uniform vec4 uFarGrid;
${SHADOW_GLSL}
uniform vec3 uColor;
uniform vec3 uEmblem;
in vec3 vWorld;
in vec3 vN;
in vec2 vUv;
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCamPos - vWorld);
  // the cloth: the owner's colour; a darker hem round the edge; the emblem — a pale ring and dot on the field
  vec2 q = (vUv - vec2(0.42, 0.5)) * vec2(${(CLOTH_W / CLOTH_H).toFixed(3)}, 1.0);
  float d = length(q);
  float ring = smoothstep(0.31, 0.29, d) * smoothstep(0.215, 0.235, d), dot_ = smoothstep(0.13, 0.11, d);
  float hem = 1.0 - smoothstep(0.0, 0.035, min(min(vUv.x, 1.0 - vUv.x) * ${(CLOTH_W / CLOTH_H).toFixed(3)}, min(vUv.y, 1.0 - vUv.y)));
  vec3 albedo = mix(uColor, uEmblem, max(ring, dot_));
  albedo *= 1.0 - 0.3 * hem;
  // (a soft weave)
  albedo *= 0.94 + 0.06 * texture(uNoise, vUv * vec2(9.0, 6.0)).r;
  float sun = sunVisibility(vWorld.xz);
  vec3 c = shade(albedo, N, V, 0.92, 0.03, 1.0, sun, 0.7);
  // (the sun through the cloth from behind: a little glow)
  c += albedo * uSunColor * sun * 0.25 * max(0.0, -dot(N, uSunDir));
  gl_FragColor = vec4(applyAtmos(c, vWorld), 1.0);
}`

interface Made {
  claim: Claim
  root: GFX.Group
  mesh: GFX.Mesh
  cloth: GFX.Mesh
  edge: GroundRing
  /** The pole's solid body — made only once no car or person of ours stands there (a pole planted inside a car threw
   *  it on its side: 2026-11-08). */
  body: RAPIER.RigidBody | null
  sphere: GFX.Sphere
}

export class Claims {
  readonly group = new GFX.Group()
  private readonly made = new Map<string, Made>()
  private readonly mat: GFX.ShaderMaterial
  private readonly clothGeo: GFX.BufferGeometry
  private readonly v = new GFX.Vector3()
  /** The claim the player is on now (its id), for the enter / leave notes. */
  private onLand: string | null = null
  /** Every edge ring shown (building: Build.ts) — else only near. */
  showEdges = false

  constructor(
    private readonly session: Session,
    private readonly map: () => MapData,
    private readonly physics: OthPhysics,
    private readonly atmos: Atmosphere,
    private readonly shadow: TerrainShadow,
    tier: Tier,
    private readonly farGrid: GFX.Vector4,
    private readonly toast: (m: string, ms?: number) => void,
  ) {
    this.mat = woodMaterial(atmos, shadow, tier, farGrid)
    // the cloth: a 24 × 12 grid hanging from the pole's top (x out from the pole, y down)
    const g = new GFX.PlaneGeometry(CLOTH_W, CLOTH_H, 24, 12)
    g.translate(CLOTH_W / 2, -CLOTH_H / 2, 0)
    this.clothGeo = g
  }

  /** The claim at (x, z), if any. */
  at(x: number, z: number): Claim | null {
    for (const c of this.session.claims.values()) if (Math.hypot(c.x - x, c.z - z) <= c.r) return c
    return null
  }

  private build(c: Claim): Made {
    const map = this.map(), colour = colourOf(c.owner), lin = linearOf(colour)
    const owner: RGB = [lin.r * 0.85, lin.g * 0.85, lin.b * 0.85]
    const y0 = map.height(c.x, c.z)
    const g: Ground = (x, z) => map.height(c.x + x, c.z + z) - y0
    const b = new Builder(hash(c.id))
    // THE CAIRN: field stones piled round the pole's foot
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + b.rnd() * 0.4, rr = k < 6 ? 0.55 : 0.25
      const s = k < 6 ? 0.28 + b.rnd() * 0.12 : 0.22 + b.rnd() * 0.08
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr
      rock(b, V(x, g(x, z) + (k < 6 ? s * 0.45 : 0.42), z), V(s, s * 0.75, s * (0.8 + b.rnd() * 0.4)), b.rnd() * 6.28, shade([0.25, 0.248, 0.245], 0.85 + b.rnd() * 0.3), hash(c.id) + k, 0)
    }
    // THE POLE: dark steel, a brass ball on top
    b.setSurf(2)
    b.log(V(0, g(0, 0) - 0.3, 0), V(0, POLE_H, 0), 0.055, [0.09, 0.09, 0.095])
    b.log(V(0, POLE_H, 0), V(0, POLE_H + 0.05, 0), 0.075, [0.09, 0.09, 0.095])
    rock(b, V(0, POLE_H + 0.16, 0), V(0.1, 0.1, 0.1), 0, [0.42, 0.3, 0.1], 7, 1, true)
    b.setSurf(2)
    // THE BOUNDS: a stake every ~9 m, its top in the owner's colour; a rope between, sagging
    const n = Math.max(8, Math.round((2 * Math.PI * c.r) / 9))
    const tops: GFX.Vector3[] = []
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, x = Math.cos(a) * c.r, z = Math.sin(a) * c.r, gy = g(x, z)
      b.setSurf(0)
      b.log(V(x, gy - 0.25, z), V(x, gy + 1.05, z), 0.045, b.wood(0.9))
      b.setSurf(4)
      b.log(V(x, gy + 0.9, z), V(x, gy + 1.08, z), 0.055, owner)
      tops.push(V(x, gy + 0.82, z))
    }
    b.setSurf(3)
    for (let k = 0; k < n; k++) {
      const p0 = tops[k], p1 = tops[(k + 1) % n], S = 4
      let prev = p0
      for (let s = 1; s <= S; s++) {
        const t = s / S, p = new GFX.Vector3().lerpVectors(p0, p1, t)
        // (the rope sags between the stakes — and never through the ground)
        const gy = g(p.x, p.z)
        p.y = Math.max(p.y - Math.sin(t * Math.PI) * 0.22, gy + 0.25)
        b.log(prev, p, 0.014, owner)
        prev = p
      }
    }
    b.setSurf(0)
    const geo = b.geometry()
    const mesh = new GFX.Mesh(geo, this.mat)
    mesh.frustumCulled = false
    const root = new GFX.Group()
    root.position.set(c.x, y0, c.z)
    root.add(mesh)
    // THE CLOTH (its own material: the owner's colour)
    const cloth = new GFX.Mesh(this.clothGeo, new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3,
      uniforms: { ...this.atmos.uniforms, ...this.shadow.uniforms, uFarGrid: { value: this.farGrid }, uColor: { value: lin.clone() }, uEmblem: { value: new GFX.Color(0.86, 0.8, 0.68) }, uSeed: { value: (hash(c.id) % 1000) / 100 } },
      vertexShader: CLOTH_VERT, fragmentShader: CLOTH_FRAG, side: GFX.DoubleSide,
    }))
    cloth.frustumCulled = false
    cloth.position.set(0, POLE_H - 0.12, 0)
    root.add(cloth)
    this.group.add(root)
    // THE EDGE on the ground (shown near)
    const edge = new GroundRing(this.map, { lift: 0.1, renderOrder: 4 })
    edge.uniforms.uColor.value.copy(lin)
    edge.uniforms.uDashes.value = Math.max(24, Math.round((2 * Math.PI * c.r) / 2.2))
    edge.uniforms.uAlpha.value = 0.75
    edge.set(c.x, c.z, c.r, 0.35)
    edge.visible = false
    this.group.add(edge.mesh)
    return { claim: c, root, mesh, cloth, edge, body: null, sphere: new GFX.Sphere(new GFX.Vector3(c.x, y0 + 2, c.z), c.r + 2) }
  }

  /** The pole made solid (a cylinder through the cairn) — once nothing of ours is in the way. */
  private solid(m: Made, blockers: GFX.Vector3[]): void {
    const c = m.claim
    for (const b of blockers) if (Math.hypot(b.x - c.x, b.z - c.z) < 3.2) return
    const pw = this.physics.pw, y0 = this.map().height(c.x, c.z)
    m.body = pw.world.createRigidBody(pw.R.RigidBodyDesc.fixed().setTranslation(c.x, y0, c.z))
    pw.world.createCollider(pw.R.ColliderDesc.cylinder(1.2, 0.45).setTranslation(0, 0.6, 0).setCollisionGroups(group(Groups.Static, 0xffff)), m.body)
  }

  private drop(m: Made): void {
    m.root.removeFromParent()
    m.mesh.geometry.dispose()
    m.edge.dispose()
    if (m.body) this.physics.pw.world.removeRigidBody(m.body)
  }

  /** Every frame: claims come and go with the session; the cloths wave; the edges near; on and off the land. */
  update(dt: number, player: GFX.Vector3, camera: GFX.Camera, mine: GFX.Vector3[]): void {
    const S = this.session
    for (const [id, m] of this.made) {
      const c = S.claims.get(id)
      if (!c || c.x !== m.claim.x || c.z !== m.claim.z || c.r !== m.claim.r) { this.drop(m); this.made.delete(id) }
    }
    for (const c of S.claims.values()) if (!this.made.has(c.id)) this.made.set(c.id, this.build(c))
    // the cloth streams down the wind
    const w = this.atmos.uniforms.uWind.value as GFX.Vector2
    const yaw = Math.atan2(-w.y, w.x)
    for (const m of this.made.values()) {
      if (!m.body) this.solid(m, mine)
      m.cloth.rotation.set(0, yaw, 0)
      const d = camera.position.distanceTo(this.v.set(m.claim.x, camera.position.y, m.claim.z))
      m.edge.visible = this.showEdges || d < m.claim.r + 60
      m.edge.uniforms.uTime.value += dt
    }
    // onto / off someone's land
    const here = this.at(player.x, player.z)
    if ((here?.id ?? null) !== this.onLand) {
      this.onLand = here?.id ?? null
      if (here) {
        const mine = here.owner === S.me.id, guarded = S.guards.get(here.id)
        this.toast(mine ? 'Your land' : `${here.owner_name}'s land${guarded ? ' · guarded — they\'re home' : ' · open — they\'re away'}`, 3000)
      }
    }
  }

  /** The land the player stands on (the HUD's chip). */
  get here(): Claim | null { return this.onLand ? this.session.claims.get(this.onLand) ?? null : null }

  cull(view: GFX.Frustum, horizon: Horizon): void {
    for (const m of this.made.values()) {
      const c = m.claim, s = m.sphere
      m.root.visible = view.intersectsSphere(s) && !horizon.hidden(c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r, s.center.y + POLE_H)
      if (!m.root.visible) m.edge.visible = false
    }
  }

  /** For the map and the minimap: every claim, its owner's colour and name, and whether it's ours. */
  get list(): { id: string; x: number; z: number; r: number; colour: string; name: string; mine: boolean; guarded: boolean }[] {
    const S = this.session, out = []
    for (const c of S.claims.values()) out.push({ id: c.id, x: c.x, z: c.z, r: c.r, colour: colourOf(c.owner), name: c.owner === S.me.id ? 'Your land' : `${c.owner_name}'s land`, mine: c.owner === S.me.id, guarded: !!S.guards.get(c.id) })
    return out
  }

  dispose(): void {
    for (const m of this.made.values()) this.drop(m)
    this.made.clear()
    this.group.removeFromParent()
  }
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
