// (temporary, docs/MIGRATION.md step 1) our gfx math / geometry against three.js's — random cases, every result compared
import * as T from 'three'
import * as G from '../src/oth/gfx/math'
import * as GG from '../src/oth/gfx/geometry'

let fails = 0, checks = 0
const near = (a: ArrayLike<number>, b: ArrayLike<number>, what: string, eps = 1e-4) => {
  checks++
  if (a.length !== b.length) { fails++; console.log('FAIL', what, 'length', a.length, b.length); return }
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > eps * Math.max(1, Math.abs(b[i]))) { fails++; console.log('FAIL', what, i, a[i], b[i]); return }
}
let seed = 7
const r = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed / 4294967296) * 2 - 1 }
for (let k = 0; k < 200; k++) {
  const p = [r() * 50, r() * 50, r() * 50], e = [r() * 3, r() * 3, r() * 3], s = [0.5 + Math.abs(r()), 0.5 + Math.abs(r()), 0.5 + Math.abs(r())]
  for (const order of ['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY'] as const) {
    const tq = new T.Quaternion().setFromEuler(new T.Euler(e[0], e[1], e[2], order)), gq = new G.Quaternion().setFromEuler(new G.Euler(e[0], e[1], e[2], order))
    near([gq.x, gq.y, gq.z, gq.w], [tq.x, tq.y, tq.z, tq.w], `setFromEuler ${order}`)
  }
  const tq = new T.Quaternion().setFromEuler(new T.Euler(e[0], e[1], e[2])), gq = new G.Quaternion().setFromEuler(new G.Euler(e[0], e[1], e[2]))
  const tm = new T.Matrix4().compose(new T.Vector3(...p), tq, new T.Vector3(...s)), gm = new G.Matrix4().compose(new G.Vector3(...p), gq, new G.Vector3(...s))
  near(gm.elements, tm.elements, 'compose')
  near(gm.clone().invert().elements, tm.clone().invert().elements, 'invert')
  const tm2 = new T.Matrix4().makeRotationY(r() * 3).setPosition(r(), r(), r()), gm2 = new G.Matrix4().makeRotationY(tm2.elements[8] === 0 ? 0 : Math.atan2(tm2.elements[8], tm2.elements[0])).setPosition(tm2.elements[12], tm2.elements[13], tm2.elements[14])
  near(new G.Matrix4().multiplyMatrices(gm, gm2).elements, new T.Matrix4().multiplyMatrices(tm, tm2).elements, 'multiply')
  const tp = new T.Vector3(), tqq = new T.Quaternion(), ts = new T.Vector3(), gp = new G.Vector3(), gqq = new G.Quaternion(), gs = new G.Vector3()
  tm.decompose(tp, tqq, ts); gm.decompose(gp, gqq, gs)
  near([gp.x, gp.y, gp.z, gs.x, gs.y, gs.z], [tp.x, tp.y, tp.z, ts.x, ts.y, ts.z], 'decompose p/s')
  near([Math.abs(gqq.dot(new G.Quaternion(tqq.x, tqq.y, tqq.z, tqq.w)))], [1], 'decompose q')
  const v = [r() * 9, r() * 9, r() * 9]
  const tv = new T.Vector3(...v).applyMatrix4(tm), gv = new G.Vector3(...v).applyMatrix4(gm)
  near([gv.x, gv.y, gv.z], [tv.x, tv.y, tv.z], 'applyMatrix4')
  const tv2 = new T.Vector3(...v).applyQuaternion(tq), gv2 = new G.Vector3(...v).applyQuaternion(gq)
  near([gv2.x, gv2.y, gv2.z], [tv2.x, tv2.y, tv2.z], 'applyQuaternion')
  const te = new T.Euler().setFromQuaternion(tq, 'YXZ'), ge = new G.Euler().setFromQuaternion(gq, 'YXZ')
  near([ge.x, ge.y, ge.z], [te.x, te.y, te.z], 'euler from quaternion YXZ')
  const tq2 = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), r() * 3), gq2 = new G.Quaternion(tq2.x, tq2.y, tq2.z, tq2.w)
  const ts1 = tq.clone().slerp(tq2, 0.3), gs1 = gq.clone().slerp(gq2, 0.3)
  near([gs1.x, gs1.y, gs1.z, gs1.w], [ts1.x, ts1.y, ts1.z, ts1.w], 'slerp')
  const a = new T.Vector3(r(), r(), r()).normalize(), b = new T.Vector3(r(), r(), r()).normalize()
  const tu = new T.Quaternion().setFromUnitVectors(a, b), gu = new G.Quaternion().setFromUnitVectors(new G.Vector3(a.x, a.y, a.z), new G.Vector3(b.x, b.y, b.z))
  near([gu.x, gu.y, gu.z, gu.w], [tu.x, tu.y, tu.z, tu.w], 'setFromUnitVectors')
  const eye = new T.Vector3(...p), tgt = new T.Vector3(...v)
  near(new G.Matrix4().lookAt(new G.Vector3(...p), new G.Vector3(...v), new G.Vector3(0, 1, 0)).elements, new T.Matrix4().lookAt(eye, tgt, new T.Vector3(0, 1, 0)).elements, 'lookAt')
  near(new G.Matrix3().getNormalMatrix(gm).elements, new T.Matrix3().getNormalMatrix(tm).elements, 'normal matrix')
}
// the cameras' projection + the frustum
const tc = new T.PerspectiveCamera(55, 16 / 9, 0.3, 9000), gpm = new G.Matrix4()
{ const top = 0.3 * Math.tan((Math.PI / 180) * 27.5), h = 2 * top, w = (16 / 9) * h; gpm.makePerspective(-0.5 * w, 0.5 * w, top, top - h, 0.3, 9000) }
near(gpm.elements, tc.projectionMatrix.elements, 'perspective')
const to = new T.OrthographicCamera(-2, 2, 3, -3, 0.01, 10)
near(new G.Matrix4().makeOrthographic(-2, 2, 3, -3, 0.01, 10).elements, to.projectionMatrix.elements, 'orthographic')
tc.position.set(10, 20, 30); tc.lookAt(100, 0, -50); tc.updateMatrixWorld()
const tf = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(tc.projectionMatrix, tc.matrixWorldInverse))
const gf = new G.Frustum().setFromProjectionMatrix(new G.Matrix4().fromArray(new T.Matrix4().multiplyMatrices(tc.projectionMatrix, tc.matrixWorldInverse).elements))
let agree = 0
for (let k = 0; k < 2000; k++) {
  const c = [r() * 3000, r() * 300, r() * 3000], h = Math.abs(r()) * 60
  const tb = new T.Box3(new T.Vector3(c[0] - h, c[1] - h, c[2] - h), new T.Vector3(c[0] + h, c[1] + h, c[2] + h))
  const gb = new G.Box3(new G.Vector3(c[0] - h, c[1] - h, c[2] - h), new G.Vector3(c[0] + h, c[1] + h, c[2] + h))
  if (tf.intersectsBox(tb) === gf.intersectsBox(gb)) agree++
}
checks++; if (agree !== 2000) { fails++; console.log('FAIL frustum', agree) }
// geometries
const cmp = (g: GG.BufferGeometry, t: T.BufferGeometry, name: string) => {
  for (const k of ['position', 'normal', 'uv']) near(g.getAttribute(k).array, t.getAttribute(k).array, `${name} ${k}`)
  if (t.index) near(g.index!.array, t.index.array, `${name} index`, 0)
}
cmp(new GG.PlaneGeometry(3, 2, 4, 3), new T.PlaneGeometry(3, 2, 4, 3), 'plane')
cmp(new GG.SphereGeometry(5, 12, 8), new T.SphereGeometry(5, 12, 8), 'sphere')
cmp(new GG.CircleGeometry(2, 9), new T.CircleGeometry(2, 9), 'circle')
for (const d of [1, 2]) { const t = new T.IcosahedronGeometry(1.5, d), g = new GG.IcosahedronGeometry(1.5, d); near(g.getAttribute('position').array, t.getAttribute('position').array, `ico ${d} position`); near(g.getAttribute('normal').array, t.getAttribute('normal').array, `ico ${d} normal`) }
{ const t = new T.SphereGeometry(2, 7, 5), g = new GG.SphereGeometry(2, 7, 5); t.computeVertexNormals(); g.computeVertexNormals(); near(g.getAttribute('normal').array, t.getAttribute('normal').array, 'computeVertexNormals') }
{ const t = new T.PlaneGeometry(2, 2, 2, 2).toNonIndexed(), g = new GG.PlaneGeometry(2, 2, 2, 2).toNonIndexed(); near(g.getAttribute('position').array, t.getAttribute('position').array, 'toNonIndexed') }
{ const t = new T.SphereGeometry(2, 7, 5), g = new GG.SphereGeometry(2, 7, 5); t.computeBoundingSphere(); g.computeBoundingSphere(); near([g.boundingSphere!.radius, ...g.boundingSphere!.center.toArray()], [t.boundingSphere!.radius, ...t.boundingSphere!.center.toArray()], 'boundingSphere', 1e-3) }
console.log(`${checks - fails} / ${checks} checks agree with three.js`)
if (fails) process.exit(1)
