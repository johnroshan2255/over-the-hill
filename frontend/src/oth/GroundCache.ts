import * as GFX from './gfx'
import { ATMOS_GLSL } from './Atmosphere'
import { PAINT_GLSL } from './paint'
import { ROCK_RELIEF_GLSL } from './rockRelief'
import { gameParams } from '../settings'

/** Levels round the camera: the finest texel × 2^k, k = 0 … 7 (ULTRA: 3.1 cm … 4 m; the coarsest reaches ~2 km); a
 *  9th, FAR, holds the whole world (16 km in N texels: ULTRA 16 m) — baked once. */
export const GC_LEVELS = 8

/**
 * THE GROUND CACHE (2026-11-06, docs/PERF.md — the ground's paint was ~70 % of the frame: ~25 texture reads and the
 * whole of groundPaint on every pixel, every frame, for a ground that never changes). The ground's SURFACE — its
 * colour and everything else about it that doesn't depend on the light, the weather or the camera (Terrain.ts
 * SURF_GLSL: one code path for the bake and the live paint) — baked into 8 LEVELS of world-space texels round the
 * camera, a CLIPMAP: level k's texel is t0·2^k and its window N texels a side, so each level reaches twice as far as
 * the one before, at half the detail. Each level is baked with its own texel as the footprint, so its marks fade as a
 * pixel of that size would fade them — the cache is the live paint's own mip chain.
 *
 * The terrain reads the level whose texel matches the pixel (or, farther than the finer levels reach, the finest that
 * holds it), two levels blended: 4–8 fetches instead of the paint. The steep walls (a top-down texel stretches down a
 * wall) and the ground past ~2 km stay live.
 *
 * Each level's window follows the camera in 16-texel steps; only what a step uncovers is baked (TOROIDAL, as the
 * grass's field: texel c holds the window's ground X ≡ c mod N — nothing moves as it slides). All 9 levels (8 + the far) in ONE
 * atlas per output (3 × 3 tiles of N + 4 texels: a 2-texel gutter round each holds the wrap's neighbours, so the
 * hardware's bilinear filter never reads across the wrap or into the next tile). Four RGBA8 outputs (Terrain.ts
 * gcSurface): colour (√, for the dark greens' steps) + rock; roughness, AO, the sheen's share, the grass's shade;
 * the ground's small shapes (hollows, crests), track, bog, the puddles' noise; the desert's ripples (a NORMAL MAP) / the valley's rock-relief strength (the relief itself is drawn live),
 * the shrub dots, the flowers.
 *
 * The bake's texture reads take their mip from the bake's own texel spacing (implicit derivatives): the window's start
 * is always a multiple of 16 and N is too, so the wrap's seam falls between two 2 × 2 quads — never inside one.
 */
export class GroundCache {
  readonly uniforms: Record<string, GFX.IUniform>
  readonly defines: Record<string, string>
  private readonly n: number
  private readonly t0: number
  private readonly S: number
  private readonly rt: GFX.WebGLRenderTarget
  private readonly scene = new GFX.Scene()
  private readonly cam = new GFX.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly win = new GFX.Vector4()
  private readonly bake = new GFX.Vector4()
  private readonly wx = new Float64Array(GC_LEVELS).fill(Number.NaN)
  private readonly wz = new Float64Array(GC_LEVELS).fill(Number.NaN)
  private far = false
  private readonly tFar: number
  /** Texels baked last frame (the HUD / the harness). */
  baked = 0

  /** n: texels a level's side (a multiple of 16); the finest texel scales with it (ULTRA 1024: 1/32 m). */
  constructor(private readonly renderer: GFX.WebGLRenderer, n: number, world: number, terrain: Record<string, GFX.IUniform>, defines: Record<string, string>, heightGlsl: string, surfGlsl: string) {
    this.n = n
    this.t0 = (1 / 32) * (1024 / n)
    this.S = n + 4
    this.tFar = world / n
    const W = 3 * this.S, H = 3 * this.S
    this.rt = new GFX.WebGLRenderTarget(W, H, { count: 4, type: GFX.UnsignedByteType, depthBuffer: false, minFilter: GFX.LinearFilter, magFilter: GFX.LinearFilter })
    this.uniforms = {
      uGC0: { value: this.rt.textures[0] },
      uGC1: { value: this.rt.textures[1] },
      uGC2: { value: this.rt.textures[2] },
      uGC3: { value: this.rt.textures[3] },
      uGC: { value: new GFX.Vector4(n, this.t0, 1 / W, this.tFar) },
    }
    // GC_BIAS: a level's texel ≈ the pixel (foot ≈ √2 × a pixel's side); GC_STEEP: steeper than ~57°, the paint is
    // live too (a top-down texel stretches down a wall). The rock's relief is live everywhere (the bake's note)
    // (?gcsteep= / ?gcbias= / ?gcblend=0: cost and look tests)
    const q = gameParams(), num = (k: string, d: number) => { const v = Number(q.get(k)); return q.get(k) !== null && Number.isFinite(v) ? v : d }
    this.defines = { GC_ON: '', GC_LEVELS: `${GC_LEVELS}.0`, GC_BIAS: num('gcbias', 0.6).toFixed(3), GC_STEEP: num('gcsteep', 0.45).toFixed(3), ...(q.get('gcblend') === '0' ? { GC_NOBLEND: '' } : {}) }
    const mat = new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3,
      uniforms: { ...terrain, uWin: { value: this.win }, uBake: { value: this.bake } },
      defines: { ...defines, ...this.defines },
      vertexShader: BAKE_VERT,
      fragmentShader: bakeFrag(heightGlsl, surfGlsl),
      depthTest: false,
      depthWrite: false,
      side: GFX.DoubleSide, // (clip space written directly: never culled on either backend — Grass.ts GrassField)
    })
    const geo = new GFX.BufferGeometry()
    geo.setAttribute('position', new GFX.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    const mesh = new GFX.Mesh(geo, mat)
    mesh.frustumCulled = false
    this.scene.add(mesh)
  }

  /** Keep each level's window on the camera: bake what a step uncovered (everything, the first time or after a jump). */
  update(cx: number, cz: number): void {
    const n = this.n, r = this.renderer
    let target: GFX.WebGLRenderTarget | null = null, auto = true, first = true
    this.baked = 0
    for (let L = this.far ? 0 : -1; L < GC_LEVELS; L++) {
      // (L = −1: the FAR tile, once — the whole world, its window fixed on the world's middle; it lives in slot 8)
      const t = L < 0 ? this.tFar : this.t0 * 2 ** L
      const wx = L < 0 ? -n / 2 : Math.floor((cx / t - n / 2) / 16) * 16, wz = L < 0 ? -n / 2 : Math.floor((cz / t - n / 2) / 16) * 16
      const ox = L < 0 ? Number.NaN : this.wx[L], oz = L < 0 ? Number.NaN : this.wz[L]
      if (wx === ox && wz === oz) continue
      const all = Number.isNaN(ox) || Math.abs(wx - ox) >= n || Math.abs(wz - oz) >= n
      this.win.set(wx, wz, all ? wx + 4 * n : ox, all ? wz + 4 * n : oz)
      const slot = L < 0 ? GC_LEVELS : L
      const tx = (slot % 3) * this.S, ty = Math.floor(slot / 3) * this.S
      this.bake.set(n, t, tx, ty)
      this.baked += all ? this.S * this.S : (Math.min(Math.abs(wx - ox), n) + Math.min(Math.abs(wz - oz), n)) * this.S
      if (first) { target = r.getRenderTarget(); auto = r.autoClear; r.setRenderTarget(this.rt); r.autoClear = false; first = false }
      this.rt.viewport.set(tx, ty, this.S, this.S)
      r.render(this.scene, this.cam)
      if (L < 0) { this.far = true; continue }
      this.wx[L] = wx
      this.wz[L] = wz
    }
    if (!first) { r.setRenderTarget(target); r.autoClear = auto }
  }

  /** Forget every window (the next update bakes them all again). */
  invalidate(): void { this.wx.fill(Number.NaN); this.wz.fill(Number.NaN); this.far = false }

  dispose(): void { this.rt.dispose() }
}

const BAKE_VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const bakeFrag = (heightGlsl: string, surfGlsl: string) => /* glsl */ `
${ATMOS_GLSL}
${heightGlsl}
${ROCK_RELIEF_GLSL}
${PAINT_GLSL}
${surfGlsl}
uniform vec4 uWin;  // the window's first texel (x, z) now, and before
uniform vec4 uBake; // N, the texel (m), the tile's first texel in the atlas (x, y)
layout(location = 0) out highp vec4 o0;
layout(location = 1) out highp vec4 o1;
layout(location = 2) out highp vec4 o2;
layout(location = 3) out highp vec4 o3;

void main() {
  // this texel's ground in the window, now and before (the gutter's texels too: c = −2, −1, N, N + 1)
  vec2 c = floor(gl_FragCoord.xy) - uBake.zw - 2.0;
  vec2 X = uWin.xy + mod(c - uWin.xy, uBake.x);
  vec2 X0 = uWin.zw + mod(c - uWin.zw, uBake.x);
  if (X.x == X0.x && X.y == X0.y) discard;
  vec2 xz = (X + 0.5) * uBake.y;
  bool box = inTheBox(xz);
  vec3 Ns = groundNormal(xz, box);
  float h = terrainHeight(xz), t = uBake.y;
  Surf s = surfaceAt(xz, h, Ns, Ns.y, t * 1.41421, false, box, 1.0, 1.0, true);
  // THE RELIEF AND THE RIPPLES as a NORMAL MAP: the light-only detail bent into the normal here, at this level's texel
  // (the relief fades as its creases shrink under a texel, as under a pixel), stored as the change to the smooth
  // normal's x / z — the terrain adds it to its own smooth normal (the walls, read live, keep the live relief)
  // THE ROCK'S RELIEF IS NOT BAKED (2026-11-06 — the user: a rock hill crumpled in blocks, smooth between them: "all
  // should have the same … the same as 2 days before"). Baked at the cache's texels it came out far weaker than the
  // live relief on the steep walls beside it, cut along the steep / cached line. The terrain draws it LIVE on every
  // rock pixel, as before the cache; the cache keeps only its strength (the valley: o3.r — the valley has no ripples;
  // the desert works its own out from its rock and the slope) and the desert's ripples as a normal map
  vec3 N = normalize(Ns + vec3(s.rip.x, 0.0, s.rip.y));
  o0 = vec4(sqrt(max(s.col, vec3(0.0))), s.rock);
  o1 = vec4(s.rough, s.aoB, s.grassy, s.under);
  o2 = vec4(clamp(groundRelief(xz) * 0.25 + 0.5, 0.0, 1.0), s.trail, s.bog, s.pudN / 1.2); // (the small shapes, ±2 m)
#ifdef OTH_DESERT
  o3 = vec4(clamp((N.xz - Ns.xz) * 0.5 + 0.5, 0.0, 1.0), s.dots, s.flower / 0.3);
#else
  o3 = vec4(s.relief, 0.0, s.dots, s.flower / 0.3);
#endif
}
`
