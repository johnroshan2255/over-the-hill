import * as GFX from './gfx'
import { ATMOS_GLSL, FRAG_OUT, type Atmosphere } from './Atmosphere'
import type { MapData } from './MapData'
import { PAINT_GLSL } from './paint'
import type { Tier } from './quality'
import { HEIGHT_GLSL, SHAPE_GLSL, shapeDefines, type Terrain } from './Terrain'
import { SHADOW_GLSL } from './TerrainShadow'

/**
 * GRASS — the Over-the-Hill carpet: low-poly TUFTS of thick pointed blades (a quad + a tip, 5 vertices; the far ring a
 * single triangle) fanning out of one root, dense enough to hide the ground, round the camera in three rings of
 * world-locked tiles (one instanced draw per ring).
 *
 * THE GRASS IS THE GROUND GROWN UP: every blade takes the colour of the ground it stands on — the terrain's own
 * `groundPaint` at its root (green ground → green grass, golden → golden, thinning out toward rock / water / forest) —
 * and is lit with the ground's (soft) normal, so a grassy hill shades as one surface, like the terrain beyond the
 * grass. Only a gentle root-to-tip ramp and a per-blade nudge (blades facing the sun a touch lighter) separate them.
 *
 * Every tuft has a RANK in [0, 1): it shows only while rank < density(distance) / the ring's build density, and its
 * blades widen by the inverse square root of that share — the field thins with distance at the SAME coverage (no
 * ring edge), and LOW (fewer tufts) keeps the look: fewer, wider tufts, never a thinner field.
 */
interface Ring { rin: number; rout: number; tile: number; density: number; blades: number; mesh: GFX.Mesh; geo: GFX.InstancedBufferGeometry; tiles: GFX.InstancedBufferAttribute; max: number }

/** HIGH's near tuft density: the reference the lower tiers widen their blades against. */
const REF_DENSITY = 22
const REF_FAN = 11
/** The share of the tier's tufts grown (the user: "reduce grass to 70%" — the amount): a sparser field, the ground
 *  showing between the tufts. Unlike a lower tier's budget, the blades are NOT widened to make up for it. */
const AMOUNT = 0.7

export class Grass {
  readonly group = new GFX.Group()
  private readonly rings: Ring[] = []
  private readonly frustum = new GFX.Frustum()
  private readonly box = new GFX.Box3()
  private readonly pv = new GFX.Matrix4()
  /** Blades drawn last frame (after the tile cull, before the per-tuft density cull). */
  blades = 0

  /** THE FIELD (2026-11-03): what a tuft's root reads off the map — its paint, whether and how tall it grows — baked
   *  into world-space texels round the camera; every blade vertex reads two texels, not the map + groundPaint. */
  private readonly field: GrassField
  /** THE CAR'S FOOTPRINT (2026-11-05: the meadow grew up through its floor and dash — seen from inside): its centre
   *  (x, z) and heading's cos / sin, and its half width / length (m) — the blades in it lie flat. */
  private readonly carBox = { value: new GFX.Vector4(0, 0, 1, 0) }
  private readonly carHalf = { value: new GFX.Vector2(0, 0) }
  /** Where the car stands now (main.ts, a frame). */
  car(x: number, z: number, heading: number, halfX: number, halfZ: number): void {
    this.carBox.value.set(x, z, Math.cos(heading), Math.sin(heading))
    this.carHalf.value.set(halfX, halfZ)
  }

  constructor(private readonly map: MapData, atmos: Atmosphere, terrain: Terrain, tier: Tier, rockFootprint: GFX.Texture, renderer: GFX.WebGLRenderer) {
    const R = tier.grassRadius, D0 = tier.grassDensity * AMOUNT
    const mg = map.meta.mask
    const t = terrain.uniforms
    const uniforms: Record<string, GFX.IUniform> = {
      ...atmos.uniforms,
      uHIn: t.uHIn, uHFar: t.uHFar, uInGrid: t.uInGrid, uFarGrid: t.uFarGrid, uInScale: t.uInScale, uFarScale: t.uFarScale,
      uBoxHalf: t.uBoxHalf, uNIn: t.uNIn,
      uShBox: t.uShBox, uShWorld: t.uShWorld, uShBoxGrid: t.uShBoxGrid, uShOn: t.uShOn,
      uTreeSh: t.uTreeSh, uTreeShGrid: t.uTreeShGrid, uTreeShOn: t.uTreeShOn,
      uMask: { value: map.maskTex },
      uMud: { value: map.mudTex },
      uOwn: { value: map.waterTex },
      uRocks: { value: rockFootprint },
      uTrail: { value: map.trailTex },
      uTrailHW: { value: map.meta.trails.hw },
      uMaskGrid: { value: new GFX.Vector4(mg.n, mg.step, mg.origin, 0) },
      uD0: { value: D0 },
      uRadius: { value: R },
      // fewer tufts on the lower tiers → each blade wider by the square root: the coverage stays HIGH's
      uWidthK: { value: Math.max(1, Math.sqrt((REF_DENSITY * REF_FAN) / (tier.grassDensity * tier.grassFan))) },
      uCarBox: this.carBox, uCarHalf: this.carHalf,
    }
    this.field = new GrassField(renderer, R, uniforms, map.biomeDefines)
    Object.assign(uniforms, this.field.uniforms)
    // (2026-10-27, 400 fps at 1080p: each ring is built at its INNER edge's density and the rank cull thins it outward —
    //  the culled tufts still cost a vertex each; the near ring (to 0.25 R) split in two halves those: its outer half
    //  built at half the density, straight blades)
    const bounds = [0, 0.12 * R, 0.25 * R, 0.55 * R, R]
    const tiles = [4, 4, 8, 16]
    const blades = [tier.grassFan, tier.grassFan, Math.max(4, Math.round(tier.grassFan * 0.7)), Math.max(3, Math.round(tier.grassFan * 0.45))]
    const segs = [tier.grassSegments, 1, 1, 1]
    for (let r = 0; r < 4; r++) {
      const density = densityAt(D0, bounds[r])
      const geo = tuftTile(tiles[r], density, blades[r], segs[r], 0x9e37 + r * 101)
      const max = Math.ceil(((2 * bounds[r + 1]) / tiles[r] + 2) ** 2)
      const attr = new GFX.InstancedBufferAttribute(new Float32Array(max * 2), 2)
      attr.setUsage(GFX.DynamicDrawUsage)
      geo.setAttribute('aTile', attr)
      geo.instanceCount = 0
      const mat = new GFX.ShaderMaterial({
        glslVersion: GFX.GLSL3,
        uniforms: { ...uniforms, uBuild: { value: density }, uRin: { value: bounds[r] }, uRout: { value: bounds[r + 1] }, uFan: { value: blades[r] } },
        defines: { ...map.biomeDefines, ...shapeDefines(), ...(CARFLAT_OFF ? { NO_CARFLAT: '' } : {}) }, // (no specular: on blades of roughness 0.85 it never showed)
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: GFX.DoubleSide,
      })
      const mesh = new GFX.Mesh(geo, mat)
      mesh.frustumCulled = false
      mesh.matrixAutoUpdate = false
      mesh.renderOrder = -30 + r // nearest ring FIRST (it hides the most; 1 − r had drawn the far ring first), all before the terrain
      this.group.add(mesh)
      this.rings.push({ rin: bounds[r], rout: bounds[r + 1], tile: tiles[r], density, blades: blades[r], mesh, geo, tiles: attr, max })
    }
  }

  /** (the world goes: its field's target with it) */
  dispose(): void { this.field.dispose() }

  update(camera: GFX.PerspectiveCamera): void {
    this.field.update(camera.position.x, camera.position.z)
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.pv, GFX.WebGLCoordinateSystem, camera.reversedDepth)
    const cx = camera.position.x, cz = camera.position.z
    this.blades = 0
    for (const ring of this.rings) {
      const T = ring.tile, a = ring.tiles.array as Float32Array
      const i0 = Math.floor((cx - ring.rout) / T), i1 = Math.floor((cx + ring.rout) / T)
      const j0 = Math.floor((cz - ring.rout) / T), j1 = Math.floor((cz + ring.rout) / T)
      let n = 0
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = i * T, z = j * T
          // nearest / farthest point of the tile from the camera (horizontal)
          const nx = Math.max(x - cx, 0, cx - x - T), nz = Math.max(z - cz, 0, cz - z - T)
          if (nx * nx + nz * nz > ring.rout * ring.rout) continue
          const fx = Math.max(Math.abs(x - cx), Math.abs(x + T - cx)), fz = Math.max(Math.abs(z - cz), Math.abs(z + T - cz))
          if (fx * fx + fz * fz < ring.rin * ring.rin) continue
          const h0 = this.map.height(x, z), h1 = this.map.height(x + T, z + T), h2 = this.map.height(x + T, z), h3 = this.map.height(x, z + T)
          this.box.min.set(x, Math.min(h0, h1, h2, h3) - 1.5, z)
          this.box.max.set(x + T, Math.max(h0, h1, h2, h3) + 2.5, z + T)
          if (!this.frustum.intersectsBox(this.box)) continue
          if (n >= ring.max) break
          a[n * 2] = x; a[n * 2 + 1] = z
          n++
        }
      }
      ring.geo.instanceCount = n
      ring.tiles.addUpdateRange(0, n * 2)
      ring.tiles.needsUpdate = true
      this.blades += n * Math.round(ring.density * T * T) * ring.blades
    }
  }
}

/** Tufts per m² wanted at distance d (m): full near the camera, falling ~d^-1.5 (the eye can't count them far). */
function densityAt(d0: number, d: number): number {
  return d0 / (1 + Math.pow(d / 9, 1.5))
}

/**
 * One ring's tile: K tufts in a T × T square (stratified jitter: no clumps, no holes), each `fan` blades of `segs`
 * segments (2: a quad + the tip, 5 vertices; 1: one triangle). Per vertex: aTuft (local x, local z, rank, seed),
 * aBlade (fan angle, lean, height ×, width ×) and aV (t along the blade 0..1, side −1 / 0 / +1).
 */
function tuftTile(T: number, density: number, fan: number, segs: number, seed: number): GFX.InstancedBufferGeometry {
  const K = Math.max(1, Math.round(density * T * T))
  const g = Math.ceil(Math.sqrt(K))
  const vpb = segs * 2 + 1
  const nv = K * fan * vpb
  const tuft = new Float32Array(nv * 4), blade = new Float32Array(nv * 4), v = new Float32Array(nv * 2), pos = new Float32Array(nv * 3)
  const idx: number[] = []
  let s = seed >>> 0
  const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
  const order = Array.from({ length: g * g }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
  let o = 0
  for (let k = 0; k < K; k++) {
    const cell = order[k]
    const lx = ((cell % g) + rnd()) * (T / g), lz = (Math.floor(cell / g) + rnd()) * (T / g)
    const rank = (k + rnd()) / K, ts = rnd()
    for (let b = 0; b < fan; b++) {
      const ang = (b / fan) * Math.PI * 2 + (rnd() - 0.5) * 1.1
      // (a carpet: even heights, wide blades)
      const lean = rnd(), hk = 0.8 + 0.3 * rnd(), wk = 0.8 + 0.4 * rnd()
      const base = o
      for (let q = 0; q < vpb; q++, o++) {
        tuft.set([lx, lz, rank, ts], o * 4)
        blade.set([ang, lean, hk, wk], o * 4)
        const tip = q === vpb - 1
        v.set([tip ? 1 : Math.floor(q / 2) / segs, tip ? 0 : q % 2 ? 1 : -1], o * 2)
      }
      for (let sg = 0; sg < segs; sg++) {
        const l = base + sg * 2, r = l + 1
        if (sg < segs - 1) idx.push(l, r, l + 2, r, l + 3, l + 2)
        else idx.push(l, r, base + vpb - 1)
      }
    }
  }
  const geo = new GFX.InstancedBufferGeometry()
  geo.setAttribute('position', new GFX.BufferAttribute(pos, 3)) // (unused: the shader builds the blade)
  geo.setAttribute('aTuft', new GFX.BufferAttribute(tuft, 4))
  geo.setAttribute('aBlade', new GFX.BufferAttribute(blade, 4))
  geo.setAttribute('aV', new GFX.BufferAttribute(v, 2))
  geo.setIndex(nv > 65535 ? new GFX.Uint32BufferAttribute(idx, 1) : new GFX.Uint16BufferAttribute(idx, 1))
  return geo
}

/** The grass vertex shader's view of the FIELD: uField = (texels a side, metres a texel, 1 / the side in metres). */
const FIELD_GLSL = /* glsl */ `
uniform sampler2D uFieldA;
uniform sampler2D uFieldB;
uniform vec4 uField;
`

/** ?carflat=0 (the cost A/B): the grass not pressed flat under the car. */
const CARFLAT_OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).get('carflat') === '0'

const VERT = /* glsl */ `
${ATMOS_GLSL}
${HEIGHT_GLSL}
#define PAINT_TEX(uv) textureLod(uNoise, uv, 0.0)
${PAINT_GLSL}
${SHADOW_GLSL}
${SHAPE_GLSL}
uniform sampler2D uMask;
uniform sampler2D uMud;
uniform sampler2D uNIn;
uniform sampler2D uRocks;
uniform sampler2D uTrail;
uniform float uTrailHW;
uniform vec4 uMaskGrid;
uniform float uD0;
uniform float uBuild;
uniform float uRin;
uniform float uRout;
uniform float uRadius;
uniform float uWidthK;
uniform vec4 uCarBox;
uniform vec2 uCarHalf;
${FIELD_GLSL}
in vec4 aTuft;  // local x, local z, rank, seed
in vec4 aBlade; // fan angle, lean, height ×, width ×
in vec2 aV;     // t (0 root … 1 tip), side
in vec2 aTile;  // the tile's world corner
out vec3 vWorld;
out vec3 vColor;
out vec3 vFlower; // a flower blade's head colour (lit; = vColor on the other blades)
out float vT;
out vec3 vN;
out float vSun;

vec3 unpackN(vec2 e) { vec2 n = e * 2.0 - 1.0; return vec3(n.x, sqrt(max(1.0 - dot(n, n), 0.0)), n.y); }

void main() {
  vec2 root = aTile + aTuft.xy;
  float d = length(root - uCamPos.xz);
  // density share at this distance → keep this tuft? (and how much wider, to hold the coverage)
  float share = (uD0 / (1.0 + pow(d / 9.0, 1.5))) / uBuild;
  float keep = step(aTuft.z, share) * step(uRin - 0.5, d) * step(d, uRout + 0.5);
  float widen = inversesqrt(clamp(share, 0.05, 1.0));
  // (2026-10-27, 400 fps at 1080p: a tuft the rank cull drops — ~9 in 10 at 36 m — used to run the whole shader below
  //  (the ground's paint, the wind, the shadow: ~20 texture reads a vertex) only to end at height 0; now it stops here,
  //  its vertices outside the clip volume: the triangle is discarded)
  if (keep < 0.5) {
    vWorld = vec3(0.0); vColor = vec3(0.0); vFlower = vec3(0.0); vT = 0.0; vN = vec3(0.0, 1.0, 0.0); vSun = 0.0;
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  // THE GROUND HERE: its height and soft normal; what the root reads off the map, from the field
  float h = terrainHeight(root);
#ifdef OTH_SHAPE
  // (the ground's normal a mip up — ~4 m: the field's bumps light the blades; it was 2.5 mips, ~11 m: every bump under
  //  that lit as flat ground — 2026-11-06) and the hill's (~45 m) the small slopes' light is measured against
  vec2 nUv = ((root - uInGrid.z) / uInGrid.y + 0.5) / uInGrid.x;
  vec3 N = unpackN(textureLod(uNIn, nUv, 1.0).rg);
  vec3 Nb = unpackN(textureLod(uNIn, nUv, 4.5).rg);
#else
  vec3 N = unpackN(textureLod(uNIn, ((root - uInGrid.z) / uInGrid.y + 0.5) / uInGrid.x, 2.5).rg);
#endif
  // the root's paint and growth: the FIELD's two texels (GrassField — baked from the map as the camera moves)
  vec4 FA = textureLod(uFieldA, root * uField.z, 0.0), FB = textureLod(uFieldB, root * uField.z, 0.0);
  vec3 col0 = FA.rgb * FA.rgb;
  float grow = FA.a;
  float approach = FB.r * 1.15;
  float flower = step(fract(aTuft.w * 71.37 + aBlade.x * 5.71), FB.b * 0.22);
  float tall = mix(0.95, 1.45, smoothstep(0.2, 0.8, FB.g)) * aBlade.z;
  float edge = 1.0 - smoothstep(uRadius * 0.8, uRadius, d);
  float height = tall * grow * edge * keep * mix(0.1, 1.0, approach) * (1.0 + 0.12 * flower);
#ifdef OTH_SHAPE
  // (the carpet follows the shapes: a little taller in the hollows, shorter on the crests — the field's B.a: its relief)
  float rel = (FB.a - 0.5) * 4.0;
  height *= clamp(1.0 - 0.14 * rel, 0.82, 1.22);
#endif
#ifndef NO_CARFLAT
  // UNDER THE CAR: pressed flat in its footprint (its local x = (cos h, −sin h), z = (sin h, cos h) in the world)
  vec2 rc = root - uCarBox.xy;
  vec2 rl = vec2(rc.x * uCarBox.z - rc.y * uCarBox.w, rc.x * uCarBox.w + rc.y * uCarBox.z);
  height *= 1.0 - 0.88 * step(abs(rl.x), uCarHalf.x) * step(abs(rl.y), uCarHalf.y);
#endif
  // the blade: out of the tuft along its fan angle, leaning out, bending with the wind
  float ang = aBlade.x + aTuft.w * 6.2832;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 side = vec2(-dir.y, dir.x);
  float t = aV.x;
  float width = 0.1 * aBlade.w * uWidthK * widen * mix(0.55, 1.0, approach) * (1.0 - t * t) * step(0.001, height);
  // A FLOWER is a grass blade like its neighbours, only its TOP in bloom (2026-11-02, the user: "they're grass blades —
  // change only the top part, don't colour the grass"; it was the blade turned over, all of it the flower's colour):
  // the fragment shader paints its top third the flower's colour (vFlower, below), the rest stays the field's
  vec2 gn = textureLod(uNoise, root * (1.0 / 37.0) - uTime * vec2(0.035, 0.02), 0.0).rg - 0.5;
  float gust = smoothstep(0.45, 0.75, textureLod(uNoise, root * (1.0 / 140.0) - uTime * vec2(0.022, 0.009), 0.0).r);
  vec2 wind = vec2(0.8, 0.35) * ((0.35 + 0.65 * sin(uTime * 1.5 + dot(root, vec2(0.21, 0.13)))) * 0.12 + gust * 0.32) + gn * 0.3;
  vec2 lean = dir * (0.05 + 0.22 * aBlade.y) + wind;
  vec2 base = root + dir * (0.03 + 0.12 * aBlade.y); // (roots spread: the tufts merge into one carpet)
  vec3 p = vec3(base.x, h - 0.04, base.y);
  p.xz += side * aV.y * width * 0.5 + lean * t * t * height;
  p.y += height * t * (1.0 - 0.3 * t * dot(lean, lean));
  vWorld = p;
  vT = t;
  // the ground's colour; each blade a touch lighter facing the sun, darker away (low-poly tone), gusts lift it
  float face = dot(dir, normalize(uSunDir.xz + vec2(1e-4)));
  // (one blade in eight stands in its neighbours' shade: the field's darker strokes)
  float br = fract(aTuft.w * 31.7 + aBlade.x * 3.1);
  vColor = col0 * (1.0 + face * 0.04 + (br - 0.5) * 0.1) * (br < 0.12 ? 0.8 : 1.0) * (1.0 + gust * 0.08);
  // the ground's light: its soft normal, leaning a little with the blade
  vN = normalize(N + vec3(dir.x, 0.0, dir.y) * 0.18);
  vSun = sunVisibility(root);
  // THE LIGHT, PER VERTEX (2026-10-27, 400 fps at 1080p: the carpet is several blades deep — every pixel was lit 3–4
  // times over): a blade has one soft normal its whole length, so its light only varies along it — lit here at its
  // ~5 vertices (the sun, the sky, the headlights' paint, the back-lit tips, the haze) and interpolated; the pixel
  // only tone-maps it
  vec3 Vv = normalize(uCamPos - p);
  float ao = mix(0.8, 1.0, smoothstep(0.0, 0.85, t));
  vec3 albedo = vColor * mix(0.9, 1.08, t);
#ifdef OTH_SHAPE
  albedo *= shapeLight(rel, N, Nb, vSun);
#endif
  vec3 c = shade(albedo, vN, Vv, 0.85, 0.03, ao, vSun, 0.62);
  c += headlight(albedo, vN, p);
  float back = pow(max(dot(-Vv, uSunDir), 0.0), 3.0);
  c += albedo * uSunColor * back * t * 0.16 * vSun; // (back-lit by a low sun, the tips glow: a soft rim)
  vColor = applyAtmos(c, p);
  // a flower's head, lit the same way (only the flower blades pay for the second light; elsewhere it is the grass)
  vFlower = vColor;
  if (flower > 0.5) {
    vec3 fa = flowerColor(root, fract(aTuft.w * 13.1)) * (0.9 + 0.2 * br) * mix(0.9, 1.08, t);
    vec3 fc = shade(fa, vN, Vv, 0.85, 0.03, ao, vSun, 0.62) + headlight(fa, vN, p) + fa * uSunColor * back * t * 0.16 * vSun;
    vFlower = applyAtmos(fc, p);
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`

const FRAG = /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
in vec3 vWorld;
in vec3 vColor;
in vec3 vFlower;
in float vT;
in vec3 vN;
in float vSun;

void main() {
  // (lit per vertex: the vertex shader's colour, interpolated — the pixel only tone-maps it; a flower blade's top
  //  third its head's colour)
  gl_FragColor = vec4(mix(vColor, vFlower, smoothstep(0.64, 0.68, vT)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`


/**
 * THE GRASS FIELD (2026-11-03, docs/MIGRATION.md — every blade vertex read the map and ran groundPaint at its root:
 * ~20 texture reads and the whole paint, the same ~45 times over for a tuft's blades and their vertices). What a ROOT
 * gets from the map — its paint (the ground's colour; the desert's own grass), whether it grows (rock, water, forest,
 * snow, scree, the tracks, mud, a boulder's foot), how far it comes up toward a track / rock (approach), the field's
 * dryness (tall) and the wildflower drift — baked into two RGBA8 maps of world-space texels (12.5 cm) round the camera
 * as it moves: the window kept within 2 m of centred, each texel whose ground changed re-baked (TOROIDAL — texel c holds
 * the window's ground X ≡ c mod n, read with wrap: nothing is copied as it slides). A blade vertex reads two texels.
 * The bake reads the paint's noise at mip 0, as the vertex shader did; the colour is stored as its square root (the
 * dark greens keep their steps in 8 bits), approach / 1.15.
 */
class GrassField {
  readonly uniforms: Record<string, GFX.IUniform>
  private readonly n: number
  private readonly t = 0.125
  private readonly rt: GFX.WebGLRenderTarget
  private readonly scene = new GFX.Scene()
  private readonly cam = new GFX.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly win = new GFX.Vector4()
  private wx = NaN
  private wz = NaN

  constructor(private readonly renderer: GFX.WebGLRenderer, radius: number, grass: Record<string, GFX.IUniform>, defines: Record<string, string>) {
    // the window: the grass's reach + 2 m of drift + a margin, in whole 16-texel steps
    this.n = Math.ceil((2 * (radius + 6)) / this.t / 16) * 16
    this.rt = new GFX.WebGLRenderTarget(this.n, this.n, { count: 2, type: GFX.UnsignedByteType, depthBuffer: false, minFilter: GFX.LinearFilter, magFilter: GFX.LinearFilter, repeat: true })
    this.uniforms = {
      uFieldA: { value: this.rt.textures[0] },
      uFieldB: { value: this.rt.textures[1] },
      uField: { value: new GFX.Vector4(this.n, this.t, 1 / (this.n * this.t), 0) },
    }
    const mat = new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3,
      uniforms: { ...grass, ...this.uniforms, uWin: { value: this.win } },
      defines: { ...defines },
      vertexShader: FIELD_VERT,
      fragmentShader: FIELD_FRAG,
      depthTest: false,
      depthWrite: false,
      // (NOT CULLED, 2026-11-03: the triangle writes clip space itself, so on WebGPU — where a bottom-origin target is
      //  drawn with the projection flipped and the front face swapped to match — it faced away and was culled: the
      //  field stayed empty and no grass grew, on WebGPU only)
      side: GFX.DoubleSide,
    })
    // one triangle over the whole target; the texels whose ground didn't change discard
    const geo = new GFX.BufferGeometry()
    geo.setAttribute('position', new GFX.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))
    const mesh = new GFX.Mesh(geo, mat)
    mesh.frustumCulled = false
    this.scene.add(mesh)
  }

  /** Keep the window on the camera: re-bake what a move uncovered (nothing while it stays within 2 m). */
  update(cx: number, cz: number): void {
    const step = 16, n = this.n, t = this.t
    const wx = Math.floor((cx / t - n / 2) / step) * step, wz = Math.floor((cz / t - n / 2) / step) * step
    if (wx === this.wx && wz === this.wz) return
    // (the first bake, or a jump past the window: every texel — "before" a whole window away matches none)
    const all = Number.isNaN(this.wx) || Math.abs(wx - this.wx) >= n || Math.abs(wz - this.wz) >= n
    this.win.set(wx, wz, all ? wx + 4 * n : this.wx, all ? wz + 4 * n : this.wz)
    this.wx = wx
    this.wz = wz
    const r = this.renderer, target = r.getRenderTarget(), auto = r.autoClear
    r.setRenderTarget(this.rt)
    r.autoClear = false
    r.render(this.scene, this.cam)
    r.setRenderTarget(target)
    r.autoClear = auto
  }

  dispose(): void { this.rt.dispose() }
}

const FIELD_VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const FIELD_FRAG = /* glsl */ `
${ATMOS_GLSL}
${HEIGHT_GLSL}
#define PAINT_TEX(uv) textureLod(uNoise, uv, 0.0)
${PAINT_GLSL}
${SHADOW_GLSL}
uniform sampler2D uMask;
uniform sampler2D uMud;
uniform sampler2D uOwn;
uniform sampler2D uNIn;
uniform sampler2D uRocks;
uniform sampler2D uTrail;
uniform float uTrailHW;
uniform vec4 uMaskGrid;
uniform vec4 uField;
uniform vec4 uWin; // the window's first texel (x, z) now, and before
layout(location = 0) out highp vec4 oA;
layout(location = 1) out highp vec4 oB;

vec3 unpackN(vec2 e) { vec2 n = e * 2.0 - 1.0; return vec3(n.x, sqrt(max(1.0 - dot(n, n), 0.0)), n.y); }

void main() {
  // this texel's ground in the window, now and before
  vec2 c = floor(gl_FragCoord.xy);
  vec2 X = uWin.xy + mod(c - uWin.xy, uField.x);
  vec2 X0 = uWin.zw + mod(c - uWin.zw, uField.x);
  if (X.x == X0.x && X.y == X0.y) discard;
  vec2 root = (X + 0.5) * uField.y;
  // (the grass vertex shader's root, as it was before 2026-11-03)
  float h = terrainHeight(root);
  vec4 m = textureLod(uMask, ((root - uMaskGrid.z) / uMaskGrid.y + 0.5) / uMaskGrid.x, 0.0);
  vec3 N = unpackN(textureLod(uNIn, ((root - uInGrid.z) / uInGrid.y + 0.5) / uInGrid.x, 2.5).rg);
  float trail = textureLod(uTrail, ((root - uInGrid.z) / uInGrid.y + 0.5) / uInGrid.x, 0.0).r * 8.0;
  // (the blade's colour is the FIELD's: painted without the track, so the blades at its edge don't take the earth)
  Ground g = groundPaint(root, m, h, 1.0 - N.y, paintNoise(root), 0.0, 99.0, uTrailHW, 0.0); // (no painted shrub dots under the grass: the bushes are real there)
  float tx = trail < uTrailHW + 3.5 ? trackEdge(root, trail) : trail; // (beyond its reach the edge changes nothing: exact)
  float onTrack = 1.0 - smoothstep(uTrailHW - 0.35, uTrailHW + 0.15, tx); // (trackMask, its ragged distance kept)
  // (none on rock, snow, the water's gravel and the earth band along it; thinner under the forest)
  // (never on rock: none where the ground shows any rock or scree tint at all — the user: "never put grass on rock")
  float grow = (1.0 - smoothstep(0.02, 0.1, g.rock)) * (1.0 - smoothstep(0.855, 0.875, m.b)) * (1.0 - 0.6 * g.forest) * (1.0 - g.snow) * (1.0 - smoothstep(0.02, 0.1, g.scree));
  grow *= (1.0 - smoothstep(0.3, 0.6, onTrack)); // (off the track)
#ifdef OTH_DESERT
  // THE DESERT: grass only in the oasis (its growth, the damp banks) — the open sand stays bare
  float oasis = max(smoothstep(0.15, 0.5, m.a), smoothstep(0.45, 0.8, m.b / 0.85)) * smoothstep(0.15, 0.5, g.lawn); // (in its green patches only)
  grow = (1.0 - smoothstep(0.02, 0.1, g.rock)) * (1.0 - smoothstep(0.855, 0.875, m.b)) * oasis * (1.0 - smoothstep(0.3, 0.6, onTrack));
#endif
  vec2 mudB = textureLod(uMud, ((root - uMaskGrid.z) / uMaskGrid.y + 0.5) / uMaskGrid.x, 0.0).rg;
  float mud = mudB.r;
  // WILDFLOWERS (mud.bin G): where the field blossoms, one blade in ~5 is a flower — a grass blade in bloom at its
  // top (below), standing a little over the others
  grow *= 1.0 - smoothstep(0.25, 0.55, mud); // (none in the mud: a reedy fringe round it, below)
  // (none on a lake's or a pond's floor — mapPrep.ts waterOwner G: the depth under it, 128 + 64 / m; the desert's oasis
  //  grew a carpet under the lagoon's shallows)
  float under = (textureLod(uOwn, ((root - uMaskGrid.z) / uMaskGrid.y + 0.5) / uMaskGrid.x, 0.0).g * 255.0 - 128.0) / 64.0;
  grow *= 1.0 - smoothstep(-0.02, 0.06, under);
  vec2 inUv = ((root - uInGrid.z) / uInGrid.y + 0.5) / uInGrid.x;
  grow *= 1.0 - smoothstep(0.0, 0.3, textureLod(uRocks, inUv, 0.0).r); // (none at a boulder's foot)
  // SHORTER TOWARD BARE GROUND (the user: "when the grass comes to rock or the path, its height must reduce
  // gradually"): full height a few metres off, a tenth where it stops — the track by its ragged edge's distance (over
  // 2.5 m), terrain rock / scree by their fields read early (~2–6 m), a boulder by its footprint blurred a mip and a
  // half up (~3 m round it). (The water's banks keep their edge: the mask can't tell a bank from a wet meadow.)
  float approach = smoothstep(uTrailHW, uTrailHW + 2.5, tx);
  approach = min(approach, (1.0 - g.rockNear) * (1.0 - g.screeNear));
  approach = min(approach, 1.0 - smoothstep(0.02, 0.45, textureLod(uRocks, inUv, 1.5).r));
  approach = max(approach * (1.0 - smoothstep(0.1, 0.3, mud)), smoothstep(0.08, 0.25, mud) * 1.15); // (REEDS: the marsh's edge tall)
  // (the desert's too, 2026-11-04: its blades take the ground's colour — the oasis floor's green, olive and khaki at its
  //  edge (paint.ts) — as the valley's do; they had a colour of their own over a red ground)
  vec3 col0 = g.col;
  oA = vec4(sqrt(max(col0, vec3(0.0))), clamp(grow, 0.0, 1.0));
  oB = vec4(clamp(approach / 1.15, 0.0, 1.0), m.g, mudB.g, clamp(groundRelief(root) * 0.25 + 0.5, 0.0, 1.0)); // (A: the small shapes, ±2 m)
}
`
