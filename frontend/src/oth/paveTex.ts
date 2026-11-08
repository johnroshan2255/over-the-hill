import * as GFX from './gfx'

/**
 * THE PAVING (2026-11-08, the user: "places like houses, broken houses — no grass there; change the terrain's shader
 * there: on mobile just a texture, on PC something like [weathered flagstones]; the colour from the terrain's"): one
 * tileable 512² RGBA8 texture generated at boot (no download, ~15 ms) of RANDOM-ASHLAR flagstones — rows of uneven
 * height, stones of uneven length, some split in two, each a soft pillow with a rounded, chipped edge, a little tilted,
 * a faint chiselled ridge across it, sunk into its joint — and grit in the joints. The terrain lays it over a place's
 * ground (Terrain.ts PAVE_GLSL), tinted by that ground's own colour:
 *   R  height: 0 the joint … ~1 a stone's top          G B  its normal's x, z (0.5 + 0.5 n; the height's slope)
 *   A  the stone's id (0 … 1, one value over the stone and the half joint round it): the paving's edge drops stones
 *      one by one where its cover falls under their id, and each stone's tone is a hash of it
 * Linear + mipmaps + repeat: far off it averages to the paving's mean.
 */
export const PAVE_TILE_M = 4.8 // (metres a tile spans: ~0.94 cm a texel, stones ~0.45 … 1.4 m)
const S = 512

function hash(ix: number, iy: number, s: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 144665)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
/** Periodic value noise over the tile (cell px; S a multiple of it), ~[-1, 1]. */
function vnoise(x: number, y: number, cell: number, s: number): number {
  const P = S / cell, fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy
  const h = (i: number, j: number) => hash(((i % P) + P) % P, ((j % P) + P) % P, s) * 2 - 1
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v)
  return (h(ix, iy) * (1 - su) + h(ix + 1, iy) * su) * (1 - sv) + (h(ix, iy + 1) * (1 - su) + h(ix + 1, iy + 1) * su) * sv
}

/** Integer lengths in [lo, hi] (random) summing to exactly S. */
function split(lo: number, hi: number, rnd: () => number): number[] {
  const raw: number[] = []
  let sum = 0
  while (sum < S) { const l = lo + (hi - lo) * rnd(); raw.push(l); sum += l }
  const out: number[] = []
  let acc = 0, prev = 0
  for (const l of raw) { acc += l; const b = Math.round((acc / sum) * S); out.push(b - prev); prev = b }
  return out
}

export function createPaveTexture(): GFX.DataTexture {
  let seed = 0x9e3779b9
  const rnd = () => { seed = (Math.imul(seed ^ (seed >>> 15), 2246822519) + 0x6d2b79f5) | 0; return ((seed ^ (seed >>> 13)) >>> 0) / 4294967296 }
  const H = new Float32Array(S * S), ID = new Float32Array(S * S)
  // the stones: x0 (may run past S: wraps), y0, w, h
  const stones: [number, number, number, number][] = []
  let y = 0
  for (const rh of split(48, 98, rnd)) {
    let x = Math.floor(rnd() * S)
    for (const w of split(62, 150, rnd)) {
      // (random ashlar: a tall stone sometimes two, one over the other, or side by side)
      const k = rnd()
      if (rh > 68 && k < 0.3) { const a = Math.round(rh * (0.4 + 0.2 * rnd())); stones.push([x, y, w, a], [x, y + a, w, rh - a]) }
      else if (w > 116 && k > 0.8) { const a = Math.round(w * (0.4 + 0.2 * rnd())); stones.push([x, y, a, rh], [x + a, y, w - a, rh]) }
      else stones.push([x, y, w, rh])
      x += w
    }
    y += rh
  }
  stones.forEach(([x0, y0, w, h], n) => {
    const id = 0.02 + 0.97 * rnd()
    const jw = 1.3 + 1.0 * rnd(), cr = 4 + 7 * rnd(), bev = 4 + 5 * rnd()
    const hx = w / 2 - jw, hy = h / 2 - jw
    const tx = (rnd() - 0.5) * 0.22, ty = (rnd() - 0.5) * 0.22, top = 0.8 + 0.12 * rnd()
    const ra = rnd() * Math.PI, rdx = Math.cos(ra), rdy = Math.sin(ra), ridge = 0.04 + 0.07 * rnd()
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const px = (x0 + i) % S, py = y0 + j, k = py * S + px
      ID[k] = id
      // the rounded rectangle's signed distance (px), its edge wobbling and chipped
      const lx = i + 0.5 - w / 2, ly = j + 0.5 - h / 2
      const qx = Math.abs(lx) - (hx - cr), qy = Math.abs(ly) - (hy - cr)
      let sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - cr
      sd += vnoise(px, py, 16, 11) * 1.6 + vnoise(px, py, 4, 12) * 0.7 + Math.max(0, vnoise(px, py, 32, 13 + n) - 0.5) * 6
      const e = Math.min(1, Math.max(0, -sd / bev)), edge = Math.sqrt(1 - (1 - e) * (1 - e))
      // the top: tilted, a chiselled ridge across it, pitted
      const along = Math.abs(lx * rdx + ly * rdy) / Math.max(1, Math.min(hx, hy) * 1.6)
      const t = top + tx * (lx / Math.max(1, hx)) + ty * (ly / Math.max(1, hy)) + ridge * (1 - Math.min(1, along)) + vnoise(px, py, 8, 14) * 0.025 + vnoise(px, py, 2, 15) * 0.012
      H[k] = edge * t
    }
  })
  // grit in the joints: small pebbles, half buried
  for (let n = 0; n < 900; n++) {
    const cx = rnd() * S, cy = rnd() * S, r = 1.4 + 2.6 * rnd(), ph = 0.18 + 0.2 * rnd()
    for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
      const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy) / r
      if (d >= 1) continue
      const k = (((j % S) + S) % S) * S + (((i % S) + S) % S)
      if (H[k] < 0.12) H[k] = Math.max(H[k], ph * Math.sqrt(1 - d * d))
    }
  }
  // the normal from the height (a stone's top ~3.5 cm over its joint: 3.7 texels)
  const data = new Uint8Array(S * S * 4), Z = 3.7
  const at = (i: number, j: number) => H[(((j + S) % S) * S) + ((i + S) % S)]
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const k = j * S + i, dx = (at(i + 1, j) - at(i - 1, j)) * 0.5 * Z, dz = (at(i, j + 1) - at(i, j - 1)) * 0.5 * Z
    const l = Math.hypot(dx, 1, dz)
    data[k * 4] = Math.round(Math.min(1, Math.max(0, H[k])) * 255)
    data[k * 4 + 1] = Math.round((0.5 - (0.5 * dx) / l) * 255)
    data[k * 4 + 2] = Math.round((0.5 - (0.5 * dz) / l) * 255)
    data[k * 4 + 3] = Math.round(ID[k] * 255)
  }
  const t = new GFX.DataTexture(data, S, S, GFX.RGBAFormat, GFX.UnsignedByteType)
  t.wrapS = t.wrapT = GFX.RepeatWrapping
  t.minFilter = GFX.LinearMipmapLinearFilter
  t.magFilter = GFX.LinearFilter
  t.generateMipmaps = true
  t.anisotropy = 4
  t.userData.shared = true // (every world's: World.dispose keeps it)
  t.needsUpdate = true
  return t
}

/** The paving's frame (GLSL, the terrain's and the grass field's): uPave, the FOUR paved places nearest the camera
 *  (Terrain.update: x, z, rot, the paving's reach r of each — none: r 0). `paveFrame(xz, F)` false where no paving
 *  reaches (the ALU gate: no texture read there — 2026-11-08, the mask read on every pixel cost ULTRA ~0.1–0.17 ms),
 *  else F the place whose reach it's deepest in, as (x, z, cos, sin); `paveUv(xz, F)` the texture's uv square to it. */
export const PAVE_FRAME_GLSL = /* glsl */ `
uniform sampler2D uPave;
uniform vec4 uPave0;
uniform vec4 uPave1;
uniform vec4 uPave2;
uniform vec4 uPave3;
const float PAVE_TILE = ${PAVE_TILE_M.toFixed(2)};
// (no local array or loop: ANGLE's D3D11 can make an indexable temp of one — four straight tests)
float paveQ(vec2 xz, vec4 p) { vec2 d = xz - p.xy; return dot(d, d) / max(p.w * p.w, 1e-6); }
bool paveFrame(vec2 xz, out vec4 F) {
  float q0 = paveQ(xz, uPave0), q1 = paveQ(xz, uPave1), q2 = paveQ(xz, uPave2), q3 = paveQ(xz, uPave3);
  if (min(min(q0, q1), min(q2, q3)) >= 1.0) return false;
  vec4 p = q0 <= min(q1, min(q2, q3)) ? uPave0 : q1 <= min(q2, q3) ? uPave1 : q2 <= q3 ? uPave2 : uPave3;
  F = vec4(p.xy, cos(p.z), sin(p.z));
  return true;
}
vec2 paveUv(vec2 xz, vec4 F) { vec2 d = xz - F.xy; return vec2(d.x * F.z - d.y * F.w, d.x * F.w + d.y * F.z) * (1.0 / PAVE_TILE); }
`
