import * as THREE from 'three'
import { ATMOS_GLSL, FRAG_OUT, type Atmosphere } from './Atmosphere'
import { HEIGHT_GLSL, type Terrain } from './Terrain'

/**
 * BIRDS (2026-11-02, the user: "just some bird like things fly in group or randomly at sky … we won't be able to see
 * it properly so can use low things") — ULTRA on a PC only, for now (main.ts). Dark flapping shapes high over the
 * valley: FLOCKS crossing the sky (a V, or a loose band) and LONE birds of prey circling, gliding, now and then a few
 * slow flaps. 8 triangles a bird (a head, a tail, two wings bent at the elbow), ~60 birds, ONE draw, and nothing on the
 * CPU per frame: they move in the vertex shader from the clock. Their paths repeat every TILE m round the camera (a
 * bird drifting past TILE / 2 comes back on the far side — shrunk to nothing first, out in the haze): wherever you
 * drive, there are birds. 35–130 m over the ground under them (the terrain's height texture, looked ahead so they rise
 * before a ridge). From sunrise to dusk; fewer in the rain (they shelter).
 */
export class Birds {
  readonly mesh: THREE.Mesh

  constructor(private readonly atmos: Atmosphere, terrain: Terrain) {
    let s = 0x5eed
    const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
    // per bird: aPath (x0, z0, heading, speed), aFly (0 flock / 1 lone, height over the ground, weave / circle radius,
    // seed), aMember (its place in the flock: right, back, up; its wingspan m)
    const path: number[] = [], fly: number[] = [], member: number[] = []
    for (let f = 0; f < 7; f++) {
      const x0 = rnd() * TILE, z0 = rnd() * TILE, head = rnd() * Math.PI * 2, speed = 10 + rnd() * 5
      const alt = 35 + rnd() * 55, weave = 20 + rnd() * 50, fs = rnd()
      const vee = rnd() < 0.45, n = vee ? 7 + Math.floor(rnd() * 5) : 4 + Math.floor(rnd() * 7)
      const span = vee ? 1.5 + rnd() * 0.2 : 0.9 + rnd() * 0.3
      for (let k = 0; k < n; k++) {
        // a V: the leader, then alternate sides, each a step back; a band: loosely together
        const side = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2)
        const [r, b, u] = vee ? [side * 2.6, Math.abs(side) * 3.2, (rnd() - 0.5) * 0.6] : [(rnd() - 0.5) * 22, (rnd() - 0.5) * 18, (rnd() - 0.5) * 7]
        path.push(x0, z0, head, speed)
        fly.push(0, alt, weave, fs + k * 0.013)
        member.push(r, b, u, span * (0.94 + rnd() * 0.12))
      }
    }
    for (let k = 0; k < 6; k++) {
      path.push(rnd() * TILE, rnd() * TILE, rnd() * Math.PI * 2, 8 + rnd() * 3)
      fly.push(1, 60 + rnd() * 70, 45 + rnd() * 70, rnd())
      member.push(0, 0, 0, 1.8 + rnd() * 0.4)
    }
    const base = birdShape()
    const g = new THREE.InstancedBufferGeometry()
    g.index = base.index
    g.setAttribute('position', base.attributes.position)
    g.setAttribute('aPart', base.attributes.aPart)
    g.setAttribute('aPath', new THREE.InstancedBufferAttribute(new Float32Array(path), 4))
    g.setAttribute('aFly', new THREE.InstancedBufferAttribute(new Float32Array(fly), 4))
    g.setAttribute('aMember', new THREE.InstancedBufferAttribute(new Float32Array(member), 4))
    g.instanceCount = path.length / 4
    const t = terrain.uniforms
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...atmos.uniforms, uHIn: t.uHIn, uHFar: t.uHFar, uInGrid: t.uInGrid, uFarGrid: t.uFarGrid, uInScale: t.uInScale, uFarScale: t.uFarScale, uBoxHalf: t.uBoxHalf },
      side: THREE.DoubleSide,
      vertexShader: VERT,
      fragmentShader: FRAG,
    })
    this.mesh = new THREE.Mesh(g, mat)
    this.mesh.frustumCulled = false // (one draw for the sky's birds; the shader drops the far and the roosting)
    this.mesh.visible = false
  }

  /** Not drawn at all at night (they've roosted). */
  update(): void {
    this.mesh.visible = this.atmos.uniforms.uLamps.value < 0.98
  }

  get count(): number {
    return (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount
  }
}

/** Paths repeat every TILE m round the camera. */
const TILE = 1600

/** A bird a wingspan of 2 across (x: right, z: forward): its head and tail on the body (part 0), each wing's elbow
 *  (part 1, 0.45 out) and tip (part 2) — the shader bends the wings there. 13 vertices, 8 triangles. */
function birdShape(): THREE.BufferGeometry {
  const v = [
    [0, 0, 0.3, 0], [0, 0, 0.1, 0], [0, 0, -0.14, 0], [-0.09, 0, -0.34, 0], [0.09, 0, -0.34, 0], [-0.04, 0, 0.08, 0], [0.04, 0, 0.08, 0],
    [-0.45, 0, 0.08, 1], [-0.45, 0, -0.15, 1], [-1, 0, -0.17, 2],
    [0.45, 0, 0.08, 1], [0.45, 0, -0.15, 1], [1, 0, -0.17, 2],
  ]
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(v.flatMap((p) => p.slice(0, 3)), 3))
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(v.map((p) => p[3]), 1))
  g.setIndex([0, 5, 6, 2, 3, 4, 1, 7, 8, 1, 8, 2, 7, 9, 8, 1, 10, 11, 1, 11, 2, 10, 12, 11])
  return g
}

const VERT = /* glsl */ `
${ATMOS_GLSL}
${HEIGHT_GLSL}
in float aPart;
in vec4 aPath;
in vec4 aFly;
in vec4 aMember;
out vec3 vWorld;
out vec3 vN;
out vec3 vAlb;
#define TILE ${TILE.toFixed(1)}
void main() {
  float s = aFly.w, t = uTime;
  bool lone = aFly.x > 0.5;
  vec2 D = vec2(sin(aPath.z), cos(aPath.z)), P = vec2(D.y, -D.x);
  // the flock's centre (or the lone bird) and its velocity: a flock crosses the sky weaving, a lone bird circles as
  // its circle drifts
  vec2 c, v;
  float roll = 0.0;
  if (!lone) {
    float w = 0.04 + 0.04 * fract(s * 3.1), ph = w * t + s * 6.28;
    c = aPath.xy + D * aPath.w * t + P * aFly.z * sin(ph);
    v = D * aPath.w + P * aFly.z * w * cos(ph);
  } else {
    float R = aFly.z, om = aPath.w / R * (fract(s * 5.7) < 0.5 ? 1.0 : -1.0), a = om * t + s * 6.28;
    c = aPath.xy + D * 1.5 * t + R * vec2(cos(a), sin(a));
    v = D * 1.5 + R * om * vec2(-sin(a), cos(a));
    roll = -sign(om) * 0.32; // (banked into the turn)
  }
  c = uCamPos.xz + mod(c - uCamPos.xz + TILE * 0.5, TILE) - TILE * 0.5;
  float d = length(c - uCamPos.xz);
  // far (out at the tile's edge), roosting from dusk (one by one), sheltering from the rain → dropped
  float k = (1.0 - smoothstep(TILE * 0.36, TILE * 0.47, d)) * step(uLamps, 0.2 + 0.75 * fract(s * 7.7)) * step(uRain, 0.15 + 0.8 * fract(s * 3.3));
  if (k < 0.01) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  vec2 f = normalize(v), r = vec2(-f.y, f.x);
  // its place in the flock, drifting a little
  vec3 m = aMember.xyz + vec3(sin(t * 0.4 + s * 91.0) * 1.2, sin(t * 0.5 + s * 37.0) * 0.8, sin(t * 0.33 + s * 53.0) * 1.0);
  vec2 xz = c + r * m.x - f * m.y;
  // high over the ground, risen before the ridge ahead
  float ground = max(terrainHeight(c), max(terrainHeight(c + f * 70.0), terrainHeight(c + f * 150.0)));
  // the wings: a flock beats steadily; a lone bird glides, now and then a few slow beats
  float beat, amp;
  if (!lone) { beat = t * (2.6 + 0.8 * fract(s * 1.9)) * 6.283 + fract(s * 13.0) * 1.2; amp = 0.55; }
  else { beat = t * 1.3 * 6.283; amp = 0.5 * step(fract(t * 0.06 + s), 0.1); }
  float a1 = amp * sin(beat) + (lone ? 0.12 : 0.05), a2 = amp * 0.7 * sin(beat - 0.7) - (lone ? 0.06 : 0.0);
  vec3 p = position;
  float side = sign(p.x), e = 0.45, ax = abs(p.x);
  if (aPart > 0.5) {
    float inner = min(ax, e), outer = ax - inner;
    p.x = side * (inner * cos(a1) + outer * cos(a1 + a2));
    p.y = inner * sin(a1) + outer * sin(a1 + a2);
  }
  p *= aMember.w * 0.5 * k;
  float cr = cos(roll), sr = sin(roll);
  p.xy = vec2(p.x * cr - p.y * sr, p.x * sr + p.y * cr);
  vec3 R3 = vec3(r.x, 0.0, r.y), F3 = vec3(f.x, 0.0, f.y);
  vec3 wpos = vec3(xz.x, ground + aFly.y + m.z + 0.06 * aMember.w * sin(beat), xz.y) + R3 * p.x + vec3(0.0, p.y, 0.0) + F3 * p.z;
  // (shade as a flat thing banked with the body, its side toward the camera)
  vec3 N = R3 * -sr + vec3(0.0, cr, 0.0);
  vN = dot(N, uCamPos - wpos) < 0.0 ? -N : N;
  vAlb = lone ? vec3(0.17, 0.12, 0.08) : mix(vec3(0.06, 0.055, 0.05), vec3(0.2, 0.19, 0.17), step(0.6, fract(s * 2.3)));
  vWorld = wpos;
  gl_Position = projectionMatrix * viewMatrix * vec4(wpos, 1.0);
}`

const FRAG = /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
in vec3 vWorld;
in vec3 vN;
in vec3 vAlb;
void main() {
  vec3 N = normalize(vN);
  vec3 col = vAlb * (ambient(N) + uSunColor * max(dot(N, uSunDir), 0.0) * 0.6);
  gl_FragColor = vec4(applyAtmos(col, vWorld), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`
