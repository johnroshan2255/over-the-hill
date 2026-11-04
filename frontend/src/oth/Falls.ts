import * as GFX from './gfx'
import { ATMOS_GLSL, FRAG_OUT, type Atmosphere } from './Atmosphere'
import { type CullPart, cullHidden } from './Bridges'
import type { Horizon } from './Horizon'
import type { MapData } from './MapData'

/**
 * WATERFALLS (meta.water.falls — scripts/oth/scenery.mjs): each a SHEET of falling water from its lip to the plunge
 * pool, arcing out a little as it drops (more the taller it is), white streaks racing down over light blue, ragged
 * strands at its edges; at its foot a churning FOAM disc spreading on the pool and a soft drift of MIST. Cheap: a
 * fall in two draws (its sheet, its foot), only when it's in view and not behind the hills; the paint noise the only
 * texture.
 */
const ROWS = 12

type Fall = NonNullable<MapData['meta']['water']['falls']>[number]
/** A fall's LIP where the ground really ends (2026-11-04, the user's screenshots: sheets hanging in the air — the
 *  valley's Hidden Falls and Veil Falls 3–5 m out in front of their cliffs, the desert's Spring Falls 126 m over the
 *  canyon floor with no cliff at all): along the fall's way out (lip → foot) the first point where the ground drops a
 *  quarter of the fall (≥ 2.5 m) under the water's surface, searched from 30 m behind the lip, then back to the brink
 *  (the last point within 1.5 m of the surface); `face(y)` = how far out from there the ground is first below y — the
 *  sheet keeps in front of the rock it falls past. Null when the ground behind the lip is already far below it:
 *  there's no cliff to fall from. */
export function fallLip(map: MapData, f: Fall): { x: number; z: number; y: number; dx: number; dz: number; hw: number; drop: number; face: (y: number, side: number) => number } | null {
  let dx = f.bx - f.x, dz = f.bz - f.z
  const l = Math.hypot(dx, dz)
  if (l < 1e-3) return null
  dx /= l; dz /= l
  const H = Math.max(0.5, f.y - f.by), D = Math.max(2.5, 0.25 * H)
  const g = (s: number, side = 0) => map.height(f.x + dx * s - dz * side, f.z + dz * s + dx * side)
  let edge = NaN
  for (let s = -30, top = false; s <= 12; s += 0.25) {
    const below = g(s) < f.y - D
    if (!below) top = true
    else if (top) { edge = s - 0.25; break }
  }
  if (Number.isNaN(edge)) return null
  // … and back up to the brink (a sloped or stepped face: the point a quarter of the way down lay metres out from it)
  while (edge > -30 && g(edge) < f.y - 1.5) edge -= 0.25
  const x = f.x + dx * edge, z = f.z + dz * edge
  const face = (y: number, side: number) => {
    for (let s = 0; s <= 40; s += 0.25) if (map.height(x + dx * s - dz * side, z + dz * s + dx * side) < y) return s
    return 40
  }
  return { x, z, y: f.y, dx, dz, hw: f.hw, drop: H, face }
}

export class Falls {
  readonly group = new GFX.Group()
  /** The hills' occlusion (main.ts). */
  horizon: Horizon | null = null
  private parts: CullPart[] = []

  constructor(map: MapData, atmos: Atmosphere) {
    const F = map.meta.water.falls ?? []
    if (!F.length) return
    const sheetMat = new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3, uniforms: { ...atmos.uniforms }, vertexShader: SHEET_VERT, fragmentShader: SHEET_FRAG,
      transparent: true, depthWrite: false, side: GFX.DoubleSide,
    })
    const footMat = new GFX.ShaderMaterial({
      glslVersion: GFX.GLSL3, uniforms: { ...atmos.uniforms }, vertexShader: FOOT_VERT, fragmentShader: FOOT_FRAG,
      transparent: true, depthWrite: false,
    })
    // (the falls of a 500 m cell — a stream's cascades — share a sheet and a foot mesh, drawn only when in view and not
    //  behind the hills — `cull`; they stand in hidden basins and gorges: one mesh for all 28 was drawn from everywhere)
    const cells = new Map<string, typeof F>()
    for (const f of F) { const k = `${Math.floor(f.x / 500)},${Math.floor(f.z / 500)}`; cells.set(k, [...(cells.get(k) ?? []), f]) }
    for (const cell of cells.values()) {
      // the sheets: ROWS × 2 vertices each — aUV = (across −1…1, down 0…1), aDrop = the fall's height (m)
      const pos: number[] = [], uv: number[] = [], drop: number[] = [], idx: number[] = []
      // the feet: a foam disc (4 corners, aKind 0) and two mist billboards (4 corners each, aKind 1) — aCorner = the
      // corner (−1…1), aSize = radius / half size (m)
      const fpos: number[] = [], corner: number[] = [], size: number[] = [], kind: number[] = [], fidx: number[] = []
      const box = new GFX.Box3()
      for (const f of cell) {
        const lip = fallLip(map, f)
        if (!lip) { console.warn(`[falls] no cliff under the lip at ${f.x}, ${f.z} (${f.y} m): not drawn`); continue }
        const { dx, dz } = lip, sx = -dz, sz = dx, H = Math.max(0.5, f.y - f.by)
        // (the arc: thrown out over the lip, ~0.4 m for a short drop … ~2 m for a tall one — and never into the face)
        const reach = (t: number) => 0.25 + Math.min(2.2, 0.55 * Math.sqrt(H)) * Math.sqrt(t)
        const base = pos.length / 3
        // (no further out than the foot itself: a scree apron above the pool would draw the sheet's last rows out along it)
        const far = Math.max(reach(1), (f.bx - lip.x) * dx + (f.bz - lip.z) * dz + 1)
        let foot = 0
        for (let r = 0; r <= ROWS; r++) {
          const t = r / ROWS, w = f.hw * (1 + 0.18 * t), y = f.y + 0.05 - (H + 0.1) * t
          for (const side of [-1, 1]) {
            const o = Math.max(reach(t), r === 0 ? 0 : Math.min(far, lip.face(y + 0.3, w * side) + 0.35))
            if (r === ROWS) foot += o / 2
            pos.push(lip.x + dx * o + sx * w * side, y, lip.z + dz * o + sz * w * side)
            box.expandByPoint(new GFX.Vector3(pos[pos.length - 3], pos[pos.length - 2], pos[pos.length - 1]))
            uv.push(side, t)
            drop.push(H)
          }
          if (r < ROWS) { const k = base + r * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2) }
        }
        // the foot: where the sheet meets the pool
        const cx = lip.x + dx * foot, cz = lip.z + dz * foot
        const quad = (y: number, s: number, kd: number) => {
          const b = fpos.length / 3
          for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { fpos.push(cx, y, cz); corner.push(a, c); size.push(s); kind.push(kd) }
          fidx.push(b, b + 1, b + 2, b, b + 2, b + 3)
        }
        quad(f.by + 0.04, f.hw * 1.9, 0)
        const ms = f.hw * 1.8 + H * 0.4
        quad(f.by + ms * 0.45, ms, 1)
        quad(f.by + ms * 0.8, ms * 0.8, 1.5)
        // (the box: the sheet, and the mist rising round its foot)
        box.expandByPoint(new GFX.Vector3(cx - ms, f.by + ms * 1.6, cz - ms)).expandByPoint(new GFX.Vector3(cx + ms, f.by, cz + ms))
      }
      const sheet = new GFX.BufferGeometry()
      sheet.setAttribute('position', new GFX.Float32BufferAttribute(pos, 3))
      sheet.setAttribute('aUV', new GFX.Float32BufferAttribute(uv, 2))
      sheet.setAttribute('aDrop', new GFX.Float32BufferAttribute(drop, 1))
      sheet.setIndex(idx)
      sheet.computeBoundingSphere()
      const sheetMesh = new GFX.Mesh(sheet, sheetMat)
      sheetMesh.renderOrder = 6
      const feet = new GFX.BufferGeometry()
      feet.setAttribute('position', new GFX.Float32BufferAttribute(fpos, 3))
      feet.setAttribute('aCorner', new GFX.Float32BufferAttribute(corner, 2))
      feet.setAttribute('aSize', new GFX.Float32BufferAttribute(size, 1))
      feet.setAttribute('aKind', new GFX.Float32BufferAttribute(kind, 1))
      feet.setIndex(fidx)
      feet.computeBoundingSphere()
      feet.boundingSphere!.radius += 30 // (the billboards grow round their centres)
      const footMesh = new GFX.Mesh(feet, footMat)
      footMesh.renderOrder = 7
      const one = new GFX.Group()
      one.add(sheetMesh, footMesh)
      this.group.add(one)
      this.parts.push({ obj: one, box })
    }
  }

  /** Skip the falls the hills hide (once a frame; the view culls the rest). */
  cull(): void { cullHidden(this.parts, this.horizon) }
}

const SHEET_VERT = /* glsl */ `
in vec2 aUV;
in float aDrop;
out vec2 vUV;
out float vDrop;
out vec3 vWorld;
void main() {
  vUV = aUV;
  vDrop = aDrop;
  vWorld = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`
const SHEET_FRAG = /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
in vec2 vUV;
in float vDrop;
in vec3 vWorld;
// (2026-10-27, "real waterfall effect like in Over the Hill — cheap"): PAINTED in three tones — deep teal where the
// water is a clear sheet, light aqua, white foam — not a frosted pane. Two noise layers race down at different scales
// and speeds (big slow ropes of water, fast fine strands); the lip a smooth glassy curl (dark teal, a bright line where
// it breaks over); whiter as it falls (air beaten into it); the edges torn into strands; the foot lost in white spray.
const vec3 DEEP = vec3(0.07, 0.25, 0.3);
const vec3 AQUA = vec3(0.36, 0.66, 0.72);
const vec3 FOAM = vec3(0.9, 0.95, 0.97);
void main() {
  float down = vUV.y * vDrop, across = vUV.x * 2.2;
  float t = vUV.y;
  float a1 = texture(uNoise, vec2(across / 1.1, (down - uTime * 5.0) / 11.0)).r;
  float a2 = texture(uNoise, vec2(across / 0.32 + 0.37, (down - uTime * 7.5) / 3.2)).g;
  float v = 0.55 * a1 + 0.45 * a2 + 0.28 * smoothstep(0.05, 0.7, t) - 0.12;
  // the lip: a smooth glassy curl over the first metre, then it breaks
  float lip = 1.0 - smoothstep(0.0, min(0.35, 1.2 / vDrop), t);
  v = mix(v, 0.18 + 0.15 * a1, lip);
  // three painted tones, a soft step between them
  vec3 c = mix(DEEP, AQUA, smoothstep(0.36, 0.42, v));
  c = mix(c, FOAM, smoothstep(0.55, 0.61, v));
  float brk = (1.0 - smoothstep(0.0, 0.03, abs(t - min(0.3, 1.0 / vDrop)))) * 0.8; // (the bright line where it breaks)
  c = mix(c, FOAM, brk);
  // the foot: white spray
  c = mix(c, FOAM, smoothstep(0.78, 0.97, t));
  // torn edges (strands), the clear sheet see-through a little, the spray thinning out at the bottom
  float edge = 1.0 - smoothstep(0.55, 1.0, abs(vUV.x) + (a2 - 0.5) * 0.5 + (a1 - 0.5) * 0.2);
  float alpha = edge * mix(0.72, 1.0, smoothstep(0.36, 0.6, v)) * smoothstep(0.0, 0.02, t) * (1.0 - smoothstep(0.9, 1.0, t) * (0.5 + 0.5 * a2));
  if (alpha < 0.02) discard;
  // lit like the stylized rock: the sun, the sky, soft (a falling sheet faces every way at once)
  vec3 light = ambient(vec3(0.0, 1.0, 0.0)) * 1.25 + uSunColor * 0.55;
  gl_FragColor = vec4(applyAtmos(c * light, vWorld), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

const FOOT_VERT = /* glsl */ `
in vec2 aCorner;
in float aSize;
in float aKind;
out vec2 vCorner;
out float vKind;
out vec3 vWorld;
void main() {
  vCorner = aCorner;
  vKind = aKind;
  vec3 p = position;
  if (aKind < 0.5) {
    p.xz += aCorner * aSize; // the foam: flat on the pool
  } else {
    // the mist: a billboard facing the camera
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    p += (right * aCorner.x + up * aCorner.y) * aSize;
  }
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`
const FOOT_FRAG = /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
in vec2 vCorner;
in float vKind;
in vec3 vWorld;
void main() {
  float r = length(vCorner);
  if (r > 1.0) discard;
  vec3 light = ambient(vec3(0.0, 1.0, 0.0)) * 1.15 + uSunColor * 0.5;
  float alpha;
  if (vKind < 0.5) {
    // FOAM: churning, spreading out from where the sheet lands, a ragged edge
    float a = atan(vCorner.y, vCorner.x);
    float n = texture(uNoise, vec2(a * 0.8, r * 1.6 - uTime * 0.7)).g;
    float m = texture(uNoise, vWorld.xz / 2.2 + uTime * vec2(0.08, -0.05)).r;
    float ring = 0.5 + 0.5 * sin((r * 7.0 - uTime * 2.2) * 3.1416 + n * 3.0); // (rings of foam running out)
    alpha = (1.0 - smoothstep(0.3 + 0.35 * n, 1.0, r)) * (0.5 + 0.35 * m + 0.25 * ring * smoothstep(0.2, 0.6, r));
  } else {
    // MIST: a soft white cloud of spray, churning (a painted puff, not a fog)
    float n = texture(uNoise, vCorner * 0.35 + vec2(uTime * 0.03, -uTime * 0.05) + vKind).r;
    float n2 = texture(uNoise, vCorner * 0.9 - vec2(uTime * 0.07, uTime * 0.11) + vKind * 0.3).g;
    alpha = (1.0 - smoothstep(0.15 + 0.25 * n2, 1.0, r)) * (0.16 + 0.2 * n) * (vKind > 1.2 ? 0.8 : 1.0);
  }
  gl_FragColor = vec4(applyAtmos(vec3(0.88, 0.92, 0.95) * light, vWorld), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
