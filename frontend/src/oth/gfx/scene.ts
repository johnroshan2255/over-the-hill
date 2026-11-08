import * as pc from 'playcanvas'
import { gfx } from './core'
import { BufferAttribute, BufferGeometry, InstancedBufferAttribute, InstancedBufferGeometry, type TypedArray } from './geometry'
import { type Layout, type Material, type PcEntry, ShaderMaterial } from './material'
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
    const ch = this.children
    for (let i = 0; i < ch.length; i++) ch[i].updateMatrixWorld(force)
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
  /** the instancing buffer's format (the buffer itself made at the size drawn) */
  fmt: pc.VertexFormat | null
  /** instanced streams in the instancing buffer: name, array, its offset (bytes), the version uploaded and how many of
   *  its entries are in the buffer, its components and (instanceMatrix's rows) which four */
  inst: { name: string; attr: BufferAttribute; offset: number; ver: number; upTo: number; comps: number; sub: number }[]
  node: pc.GraphNode
  world: Float32Array
  /** the culling sphere last given PlayCanvas (centre, radius; NaN radius: none) */
  box: number[]
}

interface Pick {
  mat: Material
  ver: number
  geo: BufferGeometry
  geoVer: number
  inst: boolean
  entry: PcEntry
  /** the geometry's own (not instanced) streams the layout draws */
  streams: { name: string; a: BufferAttribute; sem: string }[]
}

const DTYPE = (a: TypedArray) => (a instanceof Float32Array ? pc.TYPE_FLOAT32 : a instanceof Uint8Array ? pc.TYPE_UINT8 : a instanceof Int8Array ? pc.TYPE_INT8 : a instanceof Uint16Array ? pc.TYPE_UINT16 : a instanceof Int16Array ? pc.TYPE_INT16 : a instanceof Uint32Array ? pc.TYPE_UINT32 : pc.TYPE_INT32)

export class Mesh extends Object3D {
  readonly isMesh = true
  override type = 'Mesh'
  /** (scene.ts) the drawn side, made on first draw */
  gpu: Gpu | null = null
  /** (scene.ts) the layer its instance is in */
  layer: pc.Layer | null = null
  /** (scene.ts) its material's PlayCanvas entry and the geometry's streams, for this material version and geometry
   *  layout — looked up again only when one of them changes (not a key string and an attribute list each frame) */
  pick: Pick | null = null
  /** (scene.ts) the last sync that met it */
  seen = 0
  private instKey: BufferGeometry | null = null
  private instVer = -1
  private instAttrs: BufferAttribute[] = []
  constructor(public geometry: BufferGeometry = new BufferGeometry(), public material: Material = new ShaderMaterial()) { super() }
  /** InstancedMesh: its instance matrices (null for a plain mesh). */
  get instanceMatrixAttr(): InstancedBufferAttribute | null { return null }
  /** How many instances to draw (InstancedMesh.count / InstancedBufferGeometry.instanceCount), or −1: not instanced. */
  get instances(): number {
    const g = this.geometry as InstancedBufferGeometry
    if (!g.isInstancedBufferGeometry) return -1
    if (Number.isFinite(g.instanceCount)) return g.instanceCount
    let n = Infinity
    // (the instanced attributes listed once per geometry layout — not an array of them made each call)
    if (this.instKey !== g || this.instVer !== g.layoutVersion) { this.instKey = g; this.instVer = g.layoutVersion; this.instAttrs = Object.values(g.attributes).filter((a) => a.isInstancedBufferAttribute) }
    const L = this.instAttrs
    for (let i = 0; i < L.length; i++) n = Math.min(n, L[i].count)
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
  const geo = mesh.geometry
  let pk = mesh.pick
  if (!pk || pk.mat !== mat || pk.ver !== mat.version || pk.geo !== geo || pk.geoVer !== geo.layoutVersion || pk.inst !== !!instMat) {
    const entry = mat.pcMaterial(!!instMat, Object.keys(geo.attributes))
    const streams: Pick['streams'] = []
    for (const [name, a] of Object.entries(geo.attributes)) if (!a.isInstancedBufferAttribute && entry.layout.semantics[name]) streams.push({ name, a, sem: entry.layout.semantics[name] })
    pk = mesh.pick = { mat, ver: mat.version, geo, geoVer: geo.layoutVersion, inst: !!instMat, entry, streams }
  } else mat.syncState(pk.entry)
  const { m: pcMat, layout } = pk.entry
  let g = mesh.gpu
  // (a new layout — the material's defines changed, or the geometry or its attributes: made again, back in its layer)
  const layer = mesh.layer
  if (g && (g.layout !== layout || g.geo !== geo || g.geoLayout !== geo.layoutVersion)) { mesh.dispose(); g = null }
  if (!g) {
    const pcMesh = meshFor(geo, layout)
    const node = new pc.GraphNode(mesh.name || 'oth')
    const mi = new pc.MeshInstance(pcMesh, pcMat, node)
    g = mesh.gpu = { mi, pcMesh, geo, layout, matVersion: mat.version, geoLayout: geo.layoutVersion, uploaded: new Map(), vb: null, fmt: null, inst: [], node, world: new Float32Array(16).fill(NaN), box: [NaN, NaN, NaN, NaN] }
    // the instancing buffer: every instanced attribute (+ InstancedMesh's matrices as four vec4s), INTERLEAVED — one
    // vertex buffer binding (WebGPU allows 8 a draw, and PlayCanvas binds each non-interleaved stream as its own)
    const streams: { name: string; attr: BufferAttribute; comps: number; sub: number }[] = []
    for (const [name, a] of Object.entries(geo.attributes)) if (a.isInstancedBufferAttribute && layout.semantics[name]) streams.push({ name, attr: a, comps: a.itemSize, sub: 0 })
    if (instMat) for (let r = 0; r < 4; r++) streams.push({ name: `instanceMatrix${r}`, attr: instMat, comps: 4, sub: r })
    if (streams.length) {
      const desc = streams.map((s) => ({ semantic: layout.semantics[s.name], components: s.comps, type: DTYPE(s.attr.array), normalize: s.attr.normalized }))
      const fmt = g.fmt = new pc.VertexFormat(gfx().device, desc)
      g.inst = streams.map((s, i) => ({ name: s.name, attr: s.attr, offset: fmt.elements[i].offset, ver: -1, upTo: 0, comps: s.comps, sub: s.sub }))
    }
    if (layer) { mesh.layer = layer; layer.addMeshInstances([mi]) }
  }
  if (g.mi.material !== pcMat) g.mi.material = pcMat
  // re-upload what changed: the mesh's own streams, the instancing buffer
  let dirty = false, direct = 0
  // (a stream rewritten IN PLACE — the same count, the index as it was: written straight into the mesh's vertex buffer,
  //  its bounds recomputed as PlayCanvas does, one upload — 2026-11-07, docs/PERF.md "the garbage": PlayCanvas's
  //  Mesh.update walked every vertex through iterator objects and re-sent the index too, every frame for the car's
  //  ground shadow. Anything else — a first upload, a new count, a new index — goes the full way, as before.)
  const idxSame = !geo.index || g.uploaded.get('#index') === geo.index.version
  for (let i = 0; i < pk.streams.length; i++) {
    const { name, a, sem } = pk.streams[i]
    const was = g.uploaded.get(name)
    if (was === a.version) continue
    g.uploaded.set(name, a.version)
    if (a.version <= 0) continue
    if (was !== undefined && idxSame && canWrite(g.pcMesh, sem, a)) { _direct[direct++] = pk.streams[i]; continue }
    g.pcMesh.setVertexStream(sem, a.array, a.itemSize, a.count, DTYPE(a.array), a.normalized); dirty = true
  }
  if (direct && !dirty) writeStreams(g.pcMesh, direct)
  else if (direct) for (let i = 0; i < direct; i++) { const { a, sem } = _direct[i]; g.pcMesh.setVertexStream(sem, a.array, a.itemSize, a.count, DTYPE(a.array), a.normalized) }
  if (dirty) {
    if (geo.index) { g.pcMesh.setIndices(geo.index.array as Uint16Array); g.uploaded.set('#index', geo.index.version) } // (the index sent: as it is now)
    g.pcMesh.update(pc.PRIMITIVE_TRIANGLES)
  }
  // THE INSTANCING BUFFER, SIZED TO WHAT'S DRAWN (2026-11-07, docs/PERF.md "the hitches"): it holds the instances
  // drawn now — grown by half again when more are, never shrunk — and each stream's entries are copied from where it
  // was last copied to (all of them again when the attribute's version changes). Was: the attribute's whole capacity
  // copied and sent at each change — the far impostors' 50 391 slots (1.6 MB, ~1000 drawn) at every tree update, the
  // terrain's 2048 nodes every frame. The GPU reads only instances [0, count): the same picture.
  if (g.inst.length) {
    let n = Math.max(0, mesh.instances)
    for (const s of g.inst) n = Math.min(n, s.attr.count)
    if (!g.vb || g.vb.numVertices < n) {
      let cap = Math.max(16, Math.ceil(n * 1.5))
      for (const s of g.inst) cap = Math.min(cap, Math.max(s.attr.count, n))
      const old = g.vb
      g.vb = new pc.VertexBuffer(gfx().device, g.fmt!, Math.max(1, cap), { usage: pc.BUFFER_DYNAMIC })
      g.mi.setInstancing(g.vb, false)
      old?.destroy()
      for (const s of g.inst) s.upTo = 0
    }
    let up = false
    for (const s of g.inst) {
      if (s.ver !== s.attr.version) { s.ver = s.attr.version; s.upTo = 0 }
      if (s.upTo < n) up = true
    }
    if (up) {
      const buf = g.vb.lock() as ArrayBuffer, stride = g.vb.format.size
      for (const s of g.inst) {
        if (s.upTo >= n) continue
        const src = s.attr.array, el = src.BYTES_PER_ELEMENT
        // (a view of the buffer in the stream's own type: its components at offset + i × stride)
        const dst = new (src.constructor as new (b: ArrayBuffer) => TypedArray)(buf), st = stride / el, off = s.offset / el, it = s.attr.itemSize, from = s.sub * 4
        const c = s.comps
        if (c === 4) for (let i = s.upTo; i < n; i++) { const o = i * st + off, q = i * it + from; dst[o] = src[q]; dst[o + 1] = src[q + 1]; dst[o + 2] = src[q + 2]; dst[o + 3] = src[q + 3] }
        else for (let i = s.upTo; i < n; i++) for (let k = 0; k < c; k++) dst[i * st + off + k] = src[i * it + from + k]
        s.upTo = n
      }
      g.vb.unlock()
    }
  }
  return g
}

/** (prepare's streams written straight into a vertex buffer this frame) */
const _direct: Pick['streams'] = []
/** Can stream `a` be written straight into the PlayCanvas mesh's vertex buffer: one there already, of its count, with
 *  an element of its semantic, components and type? */
function canWrite(m: pc.Mesh, sem: string, a: BufferAttribute): boolean {
  const vb = m.vertexBuffer, gd = (m as unknown as { _geometryData?: { vertexCount: number } })._geometryData
  if (!vb || !gd || gd.vertexCount !== a.count || vb.numVertices < a.count) return false
  const el = vb.format.elements.find((e) => e.name === sem)
  return !!el && el.numComponents === a.itemSize && el.dataType === DTYPE(a.array)
}
/** Write the first `n` of `_direct` into the mesh's vertex buffer (one upload); its bounds from the positions. */
function writeStreams(m: pc.Mesh, n: number): void {
  const vb = m.vertexBuffer, fmt = vb.format, buf = vb.lock() as ArrayBuffer
  for (let i = 0; i < n; i++) {
    const { a, sem } = _direct[i], src = a.array, k = a.itemSize, cnt = a.count, B = src.BYTES_PER_ELEMENT
    const el = fmt.elements.find((e) => e.name === sem)!
    const Ctor = src.constructor as new (b: ArrayBuffer, o?: number, l?: number) => TypedArray
    if (el.stride === k * B && el.offset % B === 0) new Ctor(buf, el.offset, cnt * k).set(src.length === cnt * k ? src : src.subarray(0, cnt * k))
    else { const dst = new Ctor(buf), st = el.stride / B, off = el.offset / B; for (let v = 0; v < cnt; v++) for (let c = 0; c < k; c++) dst[off + v * st + c] = src[v * k + c] }
    // (as Mesh.update: the bounds from a 3-component position stream)
    if (sem === pc.SEMANTIC_POSITION && k === 3) { m.aabb.compute(src, cnt); m.aabb = m.aabb }
  }
  vb.unlock()
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

// ------------------------------------------------------------------------------------------------- the warm-up
/**
 * THE WARM-UP (2026-11-08 — the PERF MARKS drive, docs/PERF.md "first sight"): PlayCanvas makes a material's shader, and
 * WebGPU its pipeline (a driver compile), the first time something with it is DRAWN — 30–60 ms each, so every new kind
 * of thing coming into view (a place's props, a landmark, a rock set) was a stall: the "sudden drops" at places. The
 * port's `compileAsync` did nothing. Now every mesh in the main scene — shown, hidden, out of view — is warmed once
 * per material layout (the pipeline's key: the shader variant and the vertex format), 2 a frame: a throwaway mesh
 * instance sharing its mesh, material and instancing buffer, drawn by a warm camera into the SAME target as the main
 * camera (the same formats, the same MSAA: the same pipeline) through a 1-pixel viewport just before it — the main
 * camera's clear wipes it. Nothing on screen changes; the compile happens at a time of our choosing, 2 at a time.
 */
const warmed = new WeakSet<object>()
const warmNode = new pc.GraphNode('oth-warm')
let warmLayer: pc.Layer | null = null
let warmMis: pc.MeshInstance[] = []
/** How many material layouts a frame warms; and how many wait (the harness / compileAsync). */
export const warm = { perFrame: 2, pending: 0, total: 0, get layer(): pc.Layer { return warmLayerOf() }, get count(): number { return warmMis.length } }
function warmLayerOf(): pc.Layer {
  if (!warmLayer) {
    warmLayer = new pc.Layer({ name: 'oth-warm', opaqueSortMode: pc.SORTMODE_NONE, transparentSortMode: pc.SORTMODE_NONE })
    gfx().app.scene.layers.push(warmLayer)
  }
  return warmLayer
}
/**
 * WebGPU: the warm draws COMPILE OFF THE THREAD. PlayCanvas makes a pipeline with the blocking createRenderPipeline —
 * the GPU process compiles it there and then, and every command after waits (a big shader: ~1 s; measured at the
 * crossing). In the warm layer the draw is replaced: the pipeline PlayCanvas would make is described as it would
 * describe it, handed to createRenderPipelineAsync (Dawn compiles it on a worker) and kept alive; nothing is drawn and
 * PlayCanvas caches nothing. When the real draw asks for the same pipeline, Dawn finds the finished one (it shares
 * identical pipelines) — no stall. WebGL2 keeps the plain warm draw (its compile is the driver's).
 */
let asyncWarm = false
const keepAlive: unknown[] = []
export function installAsyncWarm(): void {
  if (asyncWarm) return
  asyncWarm = true
  const G = gfx()
  type Dev = { wgpu?: GPUDevice; draw: (...a: unknown[]) => void; renderPipeline: { get: (...a: unknown[]) => unknown; cache: Map<number, { pipeline: unknown }[]> }; shader: { ready: boolean; failed: boolean } | null; vertexBuffers: ({ format: unknown } | undefined)[]; renderTarget: unknown; bindGroupFormats: unknown; blendState: unknown; depthState: unknown; cullMode: unknown; stencilEnabled: unknown; stencilFront: unknown; stencilBack: unknown; frontFace: unknown; alphaToCoverage: unknown; clearVertexBuffer: () => void }
  const dev = G.device as unknown as Dev
  const wgpu = dev.wgpu
  if (!wgpu) return
  let warming = false
  G.app.scene.on('prerender:layer', (_c: unknown, layer: pc.Layer) => { warming = layer === warmLayer })
  G.app.scene.on('postrender:layer', () => { warming = false })
  const draw = dev.draw.bind(dev), rp = dev.renderPipeline
  dev.draw = (primitive: unknown, ib?: unknown, ...rest: unknown[]) => {
    const indexBuffer = ib as { format: unknown } | undefined
    if (!warming) { draw(primitive, indexBuffer, ...rest); return }
    const last = rest[3] ?? true
    if (dev.shader?.ready && !dev.shader.failed) {
      const sync = wgpu.createRenderPipeline
      let desc: GPURenderPipelineDescriptor | null = null
      ;(wgpu as unknown as { createRenderPipeline: unknown }).createRenderPipeline = (d: GPURenderPipelineDescriptor) => { desc = d; return null }
      try {
        const vb0 = dev.vertexBuffers[0], vb1 = dev.vertexBuffers[1]
        rp.get(primitive, vb0?.format, vb1?.format, indexBuffer?.format, dev.shader, dev.renderTarget, dev.bindGroupFormats, dev.blendState, dev.depthState, dev.cullMode, dev.stencilEnabled, dev.stencilFront, dev.stencilBack, dev.frontFace, dev.alphaToCoverage)
      } finally { (wgpu as unknown as { createRenderPipeline: unknown }).createRenderPipeline = sync }
      if (desc) {
        // (the empty entry PlayCanvas just cached for it: gone — the real draw makes it, and finds Dawn's)
        for (const [h, list] of rp.cache) {
          const i = list.findIndex((e) => e.pipeline === null)
          if (i >= 0) { list.splice(i, 1); if (!list.length) rp.cache.delete(h) }
        }
        wgpu.createRenderPipelineAsync(desc).then((p) => { keepAlive.push(p) }, () => { /* the real draw reports it */ })
      }
    }
    if (last) dev.clearVertexBuffer()
  }
}

/** (each main-scene sync) last frame's throwaways gone */
function warmBegin(): void {
  if (!warmMis.length) return
  warmLayerOf().removeMeshInstances(warmMis)
  for (const mi of warmMis) mi.destroy()
  warmMis = []
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
    const id = ++syncs, add: pc.MeshInstance[] = []
    let calls = 0, tris = 0
    // (the warm-up: the main scene only — the bakes' scenes draw at load)
    const main = this.layer === gfx().world
    let left = main ? warm.perFrame : 0, pending = 0
    if (main) warmBegin()
    const tryWarm = (o: Mesh) => {
      const pk = o.pick
      if (pk && warmed.has(pk.entry)) return
      if (left <= 0) { pending++; return }
      const g = o.gpu ?? prepare(o)
      if (!g || !o.pick || warmed.has(o.pick.entry)) return
      warmed.add(o.pick.entry)
      warm.total++
      left--
      const pe = o.pick.entry
      if (pe.pushed !== id) { pe.pushed = id; (o.material as ShaderMaterial).pushUniforms(pe) }
      const mi = new pc.MeshInstance(g.pcMesh, pe.m, warmNode)
      if (g.vb) { mi.setInstancing(g.vb, false); mi.instancingCount = 1 }
      mi.cull = false
      warmMis.push(mi)
    }
    const walk = (o: Object3D, vis: boolean) => {
      const v = vis && o.visible
      if (o instanceof Mesh) {
        if (main) tryWarm(o)
        // (hidden, already made, nothing disposed: only kept hidden — made ready again the frame it shows)
        if (!v && o.gpu && o.layer === this.layer && this.inLayer.has(o) && !o.geometry.disposed && !(o.material as ShaderMaterial).disposed) {
          o.seen = id
          o.gpu.mi.visible = false
          const ch = o.children
          for (let i = 0; i < ch.length; i++) walk(ch[i], v)
          return
        }
        const g = prepare(o)
        if (g) {
          o.seen = id
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
                // (set only when it moved: PlayCanvas re-derives its bounds from it each time it's set)
                const b = g.box
                if (b[0] !== c.x || b[1] !== c.y || b[2] !== c.z || b[3] !== r) {
                  b[0] = c.x; b[1] = c.y; b[2] = c.z; b[3] = r
                  _aabb.center.set(c.x, c.y, c.z); _aabb.halfExtents.set(r, r, r)
                  g.mi.setCustomAabb(_aabb)
                }
                g.mi.cull = true
              } else { if (!Number.isNaN(g.box[3])) { g.box[3] = NaN; g.mi.setCustomAabb(null) } g.mi.cull = false }
            } else g.mi.cull = o.frustumCulled
            // the draw order: renderOrder, then (opaque) by material, (transparent) far → near
            if (o.material.transparent) {
              const d = Math.min(Math.sqrt(_v.setFromMatrixPosition(o.matrixWorld).distanceToSquared(camPos)), 99999)
              g.mi.drawOrder = o.renderOrder * 1e6 - d * 10
            } else g.mi.drawOrder = o.renderOrder * 1e6 + (o.material.id % 100000)
            const pe = o.pick!.entry
            if (pe.pushed !== id) { pe.pushed = id; (o.material as ShaderMaterial).pushUniforms(pe) }
            calls++
            const ib = g.pcMesh.primitive[0].count
            tris += (ib / 3) * Math.max(1, n)
          }
        }
      }
      const ch = o.children
      for (let i = 0; i < ch.length; i++) walk(ch[i], v)
    }
    walk(this, true)
    if (main) { warm.pending = pending; if (warmMis.length) warmLayerOf().addMeshInstances(warmMis) }
    if (add.length) this.layer.addMeshInstances(add)
    const gone: pc.MeshInstance[] = []
    for (const m of this.inLayer) if (m.seen !== id) { this.inLayer.delete(m); if (m.gpu) gone.push(m.gpu.mi); m.layer = null }
    if (gone.length) this.layer.removeMeshInstances(gone)
    this.info.calls = calls
    this.info.triangles = tris
  }
}
const scenes: Scene[] = []
/** every sync, numbered (any scene): what it met and what it pushed carry its number — no sets made a frame */
let syncs = 0

const _v = new Vector3(), _p = new Vector3(), _s = new Vector3(), _t = new Vector3(), _x = new Vector3(1, 0, 0), _y = new Vector3(0, 1, 0), _z = new Vector3(0, 0, 1)
const _q = new Quaternion(), _m = new Matrix4(), _e = new Euler(), _b = new Box3(), _ident = new Matrix4()
const _aabb = new pc.BoundingBox()
