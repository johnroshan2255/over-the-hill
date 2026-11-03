/**
 * THE GAME'S MATH (docs/MIGRATION.md): vectors, matrices, quaternions, colours, boxes, spheres, frustums — the subset the
 * game uses, with three.js's semantics (column-major `elements`, right-handed, −z forward, `Euler` order XYZ) so the
 * geometry builders, the physics glue and the cameras kept their code when the renderer moved to PlayCanvas. Pure math:
 * nothing here touches the GPU.
 */
export class Vector2 {
  readonly isVector2 = true
  constructor(public x = 0, public y = 0) {}
  set(x: number, y: number): this { this.x = x; this.y = y; return this }
  setScalar(s: number): this { this.x = this.y = s; return this }
  copy(v: Vector2): this { this.x = v.x; this.y = v.y; return this }
  clone(): Vector2 { return new Vector2(this.x, this.y) }
  add(v: Vector2): this { this.x += v.x; this.y += v.y; return this }
  sub(v: Vector2): this { this.x -= v.x; this.y -= v.y; return this }
  multiplyScalar(s: number): this { this.x *= s; this.y *= s; return this }
  dot(v: Vector2): number { return this.x * v.x + this.y * v.y }
  length(): number { return Math.hypot(this.x, this.y) }
  normalize(): this { const l = this.length() || 1; return this.multiplyScalar(1 / l) }
  distanceTo(v: Vector2): number { return Math.hypot(this.x - v.x, this.y - v.y) }
  lerp(v: Vector2, t: number): this { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; return this }
  toArray(a: number[] | Float32Array = [], o = 0): number[] | Float32Array { a[o] = this.x; a[o + 1] = this.y; return a }
  fromArray(a: ArrayLike<number>, o = 0): this { this.x = a[o]; this.y = a[o + 1]; return this }
}

export class Vector3 {
  readonly isVector3 = true
  constructor(public x = 0, public y = 0, public z = 0) {}
  set(x: number, y: number, z: number): this { this.x = x; this.y = y; this.z = z; return this }
  setScalar(s: number): this { this.x = this.y = this.z = s; return this }
  setX(v: number): this { this.x = v; return this }
  setY(v: number): this { this.y = v; return this }
  setZ(v: number): this { this.z = v; return this }
  copy(v: { x: number; y: number; z: number }): this { this.x = v.x; this.y = v.y; this.z = v.z; return this }
  clone(): Vector3 { return new Vector3(this.x, this.y, this.z) }
  add(v: Vector3): this { this.x += v.x; this.y += v.y; this.z += v.z; return this }
  addScalar(s: number): this { this.x += s; this.y += s; this.z += s; return this }
  addVectors(a: Vector3, b: Vector3): this { this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z; return this }
  addScaledVector(v: Vector3, s: number): this { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this }
  sub(v: Vector3): this { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this }
  subVectors(a: Vector3, b: Vector3): this { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this }
  multiply(v: Vector3): this { this.x *= v.x; this.y *= v.y; this.z *= v.z; return this }
  multiplyScalar(s: number): this { this.x *= s; this.y *= s; this.z *= s; return this }
  divideScalar(s: number): this { return this.multiplyScalar(1 / s) }
  negate(): this { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this }
  dot(v: Vector3): number { return this.x * v.x + this.y * v.y + this.z * v.z }
  lengthSq(): number { return this.x * this.x + this.y * this.y + this.z * this.z }
  length(): number { return Math.sqrt(this.lengthSq()) }
  setLength(l: number): this { return this.normalize().multiplyScalar(l) }
  normalize(): this { return this.divideScalar(this.length() || 1) }
  cross(v: Vector3): this { return this.crossVectors(this, v) }
  crossVectors(a: Vector3, b: Vector3): this {
    const ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z
    this.x = ay * bz - az * by; this.y = az * bx - ax * bz; this.z = ax * by - ay * bx
    return this
  }
  distanceTo(v: Vector3): number { return Math.sqrt(this.distanceToSquared(v)) }
  distanceToSquared(v: Vector3): number { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return dx * dx + dy * dy + dz * dz }
  lerp(v: Vector3, t: number): this { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this }
  lerpVectors(a: Vector3, b: Vector3, t: number): this { this.x = a.x + (b.x - a.x) * t; this.y = a.y + (b.y - a.y) * t; this.z = a.z + (b.z - a.z) * t; return this }
  min(v: Vector3): this { this.x = Math.min(this.x, v.x); this.y = Math.min(this.y, v.y); this.z = Math.min(this.z, v.z); return this }
  max(v: Vector3): this { this.x = Math.max(this.x, v.x); this.y = Math.max(this.y, v.y); this.z = Math.max(this.z, v.z); return this }
  angleTo(v: Vector3): number {
    const d = Math.sqrt(this.lengthSq() * v.lengthSq())
    return d === 0 ? Math.PI / 2 : Math.acos(Math.min(1, Math.max(-1, this.dot(v) / d)))
  }
  equals(v: Vector3): boolean { return v.x === this.x && v.y === this.y && v.z === this.z }
  getComponent(i: number): number { return i === 0 ? this.x : i === 1 ? this.y : this.z }
  setComponent(i: number, v: number): this { if (i === 0) this.x = v; else if (i === 1) this.y = v; else this.z = v; return this }
  applyMatrix3(m: Matrix3): this {
    const x = this.x, y = this.y, z = this.z, e = m.elements
    this.x = e[0] * x + e[3] * y + e[6] * z; this.y = e[1] * x + e[4] * y + e[7] * z; this.z = e[2] * x + e[5] * y + e[8] * z
    return this
  }
  applyMatrix4(m: Matrix4): this {
    const x = this.x, y = this.y, z = this.z, e = m.elements
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15])
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w
    return this
  }
  applyQuaternion(q: Quaternion): this {
    const vx = this.x, vy = this.y, vz = this.z, qx = q.x, qy = q.y, qz = q.z, qw = q.w
    const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx)
    this.x = vx + qw * tx + qy * tz - qz * ty
    this.y = vy + qw * ty + qz * tx - qx * tz
    this.z = vz + qw * tz + qx * ty - qy * tx
    return this
  }
  applyAxisAngle(axis: Vector3, angle: number): this { return this.applyQuaternion(_q.setFromAxisAngle(axis, angle)) }
  applyEuler(e: Euler): this { return this.applyQuaternion(_q.setFromEuler(e)) }
  /** Direction: the matrix's rotation part, normalized (three's transformDirection). */
  transformDirection(m: Matrix4): this {
    const x = this.x, y = this.y, z = this.z, e = m.elements
    this.x = e[0] * x + e[4] * y + e[8] * z; this.y = e[1] * x + e[5] * y + e[9] * z; this.z = e[2] * x + e[6] * y + e[10] * z
    return this.normalize()
  }
  setFromMatrixPosition(m: Matrix4): this { const e = m.elements; return this.set(e[12], e[13], e[14]) }
  setFromMatrixColumn(m: Matrix4, i: number): this { return this.fromArray(m.elements, i * 4) }
  project(camera: Camera): this { return this.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix) }
  unproject(camera: Camera): this { return this.applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(camera.matrixWorld) }
  toArray(a: number[] | Float32Array = [], o = 0): number[] | Float32Array { a[o] = this.x; a[o + 1] = this.y; a[o + 2] = this.z; return a }
  fromArray(a: ArrayLike<number>, o = 0): this { this.x = a[o]; this.y = a[o + 1]; this.z = a[o + 2]; return this }
  fromBufferAttribute(a: { getX(i: number): number; getY(i: number): number; getZ(i: number): number }, i: number): this { return this.set(a.getX(i), a.getY(i), a.getZ(i)) }
}

export class Vector4 {
  readonly isVector4 = true
  constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}
  set(x: number, y: number, z: number, w: number): this { this.x = x; this.y = y; this.z = z; this.w = w; return this }
  setScalar(s: number): this { this.x = this.y = this.z = this.w = s; return this }
  copy(v: Vector4): this { this.x = v.x; this.y = v.y; this.z = v.z; this.w = v.w; return this }
  clone(): Vector4 { return new Vector4(this.x, this.y, this.z, this.w) }
  multiplyScalar(s: number): this { this.x *= s; this.y *= s; this.z *= s; this.w *= s; return this }
  lerp(v: Vector4, t: number): this { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; this.w += (v.w - this.w) * t; return this }
  toArray(a: number[] | Float32Array = [], o = 0): number[] | Float32Array { a[o] = this.x; a[o + 1] = this.y; a[o + 2] = this.z; a[o + 3] = this.w; return a }
  fromArray(a: ArrayLike<number>, o = 0): this { this.x = a[o]; this.y = a[o + 1]; this.z = a[o + 2]; this.w = a[o + 3]; return this }
}

export class Euler {
  readonly isEuler = true
  constructor(public x = 0, public y = 0, public z = 0, public order: 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY' = 'XYZ') {}
  set(x: number, y: number, z: number, order?: Euler['order']): this { this.x = x; this.y = y; this.z = z; if (order) this.order = order; return this }
  copy(e: Euler): this { this.x = e.x; this.y = e.y; this.z = e.z; this.order = e.order; return this }
  setFromRotationMatrix(m: Matrix4, order = this.order): this {
    const e = m.elements, m11 = e[0], m12 = e[4], m13 = e[8], m21 = e[1], m22 = e[5], m23 = e[9], m31 = e[2], m32 = e[6], m33 = e[10]
    const cl = (v: number) => Math.max(-1, Math.min(1, v))
    if (order === 'XYZ') {
      this.y = Math.asin(cl(m13))
      if (Math.abs(m13) < 0.9999999) { this.x = Math.atan2(-m23, m33); this.z = Math.atan2(-m12, m11) } else { this.x = Math.atan2(m32, m22); this.z = 0 }
    } else if (order === 'YXZ') {
      this.x = Math.asin(-cl(m23))
      if (Math.abs(m23) < 0.9999999) { this.y = Math.atan2(m13, m33); this.z = Math.atan2(m21, m22) } else { this.y = Math.atan2(-m31, m11); this.z = 0 }
    } else throw new Error(`Euler order ${order} not supported`)
    this.order = order
    return this
  }
  setFromQuaternion(q: Quaternion, order = this.order): this { return this.setFromRotationMatrix(_m.makeRotationFromQuaternion(q), order) }
}

export class Quaternion {
  readonly isQuaternion = true
  constructor(public x = 0, public y = 0, public z = 0, public w = 1) {}
  set(x: number, y: number, z: number, w: number): this { this.x = x; this.y = y; this.z = z; this.w = w; return this }
  copy(q: Quaternion): this { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this }
  clone(): Quaternion { return new Quaternion(this.x, this.y, this.z, this.w) }
  identity(): this { return this.set(0, 0, 0, 1) }
  setFromAxisAngle(a: Vector3, angle: number): this {
    const h = angle / 2, s = Math.sin(h)
    return this.set(a.x * s, a.y * s, a.z * s, Math.cos(h))
  }
  setFromEuler(e: Euler): this {
    const c1 = Math.cos(e.x / 2), c2 = Math.cos(e.y / 2), c3 = Math.cos(e.z / 2), s1 = Math.sin(e.x / 2), s2 = Math.sin(e.y / 2), s3 = Math.sin(e.z / 2)
    switch (e.order) {
      case 'XYZ': return this.set(s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3)
      case 'YXZ': return this.set(s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3)
      case 'ZXY': return this.set(s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3)
      case 'ZYX': return this.set(s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3)
      case 'YZX': return this.set(s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3)
      default: return this.set(s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3) // XZY
    }
  }
  setFromRotationMatrix(m: Matrix4): this {
    const e = m.elements, m11 = e[0], m12 = e[4], m13 = e[8], m21 = e[1], m22 = e[5], m23 = e[9], m31 = e[2], m32 = e[6], m33 = e[10]
    const tr = m11 + m22 + m33
    if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); return this.set((m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s) }
    if (m11 > m22 && m11 > m33) { const s = 2 * Math.sqrt(1 + m11 - m22 - m33); return this.set(0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s) }
    if (m22 > m33) { const s = 2 * Math.sqrt(1 + m22 - m11 - m33); return this.set((m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s) }
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22)
    return this.set((m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s)
  }
  setFromUnitVectors(a: Vector3, b: Vector3): this {
    let r = a.dot(b) + 1
    if (r < 1e-8) {
      r = 0
      if (Math.abs(a.x) > Math.abs(a.z)) this.set(-a.y, a.x, 0, r); else this.set(0, -a.z, a.y, r)
    } else this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x, r)
    return this.normalize()
  }
  multiply(q: Quaternion): this { return this.multiplyQuaternions(this, q) }
  premultiply(q: Quaternion): this { return this.multiplyQuaternions(q, this) }
  multiplyQuaternions(a: Quaternion, b: Quaternion): this {
    const ax = a.x, ay = a.y, az = a.z, aw = a.w, bx = b.x, by = b.y, bz = b.z, bw = b.w
    return this.set(ax * bw + aw * bx + ay * bz - az * by, ay * bw + aw * by + az * bx - ax * bz, az * bw + aw * bz + ax * by - ay * bx, aw * bw - ax * bx - ay * by - az * bz)
  }
  invert(): this { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this }
  conjugate(): this { return this.invert() }
  dot(q: Quaternion): number { return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w }
  length(): number { return Math.hypot(this.x, this.y, this.z, this.w) }
  normalize(): this { const l = this.length(); return l === 0 ? this.set(0, 0, 0, 1) : this.set(this.x / l, this.y / l, this.z / l, this.w / l) }
  angleTo(q: Quaternion): number { return 2 * Math.acos(Math.abs(Math.max(-1, Math.min(1, this.dot(q))))) }
  slerpQuaternions(a: Quaternion, b: Quaternion, t: number): this { return this.copy(a).slerp(b, t) }
  slerp(qb: Quaternion, t: number): this {
    if (t === 0) return this
    if (t === 1) return this.copy(qb)
    const x = this.x, y = this.y, z = this.z, w = this.w
    let cos = w * qb.w + x * qb.x + y * qb.y + z * qb.z
    if (cos < 0) { this.set(-qb.x, -qb.y, -qb.z, -qb.w); cos = -cos } else this.copy(qb)
    if (cos >= 1) return this.set(x, y, z, w)
    const sq = 1 - cos * cos
    if (sq <= Number.EPSILON) { const s = 1 - t; return this.set(s * x + t * this.x, s * y + t * this.y, s * z + t * this.z, s * w + t * this.w).normalize() }
    const sin = Math.sqrt(sq), ha = Math.atan2(sin, cos), ra = Math.sin((1 - t) * ha) / sin, rb = Math.sin(t * ha) / sin
    return this.set(x * ra + this.x * rb, y * ra + this.y * rb, z * ra + this.z * rb, w * ra + this.w * rb)
  }
  toArray(a: number[] | Float32Array = [], o = 0): number[] | Float32Array { a[o] = this.x; a[o + 1] = this.y; a[o + 2] = this.z; a[o + 3] = this.w; return a }
  fromArray(a: ArrayLike<number>, o = 0): this { return this.set(a[o], a[o + 1], a[o + 2], a[o + 3]) }
}

export class Matrix3 {
  readonly elements = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])
  setFromMatrix4(m: Matrix4): this { const e = m.elements, t = this.elements; t.set([e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]]); return this }
  invert(): this {
    const t = this.elements, n11 = t[0], n21 = t[1], n31 = t[2], n12 = t[3], n22 = t[4], n32 = t[5], n13 = t[6], n23 = t[7], n33 = t[8]
    const t11 = n33 * n22 - n32 * n23, t12 = n32 * n13 - n33 * n12, t13 = n23 * n12 - n22 * n13
    const det = n11 * t11 + n21 * t12 + n31 * t13
    if (det === 0) { t.fill(0); return this }
    const d = 1 / det
    t.set([t11 * d, (n31 * n23 - n33 * n21) * d, (n32 * n21 - n31 * n22) * d, t12 * d, (n33 * n11 - n31 * n13) * d, (n31 * n12 - n32 * n11) * d, t13 * d, (n21 * n13 - n23 * n11) * d, (n22 * n11 - n21 * n12) * d])
    return this
  }
  transpose(): this { const m = this.elements; let s: number; s = m[1]; m[1] = m[3]; m[3] = s; s = m[2]; m[2] = m[6]; m[6] = s; s = m[5]; m[5] = m[7]; m[7] = s; return this }
  getNormalMatrix(m: Matrix4): this { return this.setFromMatrix4(m).invert().transpose() }
}

export class Matrix4 {
  readonly isMatrix4 = true
  readonly elements = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  /** Row-major arguments (three's `set`). */
  set(n11: number, n12: number, n13: number, n14: number, n21: number, n22: number, n23: number, n24: number, n31: number, n32: number, n33: number, n34: number, n41: number, n42: number, n43: number, n44: number): this {
    const t = this.elements
    t[0] = n11; t[4] = n12; t[8] = n13; t[12] = n14; t[1] = n21; t[5] = n22; t[9] = n23; t[13] = n24
    t[2] = n31; t[6] = n32; t[10] = n33; t[14] = n34; t[3] = n41; t[7] = n42; t[11] = n43; t[15] = n44
    return this
  }
  identity(): this { return this.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1) }
  copy(m: Matrix4): this { this.elements.set(m.elements); return this }
  clone(): Matrix4 { return new Matrix4().copy(this) }
  fromArray(a: ArrayLike<number>, o = 0): this { for (let i = 0; i < 16; i++) this.elements[i] = a[i + o]; return this }
  toArray(a: number[] | Float32Array = [], o = 0): number[] | Float32Array { for (let i = 0; i < 16; i++) a[i + o] = this.elements[i]; return a }
  multiply(m: Matrix4): this { return this.multiplyMatrices(this, m) }
  premultiply(m: Matrix4): this { return this.multiplyMatrices(m, this) }
  multiplyMatrices(a: Matrix4, b: Matrix4): this {
    const ae = a.elements, be = b.elements, te = this.elements
    const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12], a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13]
    const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14], a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15]
    const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12], b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13]
    const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14], b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15]
    te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41; te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42
    te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43; te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44
    te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41; te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42
    te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43; te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44
    te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41; te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42
    te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43; te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44
    te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41; te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42
    te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43; te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44
    return this
  }
  determinant(): number {
    const t = this.elements, n11 = t[0], n12 = t[4], n13 = t[8], n14 = t[12], n21 = t[1], n22 = t[5], n23 = t[9], n24 = t[13]
    const n31 = t[2], n32 = t[6], n33 = t[10], n34 = t[14], n41 = t[3], n42 = t[7], n43 = t[11], n44 = t[15]
    return n41 * (+n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34) +
      n42 * (+n11 * n23 * n34 - n11 * n24 * n33 + n14 * n21 * n33 - n13 * n21 * n34 + n13 * n24 * n31 - n14 * n23 * n31) +
      n43 * (+n11 * n24 * n32 - n11 * n22 * n34 - n14 * n21 * n32 + n12 * n21 * n34 + n14 * n22 * n31 - n12 * n24 * n31) +
      n44 * (-n13 * n22 * n31 - n11 * n23 * n32 + n11 * n22 * n33 + n13 * n21 * n32 - n12 * n21 * n33 + n12 * n23 * n31)
  }
  invert(): this {
    const t = this.elements, n11 = t[0], n21 = t[1], n31 = t[2], n41 = t[3], n12 = t[4], n22 = t[5], n32 = t[6], n42 = t[7]
    const n13 = t[8], n23 = t[9], n33 = t[10], n43 = t[11], n14 = t[12], n24 = t[13], n34 = t[14], n44 = t[15]
    const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44
    const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44
    const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44
    const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34
    const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14
    if (det === 0) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    const d = 1 / det
    t[0] = t11 * d
    t[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d
    t[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d
    t[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d
    t[4] = t12 * d
    t[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d
    t[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d
    t[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d
    t[8] = t13 * d
    t[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d
    t[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d
    t[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d
    t[12] = t14 * d
    t[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d
    t[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d
    t[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d
    return this
  }
  transpose(): this {
    const t = this.elements
    let s: number
    s = t[1]; t[1] = t[4]; t[4] = s; s = t[2]; t[2] = t[8]; t[8] = s; s = t[6]; t[6] = t[9]; t[9] = s
    s = t[3]; t[3] = t[12]; t[12] = s; s = t[7]; t[7] = t[13]; t[13] = s; s = t[11]; t[11] = t[14]; t[14] = s
    return this
  }
  setPosition(x: number | Vector3, y?: number, z?: number): this {
    const t = this.elements
    if (typeof x === 'object') { t[12] = x.x; t[13] = x.y; t[14] = x.z } else { t[12] = x; t[13] = y!; t[14] = z! }
    return this
  }
  makeTranslation(x: number | Vector3, y?: number, z?: number): this {
    if (typeof x === 'object') return this.set(1, 0, 0, x.x, 0, 1, 0, x.y, 0, 0, 1, x.z, 0, 0, 0, 1)
    return this.set(1, 0, 0, x, 0, 1, 0, y!, 0, 0, 1, z!, 0, 0, 0, 1)
  }
  makeScale(x: number, y: number, z: number): this { return this.set(x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1) }
  makeRotationX(a: number): this { const c = Math.cos(a), s = Math.sin(a); return this.set(1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1) }
  makeRotationY(a: number): this { const c = Math.cos(a), s = Math.sin(a); return this.set(c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1) }
  makeRotationZ(a: number): this { const c = Math.cos(a), s = Math.sin(a); return this.set(c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1) }
  makeRotationAxis(axis: Vector3, a: number): this {
    const c = Math.cos(a), s = Math.sin(a), t = 1 - c, x = axis.x, y = axis.y, z = axis.z, tx = t * x, ty = t * y
    return this.set(tx * x + c, tx * y - s * z, tx * z + s * y, 0, tx * y + s * z, ty * y + c, ty * z - s * x, 0, tx * z - s * y, ty * z + s * x, t * z * z + c, 0, 0, 0, 0, 1)
  }
  makeRotationFromQuaternion(q: Quaternion): this { return this.compose(_zero, q, _one) }
  makeBasis(x: Vector3, y: Vector3, z: Vector3): this { return this.set(x.x, y.x, z.x, 0, x.y, y.y, z.y, 0, x.z, y.z, z.z, 0, 0, 0, 0, 1) }
  extractRotation(m: Matrix4): this {
    const t = this.elements, me = m.elements
    const sx = 1 / _v.setFromMatrixColumn(m, 0).length(), sy = 1 / _v.setFromMatrixColumn(m, 1).length(), sz = 1 / _v.setFromMatrixColumn(m, 2).length()
    t[0] = me[0] * sx; t[1] = me[1] * sx; t[2] = me[2] * sx; t[3] = 0
    t[4] = me[4] * sy; t[5] = me[5] * sy; t[6] = me[6] * sy; t[7] = 0
    t[8] = me[8] * sz; t[9] = me[9] * sz; t[10] = me[10] * sz; t[11] = 0
    t[12] = 0; t[13] = 0; t[14] = 0; t[15] = 1
    return this
  }
  compose(p: Vector3, q: Quaternion, s: Vector3): this {
    const t = this.elements, x = q.x, y = q.y, z = q.z, w = q.w, x2 = x + x, y2 = y + y, z2 = z + z
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2
    t[0] = (1 - (yy + zz)) * s.x; t[1] = (xy + wz) * s.x; t[2] = (xz - wy) * s.x; t[3] = 0
    t[4] = (xy - wz) * s.y; t[5] = (1 - (xx + zz)) * s.y; t[6] = (yz + wx) * s.y; t[7] = 0
    t[8] = (xz + wy) * s.z; t[9] = (yz - wx) * s.z; t[10] = (1 - (xx + yy)) * s.z; t[11] = 0
    t[12] = p.x; t[13] = p.y; t[14] = p.z; t[15] = 1
    return this
  }
  decompose(p: Vector3, q: Quaternion, s: Vector3): this {
    const t = this.elements
    let sx = _v.set(t[0], t[1], t[2]).length()
    const sy = _v.set(t[4], t[5], t[6]).length(), sz = _v.set(t[8], t[9], t[10]).length()
    if (this.determinant() < 0) sx = -sx
    p.set(t[12], t[13], t[14])
    _m.copy(this)
    const e = _m.elements, ix = 1 / sx, iy = 1 / sy, iz = 1 / sz
    e[0] *= ix; e[1] *= ix; e[2] *= ix; e[4] *= iy; e[5] *= iy; e[6] *= iy; e[8] *= iz; e[9] *= iz; e[10] *= iz
    q.setFromRotationMatrix(_m)
    s.set(sx, sy, sz)
    return this
  }
  getMaxScaleOnAxis(): number {
    const t = this.elements
    return Math.sqrt(Math.max(t[0] * t[0] + t[1] * t[1] + t[2] * t[2], t[4] * t[4] + t[5] * t[5] + t[6] * t[6], t[8] * t[8] + t[9] * t[9] + t[10] * t[10]))
  }
  /** A rotation looking from eye toward target, up `up` (three's Matrix4.lookAt: the object's −z… its +z points back). */
  lookAt(eye: Vector3, target: Vector3, up: Vector3): this {
    const t = this.elements
    _z.subVectors(eye, target)
    if (_z.lengthSq() === 0) _z.z = 1
    _z.normalize()
    _x.crossVectors(up, _z)
    if (_x.lengthSq() === 0) { if (Math.abs(up.z) === 1) _z.x += 0.0001; else _z.z += 0.0001; _z.normalize(); _x.crossVectors(up, _z) }
    _x.normalize()
    _y.crossVectors(_z, _x)
    t[0] = _x.x; t[4] = _y.x; t[8] = _z.x; t[1] = _x.y; t[5] = _y.y; t[9] = _z.y; t[2] = _x.z; t[6] = _y.z; t[10] = _z.z
    return this
  }
  /** OpenGL clip space (z −1 … 1): what PlayCanvas's WebGL camera uses — our culling agrees with its projection. */
  makePerspective(left: number, right: number, top: number, bottom: number, near: number, far: number): this {
    const x = (2 * near) / (right - left), y = (2 * near) / (top - bottom), a = (right + left) / (right - left), b = (top + bottom) / (top - bottom)
    const c = -(far + near) / (far - near), d = (-2 * far * near) / (far - near)
    return this.set(x, 0, a, 0, 0, y, b, 0, 0, 0, c, d, 0, 0, -1, 0)
  }
  makeOrthographic(left: number, right: number, top: number, bottom: number, near: number, far: number): this {
    const w = 1 / (right - left), h = 1 / (top - bottom), p = 1 / (far - near)
    return this.set(2 * w, 0, 0, -(right + left) * w, 0, 2 * h, 0, -(top + bottom) * h, 0, 0, -2 * p, -(far + near) * p, 0, 0, 0, 1)
  }
}

export class Color {
  readonly isColor = true
  constructor(public r = 1, public g = 1, public b = 1) {}
  /** (linear RGB, as every colour in the game is written; a number is a hex sRGB colour, converted like three's) */
  set(r: number | string | Color, g?: number, b?: number): this {
    if (typeof r === 'object') return this.copy(r)
    if (typeof r === 'string') return this.setStyle(r)
    if (g === undefined) {
      const h = Math.floor(r)
      return this.setRGB(srgbToLinear(((h >> 16) & 255) / 255), srgbToLinear(((h >> 8) & 255) / 255), srgbToLinear((h & 255) / 255))
    }
    return this.setRGB(r, g, b!)
  }
  /** A CSS colour ('#rrggbb'), sRGB → linear. */
  setStyle(s: string): this { return this.set(parseInt(s.replace('#', ''), 16)) }
  /** (linear; with colorSpace 'srgb' the values are sRGB and converted, as three does) */
  setRGB(r: number, g: number, b: number, colorSpace?: string): this {
    if (colorSpace === 'srgb') { r = srgbToLinear(r); g = srgbToLinear(g); b = srgbToLinear(b) }
    this.r = r; this.g = g; this.b = b
    return this
  }
  setScalar(s: number): this { this.r = this.g = this.b = s; return this }
  copy(c: Color): this { this.r = c.r; this.g = c.g; this.b = c.b; return this }
  clone(): Color { return new Color(this.r, this.g, this.b) }
  add(c: Color): this { this.r += c.r; this.g += c.g; this.b += c.b; return this }
  multiply(c: Color): this { this.r *= c.r; this.g *= c.g; this.b *= c.b; return this }
  multiplyScalar(s: number): this { this.r *= s; this.g *= s; this.b *= s; return this }
  lerp(c: Color, t: number): this { this.r += (c.r - this.r) * t; this.g += (c.g - this.g) * t; this.b += (c.b - this.b) * t; return this }
  lerpColors(a: Color, b: Color, t: number): this { this.r = a.r + (b.r - a.r) * t; this.g = a.g + (b.g - a.g) * t; this.b = a.b + (b.b - a.b) * t; return this }
  toArray(a: number[] | Float32Array = [], o = 0): number[] | Float32Array { a[o] = this.r; a[o + 1] = this.g; a[o + 2] = this.b; return a }
  getHex(): number { const e = (v: number) => Math.max(0, Math.min(255, Math.round(linearToSrgb(v) * 255))); return (e(this.r) << 16) | (e(this.g) << 8) | e(this.b) }
}
export const srgbToLinear = (c: number) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4))
export const linearToSrgb = (c: number) => (c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055)

export class Box3 {
  readonly isBox3 = true
  constructor(public min = new Vector3(Infinity, Infinity, Infinity), public max = new Vector3(-Infinity, -Infinity, -Infinity)) {}
  set(min: Vector3, max: Vector3): this { this.min.copy(min); this.max.copy(max); return this }
  copy(b: Box3): this { this.min.copy(b.min); this.max.copy(b.max); return this }
  clone(): Box3 { return new Box3().copy(this) }
  makeEmpty(): this { this.min.setScalar(Infinity); this.max.setScalar(-Infinity); return this }
  isEmpty(): boolean { return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z }
  expandByPoint(p: Vector3): this { this.min.min(p); this.max.max(p); return this }
  expandByScalar(s: number): this { this.min.addScalar(-s); this.max.addScalar(s); return this }
  setFromPoints(ps: Vector3[]): this { this.makeEmpty(); for (const p of ps) this.expandByPoint(p); return this }
  setFromBufferAttribute(a: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number }): this {
    this.makeEmpty()
    for (let i = 0; i < a.count; i++) this.expandByPoint(_v.set(a.getX(i), a.getY(i), a.getZ(i)))
    return this
  }
  union(b: Box3): this { this.min.min(b.min); this.max.max(b.max); return this }
  getSize(t: Vector3): Vector3 { return this.isEmpty() ? t.set(0, 0, 0) : t.subVectors(this.max, this.min) }
  getCenter(t: Vector3): Vector3 { return this.isEmpty() ? t.set(0, 0, 0) : t.addVectors(this.min, this.max).multiplyScalar(0.5) }
  distanceToPoint(p: Vector3): number { return _v.copy(p).max(this.min).min(this.max).distanceTo(p) }
  containsPoint(p: Vector3): boolean { return !(p.x < this.min.x || p.x > this.max.x || p.y < this.min.y || p.y > this.max.y || p.z < this.min.z || p.z > this.max.z) }
  intersectsBox(b: Box3): boolean { return !(b.max.x < this.min.x || b.min.x > this.max.x || b.max.y < this.min.y || b.min.y > this.max.y || b.max.z < this.min.z || b.min.z > this.max.z) }
  applyMatrix4(m: Matrix4): this {
    if (this.isEmpty()) return this
    const P = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new Vector3(i & 1 ? this.max.x : this.min.x, i & 2 ? this.max.y : this.min.y, i & 4 ? this.max.z : this.min.z).applyMatrix4(m))
    return this.setFromPoints(P)
  }
}

export class Sphere {
  constructor(public center = new Vector3(), public radius = -1) {}
  set(c: Vector3, r: number): this { this.center.copy(c); this.radius = r; return this }
  copy(s: Sphere): this { this.center.copy(s.center); this.radius = s.radius; return this }
  clone(): Sphere { return new Sphere().copy(this) }
  applyMatrix4(m: Matrix4): this { this.center.applyMatrix4(m); this.radius *= m.getMaxScaleOnAxis(); return this }
  isEmpty(): boolean { return this.radius < 0 }
}

export class Plane {
  constructor(public normal = new Vector3(1, 0, 0), public constant = 0) {}
  setComponents(x: number, y: number, z: number, w: number): this { this.normal.set(x, y, z); this.constant = w; return this }
  normalize(): this { const l = 1 / this.normal.length(); this.normal.multiplyScalar(l); this.constant *= l; return this }
  distanceToPoint(p: Vector3): number { return this.normal.dot(p) + this.constant }
}

/** (three's coordinate-system constant — accepted, the clip space is always OpenGL's here) */
export const WebGLCoordinateSystem = 2000

export class Frustum {
  readonly planes = [new Plane(), new Plane(), new Plane(), new Plane(), new Plane(), new Plane()]
  setFromProjectionMatrix(m: Matrix4, _cs?: number, _reversed?: boolean): this {
    const e = m.elements, p = this.planes
    const me0 = e[0], me1 = e[1], me2 = e[2], me3 = e[3], me4 = e[4], me5 = e[5], me6 = e[6], me7 = e[7]
    const me8 = e[8], me9 = e[9], me10 = e[10], me11 = e[11], me12 = e[12], me13 = e[13], me14 = e[14], me15 = e[15]
    p[0].setComponents(me3 - me0, me7 - me4, me11 - me8, me15 - me12).normalize()
    p[1].setComponents(me3 + me0, me7 + me4, me11 + me8, me15 + me12).normalize()
    p[2].setComponents(me3 + me1, me7 + me5, me11 + me9, me15 + me13).normalize()
    p[3].setComponents(me3 - me1, me7 - me5, me11 - me9, me15 - me13).normalize()
    p[4].setComponents(me3 - me2, me7 - me6, me11 - me10, me15 - me14).normalize()
    p[5].setComponents(me3 + me2, me7 + me6, me11 + me10, me15 + me14).normalize()
    return this
  }
  intersectsBox(b: Box3): boolean {
    for (const pl of this.planes) {
      const n = pl.normal
      _v.x = n.x > 0 ? b.max.x : b.min.x; _v.y = n.y > 0 ? b.max.y : b.min.y; _v.z = n.z > 0 ? b.max.z : b.min.z
      if (pl.distanceToPoint(_v) < 0) return false
    }
    return true
  }
  intersectsSphere(s: Sphere): boolean {
    for (const pl of this.planes) if (pl.distanceToPoint(s.center) < -s.radius) return false
    return true
  }
  containsPoint(p: Vector3): boolean {
    for (const pl of this.planes) if (pl.distanceToPoint(p) < 0) return false
    return true
  }
}

export const MathUtils = {
  clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)),
  lerp: (a: number, b: number, t: number) => (1 - t) * a + t * b,
  smoothstep: (x: number, a: number, b: number) => { if (x <= a) return 0; if (x >= b) return 1; const t = (x - a) / (b - a); return t * t * (3 - 2 * t) },
  degToRad: (d: number) => (d * Math.PI) / 180,
  radToDeg: (r: number) => (r * 180) / Math.PI,
  euclideanModulo: (n: number, m: number) => ((n % m) + m) % m,
  inverseLerp: (a: number, b: number, v: number) => (a !== b ? (v - a) / (b - a) : 0),
  mapLinear: (x: number, a1: number, a2: number, b1: number, b2: number) => b1 + ((x - a1) * (b2 - b1)) / (a2 - a1),
  damp: (x: number, y: number, l: number, dt: number) => x + (y - x) * (1 - Math.exp(-l * dt)),
}

/** three's Clock: seconds since the last getDelta, and in all. */
export class Clock {
  elapsedTime = 0
  private last = performance.now()
  getDelta(): number { const n = performance.now(), d = (n - this.last) / 1000; this.last = n; this.elapsedTime += d; return d }
}

/** The camera contract the math needs (Vector3.project / unproject). */
interface Camera { matrixWorld: Matrix4; matrixWorldInverse: Matrix4; projectionMatrix: Matrix4; projectionMatrixInverse: Matrix4 }

const _v = new Vector3(), _x = new Vector3(), _y = new Vector3(), _z = new Vector3()
const _q = new Quaternion(), _m = new Matrix4()
const _zero = new Vector3(), _one = new Vector3(1, 1, 1)
