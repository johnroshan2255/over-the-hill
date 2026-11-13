import * as GFX from './gfx'
import { ATMOS_GLSL, FRAG_OUT, type Atmosphere } from './Atmosphere'
import type { MapData } from './MapData'
import type { Tier } from './quality'

/**
 * GROUND MIST (2026-11-13 — the user's painted frames: wisps of mist lying in the valley's hollows, lit gold by a low
 * sun; "no real fog, a fog-like filter"): soft translucent CARDS standing in the low ground round the camera (40 … 300 m
 * out), each turned about the vertical to face it, its shape torn into wisps by the paint noise drifting with the wind,
 * faded out at its foot (no hard line where it meets a slope) and near the lens. Coloured as the HAZE is in its
 * direction (Atmosphere fogColorK — gold toward the sun), so they read as the air thickening, not as sprites.
 * Strongest at dawn and dusk and after rain, faint at noon, a dim grey-blue at night. One instanced draw; re-placed as
 * the camera moves 40 m (CPU: ~150 height reads). ULTRA / HIGH 36 cards, MEDIUM 22, LOW and the phones 10. ?mist=0: none.
 */
export class Mist {
  readonly mesh: GFX.Mesh
  private readonly attr: GFX.InstancedBufferAttribute
  private readonly mat: GFX.ShaderMaterial
  private readonly n: number
  private readonly last = new GFX.Vector3(1e9, 0, 1e9)

  constructor(private readonly map: MapData, private readonly atmos: Atmosphere, tier: Tier) {
    this.n = tier.weakGpu || tier.name === 'low' ? 10 : tier.name === 'medium' ? 22 : 36
    const g = new GFX.InstancedBufferGeometry()
    g.setAttribute('position', new GFX.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3))
    g.setIndex([0, 1, 2, 0, 2, 3])
    this.attr = new GFX.InstancedBufferAttribute(new Float32Array(this.n * 4), 4).setUsage(GFX.DynamicDrawUsage)
    g.setAttribute('aC', this.attr)
    g.instanceCount = this.n
    this.mat = new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3,
      uniforms: { ...atmos.uniforms, uK: { value: 0 } },
      vertexShader: /* glsl */ `
        ${ATMOS_GLSL}
        in vec4 aC;
        out vec2 vUv;
        out float vA;
        out vec3 vDir;
        out float vSeed;
        void main() {
          // (a card ~70 … 120 m wide, 9 … 15 m tall, its foot at the ground: turned about y toward the camera)
          float W = 35.0 + aC.w * 25.0, Hh = 9.0 + aC.w * 6.0;
          vec3 toCam = uCamPos - aC.xyz;
          vec3 side = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-4, 0.0, 0.0));
          vec3 p = aC.xyz + side * position.x * W + vec3(0.0, position.y * Hh, 0.0);
          vUv = position.xy;
          float d = length(toCam.xz);
          vA = smoothstep(35.0, 80.0, d) * (1.0 - smoothstep(240.0, 320.0, d));
          vDir = normalize(p - uCamPos);
          vSeed = aC.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${FRAG_OUT}
        ${ATMOS_GLSL}
        uniform float uK;
        in vec2 vUv;
        in float vA;
        in vec3 vDir;
        in float vSeed;
        void main() {
          // soft across, faded at the foot and up to its top; torn into wisps by two layers of the noise drifting with
          // the wind (in the card's own plane: slow)
          float across = 1.0 - vUv.x * vUv.x;
          float up = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
          vec2 q = vec2(vUv.x * 2.2 + vSeed * 7.0, vUv.y * 0.9) + uWind * uTime * 0.004;
          float n = texture(uNoise, q * 0.35).g * 0.65 + texture(uNoise, q * 0.9 + 0.37).r * 0.35;
          float a = across * across * up * smoothstep(0.32, 0.75, n) * vA * uK;
          gl_FragColor = vec4(mix(fogColorK(vDir, 0.0), uFogColor, 0.35) * 1.05, a); // (a little paler than the haze toward the sun: mist, not a glow)
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    })
    this.mesh = new GFX.Mesh(g, this.mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 700
  }

  update(camera: GFX.Camera): void {
    const u = this.atmos.uniforms, s = u.uSunDir.value.y, night = u.uNight.value
    // (dawn and dusk most — the sun under ~25° — a third of it at noon; after rain more; a little by moonlight)
    const low = 1 - GFX.MathUtils.smoothstep(s, 0.12, 0.42)
    const k = (0.3 + 0.7 * low) * (1 - 0.55 * night) * (1 + 0.6 * u.uWet.value) * (1 - GFX.MathUtils.smoothstep(u.uMist.value, 0.05, 0.4)) * (1 - u.uDust.value)
    this.mat.uniforms.uK.value = Math.min(0.55, 0.42 * k)
    this.mesh.visible = k > 0.02
    const c = camera.position
    if (!this.mesh.visible || c.distanceToSquared(this.last) < 1600) return
    this.last.copy(c)
    this.place(c)
  }

  /** Re-place the cards: in the low ground of a ring round the camera — a point lower than the land 60 m round it. */
  private place(c: GFX.Vector3): void {
    const a = this.attr.array as Float32Array, H = (x: number, z: number) => this.map.height(x, z)
    let n = 0
    const cx = Math.round(c.x / 40), cz = Math.round(c.z / 40)
    for (let t = 0; t < 160 && n < this.n; t++) {
      const h = Math.sin((cx * 73.13 + cz * 19.71 + t * 7.37) * 12.9898) * 43758.5453
      const r1 = h - Math.floor(h), r2 = (h * 7.13) % 1, r3 = Math.abs((h * 3.71) % 1)
      const ang = r1 * 6.283, d = 55 + Math.abs(r2) * 240
      const x = c.x + Math.cos(ang) * d, z = c.z + Math.sin(ang) * d, y = H(x, z)
      const around = (H(x + 60, z) + H(x - 60, z) + H(x, z + 60) + H(x, z - 60)) / 4
      if (y > around - 1.5 && r3 > 0.2) continue // (a hollow — or now and then anywhere: a little over the open land)
      if (this.map.lakeShore(x, z, y, 4)) continue // (never on a lake: it lay on the water as a glowing smear)
      a[n * 4] = x; a[n * 4 + 1] = y - 1.5; a[n * 4 + 2] = z; a[n * 4 + 3] = r3
      n++
    }
    for (let i = n; i < this.n; i++) { a[i * 4] = 1e6; a[i * 4 + 1] = -1e4; a[i * 4 + 2] = 1e6; a[i * 4 + 3] = 0 }
    this.attr.needsUpdate = true
  }
}
