import { Box3, Matrix3, Matrix4, Quaternion, Sphere, Vector3 } from './math'

/**
 * GEOMETRY (docs/MIGRATION.md): three's buffer geometry kept as plain arrays (attributes by name, an index, instanced
 * attributes, `needsUpdate` to re-upload) — the scene layer (scene.ts) turns them into PlayCanvas meshes and instancing
 * buffers when they're first drawn, per material (each material maps attribute names to its own vertex slots).
 */
export const StaticDrawUsage = 35044
export const DynamicDrawUsage = 35048
export const StreamDrawUsage = 35040

export type TypedArray = Float32Array | Uint32Array | Uint16Array | Uint8Array | Int32Array | Int16Array | Int8Array

export class BufferAttribute {
  readonly isBufferAttribute = true
  readonly isInstancedBufferAttribute: boolean = false
  usage = StaticDrawUsage
  /** bumped by `needsUpdate = true` */
  version = 0
  name = ''
  /** (three's partial-upload hints: accepted; the whole buffer is re-sent) */
  readonly updateRanges: { start: number; count: number }[] = []
  constructor(public array: TypedArray, public itemSize: number, public normalized = false) {}
  get count(): number { return this.array.length / this.itemSize }
  set needsUpdate(v: boolean) { if (v) this.version++ }
  setUsage(u: number): this { this.usage = u; return this }
  addUpdateRange(start: number, count: number): void { this.updateRanges.push({ start, count }) }
  clearUpdateRanges(): void { this.updateRanges.length = 0 }
  /** (three's rule: a normalized integer attribute reads as 0 … 1 / −1 … 1 and writes from it) */
  private den(v: number): number {
    if (!this.normalized) return v
    const a = this.array
    return a instanceof Float32Array ? v : a instanceof Uint8Array ? v / 255 : a instanceof Uint16Array ? v / 65535 : a instanceof Uint32Array ? v / 4294967295
      : a instanceof Int8Array ? Math.max(v / 127, -1) : a instanceof Int16Array ? Math.max(v / 32767, -1) : Math.max(v / 2147483647, -1)
  }
  private nor(v: number): number {
    if (!this.normalized) return v
    const a = this.array
    return a instanceof Float32Array ? v : a instanceof Uint8Array ? Math.round(v * 255) : a instanceof Uint16Array ? Math.round(v * 65535) : a instanceof Uint32Array ? Math.round(v * 4294967295)
      : a instanceof Int8Array ? Math.round(v * 127) : a instanceof Int16Array ? Math.round(v * 32767) : Math.round(v * 2147483647)
  }
  getComponent(i: number, c: number): number { return this.den(this.array[i * this.itemSize + c]) }
  setComponent(i: number, c: number, v: number): this { this.array[i * this.itemSize + c] = this.nor(v); return this }
  getX(i: number): number { return this.den(this.array[i * this.itemSize]) }
  getY(i: number): number { return this.den(this.array[i * this.itemSize + 1]) }
  getZ(i: number): number { return this.den(this.array[i * this.itemSize + 2]) }
  getW(i: number): number { return this.den(this.array[i * this.itemSize + 3]) }
  setX(i: number, v: number): this { this.array[i * this.itemSize] = this.nor(v); return this }
  setY(i: number, v: number): this { this.array[i * this.itemSize + 1] = this.nor(v); return this }
  setZ(i: number, v: number): this { this.array[i * this.itemSize + 2] = this.nor(v); return this }
  setW(i: number, v: number): this { this.array[i * this.itemSize + 3] = this.nor(v); return this }
  setXY(i: number, x: number, y: number): this { const o = i * this.itemSize; this.array[o] = this.nor(x); this.array[o + 1] = this.nor(y); return this }
  setXYZ(i: number, x: number, y: number, z: number): this { const o = i * this.itemSize; this.array[o] = this.nor(x); this.array[o + 1] = this.nor(y); this.array[o + 2] = this.nor(z); return this }
  setXYZW(i: number, x: number, y: number, z: number, w: number): this { const o = i * this.itemSize; this.array[o] = this.nor(x); this.array[o + 1] = this.nor(y); this.array[o + 2] = this.nor(z); this.array[o + 3] = this.nor(w); return this }
  copyArray(a: ArrayLike<number>): this { this.array.set(a); return this }
  set(a: ArrayLike<number>, offset = 0): this { this.array.set(a, offset); return this }
  clone(): BufferAttribute { return new (this.constructor as typeof BufferAttribute)(this.array.slice() as TypedArray, this.itemSize, this.normalized).setUsage(this.usage) }
  applyMatrix4(m: Matrix4): this {
    for (let i = 0; i < this.count; i++) { _v.fromArray(this.array, i * this.itemSize).applyMatrix4(m); this.setXYZ(i, _v.x, _v.y, _v.z) }
    return this
  }
  applyNormalMatrix(m: Matrix3): this {
    for (let i = 0; i < this.count; i++) { _v.fromArray(this.array, i * this.itemSize).applyMatrix3(m).normalize(); this.setXYZ(i, _v.x, _v.y, _v.z) }
    return this
  }
  transformDirection(m: Matrix4): this {
    for (let i = 0; i < this.count; i++) { _v.fromArray(this.array, i * this.itemSize).transformDirection(m); this.setXYZ(i, _v.x, _v.y, _v.z) }
    return this
  }
}
export class Float32BufferAttribute extends BufferAttribute {
  constructor(a: ArrayLike<number> | number, itemSize: number, normalized = false) { super(typeof a === 'number' ? new Float32Array(a) : new Float32Array(a), itemSize, normalized) }
}
export class Uint16BufferAttribute extends BufferAttribute {
  constructor(a: ArrayLike<number> | number, itemSize: number, normalized = false) { super(typeof a === 'number' ? new Uint16Array(a) : new Uint16Array(a), itemSize, normalized) }
}
export class Uint32BufferAttribute extends BufferAttribute {
  constructor(a: ArrayLike<number> | number, itemSize: number, normalized = false) { super(typeof a === 'number' ? new Uint32Array(a) : new Uint32Array(a), itemSize, normalized) }
}
export class InstancedBufferAttribute extends BufferAttribute {
  override readonly isInstancedBufferAttribute = true
  constructor(array: TypedArray, itemSize: number, normalized = false, public meshPerAttribute = 1) { super(array, itemSize, normalized) }
}

let geometryIds = 0

export class BufferGeometry {
  readonly isBufferGeometry = true
  readonly id = ++geometryIds
  readonly attributes: Record<string, BufferAttribute> = {}
  index: BufferAttribute | null = null
  boundingBox: Box3 | null = null
  boundingSphere: Sphere | null = null
  userData: Record<string, unknown> = {}
  name = ''
  /** bumped when an attribute is added / removed or the index changes (the scene layer rebuilds its meshes) */
  layoutVersion = 0
  /** (scene.ts: the PlayCanvas meshes made from this, by material layout — destroyed with it) */
  readonly gpu = new Map<string, unknown>()
  disposed = false

  setAttribute(name: string, a: BufferAttribute): this { this.attributes[name] = a; this.layoutVersion++; return this }
  getAttribute(name: string): BufferAttribute { return this.attributes[name] }
  hasAttribute(name: string): boolean { return name in this.attributes }
  deleteAttribute(name: string): this { delete this.attributes[name]; this.layoutVersion++; return this }
  setIndex(i: BufferAttribute | number[] | null): this {
    if (Array.isArray(i)) { const max = i.reduce((m, v) => Math.max(m, v), 0); this.index = new BufferAttribute(max > 65535 ? new Uint32Array(i) : new Uint16Array(i), 1) }
    else this.index = i
    this.layoutVersion++
    return this
  }
  getIndex(): BufferAttribute | null { return this.index }

  applyMatrix4(m: Matrix4): this {
    this.attributes.position?.applyMatrix4(m)
    if (this.attributes.normal) this.attributes.normal.applyNormalMatrix(new Matrix3().getNormalMatrix(m))
    if (this.attributes.position) this.attributes.position.needsUpdate = true
    if (this.boundingBox) this.computeBoundingBox()
    if (this.boundingSphere) this.computeBoundingSphere()
    return this
  }
  applyQuaternion(q: Quaternion): this { return this.applyMatrix4(_m.makeRotationFromQuaternion(q)) }
  translate(x: number, y: number, z: number): this { return this.applyMatrix4(_m.makeTranslation(x, y, z)) }
  scale(x: number, y: number, z: number): this { return this.applyMatrix4(_m.makeScale(x, y, z)) }
  rotateX(a: number): this { return this.applyMatrix4(_m.makeRotationX(a)) }
  rotateY(a: number): this { return this.applyMatrix4(_m.makeRotationY(a)) }
  rotateZ(a: number): this { return this.applyMatrix4(_m.makeRotationZ(a)) }
  lookAt(v: Vector3): this { _o.lookAt(_zero, v, _up); return this.applyMatrix4(_o) }
  center(): this { this.computeBoundingBox(); this.boundingBox!.getCenter(_v).negate(); return this.translate(_v.x, _v.y, _v.z) }
  setFromPoints(ps: Vector3[]): this {
    const a = new Float32Array(ps.length * 3)
    ps.forEach((p, i) => { a[i * 3] = p.x; a[i * 3 + 1] = p.y; a[i * 3 + 2] = p.z })
    return this.setAttribute('position', new BufferAttribute(a, 3))
  }

  computeBoundingBox(): void {
    const p = this.attributes.position
    this.boundingBox ??= new Box3()
    if (p) this.boundingBox.setFromBufferAttribute(p)
    else this.boundingBox.makeEmpty()
  }
  computeBoundingSphere(): void {
    const p = this.attributes.position
    this.boundingSphere ??= new Sphere()
    if (!p) { this.boundingSphere.radius = -1; return }
    _b.setFromBufferAttribute(p)
    _b.getCenter(this.boundingSphere.center)
    let r = 0
    for (let i = 0; i < p.count; i++) r = Math.max(r, this.boundingSphere.center.distanceToSquared(_v.set(p.getX(i), p.getY(i), p.getZ(i))))
    this.boundingSphere.radius = Math.sqrt(r)
  }

  /** Smooth normals: each vertex's the area-weighted sum of its triangles' (three's computeVertexNormals). */
  computeVertexNormals(): void {
    const p = this.attributes.position
    if (!p) return
    let n = this.attributes.normal
    if (!n || n.count !== p.count) { n = new BufferAttribute(new Float32Array(p.count * 3), 3); this.setAttribute('normal', n) } else (n.array as Float32Array).fill(0)
    const a = new Vector3(), b = new Vector3(), c = new Vector3(), cb = new Vector3(), ab = new Vector3()
    const tri = (i0: number, i1: number, i2: number) => {
      a.fromArray(p.array, i0 * 3); b.fromArray(p.array, i1 * 3); c.fromArray(p.array, i2 * 3)
      cb.subVectors(c, b); ab.subVectors(a, b); cb.cross(ab)
      for (const i of [i0, i1, i2]) { n.array[i * 3] += cb.x; n.array[i * 3 + 1] += cb.y; n.array[i * 3 + 2] += cb.z }
    }
    if (this.index) { const I = this.index.array; for (let i = 0; i < I.length; i += 3) tri(I[i], I[i + 1], I[i + 2]) }
    else for (let i = 0; i < p.count; i += 3) tri(i, i + 1, i + 2)
    for (let i = 0; i < n.count; i++) { _v.fromArray(n.array, i * 3).normalize(); n.setXYZ(i, _v.x, _v.y, _v.z) }
    n.needsUpdate = true
  }

  /** Every triangle its own three vertices (three's toNonIndexed). */
  toNonIndexed(): BufferGeometry {
    if (!this.index) return this.clone()
    const I = this.index.array, g = new BufferGeometry()
    for (const [name, at] of Object.entries(this.attributes)) {
      const s = at.itemSize, out = new (at.array.constructor as new (n: number) => TypedArray)(I.length * s)
      for (let i = 0; i < I.length; i++) for (let k = 0; k < s; k++) out[i * s + k] = at.array[I[i] * s + k]
      g.setAttribute(name, new BufferAttribute(out, s, at.normalized))
    }
    return g
  }

  clone(): BufferGeometry {
    const g = new (this.constructor as new () => BufferGeometry)()
    for (const [k, a] of Object.entries(this.attributes)) g.setAttribute(k, a.clone())
    if (this.index) g.setIndex(this.index.clone())
    if (this.boundingBox) g.boundingBox = this.boundingBox.clone()
    if (this.boundingSphere) g.boundingSphere = this.boundingSphere.clone()
    g.userData = { ...this.userData }
    if (this instanceof InstancedBufferGeometry) (g as InstancedBufferGeometry).instanceCount = this.instanceCount
    return g
  }

  /** (scene.ts frees the GPU side; the arrays go with the last reference) */
  dispose(): void {
    this.disposed = true
    for (const v of this.gpu.values()) (v as { destroy(): void }).destroy()
    this.gpu.clear()
  }
}

export class InstancedBufferGeometry extends BufferGeometry {
  readonly isInstancedBufferGeometry = true
  instanceCount = Infinity
}

// ------------------------------------------------------------------------------------------------- shapes
/** A plane in x / y, facing +z (three's PlaneGeometry). */
export class PlaneGeometry extends BufferGeometry {
  constructor(w = 1, h = 1, ws = 1, hs = 1) {
    super()
    const gx = Math.floor(ws), gy = Math.floor(hs), pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = []
    for (let iy = 0; iy <= gy; iy++) for (let ix = 0; ix <= gx; ix++) {
      pos.push((ix / gx - 0.5) * w, -(iy / gy - 0.5) * h, 0); nor.push(0, 0, 1); uv.push(ix / gx, 1 - iy / gy)
    }
    for (let iy = 0; iy < gy; iy++) for (let ix = 0; ix < gx; ix++) {
      const a = ix + (gx + 1) * iy, b = ix + (gx + 1) * (iy + 1), c = ix + 1 + (gx + 1) * (iy + 1), d = ix + 1 + (gx + 1) * iy
      idx.push(a, b, d, b, c, d)
    }
    this.setIndex(idx)
    this.setAttribute('position', new Float32BufferAttribute(pos, 3))
    this.setAttribute('normal', new Float32BufferAttribute(nor, 3))
    this.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  }
}

/** A disc in x / y, facing +z (three's CircleGeometry). */
export class CircleGeometry extends BufferGeometry {
  constructor(r = 1, seg = 32, thetaStart = 0, thetaLength = Math.PI * 2) {
    super()
    const pos = [0, 0, 0], nor = [0, 0, 1], uv = [0.5, 0.5], idx: number[] = []
    for (let s = 0; s <= seg; s++) {
      const a = thetaStart + (s / seg) * thetaLength, x = r * Math.cos(a), y = r * Math.sin(a)
      pos.push(x, y, 0); nor.push(0, 0, 1); uv.push((x / r + 1) / 2, (y / r + 1) / 2)
    }
    for (let i = 1; i <= seg; i++) idx.push(i, i + 1, 0)
    this.setIndex(idx)
    this.setAttribute('position', new Float32BufferAttribute(pos, 3))
    this.setAttribute('normal', new Float32BufferAttribute(nor, 3))
    this.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  }
}

/** A UV sphere (three's SphereGeometry: phi round y from −x, theta from +y down). */
export class SphereGeometry extends BufferGeometry {
  constructor(radius = 1, ws = 32, hs = 16, phiStart = 0, phiLength = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI) {
    super()
    const W = Math.max(3, Math.floor(ws)), H = Math.max(2, Math.floor(hs)), thetaEnd = Math.min(thetaStart + thetaLength, Math.PI)
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [], grid: number[][] = []
    let k = 0
    for (let iy = 0; iy <= H; iy++) {
      const row: number[] = [], v = iy / H
      let uOff = 0
      if (iy === 0 && thetaStart === 0) uOff = 0.5 / W
      else if (iy === H && thetaEnd === Math.PI) uOff = -0.5 / W
      for (let ix = 0; ix <= W; ix++) {
        const u = ix / W
        const x = -radius * Math.cos(phiStart + u * phiLength) * Math.sin(thetaStart + v * thetaLength)
        const y = radius * Math.cos(thetaStart + v * thetaLength)
        const z = radius * Math.sin(phiStart + u * phiLength) * Math.sin(thetaStart + v * thetaLength)
        pos.push(x, y, z)
        _v.set(x, y, z).normalize(); nor.push(_v.x, _v.y, _v.z)
        uv.push(u + uOff, 1 - v)
        row.push(k++)
      }
      grid.push(row)
    }
    for (let iy = 0; iy < H; iy++) for (let ix = 0; ix < W; ix++) {
      const a = grid[iy][ix + 1], b = grid[iy][ix], c = grid[iy + 1][ix], d = grid[iy + 1][ix + 1]
      if (iy !== 0 || thetaStart > 0) idx.push(a, b, d)
      if (iy !== H - 1 || thetaEnd < Math.PI) idx.push(b, c, d)
    }
    this.setIndex(idx)
    this.setAttribute('position', new Float32BufferAttribute(pos, 3))
    this.setAttribute('normal', new Float32BufferAttribute(nor, 3))
    this.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  }
}

/** An icosahedron subdivided `detail` times, its vertices on the sphere, flat triangles (non-indexed, like three's). */
export class IcosahedronGeometry extends BufferGeometry {
  constructor(radius = 1, detail = 0) {
    super()
    const t = (1 + Math.sqrt(5)) / 2
    const V = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1]
    const F = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1]
    const out: number[] = [], uvs: number[] = []
    const vert = (i: number) => new Vector3(V[i * 3], V[i * 3 + 1], V[i * 3 + 2])
    const push = (p: Vector3) => { const n = p.clone().normalize(); out.push(n.x * radius, n.y * radius, n.z * radius) }
    for (let f = 0; f < F.length; f += 3) {
      const a = vert(F[f]), b = vert(F[f + 1]), c = vert(F[f + 2]), cols = detail + 1, grid: Vector3[][] = []
      for (let i = 0; i <= cols; i++) {
        grid[i] = []
        const aj = a.clone().lerp(c, i / cols), bj = b.clone().lerp(c, i / cols), rows = cols - i
        for (let j = 0; j <= rows; j++) grid[i][j] = j === 0 && i === cols ? aj : aj.clone().lerp(bj, j / rows)
      }
      for (let i = 0; i < cols; i++) for (let j = 0; j < 2 * (cols - i) - 1; j++) {
        const k = Math.floor(j / 2)
        if (j % 2 === 0) { push(grid[i][k + 1]); push(grid[i + 1][k]); push(grid[i][k]) }
        else { push(grid[i][k + 1]); push(grid[i + 1][k + 1]); push(grid[i + 1][k]) }
      }
    }
    for (let i = 0; i < out.length; i += 3) {
      _v.set(out[i], out[i + 1], out[i + 2])
      uvs.push(Math.atan2(_v.z, -_v.x) / (2 * Math.PI) + 0.5, Math.atan2(-_v.y, Math.sqrt(_v.x * _v.x + _v.z * _v.z)) / Math.PI + 0.5)
    }
    this.setAttribute('position', new Float32BufferAttribute(out, 3))
    this.setAttribute('normal', new Float32BufferAttribute(out.map((v) => v / radius), 3))
    this.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
    // (three: detail 0 flat — each face its own normal; finer ones smooth)
    if (detail === 0) this.computeVertexNormals()
  }
}

const _v = new Vector3(), _m = new Matrix4(), _o = new Matrix4(), _b = new Box3(), _zero = new Vector3(), _up = new Vector3(0, 1, 0)
