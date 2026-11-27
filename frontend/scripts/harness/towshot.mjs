// towshot.mjs [outDir] [tier] [ids…] — EVERY CAR'S WINCH AND TOW POINTS ON ITS OWN BUMPERS (2026-11-27, the user: "the
// hook we pull vehicles with is not connected to the cars — it's in the air; check all cars, it must be perfectly
// attached" — loadModels `towOf`, Winch.ts): each car loaded (?car=<id>), its fairlead and its three recovery points
// printed with HOW FAR EACH IS FROM THE CAR'S OWN METAL (the nearest point of its body's triangles: 0 — it is on a
// face), where the game DRAWS them (the three tow eyes' instances, the hook hanging on the winch: at those points to the
// tenth of a millimetre), and the nose and the tail shot, low and close.
// CHECKED per car: the four places found on the model; each on its metal (under 2 mm); the eyes drawn there; the hook's
// eye at the fairlead. Needs `npm run dev`.
//   node scripts/harness/towshot.mjs screenshots/tow ultra            env: PORT=5200, Q (extra URL switches), SHOTS=0 (the numbers only)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [out = 'screenshots/tow', tier = 'ultra', ...only] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const kit = Object.keys(JSON.parse(fs.readFileSync(new URL('../../src/gameplay/vehicle/cars.json', import.meta.url), 'utf8')))
const ids = only.length ? only : ['offroader', ...kit, 'g500', 'e30']
const SHOTS = process.env.SHOTS !== '0'
let bad = 0
for (const id of ids) {
  const p = await b.newPage(); const errs = []
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text().slice(0, 200)) })
  await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&dpr=fixed&time=0&hour=13&weather=clear&sound=0&save=0&car=${id}${process.env.Q ? '&' + process.env.Q : ''}`, { waitUntil: 'load' })
  try { await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 120000, polling: 200 }) } catch { console.log(id, 'NEVER READY', errs.join(' | ')); bad++; await p.close(); continue }
  await sleep(1800)
  const info = await p.evaluate(() => {
    const o = window.__oth, c = o.car, m = c.model, t = m.tow, W = o.winch, fails = []
    if (!t) return { id: c.id, fails: ['no bumper found on the model: the box is used'] }
    // how far a point is from the car's own triangles (its exact shell: body, glass, doors)
    const T = m.mesh
    const dist = (P) => {
      let best = 1e9
      const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
      for (let i = 0; i + 8 < T.length; i += 9) {
        const A = [T[i], T[i + 1], T[i + 2]], B = [T[i + 3], T[i + 4], T[i + 5]], C = [T[i + 6], T[i + 7], T[i + 8]]
        if (Math.min(A[0], B[0], C[0]) > P[0] + best || Math.max(A[0], B[0], C[0]) < P[0] - best) continue
        // (the closest point of a triangle — Ericson, Real-Time Collision Detection 5.1.5)
        const ab = sub(B, A), ac = sub(C, A), ap = sub(P, A), d1 = dot(ab, ap), d2 = dot(ac, ap)
        let q
        if (d1 <= 0 && d2 <= 0) q = A
        else {
          const bp = sub(P, B), d3 = dot(ab, bp), d4 = dot(ac, bp)
          if (d3 >= 0 && d4 <= d3) q = B
          else {
            const vc = d1 * d4 - d3 * d2
            if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); q = [A[0] + ab[0] * v, A[1] + ab[1] * v, A[2] + ab[2] * v] }
            else {
              const cp = sub(P, C), d5 = dot(ab, cp), d6 = dot(ac, cp)
              if (d6 >= 0 && d5 <= d6) q = C
              else {
                const vb = d5 * d2 - d1 * d6
                if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); q = [A[0] + ac[0] * w, A[1] + ac[1] * w, A[2] + ac[2] * w] }
                else {
                  const va = d3 * d6 - d5 * d4
                  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); q = [B[0] + (C[0] - B[0]) * w, B[1] + (C[1] - B[1]) * w, B[2] + (C[2] - B[2]) * w] }
                  else { const dn = 1 / (va + vb + vc), v = vb * dn, w = vc * dn; q = [A[0] + ab[0] * v + ac[0] * w, A[1] + ab[1] * v + ac[1] * w, A[2] + ab[2] * v + ac[2] * w] }
                }
              }
            }
          }
        }
        const d = Math.hypot(P[0] - q[0], P[1] - q[1], P[2] - q[2])
        if (d < best) best = d
      }
      return best
    }
    const names = ['fairlead', 'front left', 'front right', 'rear'], pts = [t.fairlead, ...t.points]
    const off = pts.map((P) => dist(P))
    off.forEach((d, k) => { if (d > 0.002) fails.push(`${names[k]}: ${(d * 1000).toFixed(1)} mm off the metal`) })
    // where the game draws them: the eyes' instances, the hook on the winch (its eye — the hook's own (-0.034, 0.155, 0))
    const V = (v) => o.camera.position.clone().set(v[0], v[1], v[2]).applyMatrix4(c.root.matrixWorld)
    let eyeOff = null, hookOff = null
    if (W.eyes && W.eyes.count >= 3) {
      const a = W.eyes.instanceMatrix.array
      eyeOff = Math.max(...[0, 1, 2].map((k) => V(t.points[k]).distanceTo(o.camera.position.clone().set(a[k * 16 + 12], a[k * 16 + 13], a[k * 16 + 14]))))
      if (eyeOff > 1e-3) fails.push(`a tow eye drawn ${(eyeOff * 1000).toFixed(1)} mm off its point`)
    } else fails.push('the tow eyes are not drawn')
    const hk = W.hooks.find((h) => h.visible)
    if (hk) {
      const e = o.camera.position.clone().set(-0.034, 0.155, 0).applyMatrix4(hk.matrixWorld), lead = V([t.fairlead[0], t.fairlead[1], t.fairlead[2] - 0.022])
      hookOff = e.distanceTo(lead)
      if (hookOff > 2e-3) fails.push(`the hook's eye ${(hookOff * 1000).toFixed(1)} mm off the fairlead`)
    } else fails.push('the hook is not drawn on the winch')
    const r = (v) => +v.toFixed(3)
    return { id: c.id, fairlead: t.fairlead.map(r), points: t.points.map((q) => q.map(r)), box: { front: r(m.front), rear: r(m.rear), wheelR: r(m.wheelRadius) },
      offMetalMm: off.map((d) => +(d * 1000).toFixed(2)), eyeOffMm: eyeOff === null ? null : +(eyeOff * 1000).toFixed(3), hookOffMm: hookOff === null ? null : +(hookOff * 1000).toFixed(3), fails }
  })
  if (SHOTS) {
    const m = await p.evaluate(() => { const m = window.__oth.car.model; return { front: m.front, rear: m.rear, hx: m.half.x, fy: m.tow ? m.tow.fairlead[1] : m.wheelRadius + 0.3, ry: m.tow ? m.tow.points[2][1] : m.wheelRadius + 0.1, fz: m.tow ? m.tow.fairlead[2] : m.front, rz: m.tow ? m.tow.points[2][2] : m.rear } })
    const look = (from, at) => p.evaluate(([from, at]) => {
      const o = window.__oth, c = o.car, q = c.root.quaternion, P = c.root.position
      const V = (v) => o.camera.position.clone().set(v[0], v[1], v[2]).applyQuaternion(q).add(P)
      const a = V(from), t = V(at)
      o.view(a.x, a.z, a.y - o.world.map.height(a.x, a.z), Math.atan2(-(t.x - a.x), -(t.z - a.z)), Math.atan2(t.y - a.y, Math.hypot(t.x - a.x, t.z - a.z)))
    }, [from, at])
    await look([-1.5, m.fy + 0.45, m.fz - 1.55], [0, m.fy - 0.05, m.fz]); await sleep(500); await p.screenshot({ path: `${out}/${id}_nose.png` })
    await look([-2.3, m.fy + 0.1, m.fz + 0.25], [0, m.fy, m.fz]); await sleep(500); await p.screenshot({ path: `${out}/${id}_noseSide.png` })
    await look([1.4, m.ry + 0.5, m.rz + 1.5], [0, m.ry, m.rz]); await sleep(500); await p.screenshot({ path: `${out}/${id}_tail.png` })
    await look([2.2, m.ry + 0.1, m.rz - 0.2], [0, m.ry, m.rz]); await sleep(500); await p.screenshot({ path: `${out}/${id}_tailSide.png` })
  }
  const fails = info.fails ?? []
  if (errs.length || info.id !== id || fails.length) bad++
  console.log(JSON.stringify(info), errs.length ? 'ERRORS: ' + [...new Set(errs)].join(' | ') : fails.length ? 'FAILS: ' + fails.join('; ') : 'ok')
  await p.close()
}
console.log(bad ? `${bad} with problems` : 'all ok')
await b.close()
