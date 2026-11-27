import * as GFX from './gfx'
import type { Lamp, Lens, TruckModel } from '../assets/loadModels'

/** How far a halo reaches beyond its lens's outline, in the lens's half widths (the smaller). */
const HALO = 2
const BEAM_RINGS = 12, BEAM_SIDES = 14

/**
 * A CAR'S LIT LAMPS (2026-11-27, the user: "the light must come exactly from the car's brake light and headlight —
 * not a nanometre of difference; if the lamp is round in the car's design our light must be that shape too"). Until
 * then a lamp's place was guessed from the texture's brightest patch (the bumper, the plate, the grille's surround on
 * most cars — the off-roader's light 42 cm inboard of its lens) and its light was a round blob three lenses wide
 * whatever the lamp.
 *
 * Now WHAT IS LIT IS THE LENS: the model's own lens faces (loadModels `lampsOf`), drawn again on themselves in light —
 * the same vertices, so nothing to place and nothing to be off; they follow the body when it is dented (`follow`).
 * Round each lens a soft HALO in its own shape — a disc's round, a square lamp's square with round corners — falling
 * off with the distance from its outline (as far as the old blob reached: twice the lens's half width). A lens the
 * model does not name (the E30's, measured — the catalogue's `lamps`) is drawn as its disc / square on the body's
 * surface there.
 *
 * ONE DRAW for the four lamps — head left, head right, tail left, tail right — where there were two (the heads' quads,
 * the tails'); each lamp's brightness its own (`set`: a broken lamp, a lamp off, is given no size). The BEAMS in the air
 * (`beams`) start as the head lamps' outlines; `at` is where each lamp's light starts — the painted beams on the
 * world and the brake lights' pool behind (Atmosphere `headlight()`) are put there.
 */
export class CarLamps {
  readonly mesh: GFX.Mesh
  /** Head left, head right, tail left, tail right — null: the car has no such lamp. */
  readonly lamps: (Lamp | null)[]
  /** Where each lamp's light starts NOW (car space): the middle of its biggest lens, on its face. */
  readonly at: (GFX.Vector3 | null)[] = [null, null, null, null]
  /** The head lamps' beams in the air (car space; its `t`: 0 at the lens … 1 at the far rim) — null without head lamps. */
  readonly beams: GFX.BufferGeometry | null = null
  private readonly lit: { lens: Lens; lamp: number; main: boolean; core: number; n: number; halo: number }[] = []
  private readonly pos: GFX.BufferAttribute
  private readonly rest: Float32Array
  private readonly live = new GFX.Vector4()

  constructor(model: TruckModel) {
    const L = model.lamps
    this.lamps = [L.head?.[0] ?? null, L.head?.[1] ?? null, L.tail?.[0] ?? null, L.tail?.[1] ?? null]
    // (each vertex: where it is; `q` — where from its lens's middle (m), the lens's half width and height; `s` — what it is
    //  (0 a lens's own face, 1 its halo, 2 a face under a measured lens), round or square, which lamp)
    const P: number[] = [], Q: number[] = [], S: number[] = []
    const src = (ofGlass: boolean) => ((ofGlass ? model.glass : model.body).getAttribute('position') as GFX.BufferAttribute).array
    this.lamps.forEach((lamp, k) => {
      if (!lamp) return
      const dir = k < 2 ? -1 : 1
      this.at[k] = new GFX.Vector3(...lamp.c)
      lamp.lenses.forEach((lens, i) => {
        const put = (x: number, y: number, z: number, qx: number, qy: number, halo: number) => { P.push(x, y, z); Q.push(qx, qy, lens.w, lens.h); S.push(halo, lens.round ? 1 : 0, k) }
        const [cx, cy, cz] = lens.c
        // (a face looking back is wound the other way round from one looking ahead)
        const tri = (a: number[], b: number[], c: number[], halo: number) => { for (const v of dir > 0 ? [a, b, c] : [a, c, b]) put(cx + v[0], cy + v[1], cz, v[0], v[1], halo) }
        const core = P.length / 3
        if (lens.verts) {
          // THE LENS'S OWN FACES
          // (a measured lens's are the body's whole faces under it: each vertex told where it is from the lens's
          //  middle, the light cut to the outline in the shader)
          const A = src(lens.ofGlass)
          for (const v of lens.verts) put(A[v * 3], A[v * 3 + 1], A[v * 3 + 2], lens.clip ? A[v * 3] - cx : 0, lens.clip ? A[v * 3 + 1] - cy : 0, lens.clip ? 2 : 0)
        } else {
          // (none named in the model: its disc / its square, on the body's surface)
          const ring = lens.round ? Array.from({ length: 32 }, (_, j) => [Math.cos((j / 32) * Math.PI * 2) * lens.w, Math.sin((j / 32) * Math.PI * 2) * lens.h]) : [[lens.w, lens.h], [-lens.w, lens.h], [-lens.w, -lens.h], [lens.w, -lens.h]]
          for (let j = 0; j < ring.length; j++) tri([0, 0], ring[j], ring[(j + 1) % ring.length], 0)
        }
        const n = P.length / 3 - core, halo = P.length / 3
        // THE HALO: a sheet in the lens's plane, twice its half width beyond its outline all round
        const m = HALO * Math.min(lens.w, lens.h), X = lens.w + m, Y = lens.h + m
        tri([-X, -Y], [X, -Y], [X, Y], 1)
        tri([-X, -Y], [X, Y], [-X, Y], 1)
        this.lit.push({ lens, lamp: k, main: i === 0, core, n, halo })
      })
    })
    const g = new GFX.BufferGeometry()
    this.pos = new GFX.BufferAttribute(new Float32Array(P), 3)
    this.rest = (this.pos.array as Float32Array).slice()
    g.setAttribute('position', this.pos)
    g.setAttribute('q', new GFX.BufferAttribute(new Float32Array(Q), 4))
    g.setAttribute('s', new GFX.BufferAttribute(new Float32Array(S), 3))
    this.mesh = new GFX.Mesh(g, new GFX.ShaderMaterial({
      uniforms: { uLive: { value: this.live }, uHead: { value: new GFX.Color(1, 0.9, 0.72) }, uTail: { value: new GFX.Color(1, 0.07, 0.03) } },
      vertexShader: /* glsl */ `
        attribute vec4 q;
        attribute vec3 s;
        uniform vec4 uLive;
        uniform vec3 uHead;
        uniform vec3 uTail;
        varying vec4 vQ;
        varying vec2 vS;
        varying vec3 vC;
        void main() {
          float k = s.z < 0.5 ? uLive.x : s.z < 1.5 ? uLive.y : s.z < 2.5 ? uLive.z : uLive.w;
          vQ = q; vS = s.xy; vC = (s.z < 1.5 ? uHead : uTail) * k;
          // (a lamp off or broken: no size. The body's own sum, term for term — Vehicle.ts VERT: the model's matrix
          //  first, then the view's — so a lit face's depth IS its lens's: (view × model) first rounds another way,
          //  a millimetre out here kilometres from the origin, and whole triangles of a lens lost the depth test)
          vec4 w = modelMatrix * vec4(k > 0.0 ? position : vec3(0.0), 1.0);
          // (… and 2 mm nearer the eye ALONG ITS OWN SIGHT LINE: the same pixel to the bit, only its depth nearer — a
          //  GPU that rounds the two shaders apart still draws the light over its lens)
          w.xyz += normalize(cameraPosition - w.xyz) * 0.002;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      // (above white: the bloom spreads it)
      fragmentShader: /* glsl */ `
        varying vec4 vQ;
        varying vec2 vS;
        varying vec3 vC;
        void main() {
          float a = 1.2;                                   // the lens's own faces: lit
          if (vS.x > 0.5) {
            // d: how far outside the lens's outline (m; inside: under 0) — a disc's or a square's
            vec2 p = abs(vQ.xy), hw = vQ.zw;
            float rmin = min(hw.x, hw.y), d;
            if (vS.y > 0.5) { float e = length(p / hw); d = length(p) * (1.0 - 1.0 / max(e, 1e-4)); }
            else d = length(max(p - hw, 0.0)) + min(max(p.x - hw.x, p.y - hw.y), 0.0);
            // a measured lens — the body's whole faces under it: lit inside the outline only
            if (vS.x > 1.5) a = 1.2 * (1.0 - smoothstep(-0.0015, 0.0015, d));
            // the halo (2 mm under the lens's edge too: no dark seam between the two)
            else a = d > -0.002 ? pow(max(1.0 - (rmin + max(d, 0.0)) / (${(1 + HALO).toFixed(1)} * rmin), 0.0), 2.2) * 0.32 : 0.0;
          }
          gl_FragColor = vec4(vC * a, 1.0);
        }`,
      blending: GFX.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
      // (the lit faces lie ON the lens's: drawn a hair nearer, not fought over)
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -8,
    }))
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 4          // (after the car's glass — 3: a lens under a pane of it, the G500's, is not dimmed by the pane)
    this.mesh.visible = false
    if (this.lamps[0] && this.lamps[1]) {
      const R = BEAM_RINGS, S2 = BEAM_SIDES, tt: number[] = [], idx: number[] = []
      for (let sd = 0; sd < 2; sd++) {
        const base = sd * (R + 1) * S2
        for (let i = 0; i <= R; i++) for (let j = 0; j < S2; j++) tt.push(i / R)
        for (let i = 0; i < R; i++) for (let j = 0; j < S2; j++) {
          const a0 = base + i * S2 + j, a1 = base + i * S2 + ((j + 1) % S2), b0 = a0 + S2, b1 = a1 + S2
          idx.push(a0, b0, a1, a1, b0, b1)
        }
      }
      const bg = (this.beams = new GFX.BufferGeometry())
      bg.setAttribute('position', new GFX.BufferAttribute(new Float32Array(2 * (R + 1) * S2 * 3), 3))
      bg.setAttribute('t', new GFX.Float32BufferAttribute(tt, 1))
      bg.setIndex(idx)
      this.shapeBeams()
    }
  }

  /** The beams from where the head lamps are now: each an open cone — wide, low, 12 m — that STARTS AS ITS LENS'S
   *  OUTLINE (a disc's ring, a square's) and opens from it. */
  private shapeBeams(): void {
    const g = this.beams
    if (!g) return
    const p = (g.getAttribute('position') as GFX.BufferAttribute), a = p.array as Float32Array
    let o = 0
    for (let sd = 0; sd < 2; sd++) {
      const l = this.lamps[sd]!, c = this.at[sd]!
      for (let i = 0; i <= BEAM_RINGS; i++) {
        const along = (i / BEAM_RINGS) * 12
        for (let j = 0; j < BEAM_SIDES; j++) {
          const an = (j / BEAM_SIDES) * Math.PI * 2, cs = Math.cos(an), sn = Math.sin(an)
          const k = l.round ? 1 : 1 / Math.max(Math.abs(cs) / l.w, Math.abs(sn) / l.h)
          a[o++] = c.x + (l.round ? l.w * cs : cs * k) + cs * along * 0.4
          a[o++] = c.y + (l.round ? l.h * sn : sn * k) - along * 0.07 + sn * along * 0.17
          a[o++] = c.z - along
        }
      }
    }
    p.needsUpdate = true
    g.computeVertexNormals()
  }

  /** Each lamp's brightness (head left, head right, tail left, tail right — 0: off, or broken): what is drawn. */
  set(headL: number, headR: number, tailL: number, tailR: number): void {
    this.live.set(this.lamps[0] ? headL : 0, this.lamps[1] ? headR : 0, this.lamps[2] ? tailL : 0, this.lamps[3] ? tailR : 0)
    this.mesh.visible = this.live.x + this.live.y + this.live.z + this.live.w > 0.01
  }

  /** THE BODY WAS DENTED (or mended): the lit faces go where the lens's now are — `body`, `glass`: the car's own
   *  shell's vertices (the model's first in each: Vehicle's `mergeParts`) —, each halo and each light's start with its
   *  lens (by how far the lens's middle moved). */
  follow(body: ArrayLike<number>, glass: ArrayLike<number> | null): void {
    const a = this.pos.array as Float32Array, r = this.rest
    for (const L of this.lit) {
      const v = L.lens.verts, A = L.lens.ofGlass ? glass : body
      if (!v || !A) continue
      let dx = 0, dy = 0, dz = 0
      for (let i = 0; i < v.length; i++) {
        const o = (L.core + i) * 3, s = v[i] * 3
        a[o] = A[s]; a[o + 1] = A[s + 1]; a[o + 2] = A[s + 2]
        dx += a[o] - r[o]; dy += a[o + 1] - r[o + 1]; dz += a[o + 2] - r[o + 2]
      }
      dx /= v.length; dy /= v.length; dz /= v.length
      for (let i = 0; i < 6; i++) { const o = (L.halo + i) * 3; a[o] = r[o] + dx; a[o + 1] = r[o + 1] + dy; a[o + 2] = r[o + 2] + dz }
      if (L.main) this.at[L.lamp]!.set(L.lens.c[0] + dx, L.lens.c[1] + dy, L.lens.c[2] + dz)
    }
    this.pos.needsUpdate = true
    this.shapeBeams()
  }

  /** (scripts/harness/lampshot.mjs) How far the lit faces are from the lens's own (m) — the greatest over every lit
   *  vertex against `body` / `glass` as they are now: 0, to the bit. And how many lit vertices are a lens's own. */
  check(body: ArrayLike<number>, glass: ArrayLike<number> | null): { off: number; own: number; drawn: number } {
    const a = this.pos.array as Float32Array
    let off = 0, own = 0, drawn = 0
    for (const L of this.lit) {
      const v = L.lens.verts, A = L.lens.ofGlass ? glass : body
      if (!v || !A) { drawn += L.n; continue }
      own += v.length
      for (let i = 0; i < v.length; i++) for (let c = 0; c < 3; c++) off = Math.max(off, Math.abs(a[(L.core + i) * 3 + c] - A[v[i] * 3 + c]))
    }
    return { off, own, drawn }
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as GFX.Material).dispose()
    this.beams?.dispose()
  }
}
