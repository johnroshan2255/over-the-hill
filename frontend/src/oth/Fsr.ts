import * as GFX from './gfx'
import { FRAG_OUT } from './Atmosphere'

/**
 * FSR 1 — AMD FidelityFX Super Resolution 1.0 (MIT licence; docs/ASSETS.md), the user's ask 2026-11-08: the world drawn
 * into a SMALLER target (`scale` of the canvas each way: 0.77 Quality, 0.67 Balanced, 0.5 Performance — its own MSAA,
 * already tone-mapped and sRGB, as the canvas would get it), then
 *   EASU — the edge-adaptive spatial upsampler: 12 texels round each output pixel, the local edge's direction and
 *          length from their luma, a Lanczos-like lobe stretched along the edge, clamped to the 2 × 2's range (no ring)
 *   RCAS — robust contrast-adaptive sharpening of that, at the canvas's size (`sharp` in stops: 0 the most, AMD's 0.2)
 * to the canvas. Pixels drawn fall to scale² (0.59 / 0.45 / 0.25): a GPU-bound device gains; a CPU-bound one (this
 * project's PC) adds two full-screen passes. The HUD is HTML: always sharp. `?fsr=0.67` / the Upscaling setting.
 */
export class Fsr {
  private low: GFX.WebGLRenderTarget | null = null
  private mid: GFX.WebGLRenderTarget | null = null
  private readonly sceneE = new GFX.Scene()
  private readonly sceneR = new GFX.Scene()
  private readonly cam = new GFX.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly easu: GFX.ShaderMaterial
  private readonly rcas: GFX.ShaderMaterial

  constructor(private readonly renderer: GFX.WebGLRenderer, public scale: number, sharp = 0.2) {
    const tri = new GFX.BufferGeometry()
    tri.setAttribute('position', new GFX.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    const mk = (frag: string, u: Record<string, GFX.IUniform>) => new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3, uniforms: u, vertexShader: VERT, fragmentShader: frag,
      depthTest: false, depthWrite: false, side: GFX.DoubleSide, // (clip space written directly: never culled — Grass.ts's field)
    })
    this.easu = mk(EASU, { uSrc: { value: null }, uIn: { value: new GFX.Vector2(1, 1) }, uOut: { value: new GFX.Vector2(1, 1) } })
    // (WEBGPU: a clip-space triangle drawn into a bottom-origin target isn't flipped as the scene is — the middle image
    //  lands upside down there; RCAS reads it flipped back)
    this.rcas = mk(RCAS, { uSrc: { value: null }, uOut: { value: new GFX.Vector2(1, 1) }, uSharp: { value: Math.pow(2, -sharp) }, uFlip: { value: renderer.backend === 'webgpu' ? 1 : 0 } })
    // (a mesh and a scene each: the gfx layer keeps a mesh's vertex layout for its material — one swapped between the
    //  passes drew the second with the first's on WebGPU)
    for (const [m, sc] of [[this.easu, this.sceneE], [this.rcas, this.sceneR]] as const) {
      const geo = new GFX.BufferGeometry()
      geo.setAttribute('position', tri.getAttribute('position'))
      const mesh = new GFX.Mesh(geo, m)
      mesh.frustumCulled = false
      sc.add(mesh)
    }
  }

  /** Before the frame: the low target sized to the canvas × scale, the world drawn into it (Renderer.mainTarget). */
  begin(): void {
    const c = this.renderer.domElement, W = c.width, H = c.height
    const w = Math.max(1, Math.round(W * this.scale)), h = Math.max(1, Math.round(H * this.scale))
    if (!this.low || this.low.width !== w || this.low.height !== h) {
      this.low?.dispose()
      this.low = new GFX.WebGLRenderTarget(w, h, { samples: this.renderer.samples, depthBuffer: true })
    }
    if (!this.mid || this.mid.width !== W || this.mid.height !== H) {
      this.mid?.dispose()
      this.mid = new GFX.WebGLRenderTarget(W, H, { depthBuffer: false })
    }
    this.renderer.mainTarget = this.low
  }

  /** After the world is drawn: EASU into the middle target, RCAS to the canvas. */
  end(): void {
    if (!this.low || !this.mid) return
    const r = this.renderer, auto = r.autoClear
    ;(this.easu.uniforms.uSrc.value as unknown) = this.low.texture
    ;(this.easu.uniforms.uIn.value as GFX.Vector2).set(this.low.width, this.low.height)
    ;(this.easu.uniforms.uOut.value as GFX.Vector2).set(this.mid.width, this.mid.height)
    ;(this.rcas.uniforms.uSrc.value as unknown) = this.mid.texture
    ;(this.rcas.uniforms.uOut.value as GFX.Vector2).set(this.mid.width, this.mid.height)
    r.autoClear = false
    r.setRenderTarget(this.mid)
    r.render(this.sceneE, this.cam)
    r.setRenderTarget(null)
    r.render(this.sceneR, this.cam)
    r.autoClear = auto
  }

  dispose(): void {
    this.renderer.mainTarget = null
    this.low?.dispose(); this.mid?.dispose()
    this.low = this.mid = null
  }
}

const VERT = /* glsl */ `
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

// EASU (ffx_fsr1.h FsrEasuF, ported to GLSL): the output pixel's position in the input, its 12-texel neighbourhood
//      b c
//    e f g h
//    i j k l
//      n o
// the edge's direction and length from the luma of the four 2 × 2 corners (bilinearly weighted), a lobe stretched
// along it, the result clamped to f g j k's range
const EASU = /* glsl */ `
${FRAG_OUT}
uniform sampler2D uSrc;
uniform vec2 uIn;
uniform vec2 uOut;
in vec2 vUv;
vec3 tapE(vec2 fp, vec2 o) { return textureLod(uSrc, (fp + o + 0.5) / uIn, 0.0).rgb; }
float lumE(vec3 c) { return c.b * 0.5 + (c.r * 0.5 + c.g); }
void easuTap(inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len, float lob, float clp, vec3 c) {
  vec2 v = vec2(off.x * dir.x + off.y * dir.y, off.x * (-dir.y) + off.y * dir.x) * len;
  float d2 = min(dot(v, v), clp);
  float wB = 0.4 * d2 - 1.0, wA = lob * d2 - 1.0;
  wB *= wB; wA *= wA;
  wB = 1.5625 * wB - 0.5625;
  float w = wB * wA;
  aC += c * w; aW += w;
}
void easuSet(inout vec2 dir, inout float len, float w, float lA, float lB, float lC, float lD, float lE) {
  float dc = lD - lC, cb = lC - lB;
  float lenX = max(abs(dc), abs(cb));
  lenX = lenX > 0.0 ? 1.0 / lenX : 0.0;
  float dirX = lD - lB;
  dir.x += dirX * w;
  lenX = clamp(abs(dirX) * lenX, 0.0, 1.0); lenX *= lenX;
  len += lenX * w;
  float ec = lE - lC, ca = lC - lA;
  float lenY = max(abs(ec), abs(ca));
  lenY = lenY > 0.0 ? 1.0 / lenY : 0.0;
  float dirY = lE - lA;
  dir.y += dirY * w;
  lenY = clamp(abs(dirY) * lenY, 0.0, 1.0); lenY *= lenY;
  len += lenY * w;
}
void main() {
  vec2 pp = vUv * uIn - 0.5;
  vec2 fp = floor(pp);
  pp -= fp;
  vec3 b = tapE(fp, vec2(0.0, -1.0)), c = tapE(fp, vec2(1.0, -1.0));
  vec3 e = tapE(fp, vec2(-1.0, 0.0)), f = tapE(fp, vec2(0.0, 0.0)), g = tapE(fp, vec2(1.0, 0.0)), h = tapE(fp, vec2(2.0, 0.0));
  vec3 i = tapE(fp, vec2(-1.0, 1.0)), j = tapE(fp, vec2(0.0, 1.0)), k = tapE(fp, vec2(1.0, 1.0)), l = tapE(fp, vec2(2.0, 1.0));
  vec3 n = tapE(fp, vec2(0.0, 2.0)), o = tapE(fp, vec2(1.0, 2.0));
  float bL = lumE(b), cL = lumE(c), eL = lumE(e), fL = lumE(f), gL = lumE(g), hL = lumE(h);
  float iL = lumE(i), jL = lumE(j), kL = lumE(k), lL = lumE(l), nL = lumE(n), oL = lumE(o);
  vec2 dir = vec2(0.0);
  float len = 0.0;
  easuSet(dir, len, (1.0 - pp.x) * (1.0 - pp.y), bL, eL, fL, gL, jL);
  easuSet(dir, len, pp.x * (1.0 - pp.y), cL, fL, gL, hL, kL);
  easuSet(dir, len, (1.0 - pp.x) * pp.y, fL, iL, jL, kL, nL);
  easuSet(dir, len, pp.x * pp.y, gL, jL, kL, lL, oL);
  float dirR = dot(dir, dir);
  bool zro = dirR < 1.0 / 32768.0;
  dirR = zro ? 1.0 : inversesqrt(dirR);
  dir.x = zro ? 1.0 : dir.x;
  dir *= dirR;
  len = len * 0.5; len *= len;
  float stretch = dot(dir, dir) / max(abs(dir.x), abs(dir.y));
  vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
  float lob = 0.5 + ((1.0 / 4.0 - 0.04) - 0.5) * len;
  float clp = 1.0 / lob;
  vec3 mn = min(min(f, g), min(j, k)), mx = max(max(f, g), max(j, k));
  vec3 aC = vec3(0.0);
  float aW = 0.0;
  easuTap(aC, aW, vec2(0.0, -1.0) - pp, dir, len2, lob, clp, b);
  easuTap(aC, aW, vec2(1.0, -1.0) - pp, dir, len2, lob, clp, c);
  easuTap(aC, aW, vec2(-1.0, 1.0) - pp, dir, len2, lob, clp, i);
  easuTap(aC, aW, vec2(0.0, 1.0) - pp, dir, len2, lob, clp, j);
  easuTap(aC, aW, vec2(0.0, 0.0) - pp, dir, len2, lob, clp, f);
  easuTap(aC, aW, vec2(-1.0, 0.0) - pp, dir, len2, lob, clp, e);
  easuTap(aC, aW, vec2(1.0, 1.0) - pp, dir, len2, lob, clp, k);
  easuTap(aC, aW, vec2(2.0, 1.0) - pp, dir, len2, lob, clp, l);
  easuTap(aC, aW, vec2(2.0, 0.0) - pp, dir, len2, lob, clp, h);
  easuTap(aC, aW, vec2(1.0, 0.0) - pp, dir, len2, lob, clp, g);
  easuTap(aC, aW, vec2(1.0, 2.0) - pp, dir, len2, lob, clp, o);
  easuTap(aC, aW, vec2(0.0, 2.0) - pp, dir, len2, lob, clp, n);
  gl_FragColor = vec4(min(mx, max(mn, aC / aW)), 1.0);
}
`

// RCAS (ffx_fsr1.h FsrRcasF): a 5-tap cross; the sharpening lobe the most that keeps the result within the neighbours'
// range (no clipping, no halo), eased off where it looks like noise; uSharp = 2^−stops
const RCAS = /* glsl */ `
${FRAG_OUT}
uniform sampler2D uSrc;
uniform vec2 uOut;
uniform float uSharp;
uniform float uFlip;
in vec2 vUv;
vec3 tapR(vec2 p, vec2 o) { vec2 q = (p + o) / uOut; if (uFlip > 0.5) q.y = 1.0 - q.y; return textureLod(uSrc, q, 0.0).rgb; }
float lumR(vec3 c) { return c.b * 0.5 + (c.r * 0.5 + c.g); }
void main() {
  vec2 p = floor(vUv * uOut) + 0.5;
  vec3 b = tapR(p, vec2(0.0, -1.0)), d = tapR(p, vec2(-1.0, 0.0)), e = tapR(p, vec2(0.0)), f = tapR(p, vec2(1.0, 0.0)), h = tapR(p, vec2(0.0, 1.0));
  float bL = lumR(b), dL = lumR(d), eL = lumR(e), fL = lumR(f), hL = lumR(h);
  float nz = 0.25 * (bL + dL + fL + hL) - eL;
  float rng = max(max(max(bL, dL), max(fL, hL)), eL) - min(min(min(bL, dL), min(fL, hL)), eL);
  nz = clamp(abs(nz) / max(rng, 1e-5), 0.0, 1.0);
  nz = -0.5 * nz + 1.0;
  vec3 mn4 = min(min(b, d), min(f, h)), mx4 = max(max(b, d), max(f, h));
  vec3 hitMin = min(mn4, e) / max(4.0 * mx4, vec3(1e-5));
  vec3 hitMax = (1.0 - max(mx4, e)) / min(4.0 * mn4 - 4.0, vec3(-1e-5));
  vec3 lobeRGB = max(-hitMin, hitMax);
  float lobe = max(-0.1875, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * uSharp;
  lobe *= nz;
  vec3 c = (lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0);
  gl_FragColor = vec4(c, 1.0);
}
`
