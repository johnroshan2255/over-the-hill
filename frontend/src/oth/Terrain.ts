import * as GFX from './gfx'
import { ATMOS_GLSL, FRAG_OUT, type Atmosphere } from './Atmosphere'
import type { MapData } from './MapData'
import { PAINT_GLSL } from './paint'
import { ROCK_RELIEF_GLSL } from './rockRelief'
import type { Tier } from './quality'
import { SHADOW_GLSL, type TerrainShadow } from './TerrainShadow'

/**
 * THE GROUND — continuous distance-dependent LOD (CDLOD) on the GPU, the whole 16 km world in ONE instanced draw.
 *
 * One patch mesh (G × G quads) is instanced once per selected quadtree node; the vertex shader places it, reads the
 * height from the R16UI grids (the box's 2 m one inside it, the world's 16 m one outside) and GEOMORPHS each vertex
 * by its distance: from 62 % to 100 % of its level's range the odd vertices slide onto the next coarser grid, so a
 * patch meets its coarser neighbour exactly and LOD changes never pop. Up to three levels are morphed per vertex,
 * which lets the selection stay the plain "split while the camera is within the finer level's range" rule.
 *
 * Selection (CPU, per frame, ~0.05 ms): the quadtree from a 16 km root down to `tier.terrainLeaf` patches; a node
 * splits while its nearest point is closer than R(level−1) = near · 2^(level−1); nodes outside the view frustum (boxes
 * from a min/max height pyramid) are skipped. Distance is horizontal + the camera's height above the ground, so
 * flying high coarsens it all.
 *
 * Fragment: the per-pixel normal from the RG8 normal grids (the far ranges keep their ridges with coarse vertices),
 * the box's mask (rock, dryness, wet, forest) or a procedural one outside, painted by PAINT_GLSL, lit by the shared
 * ATMOS_GLSL `shade` and hazed by `applyAtmos`.
 */
export class Terrain {
  readonly mesh: GFX.Mesh
  private readonly geo: GFX.InstancedBufferGeometry
  private readonly nodes: GFX.InstancedBufferAttribute
  private readonly maxNodes = 2048
  private readonly leaf: number
  private readonly levels: number
  private readonly origin: number
  private readonly near: number
  /** min / max height per node, per level (level 0 = leaf cells), row-major. */
  private readonly minH: Float32Array[] = []
  private readonly maxH: Float32Array[] = []
  private readonly frustum = new GFX.Frustum()
  private readonly box = new GFX.Box3()
  private readonly pv = new GFX.Matrix4()
  private count = 0
  private cx = 0
  private cz = 0
  private agl2 = 0
  /** This frame's picks before the near → far sort: x0, z0, size, level, distance (m). */
  private readonly picked = new Float32Array(2048 * 5)
  private readonly order: number[] = []
  /** What the hills hide (main.ts: the trees' and rocks' Horizon) — whole patches behind a ridge are skipped. */
  horizon: { hidden(x0: number, z0: number, x1: number, z1: number, top: number): boolean } | null = null
  /** Patches skipped behind the hills this frame (the HUD). */
  occluded = 0
  readonly uniforms: Record<string, GFX.IUniform>

  constructor(private readonly map: MapData, atmos: Atmosphere, tier: Tier, shadow: TerrainShadow) {
    const G = tier.terrainGrid
    this.leaf = tier.terrainLeaf
    this.near = tier.terrainNear
    this.origin = -map.farHalf
    this.levels = Math.ceil(Math.log2((2 * map.farHalf) / this.leaf))
    this.buildPyramid()

    // the patch: (G+1)² vertices, quads split along alternating diagonals (no directional grain)
    const pos = new Float32Array((G + 1) * (G + 1) * 3)
    for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) {
      const k = (j * (G + 1) + i) * 3
      pos[k] = i; pos[k + 2] = j
    }
    const idx = new Uint16Array(G * G * 6)
    let n = 0
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const a = j * (G + 1) + i, b = a + 1, c = a + G + 1, d = c + 1
      if ((i + j) & 1) { idx[n++] = a; idx[n++] = c; idx[n++] = b; idx[n++] = b; idx[n++] = c; idx[n++] = d }
      else { idx[n++] = a; idx[n++] = c; idx[n++] = d; idx[n++] = a; idx[n++] = d; idx[n++] = b }
    }
    this.geo = new GFX.InstancedBufferGeometry()
    this.geo.setAttribute('position', new GFX.BufferAttribute(pos, 3))
    this.geo.setIndex(new GFX.BufferAttribute(idx, 1))
    this.nodes = new GFX.InstancedBufferAttribute(new Float32Array(this.maxNodes * 4), 4)
    this.nodes.setUsage(GFX.DynamicDrawUsage)
    this.geo.setAttribute('aNode', this.nodes)
    this.geo.instanceCount = 0

    const g = (h: MapData['inner']) => new GFX.Vector4(h.n, h.step, h.origin, 0)
    const sc = (h: MapData['inner']) => new GFX.Vector2(h.g.min, h.g.range / 65535)
    const mg = map.meta.mask
    this.uniforms = {
      ...atmos.uniforms,
      ...shadow.uniforms,
      uHIn: { value: map.inner.tex },
      uHFar: { value: map.far.tex },
      uNIn: { value: map.inner.normalTex },
      uNFar: { value: map.far.normalTex },
      uMask: { value: map.maskTex },
      uMud: { value: map.mudTex },
      uInGrid: { value: g(map.inner) },
      uFarGrid: { value: g(map.far) },
      uInScale: { value: sc(map.inner) },
      uFarScale: { value: sc(map.far) },
      uMaskGrid: { value: new GFX.Vector4(mg.n, mg.step, mg.origin, 0) },
      uBoxHalf: { value: map.half },
      uGridN: { value: G },
      uNear: { value: this.near },
      uWorldOrigin: { value: this.origin },
      uAgl2: { value: 0 },
      uWater: { value: map.meta.water.lake.level },
      uTrail: { value: map.trailTex },
      uTrailHW: { value: map.meta.trails.hw },
      uGrassR: { value: tier.grassRadius },
      uBushR: { value: tier.bushReach },
    }
    const mat = new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3,
      uniforms: this.uniforms,
      defines: { ...(tier.spec ? { OTH_SPEC: '' } : {}), ...(tier.rockRelief ? { OTH_ROCK_RELIEF: '' } : {}), ...map.biomeDefines },
      vertexShader: VERT,
      fragmentShader: FRAG,
    })
    this.mesh = new GFX.Mesh(this.geo, mat)
    this.mesh.frustumCulled = false // the selection culls per node
    this.mesh.matrixAutoUpdate = false
    // LAST of the opaque things (2026-10-27, 400 fps at 1080p): the grass, rocks, trees, bushes and the car draw first
    // and the depth test then skips the ground's paint under them — drawn first, every pixel under the carpet was
    // painted and then covered
    this.mesh.renderOrder = 10
  }

  /** Min / max heights per node, per level: the map's (computed with it in the loader's worker, mapPrep.ts). */
  private buildPyramid(): void {
    const P = this.map.pyramid
    if (P.leaf !== this.leaf || P.levels !== this.levels) throw new Error('Terrain: the map was prepared for another leaf size')
    this.minH.push(...P.minH)
    this.maxH.push(...P.maxH)
  }

  /** Pick this frame's patches. */
  update(camera: GFX.PerspectiveCamera): void {
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.pv, GFX.WebGLCoordinateSystem, camera.reversedDepth)
    this.cx = camera.position.x
    this.cz = camera.position.z
    const agl = Math.max(0, camera.position.y - this.map.height(this.cx, this.cz))
    this.agl2 = agl * agl
    this.uniforms.uAgl2.value = this.agl2
    this.count = 0
    this.occluded = 0
    this.select(0, 0, this.levels)
    // NEAR → FAR (2026-10-27, the hidden valleys): the patches draw in one instanced call in the order written, so the
    // nearest ground fills the depth buffer first and everything it hides fails the early depth test — the ground
    // behind a ridge costs no shading (it was quadtree order: a far patch could be shaded, then painted over)
    const P = this.picked, ord = this.order
    ord.length = this.count
    for (let n = 0; n < this.count; n++) ord[n] = n
    ord.sort((u, v) => P[u * 5 + 4] - P[v * 5 + 4])
    const a = this.nodes.array as Float32Array
    for (let n = 0; n < this.count; n++) { const o = ord[n] * 5; a[n * 4] = P[o]; a[n * 4 + 1] = P[o + 1]; a[n * 4 + 2] = P[o + 2]; a[n * 4 + 3] = P[o + 3] }
    this.geo.instanceCount = this.count
    this.nodes.addUpdateRange(0, this.count * 4)
    this.nodes.needsUpdate = true
  }

  private select(i: number, j: number, level: number): void {
    const size = this.leaf * 2 ** level
    const x0 = this.origin + i * size, z0 = this.origin + j * size
    if (x0 >= -this.origin || z0 >= -this.origin) return // past the world's edge
    const c = 2 ** (this.levels - level), k = j * c + i
    this.box.min.set(x0, this.minH[level][k] - 1, z0)
    this.box.max.set(x0 + size, this.maxH[level][k] + 1, z0 + size)
    if (!this.frustum.intersectsBox(this.box)) return
    const dx = Math.max(x0 - this.cx, 0, this.cx - x0 - size), dz = Math.max(z0 - this.cz, 0, this.cz - z0 - size)
    const dh = Math.sqrt(dx * dx + dz * dz)
    // BEHIND THE HILLS: a node whose highest point stays under the horizon (Horizon.ts) is skipped with all it holds —
    // judged with its top raised 3 m + 1.5 % of its distance (the horizon is rebuilt every 4 m the camera moves: a
    // ridge's far side must never open as a hole between two rebuilds)
    if (this.horizon && dh > 60 && this.horizon.hidden(x0, z0, x0 + size, z0 + size, this.maxH[level][k] + 3 + dh * 0.015)) { this.occluded++; return }
    if (level > 0) {
      const d = Math.sqrt(dh * dh + this.agl2)
      if (d < this.near * 2 ** (level - 1)) {
        this.select(2 * i, 2 * j, level - 1); this.select(2 * i + 1, 2 * j, level - 1)
        this.select(2 * i, 2 * j + 1, level - 1); this.select(2 * i + 1, 2 * j + 1, level - 1)
        return
      }
    }
    if (this.count >= this.maxNodes) return
    const o = this.count++ * 5, P = this.picked
    P[o] = x0; P[o + 1] = z0; P[o + 2] = size; P[o + 3] = level; P[o + 4] = Math.sqrt(dh * dh + this.agl2)
  }

  get patches(): number { return this.count }
}

/** Height lookup shared by the terrain and the grass vertex shaders (needs uHIn/uHFar, uInGrid/uFarGrid, scales). */
export const HEIGHT_GLSL = /* glsl */ `
uniform highp usampler2D uHIn;
uniform highp usampler2D uHFar;
uniform vec4 uInGrid;   // n, step, origin
uniform vec4 uFarGrid;
uniform vec2 uInScale;  // min, range / 65535
uniform vec2 uFarScale;
uniform float uBoxHalf;

float gridHeight(highp usampler2D t, vec4 g, vec2 sc, vec2 xz) {
  vec2 f = clamp((xz - g.z) / g.y, vec2(0.0), vec2(g.x - 1.001));
  vec2 i = floor(f);
  vec2 w = f - i;
  ivec2 p = ivec2(i);
  float a = float(texelFetch(t, p, 0).r);
  float b = float(texelFetch(t, p + ivec2(1, 0), 0).r);
  float c = float(texelFetch(t, p + ivec2(0, 1), 0).r);
  float d = float(texelFetch(t, p + ivec2(1, 1), 0).r);
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y) * sc.y + sc.x;
}
bool inBox(vec2 xz) {
  float e = uBoxHalf - uInGrid.y;
  return abs(xz.x) < e && abs(xz.y) < e;
}
float terrainHeight(vec2 xz) {
  return inBox(xz) ? gridHeight(uHIn, uInGrid, uInScale, xz) : gridHeight(uHFar, uFarGrid, uFarScale, xz);
}
`

const VERT = /* glsl */ `
${ATMOS_GLSL}
${HEIGHT_GLSL}
uniform float uGridN;
uniform float uNear;
uniform float uWorldOrigin;
uniform float uAgl2;
in vec4 aNode; // x0, z0, size, level
out vec3 vWorld;

// one geomorph step: level L's vertices that its coarser parent lacks slide onto the parent's edge as dist nears L's rim
vec2 morphStep(vec2 xz, float dist, float L, float c) {
  float R = uNear * exp2(L);
  float m = clamp((dist - R * 0.62) / (R * 0.38), 0.0, 1.0);
  vec2 odd = step(vec2(0.25), fract((xz - uWorldOrigin) / (2.0 * c)));
  return xz - odd * c * m;
}

void main() {
  float cell = aNode.z / uGridN;
  vec2 xz = aNode.xy + position.xz * cell;
  vec2 d2 = xz - uCamPos.xz;
  float dist = sqrt(dot(d2, d2) + uAgl2);
  // geomorph through up to three coarser levels (written out, no loop — rockRelief.ts says why; a level whose blend
  // is 0 moves nothing, and every coarser one's is 0 too)
  xz = morphStep(xz, dist, aNode.w, cell);
  xz = morphStep(xz, dist, aNode.w + 1.0, cell * 2.0);
  xz = morphStep(xz, dist, aNode.w + 2.0, cell * 4.0);
  float h = terrainHeight(xz);
  vWorld = vec3(xz.x, h, xz.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`

const FRAG = /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
${ROCK_RELIEF_GLSL}
${PAINT_GLSL}
uniform sampler2D uNIn;
uniform sampler2D uNFar;
uniform sampler2D uMask;
uniform sampler2D uMud;
uniform vec4 uInGrid;
uniform vec4 uFarGrid;
uniform vec4 uMaskGrid;
uniform float uBoxHalf;
uniform float uWater;
${SHADOW_GLSL}
in vec3 vWorld;

uniform float uGrassR;
uniform float uBushR;
uniform sampler2D uTrail;
uniform float uTrailHW;
// where the grass stands (the grass shader's rule: not on rock, not in water, thinner in the forest)
float grassy0(vec4 m, float rk, float fo) { return (1.0 - smoothstep(0.02, 0.1, rk)) * (1.0 - smoothstep(0.9, 0.97, m.b)) * (1.0 - 0.55 * fo); }
vec2 gridUv(vec4 g, vec2 xz) { return ((xz - g.z) / g.y + 0.5) / g.x; }
// a smooth 1D value noise (0..1): the cliffs' beds by height, of uneven thickness
float strataH(float i) { return fract(sin(i * 12.9898 + 4.1) * 43758.5453); }
float strataN(float x) { float i = floor(x), f = x - i; return mix(strataH(i), strataH(i + 1.0), f * f * (3.0 - 2.0 * f)); }
vec3 unpackN(vec2 e) { vec2 n = e * 2.0 - 1.0; return vec3(n.x, sqrt(max(1.0 - dot(n, n), 0.0)), n.y); }

void main() {
  vec2 xz = vWorld.xz;
  float e = uBoxHalf - uInGrid.y;
  bool box = abs(xz.x) < e && abs(xz.y) < e;
  // LOW-POLY LIGHT: the triangle's own flat normal (its facet), blended over a SOFT normal (the normal grid read a
  // few mips up: rolling shapes without the 2 m detail) — full facets on rock, gentle ones on the grassy hills
  vec3 Ns = box ? unpackN(texture(uNIn, gridUv(uInGrid, xz), 0.8).rg) : unpackN(texture(uNFar, gridUv(uFarGrid, xz), 0.0).rg);
  vec3 Nf = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (Nf.y < 0.0) Nf = -Nf;
  // THE FAR GROUND, CHEAP (2026-10-27, phones at full resolution): past 2 km the haze has taken half and the fine marks
  // are under a pixel — only the paint's two broad octaves are read there (2 fetches, not 5) and no shrub dots
  float dcam = length(vWorld.xz - uCamPos.xz);
  bool farG = dcam > 2000.0;
  // the pixel's footprint on the ground (m): the paint's small marks fade before they'd shimmer
  float foot = max(length(fwidth(xz)), 0.001);
  Paint p;
  if (farG) {
    p.mid = texture(uNoise, xz * (1.0 / 71.0));
    p.big = texture(uNoise, xz * (1.0 / 389.0) + vec2(0.37, 0.59));
    p.fine = p.grain = p.micro = vec4(0.5);
  } else if (foot > 1.6) {
    // (2026-10-27, the cost of the new look: an octave whose marks are under ~2 pixels reads its mip's average —
    //  ≈ 0.5, and every use of the grain / micro already fades by near there: skip the fetch, keep the look)
    p.mid = texture(uNoise, xz * (1.0 / 71.0));
    p.big = texture(uNoise, xz * (1.0 / 389.0) + vec2(0.37, 0.59));
    p.fine = foot > 8.0 ? vec4(0.5) : texture(uNoise, xz * (1.0 / 13.0) + vec2(0.71, 0.13));
    p.grain = p.micro = vec4(0.5);
  } else p = paintNoise(xz);
  float h = vWorld.y;
  float steep = 1.0 - Ns.y; // 0 flat … 0.3 ≈ 45°

  // the mask: baked inside the box; outside it, painted from slope, height and noise (the far ranges)
  vec4 m;
  if (box) {
    m = texture(uMask, gridUv(uMaskGrid, xz));
  } else {
#ifdef OTH_DESERT
    // (the far desert: sandstone where it's steep, sand everywhere else — loose in broad drifts; nothing grows)
    float rock = smoothstep(0.12, 0.26, steep + (p.big.b - 0.5) * 0.12);
    m = vec4(rock, 0.55 + (p.big.g - 0.5) * 0.7, 0.0, 0.0);
#else
    float rock = smoothstep(0.1, 0.24, steep + (p.big.b - 0.5) * 0.12) + smoothstep(700.0, 1100.0, h) * smoothstep(0.04, 0.14, steep);
    float forest = smoothstep(0.52, 0.62, p.big.r + p.mid.g * 0.25) * (1.0 - smoothstep(560.0, 820.0, h + (p.mid.r - 0.5) * 160.0));
    m = vec4(clamp(rock, 0.0, 1.0), 0.6 + (p.big.g - 0.5) * 0.6, 0.0, forest);
#endif
  }
  float trail = box ? texture(uTrail, gridUv(uInGrid, xz)).r * 8.0 : 8.0;
  Ground g = groundPaint(xz, m, h, steep, p, foot, trail, uTrailHW, farG ? 0.0 : smoothstep(uBushR * 0.7, uBushR, dcam)); // (painted shrub dots only beyond the real bushes)
  vec3 col = g.col;
  // (2026-11-04 — the user: "I can see lots of triangles instead of a smooth surface … even in the valley the rocky
  //  places are sharp; I want smoothness": the low-poly facets are gone — the smooth normal everywhere, no per-triangle
  //  tone; the light rolls over the land in soft gradients)
  float facet = 0.0;
  // (2026-11-04 — the user: "in a big wall … a repeated line, then the next, then the next": on a steep face the 2 m
  //  grid's triangles are tall slivers, row on row — their flat normals and per-facet tones drew a line at every row.
  //  A steep wall takes the smooth normal; the relief and the paint are its detail)
  facet *= 1.0 - 0.8 * smoothstep(0.2, 0.45, steep);
  vec3 N = normalize(mix(Ns, Nf, facet));
  // HIGH / ULTRA on PCs: the rock's (and the scree's) crumpled 3D relief — the light only, the colour stays
  float cav = 1.0;
#ifdef OTH_ROCK_RELIEF
  // (the desert too, 2026-11-04 — the user: "the way we put rock texture on the valley": the crumpled relief on its
  //  bare rock — warped, never a repeating tile)
  N = rockRelief(vWorld, N, max(g.rock, g.scree * 0.6) * (1.0 - g.trail), dFdx(vWorld), dFdy(vWorld), cav); // (never on a track)
#endif
  col *= 1.0 + (facetRand(Nf) - 0.5) * 0.1 * facet;
#ifdef OTH_DESERT
  // WIND RIPPLES in the loose sand: fine ridges across the wind (~0.35 m), the light only — on the LOOSE sand only
  // (2026-11-04: not the gravel, rock, tracks or the damp), in PATCHES (a slow no-repeat noise: some sand lies smooth),
  // at two angles of the wind crossfading (one direction everywhere read as a repeated pattern), gone wherever a
  // ripple would be smaller than a pixel or two
  // (2026-11-04, the clean look: only on the dunes and the deep sheets, and gentler)
  float loose = g.loose * smoothstep(0.75, 0.95, m.g) * (1.0 - smoothstep(0.3, 0.7, m.b)) * (1.0 - smoothstep(0.05, 0.12, foot));
  if (loose > 0.01) {
    float patchK = smoothstep(0.38, 0.62, g.ripK);
    loose *= 0.25 + 0.75 * patchK;
    vec2 wd1 = vec2(0.83, 0.56), wd2 = vec2(0.47, 0.88);
    float warp = (p.mid.g - 0.5) * 9.0 + (p.fine.b - 0.5) * 2.2 + (p.grain.r - 0.5) * 1.2;
    float wk = smoothstep(0.38, 0.62, p.big.r);
#ifdef OTH_SPEC
    float ph1 = dot(xz, wd1) * 17.0 + warp, ph2 = dot(xz, wd2) * 13.5 + warp * 0.8;
    float rip = mix(cos(ph1) * 0.5 + 0.5 * cos(ph1 * 2.03 + 1.1) * 0.35, cos(ph2) * 0.5 + 0.5 * cos(ph2 * 2.03 + 0.4) * 0.35, wk);
    vec2 wd = normalize(mix(wd1, wd2, wk));
#else
    // (LOW: one angle or the other, never both)
    vec2 wd = wk > 0.5 ? wd2 : wd1;
    float ph = dot(xz, wd) * (wk > 0.5 ? 13.5 : 17.0) + warp;
    float rip = cos(ph) * 0.5 + 0.5 * cos(ph * 2.03 + 1.1) * 0.35;
#endif
    N = normalize(N + vec3(wd.x, 0.0, wd.y) * rip * 0.1 * loose);
  }
#endif
  // CLIFF FACES (2026-10-27, "cliffs … the colour is the key"): a steep rock face reads as LAYERED stone — horizontal
  // strata ~3.4 m apart (their lines wandering), each band its own tone between a warm sandy grey and a cool blue
  // grey, a dark seam where two meet; darker water streaks running down from the ledges; moss and grass on the ledges
  // (the facets that face up). Rock only, large marks (every tier: no texture, one noise fetch).
#ifdef OTH_DESERT
  float cliffK = 0.0; // (the desert's beds are its own paint: groundPaint)
#else
  float cliffK = g.rock * smoothstep(0.22, 0.5, steep) * (1.0 - g.trail);
#endif
  if (cliffK > 0.01) {
    // (2026-11-04 — the user: "a repeated line … first 2 m, then the next line, then the next … use shaders, not
    //  repeated textures; from a distance just colour": the strata were EVEN 3.4 m bands with a dark seam at each, the
    //  streaks a texture repeating every 4.5 m. Now beds of UNEVEN thickness — two smooth 1D noises sharing no period —
    //  soft tones, no seams; the streaks on the face's own axis at two scales with no common period; the small beds and
    //  the streaks fade into the plain colour as they shrink toward a pixel)
    float nearK = 1.0 - smoothstep(0.8, 3.5, foot);
    float q = h + (p.mid.g - 0.5) * 6.0 + (p.big.r - 0.5) * 9.0;
    float bh = strataN(q / 13.0);
    if (nearK > 0.01) bh = mix(bh, 0.62 * bh + 0.38 * strataN(q / 4.1 + 5.3), nearK);
    vec3 band = mix(vec3(1.08, 1.03, 0.92), vec3(0.92, 0.97, 1.06), bh);
    float wx = smoothstep(0.3, 0.7, abs(Ns.x) / (abs(Ns.x) + abs(Ns.z) + 1e-4));
    float streak = 0.0;
    if (nearK > 0.01) {
#ifdef OTH_SPEC
      streak = smoothstep(0.5, 0.82, mix(texture(uNoise, vec2(xz.x / 29.0, h / 230.0 + 0.6)).g, texture(uNoise, vec2(xz.y / 25.1 + 0.2, h / 210.0)).g, wx)) * nearK;
#else
      streak = smoothstep(0.5, 0.82, texture(uNoise, vec2((wx > 0.5 ? xz.y : xz.x) / 29.0, h / 230.0 + 0.6)).g) * nearK; // (LOW: one read)
#endif
    }
    col *= mix(vec3(1.0), band * (1.0 - 0.16 * streak), cliffK);
    col = mix(col, mix(GREEN, GREEN_DEEP, p.fine.g) * 1.1, cliffK * smoothstep(0.8, 0.95, Nf.y) * 0.75);
  }

  float rough = mix(0.92, 0.62, g.rock);
  rough = mix(rough, 0.45, g.snow);
  // MUD (the marsh, the tracks' mud holes, the slow banks — mud.bin): dark wet earth in soft painted patches, glossy,
  // dragged into streaks; the thickest of it holds standing water (below, with the rain's puddles)
  vec2 mudB = box ? texture(uMud, gridUv(uMaskGrid, xz)).rg : vec2(0.0);
  float mud = mudB.r;
  // WILDFLOWERS seen from beyond the grass (the blades draw them near): the field speckled with its drift's colour,
  // the speckle melting into a tint where it would shimmer
  if (mudB.g > 0.02) {
    float beyond = smoothstep(uGrassR * 0.55, uGrassR * 0.9, dcam) * (1.0 - g.trail) * (1.0 - g.rock);
    // (LOW's grass ends at 38 m, ULTRA's at 72: past that the paint carries the same band — a sprinkle over the field's
    //  own colour, as the blades show it: only a flower's top is in bloom (2026-11-02, was 0.8: the drift read as a
    //  flower-coloured field))
    float spk = mix(dotsAt(xz, 1.6, 0.42, 0.42, max(0.12, foot * 0.45)), 0.62, smoothstep(0.4, 1.6, foot));
    col = mix(col, flowerColor(xz, 0.5), min(1.0, mudB.g * 1.15) * beyond * min(1.0, spk * 1.6) * 0.3);
  }
  float mudA = 0.0;
  if (mud > 0.01) {
    mudA = smoothstep(0.1, 0.45, mud + (p.mid.r - 0.5) * 0.3);
    vec3 MUDC = mix(vec3(0.075, 0.056, 0.038), vec3(0.135, 0.1, 0.066), texture(uNoise, xz * vec2(0.31, 0.11)).b);
    col = mix(col, MUDC, mudA);
    rough = mix(rough, 0.3, mudA);
  }
  float wrap = mix(0.62, 0.45, g.rock); // (rock's light softer at its edge too)
  float ao = mix(1.0, 0.7, g.forest) * mix(1.0, 0.85, g.bed) * cav;
  vec3 V = normalize(uCamPos - vWorld);
  // (the 4 m shadow bake on a near-vertical face: a stripe at every texel row. A steep face reads its shade a few
  //  metres out in front of it instead — the open ground there, in the wall's shadow or not; its facing does the rest.
  //  Both worlds, 2026-11-04 — the desert lit its walls fully before; the valley's walls kept the stripes)
  float wallK = smoothstep(0.3, 0.6, steep);
  vec2 outward = Ns.xz / max(length(Ns.xz), 1e-3);
  float sun = sunVisibility(xz + outward * 6.0 * wallK);
  // under the grass the ground lies in the blades' shade (it shows between them); the shade lifts toward the
  // grass's edge, where the ground alone must look like the field from afar
  float under = grassy0(m, g.rock, g.forest) * (1.0 - smoothstep(0.02, 0.1, g.scree)) * (1.0 - g.trail) * (1.0 - smoothstep(uGrassR * 0.3, uGrassR * 0.95, length(vWorld - uCamPos)));
  col *= 1.0 - 0.14 * under;
  vec3 c = shade(col, N, V, rough, 0.04, ao, sun, wrap);
  c += rockFill(col, N) * g.rock * ao;
  c += headlight(col, N, vWorld);
  // PUDDLES (the rain): pools in the tracks' ruts and dips, a still dark mirror of the sky, spreading as it gets wetter
  float bog = smoothstep(0.8, 0.92, mud + (texture(uNoise, xz * 0.05).g - 0.5) * 0.3);
  if ((uWet > 0.05 && g.trail > 0.2) || bog > 0.0) {
    float pud = smoothstep(0.71, 0.76, texture(uNoise, xz * 0.085).g + texture(uNoise, xz * 0.31).r * 0.16 + (uWet - 1.0) * 0.35) * g.trail * step(0.05, uWet);
    pud = max(pud, bog * 0.85);
    float fr = 0.12 + 0.6 * pow(1.0 - max(V.y, 0.0), 4.0);
    // (dark muddy water: the bed shows through, the sky in it at a glance — a bright mirror read as snow; the bed LIT
    //  (c, ~0.14 of the lit ground ≈ the 0.32 of its albedo by day) — 2026-11-02, the user: "at evening and night the
    //  water on the ground still bright like a light": the unlit albedo stayed day-bright as the land went dark)
    vec3 mirror = c * 0.14 + skyColor(reflect(-V, vec3(0.0, 1.0, 0.0))) * fr * 0.55 + headlight(vec3(0.5), vec3(0.0, 1.0, 0.0), vWorld) * 0.6;
    c = mix(c, mirror, pud * 0.9);
  }
  // the fields' sheen: grass back-lit by a low sun glows warm
  float grassy = (1.0 - g.rock) * (1.0 - g.forest) * (1.0 - g.snow) * (1.0 - g.bed);
  float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
  c += g.col * uSunColor * back * 0.11 * grassy * smoothstep(-0.1, 0.4, dot(N, uSunDir)) * sun;
  gl_FragColor = vec4(applyAtmos(c, vWorld), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
