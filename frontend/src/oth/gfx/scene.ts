import * as pc from 'playcanvas'
import { gfx } from './core'
import { BufferAttribute, BufferGeometry, InstancedBufferAttribute, InstancedBufferGeometry, type TypedArray } from './geometry'
import { type Layout, type Material, ShaderMaterial } from './material'
import { Box3, Euler, Matrix4, Quaternion, Sphere, Vector3 } from './math'

/**
 * THE SCENE (docs/MIGRATION.md): three's object tree kept — Object3D / Group / Mesh / InstancedMesh, positions,
 * quaternions (and Euler rotations kept in step with them), scales, `visible`, `renderOrder`, `frustumCulled` — with our
 * own world matrices; each drawn mesh owns a PlayCanvas MeshInstance on a standalone GraphNode whose world transform we
 * write (PlayCanvas never re-derives it: the node is in no hierarchy).
 *
 * `Scene.sync` (once a render, from Renderer.render): world matrices, visibility, layer membership (what's attached to
 * the scene is in its layer, what was detached leaves it), the GPU side made / refreshed (meshes per material layout,
 * re-uploaded attributes, the instancing buffer, the instance count), the draw order, each material's own uniforms.
 */
let objectIds = 0

export class Object3D {
  readonly isObject3D = true
  readonly id = ++objectIds
  name = ''
  type = 'Object3D'
  parent: Object3D | null = null
  readonly children: Object3D[] = []
  readonly position = new Vector3()
  readonly quaternion = new Quaternion()
  readonly scale = new Vector3(1, 1, 1)
  /** an Euler view of `quaternion` (three's two-way sync: writing it sets the quaternion, reading it follows it) */
  readonly rotation: Euler
  readonly matrix = new Matrix4()
  readonly matrixWorld = new Matrix4()
  matrixAutoUpdate = true
  matrixWorldAutoUpdate = true
  visible = true
  frustumCulled = true
  renderOrder = 0
  castShadow = false
  receiveShadow = false
  userData: Record<string, unknown> = {}
  readonly up = new Vector3(0, 1, 0)

  constructor() {
    this.rotation = syncedEuler(this.quaternion)
  }

  add(...objs: Object3D[]): this {
    for (const o of objs) {
      if (o === this) continue
      o.parent?.remove(o)
      o.parent = this
      this.children.push(o)
    }
    return this
  }
  remove(...objs: Object3D[]): this {
    for (const o of objs) {
      const i = this.children.indexOf(o)
      if (i >= 0) { this.children.splice(i, 1); o.parent = null }
    }
    return this
  }
  removeFromParent(): this { this.parent?.remove(this); return this }
  clear(): this { for (const c of [...this.children]) this.remove(c); return this }
  traverse(f: (o: Object3D) => void): void { f(this); for (const c of this.children) c.traverse(f) }
  traverseVisible(f: (o: Object3D) => void): void { if (!this.visible) return; f(this); for (const c of this.children) c.traverseVisible(f) }
  getObjectByName(n: string): Object3D | undefined {
    if (this.name === n) return this
    for (const c of this.children) { const r = c.getObjectByName(n); if (r) return r }
    return undefined
  }

  updateMatrix(): void { this.matrix.compose(this.position, this.quaternion, this.scale) }
  updateMatrixWorld(force = false): void {
    if (this.matrixAutoUpdate) this.updateMatrix()
    if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix)
    else this.matrixWorld.copy(this.matrix)
    for (const c of this.children) c.updateMatrixWorld(force)
  }
  updateWorldMatrix(updateParents: boolean, updateChildren: boolean): void {
    if (updateParents && this.parent) this.parent.updateWorldMatrix(true, false)
    if (this.matrixAutoUpdate) this.updateMatrix()
    if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix)
    else this.matrixWorld.copy(this.matrix)
    if (updateChildren) for (const c of this.children) c.updateWorldMatrix(false, true)
  }
  /** Turn to face a point (three's lookAt: −z toward it for cameras, +z for everything else). */
  lookAt(x: number | Vector3, y?: number, z?: number): void {
    const target = typeof x === 'number' ? _t.set(x, y!, z!) : _t.copy(x)
    this.updateWorldMatrix(true, false)
    _p.setFromMatrixPosition(this.matrixWorld)
    if (this instanceof Camera) _m.lookAt(_p, target, this.up)
    else _m.lookAt(target, _p, this.up)
    this.quaternion.setFromRotationMatrix(_m)
    if (this.parent) { _m.extractRotation(this.parent.matrixWorld); _q.setFromRotationMatrix(_m); this.quaternion.premultiply(_q.invert()) }
  }
  getWorldPosition(t: Vector3): Vector3 { this.updateWorldMatrix(true, false); return t.setFromMatrixPosition(this.matrixWorld) }
  getWorldQuaternion(t: Quaternion): Quaternion { this.updateWorldMatrix(true, false); this.matrixWorld.decompose(_p, t, _s); return t }
  /** The +z axis in the world (three's: cameras override to −z). */
  getWorldDirection(t: Vector3): Vector3 {
    this.updateWorldMatrix(true, false)
    const e = this.matrixWorld.elements
    return t.set(e[8], e[9], e[10]).normalize()
  }
  localToWorld(v: Vector3): Vector3 { this.updateWorldMatrix(true, false); return v.applyMatrix4(this.matrixWorld) }
  worldToLocal(v: Vector3): Vector3 { this.updateWorldMatrix(true, false); return v.applyMatrix4(_m.copy(this.matrixWorld).invert()) }
  rotateX(a: number): this { this.quaternion.multiply(_q.setFromAxisAngle(_x, a)); return this }
  rotateY(a: number): this { this.quaternion.multiply(_q.setFromAxisAngle(_y, a)); return this }
  rotateZ(a: number): this { this.quaternion.multiply(_q.setFromAxisAngle(_z, a)); return this }
}

/** An Euler that reads / writes through a quaternion (three keeps them in step; here the quaternion is the truth). */
function syncedEuler(q: Quaternion): Euler {
  const e = new Euler()
  const snap = [NaN, NaN, NaN, NaN]
  let x = 0, y = 0, z = 0
  const fresh = () => {
    if (snap[0] !== q.x || snap[1] !== q.y || snap[2] !== q.z || snap[3] !== q.w) {
      _e.setFromQuaternion(q, e.order)
      x = _e.x; y = _e.y; z = _e.z
      snap[0] = q.x; snap[1] = q.y; snap[2] = q.z; snap[3] = q.w
    }
  }
  const write = () => { _e.set(x, y, z, e.order); q.setFromEuler(_e); snap[0] = q.x; snap[1] = q.y; snap[2] = q.z; snap[3] = q.w }
  Object.defineProperties(e, {
    x: { get: () => { fresh(); return x }, set: (v: number) => { fresh(); x = v; write() } },
    y: { get: () => { fresh(); return y }, set: (v: number) => { fresh(); y = v; write() } },
    z: { get: () => { fresh(); return z }, set: (v: number) => { fresh(); z = v; write() } },
  })
  e.set = (a: number, b: number, c: number, order?: Euler['order']) => { if (order) e.order = order; x = a; y = b; z = c; write(); return e }
  e.copy = (o: Euler) => e.set(o.x, o.y, o.z, o.order)
  return e
}

export class Group extends Object3D { override type = 'Group' }

// ------------------------------------------------------------------------------------------------- meshes
interface Gpu {
  mi: pc.MeshInstance
  pcMesh: pc.Mesh
  geo: BufferGeometry
  layout: Layout
  matVersion: number
  geoLayout: number
  /** attribute name → the version uploaded */
  uploaded: Map<string, number>
  vb: pc.VertexBuffer | null
  /** instanced streams in the instancing buffer: name, array, item size, its offset (bytes) and the version uploaded */
  inst: { name: string; attr: BufferAttribute; offset: number; ver: number }[]
  node: pc.GraphNode
  world: Float32Array
}

const DTYPE = (a: TypedArray) => (a instanceof Float32Array ? pc.TYPE_FLOAT32 : a instanceof Uint8Array ? pc.TYPE_UINT8 : a instanceof Int8Array ? pc.TYPE_INT8 : a instanceof Uint16Array ? pc.TYPE_UINT16 : a instanceof Int16Array ? pc.TYPE_INT16 : a instanceof Uint32Array ? pc.TYPE_UINT32 : pc.TYPE_INT32)

export class Mesh extends Object3D {
  readonly isMesh = true
  override type = 'Mesh'
  /** (scene.ts) the drawn side, made on first draw */
  gpu: Gpu | null = null
  /** (scene.ts) the layer its instance is in */
  layer: pc.Layer | null = null
  constructor(public geometry: BufferGeometry = new BufferGeometry(), public material: Material = new ShaderMaterial()) { super() }
  /** InstancedMesh: its instance matrices (null for a plain mesh). */
  get instanceMatrixAttr(): InstancedBufferAttribute | null { return null }
  /** How many instances to draw (InstancedMesh.count / InstancedBufferGeometry.instanceCount), or −1: not instanced. */
  get instances(): number {
    const g = this.geometry as InstancedBufferGeometry
    if (!g.isInstancedBufferGeometry) return -1
    if (Number.isFinite(g.instanceCount)) return g.instanceCount
    let n = Infinity
    for (const a of Object.values(g.attributes)) if (a.isInstancedBufferAttribute) n = Math.min(n, a.count)
    return Number.isFinite(n) ? n : 0
  }
  /** The bounds the camera culls this with (null: PlayCanvas's own from the positions). */
  cullSphere(): Sphere | null { return this.geometry.boundingSphere }
  dispose(): void {
    if (this.gpu) { this.layer?.removeMeshInstances([this.gpu.mi]); this.gpu.mi.destroy(); this.gpu.vb?.destroy() }
    this.gpu = null
    this.layer = null
  }
}

export class InstancedMesh extends Mesh {
  readonly isInstancedMesh = true
  override type = 'InstancedMesh'
  readonly instanceMatrix: InstancedBufferAttribute
  count: number
  boundingSphere: Sphere | null = null
  boundingBox: Box3 | null = null
  constructor(geometry: BufferGeometry, material: Material, count: number) {
    super(geometry, material)
    this.instanceMatrix = new InstancedBufferAttribute(new Float32Array(count * 16), 16)
    for (let i = 0; i < count; i++) this.instanceMatrix.array.set(_ident.elements, i * 16)
    this.count = count
  }
  override get instanceMatrixAttr(): InstancedBufferAttribute { return this.instanceMatrix }
  override get instances(): number { return this.count }
  setMatrixAt(i: number, m: Matrix4): void { this.instanceMatrix.array.set(m.elements, i * 16) }
  getMatrixAt(i: number, m: Matrix4): void { m.fromArray(this.instanceMatrix.array, i * 16) }
  computeBoundingSphere(): void {
    this.geometry.boundingSphere ?? this.geometry.computeBoundingSphere()
    const gs = this.geometry.boundingSphere!
    this.boundingSphere ??= new Sphere()
    _b.makeEmpty()
    const s = new Sphere()
    for (let i = 0; i < this.count; i++) {
      this.getMatrixAt(i, _m)
      s.copy(gs).applyMatrix4(_m)
      _b.expandByPoint(_v.copy(s.center).addScalar(s.radius)); _b.expandByPoint(_v.copy(s.center).addScalar(-s.radius))
    }
    _b.getCenter(this.boundingSphere.center)
    this.boundingSphere.radius = _b.isEmpty() ? -1 : _b.min.distanceTo(_b.max) / 2
  }
  computeBoundingBox(): void {
    this.computeBoundingSphere()
    const s = this.boundingSphere!
    this.boundingBox = new Box3(s.center.clone().addScalar(-s.radius), s.center.clone().addScalar(s.radius))
  }
  override cullSphere(): Sphere | null {
    if (!this.boundingSphere) this.computeBoundingSphere()
    return this.boundingSphere
  }
}

/** Make / refresh a mesh's drawn side for this frame. */
function prepare(mesh: Mesh): Gpu | null {
  const mat = mesh.material as ShaderMaterial
  if (!mat.isShaderMaterial || mesh.geometry.disposed || mat.disposed) return null
  // (nothing to draw yet: an empty geometry — PlayCanvas can't build a mesh of no vertices)
  const pos = mesh.geometry.attributes.position ?? Object.values(mesh.geometry.attributes).find((a) => !a.isInstancedBufferAttribute)
  if (!pos || pos.count === 0) return null
  const instMat = mesh.instanceMatrixAttr
  const { m: pcMat, layout } = mat.pcMaterial(!!instMat)
  const geo = mesh.geometry
  let g = mesh.gpu
  // (a new layout — the material's defines changed, or the geometry or its attributes: made again, back in its layer)
  const layer = mesh.layer
  if (g && (g.layout !== layout || g.geo !== geo || g.geoLayout !== geo.layoutVersion)) { mesh.dispose(); g = null }
  if (!g) {
    const pcMesh = meshFor(geo, layout)
    const node = new pc.GraphNode(mesh.name || 'oth')
    const mi = new pc.MeshInstance(pcMesh, pcMat, node)
    g = mesh.gpu = { mi, pcMesh, geo, layout, matVersion: mat.version, geoLayout: geo.layoutVersion, uploaded: new Map(), vb: null, inst: [], node, world: new Float32Array(16).fill(NaN) }
    // the instancing buffer: every instanced attribute (+ InstancedMesh's matrices as four vec4s), non-interleaved
    const streams: { name: string; attr: BufferAttribute; comps: number; sub: number }[] = []
    for (const [name, a] of Object.entries(geo.attributes)) if (a.isInstancedBufferAttribute && layout.semantics[name]) streams.push({ name, attr: a, comps: a.itemSize, sub: 0 })
    if (instMat) for (let r = 0; r < 4; r++) streams.push({ name: `instanceMatrix${r}`, attr: instMat, comps: 4, sub: r })
    if (streams.length) {
      const count = Math.max(1, ...streams.map((s) => s.attr.count))
      const desc = streams.map((s) => ({ semantic: layout.semantics[s.name], components: s.comps, type: DTYPE(s.attr.array), normalize: s.attr.normalized }))
      const fmt = new pc.VertexFormat(gfx().device, desc, count)
      g.vb = new pc.VertexBuffer(gfx().device, fmt, count, { usage: pc.BUFFER_DYNAMIC })
      g.inst = streams.map((s, i) => ({ name: s.name, attr: s.attr, offset: fmt.elements[i].offset, ver: -1, comps: s.comps, sub: s.sub })) as Gpu['inst']
      mi.setInstancing(g.vb, false)
    }
    if (layer) { mesh.layer = layer; layer.addMeshInstances([mi]) }
  }
  if (g.mi.material !== pcMat) g.mi.material = pcMat
  // re-upload what changed: the mesh's own streams, the instancing buffer
  let dirty = false
  for (const [name, a] of Object.entries(geo.attributes)) {
    if (a.isInstancedBufferAttribute || !layout.semantics[name]) continue
    if (g.uploaded.get(name) !== a.version) { g.uploaded.set(name, a.version); if (a.version > 0) { g.pcMesh.setVertexStream(layout.semantics[name], a.array, a.itemSize, a.count, DTYPE(a.array), a.normalized); dirty = true } }
  }
  if (dirty) { if (geo.index) g.pcMesh.setIndices(geo.index.array as Uint16Array); g.pcMesh.update(pc.PRIMITIVE_TRIANGLES) }
  if (g.vb) {
    let up = false
    for (const s of g.inst) if (s.ver !== s.attr.version) { s.ver = s.attr.version; up = true }
    if (up) {
      const buf = g.vb.lock() as ArrayBuffer
      for (const s of g.inst as (Gpu['inst'][number] & { comps: number; sub: number })[]) {
        const src = s.attr.array, n = Math.min(s.attr.count, g.vb.numVertices)
        if (s.attr.itemSize === s.comps) {
          new (src.constructor as new (b: ArrayBuffer, o: number, l: number) => TypedArray)(buf, s.offset, n * s.comps).set(src.subarray(0, n * s.comps) as never)
        } else {
          // (a row of a 4×4 matrix: every 16 floats, 4 of them from s.sub × 4)
          const dst = new Float32Array(buf, s.offset, n * 4), st = s.attr.itemSize, src4 = src as Float32Array
          for (let i = 0; i < n; i++) { const o = i * st + s.sub * 4; dst[i * 4] = src4[o]; dst[i * 4 + 1] = src4[o + 1]; dst[i * 4 + 2] = src4[o + 2]; dst[i * 4 + 3] = src4[o + 3] }
        }
      }
      g.vb.unlock()
    }
  }
  return g
}

/** The PlayCanvas mesh for a geometry under a material's attribute slots (shared by the meshes drawing it so). */
function meshFor(geo: BufferGeometry, layout: Layout): pc.Mesh {
  const key = layout.key + ':' + geo.layoutVersion
  let m = geo.gpu.get(key) as pc.Mesh | undefined
  if (m) return m
  m = new pc.Mesh(gfx().device)
  for (const [name, a] of Object.entries(geo.attributes)) {
    if (a.isInstancedBufferAttribute || !layout.semantics[name]) continue
    m.setVertexStream(layout.semantics[name], a.array, a.itemSize, a.count, DTYPE(a.array), a.normalized)
  }
  if (geo.index) m.setIndices(geo.index.array as Uint16Array)
  m.update(pc.PRIMITIVE_TRIANGLES)
  geo.gpu.set(key, m)
  return m
}

// ------------------------------------------------------------------------------------------------- cameras
export class Camera extends Object3D {
  readonly isCamera = true
  override type = 'Camera'
  readonly matrixWorldInverse = new Matrix4()
  readonly projectionMatrix = new Matrix4()
  readonly projectionMatrixInverse = new Matrix4()
  /** (three's reversed depth: never here) */
  readonly reversedDepth = false
  near = 0.1
  far = 2000
  override updateMatrixWorld(force = false): void { super.updateMatrixWorld(force); this.matrixWorldInverse.copy(this.matrixWorld).invert() }
  override updateWorldMatrix(p: boolean, c: boolean): void { super.updateWorldMatrix(p, c); this.matrixWorldInverse.copy(this.matrixWorld).invert() }
  /** The view direction (−z). */
  override getWorldDirection(t: Vector3): Vector3 {
    this.updateWorldMatrix(true, false)
    const e = this.matrixWorld.elements
    return t.set(-e[8], -e[9], -e[10]).normalize()
  }
  updateProjectionMatrix(): void {}
}

export class PerspectiveCamera extends Camera {
  readonly isPerspectiveCamera = true
  override type = 'PerspectiveCamera'
  zoom = 1
  constructor(public fov = 50, public aspect = 1, near = 0.1, far = 2000) {
    super()
    this.near = near
    this.far = far
    this.updateProjectionMatrix()
  }
  override updateProjectionMatrix(): void {
    const top = (this.near * Math.tan((Math.PI / 180) * 0.5 * this.fov)) / this.zoom, h = 2 * top, w = this.aspect * h
    this.projectionMatrix.makePerspective(-0.5 * w, 0.5 * w, top, top - h, this.near, this.far)
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert()
  }
}

export class OrthographicCamera extends Camera {
  readonly isOrthographicCamera = true
  override type = 'OrthographicCamera'
  constructor(public left = -1, public right = 1, public top = 1, public bottom = -1, near = 0.1, far = 2000) {
    super()
    this.near = near
    this.far = far
    this.updateProjectionMatrix()
  }
  override updateProjectionMatrix(): void {
    this.projectionMatrix.makeOrthographic(this.left, this.right, this.top, this.bottom, this.near, this.far)
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert()
  }
}

// ------------------------------------------------------------------------------------------------- the scene
export class Scene extends Object3D {
  readonly isScene = true
  override type = 'Scene'
  background: { r: number; g: number; b: number } | null = null
  /** its PlayCanvas layer (the first scene made: the world layer; others their own) */
  readonly layer: pc.Layer
  private readonly inLayer = new Set<Mesh>()
  private frame = 0
  /** this render's counts (the HUD) */
  readonly info = { calls: 0, triangles: 0 }

  constructor() {
    super()
    const G = gfx()
    if (!scenes.length) this.layer = G.world
    else {
      this.layer = new pc.Layer({ name: `oth-scene-${this.id}`, opaqueSortMode: pc.SORTMODE_MANUAL, transparentSortMode: pc.SORTMODE_MANUAL })
      G.app.scene.layers.push(this.layer)
    }
    scenes.push(this)
  }

  /** World matrices, visibility, layer membership, the GPU side, the draw order, the materials' own uniforms. */
  sync(camPos: Vector3): void {
    this.frame++
    this.updateMatrixWorld()
    const seen = new Set<Mesh>(), pushed = new Set<ShaderMaterial>(), add: pc.MeshInstance[] = []
    let calls = 0, tris = 0
    const walk = (o: Object3D, vis: boolean) => {
      const v = vis && o.visible
      if (o instanceof Mesh) {
        const g = prepare(o)
        if (g) {
          seen.add(o)
          if (!this.inLayer.has(o) || o.layer !== this.layer) { this.inLayer.add(o); o.layer = this.layer; add.push(g.mi) }
          const n = o.instances
          const show = v && o.material.visible && n !== 0
          g.mi.visible = show
          if (show) {
            // the world transform (only when it changed: PlayCanvas re-derives its bounds from it)
            const e = o.matrixWorld.elements, w = g.world
            let same = true
            for (let i = 0; i < 16; i++) if (w[i] !== e[i]) { same = false; break }
            if (!same) {
              w.set(e)
              const node = g.node as unknown as { worldTransform: pc.Mat4; _dirtyLocal: boolean; _dirtyWorld: boolean; _dirtyNormal: boolean; _worldScaleSign: number; _aabbVer: number }
              node.worldTransform.data.set(e)
              node._dirtyLocal = false; node._dirtyWorld = false; node._dirtyNormal = true; node._worldScaleSign = 0; node._aabbVer++
            }
            if (n > 0) g.mi.instancingCount = n
            // culling: a known bounding sphere (instanced: the only bounds there are), else PlayCanvas's own
            const s = o.frustumCulled ? o.cullSphere() : null
            if (n >= 0 || s) {
              if (s && s.radius >= 0) {
                const c = _v.copy(s.center).applyMatrix4(o.matrixWorld), r = s.radius * o.matrixWorld.getMaxScaleOnAxis()
                _aabb.center.set(c.x, c.y, c.z); _aabb.halfExtents.set(r, r, r)
                g.mi.setCustomAabb(_aabb)
                g.mi.cull = true
              } else { g.mi.setCustomAabb(null); g.mi.cull = false }
            } else g.mi.cull = o.frustumCulled
            // the draw order: renderOrder, then (opaque) by material, (transparent) far → near
            if (o.material.transparent) {
              const d = Math.min(Math.sqrt(_v.setFromMatrixPosition(o.matrixWorld).distanceToSquared(camPos)), 99999)
              g.mi.drawOrder = o.renderOrder * 1e6 - d * 10
            } else g.mi.drawOrder = o.renderOrder * 1e6 + (o.material.id % 100000)
            const mat = o.material as ShaderMaterial
            if (!pushed.has(mat)) { pushed.add(mat); mat.pushUniforms(g.mi.material as pc.ShaderMaterial) }
            calls++
            const ib = g.pcMesh.primitive[0].count
            tris += (ib / 3) * Math.max(1, n)
          }
        }
      }
      for (const c of o.children) walk(c, v)
    }
    walk(this, true)
    if (add.length) this.layer.addMeshInstances(add)
    const gone: pc.MeshInstance[] = []
    for (const m of this.inLayer) if (!seen.has(m)) { this.inLayer.delete(m); if (m.gpu) gone.push(m.gpu.mi); m.layer = null }
    if (gone.length) this.layer.removeMeshInstances(gone)
    this.info.calls = calls
    this.info.triangles = tris
  }
}
const scenes: Scene[] = []

const _v = new Vector3(), _p = new Vector3(), _s = new Vector3(), _t = new Vector3(), _x = new Vector3(1, 0, 0), _y = new Vector3(0, 1, 0), _z = new Vector3(0, 0, 1)
const _q = new Quaternion(), _m = new Matrix4(), _e = new Euler(), _b = new Box3(), _ident = new Matrix4()
const _aabb = new pc.BoundingBox()
