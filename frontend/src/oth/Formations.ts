import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ATMOS_GLSL, FRAG_OUT, type Atmosphere } from './Atmosphere'
import type { Horizon } from './Horizon'
import type { Tier } from './quality'
import { SHADOW_GLSL, type TerrainShadow } from './TerrainShadow'

/**
 * THE DESERT'S SANDSTONE (2026-11-02): the slabs' skins modelled in Blender over the terraced walls, mesas and spires
 * (scripts/oth/desert_rocks.py → formations.glb, Draco — decoded in the loader's workers): every bed a rounded band
 * bulging out of its riser, split into blocks by cracks. One mesh per 256 m cell; drawn within the tier's reach, in
 * view and not behind the hills (Horizon) — beyond it the terrain's own terraced beds carry the shape. Coloured like
 * the ground's sandstone (paint.ts: each 9 m bed its own tone), sand on the lips, a darker tuck under each slab, the
 * terrain's shadow and the haze.
 */
export class Formations {
  readonly group = new THREE.Group()
  horizon: Horizon | null = null
  /** Cells drawn last update (the HUD / the cost tests). */
  drawn = 0
  private readonly cells: { mesh: THREE.Mesh; box: THREE.Box3 }[] = []
  private readonly reach: number
  private readonly frustum = new THREE.Frustum()
  private readonly pv = new THREE.Matrix4()
  private readonly last = new THREE.Vector3(1e9, 0, 0)
  private readonly lastDir = new THREE.Vector3()
  private readonly dir = new THREE.Vector3()

  private constructor(scene: THREE.Object3D, atmos: Atmosphere, shadow: TerrainShadow, tier: Tier, farGrid: THREE.Vector4) {
    this.reach = { low: 420, medium: 560, high: 720, ultra: 900 }[tier.name] ?? 720
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...atmos.uniforms, ...shadow.uniforms, uFarGrid: { value: farGrid } },
      defines: tier.spec ? { OTH_SPEC: '' } : {},
      vertexShader: VERT,
      fragmentShader: FRAG,
    })
    scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      m.updateWorldMatrix(true, false)
      const g = m.geometry
      g.applyMatrix4(m.matrixWorld) // (world space: the cells are drawn where they are, no transforms)
      g.computeBoundingBox(); g.computeBoundingSphere()
      const mesh = new THREE.Mesh(g, mat)
      mesh.matrixAutoUpdate = false
      mesh.visible = false
      this.group.add(mesh)
      this.cells.push({ mesh, box: g.boundingBox!.clone() })
    })
  }

  /** Load a world's formations (null if it has none). */
  static async load(url: string, atmos: Atmosphere, shadow: TerrainShadow, tier: Tier, farGrid: THREE.Vector4): Promise<Formations | null> {
    const draco = (dracoLoader ??= new DRACOLoader().setDecoderPath('/draco/'))
    try {
      const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(url)
      return new Formations(gltf.scene, atmos, shadow, tier, farGrid)
    } catch {
      return null
    }
  }

  /** The cells in reach, in view and not behind the hills (rebuilt when the camera moves 4 m or turns). */
  update(camera: THREE.PerspectiveCamera): void {
    camera.getWorldDirection(this.dir)
    if (camera.position.distanceToSquared(this.last) < 16 && this.dir.dot(this.lastDir) > 0.9985) return
    this.last.copy(camera.position); this.lastDir.copy(this.dir)
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.pv, THREE.WebGLCoordinateSystem, camera.reversedDepth)
    const p = camera.position, R2 = this.reach * this.reach
    let n = 0
    for (const c of this.cells) {
      const b = c.box
      const dx = Math.max(b.min.x - p.x, 0, p.x - b.max.x), dz = Math.max(b.min.z - p.z, 0, p.z - b.max.z)
      const on = dx * dx + dz * dz < R2 && this.frustum.intersectsBox(b) && !this.horizon?.hiddenBox(b)
      c.mesh.visible = on
      if (on) n++
    }
    this.drawn = n
  }
}
let dracoLoader: DRACOLoader | null = null

const VERT = /* glsl */ `
out vec3 vWorld;
out vec3 vN;
void main() {
  vWorld = position;
  vN = normal;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`

const FRAG = /* glsl */ `
${FRAG_OUT}
${ATMOS_GLSL}
uniform vec4 uFarGrid;
${SHADOW_GLSL}
in vec3 vWorld;
in vec3 vN;
// (paint.ts's desert sandstone: the same beds as the ground's)
const vec3 STONE      = vec3(0.44, 0.19, 0.115);
const vec3 STONE_PALE = vec3(0.5, 0.26, 0.155);
const vec3 STONE_DEEP = vec3(0.3, 0.12, 0.075);
const vec3 SAND_PALE  = vec3(0.52, 0.37, 0.23);
float facetRand(vec3 n) { return fract(sin(dot(floor(n * 400.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  // LOW-POLY like the valley's rock (the user): each facet lit flat (its own normal, from the screen derivatives — a
  // little of the smooth one kept), each a touch its own tone
  vec3 Ns = normalize(vN);
  vec3 Nf = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (dot(Nf, Ns) < 0.0) Nf = -Nf;
  vec3 N = normalize(mix(Ns, Nf, 0.85));
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCamPos - vWorld);
  vec2 xz = vWorld.xz;
  float big = texture(uNoise, xz * (1.0 / 389.0) + vec2(0.37, 0.59)).g;
  vec4 mid = texture(uNoise, xz * (1.0 / 71.0));
  float fine = texture(uNoise, xz * (1.0 / 13.0) + vec2(0.71, 0.13)).g;
  float b = floor((vWorld.y + (big - 0.5) * 5.0) / 9.0);
  float tone = fract(sin(b * 12.9898 + 4.1) * 43758.5453);
  vec3 albedo = mix(STONE, STONE_PALE, tone * 0.8 + (mid.r - 0.5) * 0.3) * (0.92 + 0.12 * fine) * (0.94 + 0.12 * facetRand(Nf));
  // the tuck under each slab darker, sand dusting its lip
  albedo = mix(albedo, STONE_DEEP, smoothstep(-0.15, -0.6, N.y) * 0.6);
  albedo = mix(albedo, SAND_PALE * 0.96, smoothstep(0.72, 0.92, N.y) * 0.6);
  float ao = mix(0.62, 1.0, smoothstep(-0.7, 0.25, N.y));
  float sun = sunVisibility(xz);
  vec3 c = shade(albedo, N, V, 0.8, 0.04, ao, sun, 0.25);
  c += rockFill(albedo, N) * ao;
  c += headlight(albedo, N, vWorld);
  gl_FragColor = vec4(applyAtmos(c, vWorld), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
