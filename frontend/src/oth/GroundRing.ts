import * as GFX from './gfx'
import type { MapData } from './MapData'

/**
 * A RING ON THE GROUND (the build brush — Build.ts; a claim's edge — Claims.ts): Blender's brush circle laid on the
 * land — a band `w` m wide at radius r, its vertices on the ground (sampled every ~1 m round it, lifted a hand's
 * breadth), DASHED (the dashes crawl slowly round, as a selection's do), soft at its edges; an optional thin inner ring
 * (the brush's falloff, Blender's) and a faint FILL over the area it holds. One draw (two with the fill), transparent,
 * no depth written; rebuilt only when it moves or resizes.
 */
const VERT = /* glsl */ `
in float aAngle;
in float aSide;
out float vAngle;
out float vSide;
void main() {
  vAngle = aAngle;
  vSide = aSide;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`
const FRAG = /* glsl */ `
layout(location = 0) out highp vec4 outColor;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uDashes;
uniform float uTime;
uniform float uFill;
in float vAngle;
in float vSide;
void main() {
  if (uFill > 0.5) {
    // (the fill: faint, brighter toward the rim)
    outColor = vec4(uColor, uAlpha * (0.1 + 0.16 * vSide * vSide));
    return;
  }
  // (aSide: 0 … 1 across the band; 2 … 3 across the inner ring)
  float inner = step(1.5, vSide), s = vSide - 2.0 * inner;
  float edge = smoothstep(0.0, 0.12, s) * smoothstep(1.0, 0.88, s);
  float dash = uDashes > 0.0 ? step(fract(vAngle * uDashes - uTime * 0.25), 0.58) : 1.0;
  // (Blender's brush: a bright band with a dark rim each side — it reads on sand, grass and rock alike)
  float rim = 1.0 - smoothstep(0.12, 0.3, s) * smoothstep(0.88, 0.7, s);
  vec3 c = mix(uColor * 1.35, uColor * 0.18, rim);
  float a = uAlpha * edge * (inner > 0.5 ? 0.55 : max(dash, 0.18));
  if (a < 0.01) discard;
  outColor = vec4(inner > 0.5 ? uColor : mix(uColor * 0.25, c, dash), a);
}`

export class GroundRing {
  readonly mesh: GFX.Mesh
  readonly fill: GFX.Mesh | null
  readonly uniforms = { uColor: { value: new GFX.Color(1, 0.66, 0.23) }, uAlpha: { value: 0.95 }, uDashes: { value: 48 }, uTime: { value: 0 }, uFill: { value: 0 } }
  private readonly geo = new GFX.BufferGeometry()
  private readonly fillGeo = new GFX.BufferGeometry()
  private key = ''

  /** `inner`: the falloff ring at that share of the radius (0: none); `fill`: the area tinted. */
  constructor(private readonly map: () => MapData, readonly opts: { inner?: number; fill?: boolean; lift?: number; renderOrder?: number } = {}) {
    const mat = (fill: boolean) => new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3,
      uniforms: { ...this.uniforms, uFill: { value: fill ? 1 : 0 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, side: GFX.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
    })
    this.mesh = new GFX.Mesh(this.geo, mat(false))
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = opts.renderOrder ?? 4
    this.fill = opts.fill ? new GFX.Mesh(this.fillGeo, mat(true)) : null
    if (this.fill) { this.fill.frustumCulled = false; this.fill.renderOrder = (opts.renderOrder ?? 4) - 1 }
    // (the fill and the ring share the colour, alpha, dashes and clock)
    if (this.fill) {
      const u = (this.fill.material as GFX.ShaderMaterial).uniforms
      u.uColor = this.uniforms.uColor; u.uAlpha = this.uniforms.uAlpha
    }
  }

  set visible(v: boolean) { this.mesh.visible = v; if (this.fill) this.fill.visible = v }
  get visible(): boolean { return this.mesh.visible }

  /** Laid round (x, z) at radius r, its band w m wide. */
  set(x: number, z: number, r: number, w: number): void {
    const key = `${x.toFixed(2)},${z.toFixed(2)},${r.toFixed(2)},${w.toFixed(2)}`
    if (key === this.key) return
    this.key = key
    const map = this.map(), lift = this.opts.lift ?? 0.12
    const n = Math.max(48, Math.min(480, Math.round((2 * Math.PI * r) / 0.9)))
    const inner = this.opts.inner ?? 0
    const rings: [number, number, number][] = [[r - w / 2, r + w / 2, 0]]
    if (inner > 0) rings.push([r * inner - w * 0.2, r * inner + w * 0.2, 2])
    const pos: number[] = [], ang: number[] = [], side: number[] = [], idx: number[] = []
    for (const [r0, r1, s0] of rings) {
      const base = pos.length / 3
      for (let i = 0; i <= n; i++) {
        const t = i / n, a = t * Math.PI * 2, c = Math.cos(a), s = Math.sin(a)
        for (const [rr, sd] of [[r0, s0], [r1, s0 + 1]] as const) {
          const px = x + c * rr, pz = z + s * rr
          pos.push(px, map.height(px, pz) + lift, pz)
          ang.push(t); side.push(sd)
        }
      }
      for (let i = 0; i < n; i++) { const k = base + i * 2; idx.push(k, k + 1, k + 3, k, k + 3, k + 2) }
    }
    this.geo.setAttribute('position', new GFX.Float32BufferAttribute(pos, 3))
    this.geo.setAttribute('aAngle', new GFX.Float32BufferAttribute(ang, 1))
    this.geo.setAttribute('aSide', new GFX.Float32BufferAttribute(side, 1))
    this.geo.setIndex(idx)
    this.geo.computeBoundingSphere()
    if (this.fill) {
      // (a polar grid: rings every ~3 m out to the band, the ground under each point)
      const R = Math.max(2, Math.round(r / 3)), m = Math.max(24, Math.round(n / 3))
      const fp: number[] = [x, map.height(x, z) + lift * 0.8, z], fa: number[] = [0], fs: number[] = [0], fi: number[] = []
      for (let k = 1; k <= R; k++) {
        const rr = (r - w / 2) * (k / R)
        for (let i = 0; i < m; i++) {
          const a = (i / m) * Math.PI * 2, px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr
          fp.push(px, map.height(px, pz) + lift * 0.8, pz); fa.push(i / m); fs.push(k / R)
        }
      }
      for (let i = 0; i < m; i++) fi.push(0, 1 + i, 1 + ((i + 1) % m))
      for (let k = 1; k < R; k++) {
        const a0 = 1 + (k - 1) * m, a1 = 1 + k * m
        for (let i = 0; i < m; i++) { const j = (i + 1) % m; fi.push(a0 + i, a1 + i, a1 + j, a0 + i, a1 + j, a0 + j) }
      }
      this.fillGeo.setAttribute('position', new GFX.Float32BufferAttribute(fp, 3))
      this.fillGeo.setAttribute('aAngle', new GFX.Float32BufferAttribute(fa, 1))
      this.fillGeo.setAttribute('aSide', new GFX.Float32BufferAttribute(fs, 1))
      this.fillGeo.setIndex(fi)
      this.fillGeo.computeBoundingSphere()
    }
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.fill?.removeFromParent()
    this.geo.dispose()
    this.fillGeo.dispose()
  }
}

/** '#rrggbb' → a GFX colour in the linear light the shaders work in. */
export function linearOf(hex: string, out = new GFX.Color()): GFX.Color {
  const n = parseInt(hex.slice(1), 16)
  const f = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return out.setRGB(f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255))
}
