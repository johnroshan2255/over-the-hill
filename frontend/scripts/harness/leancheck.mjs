// leancheck.mjs [outDir] — THE LEAN BUFFERS (scene.ts, 2026-11-18) under the two things that write a mesh's buffers again:
// a drive (the meshes that change: their copies made again, kept) and a LOST DEVICE (PlayCanvas restores every buffer
// from its copy — the lean ones refilled first). Each variant (QS: '' lean, 'lean=0' the control): track 0 driven for
// 20 s, a shot; the device lost and restored, the same view again, a shot; page errors. Compare the four pictures.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const out = process.argv[2] || '/tmp/leancheck'
fs.mkdirSync(out, { recursive: true })
for (const qs of ['lean=0', '']) {
  const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', protocolTimeout: 600000,
    args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1280,720', '--mute-audio'], defaultViewport: { width: 1280, height: 720 } })
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { try { await b.close() } catch {} process.exit(130) })
  const p = await b.newPage(), errs = []
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 160)))
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text().slice(0, 160)) })
  await p.goto(`http://localhost:5200/?tier=ultra&hour=12&dpr=fixed&time=0&weather=clear&sound=0&save=0&freeze=1&${qs}`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
  await p.evaluate(() => window.__oth.drive(true))
  await p.evaluate(async () => {
    const o = window.__oth, L = o.world.map.meta.trails.lines[0], pts = []
    for (let i = 1; i < L.length; i++) { const [ax, az] = L[i - 1], [bx, bz] = L[i], d = Math.hypot(bx - ax, bz - az); for (let s = 0; s < d; s += 1) pts.push([ax + (bx - ax) * (s / d), az + (bz - az) * (s / d)]) }
    const t0 = performance.now()
    await new Promise((r) => { const f = () => { const d = Math.min(pts.length - 9, Math.floor((performance.now() - t0) / 1000 * 28)), a = pts[d], q = pts[d + 8]; o.car.placeAt(a[0], a[1], Math.atan2(-(q[0] - a[0]), -(q[1] - a[1]))); if (performance.now() - t0 < 20000) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) })
  })
  await new Promise((r) => setTimeout(r, 2500))
  const tag = qs || 'lean'
  await p.screenshot({ path: `${out}/${tag}_drive.png` })
  const lost = await p.evaluate(() => window.__oth.renderer.loseDevice())
  await new Promise((r) => setTimeout(r, 4000))
  await p.screenshot({ path: `${out}/${tag}_restored.png` })
  console.log(`${tag}: device lost + restored: ${lost}; errors: ${errs.length ? errs.join(' | ') : 'none'}`)
  await b.close()
}
