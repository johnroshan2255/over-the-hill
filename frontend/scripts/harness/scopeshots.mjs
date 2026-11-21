// scopeshots.mjs [outDir] — THE SCOPE'S PICTURE (docs/weapons/SNIPER.md, oth/LodEye.ts): from a few stands, the sniper
// rifle's two steps on a far piece of land — as a bare lens (`?lodeye=0`) beside the detail's eye (the world drawn for
// what the glass is on); what each draws, and what a slow sweep of the glass costs a frame.
//   node scripts/harness/scopeshots.mjs screenshots/scope     env: PORT (5200), TIER (high), VIEWS ("yaw,pitch;…" rad
//   from the way he faces after the walk out), Q (URL params)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
const out = process.argv[2] || 'screenshots/scope'
fs.mkdirSync(out, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const W = 1280, H = 720
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const VIEWS = (process.env.VIEWS || '0,-0.03;0.35,-0.02;-0.5,-0.06').split(';').map((v) => v.split(',').map(Number))
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio', `--window-size=${W},${H}`], defaultViewport: { width: W, height: H } })
const files = []
// (the same stand for both: where the first walked out to — or AT=x,z,heading)
let stand = process.env.AT ? process.env.AT.split(',').map(Number) : null
for (const mode of ['lodeye=0', '']) {
  const p = await b.newPage()
  p.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)))
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) console.log('[console]', m.text().slice(0, 300)) })
  await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${process.env.TIER || 'high'}&hour=12&dpr=fixed&time=0&weather=clear&sound=0&save=0&ride=foot&weapons=all${mode ? `&${mode}` : ''}${process.env.Q ? `&${process.env.Q}` : ''}`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
  await p.evaluate(() => window.__oth.drive(true))
  for (let i = 0; i < 80; i++) { await sleep(500); if (await p.evaluate(() => window.__oth.onFoot && window.__oth.hero.state === 'move')) break }
  await p.evaluate(() => { const o = window.__oth; o.arsenal.host.kick = () => {}; o.footCam() })
  if (!stand) { await p.keyboard.down('KeyW'); await sleep(2600); await p.keyboard.up('KeyW'); await sleep(600); stand = await p.evaluate(() => { const h = window.__oth.hero; return [h.pos.x, h.pos.z, h.heading] }) }
  else { await p.evaluate((s) => { window.__oth.hero.appear(s[0], s[1], s[2]) }, stand); await sleep(800) }
  console.log(`the stand: ${stand.map((v) => v.toFixed(2)).join(',')}`)
  const h0 = await p.evaluate(() => { const o = window.__oth; o.arsenal.equip('sniper'); return o.hero.heading })
  await sleep(1400)
  for (const [vi, [yaw, pitch]] of VIEWS.entries()) for (const step of [1, 2]) {
    await p.evaluate((y, pt, st) => { const o = window.__oth; o.arsenal.scope = st; o.aim(y, pt) }, h0 + yaw, pitch, step)
    await sleep(2200)
    const st = await p.evaluate(() => { const o = window.__oth, t = o.stats(), E = o.lodEye; return { draws: t.draws, tris: t.tris, trees: t.trees, blades: t.blades, eye: E.on ? Math.round(Math.hypot(E.bx - E.ax, E.bz - E.az)) : 0, line: E.on ? Math.round(Math.hypot(E.lx - E.ax, E.lz - E.az)) : 0 } })
    const f = `${out}/_v${vi}_x${step}_${mode ? 'lens' : 'eye'}.png`
    await p.screenshot({ path: f }); files.push(f)
    console.log(`view ${vi} ×${step} ${mode ? 'bare lens    ' : "detail's eye "} draws ${st.draws} tris ${(st.tris / 1000).toFixed(0)}k trees ${JSON.stringify(st.trees)} blades ${(st.blades / 1000).toFixed(0)}k  eye ${st.eye} m out, the line ${st.line} m`)
  }
  // a slow sweep of the glass at its second step: the frame while it turns (the camera's own vsync: 60 a second)
  const r = await p.evaluate((y0) => new Promise((res) => {
    const o = window.__oth, d = []; let l = performance.now(); const t0 = l
    o.arsenal.scope = 2
    const f = () => { const n = performance.now(); d.push(n - l); l = n; o.aim(y0 + Math.sin((n - t0) / 1000 * 0.8) * 0.5, -0.03); if (n - t0 < 6000) requestAnimationFrame(f); else { d.sort((a, c) => a - c); res({ n: d.length, mean: +(d.reduce((a, c) => a + c, 0) / d.length).toFixed(2), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), p99: +d[Math.floor(d.length * 0.99)].toFixed(1), max: +d[d.length - 1].toFixed(1) }) } }
    requestAnimationFrame(f)
  }), h0)
  console.log(`sweep ×2 ${mode ? 'bare lens    ' : "detail's eye "} ${JSON.stringify(r)}`)
  await p.close()
}
// one sheet: a row a view and step — the bare lens, the detail's eye
const n = files.length / 2
execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw
files = sys.argv[2:]; n = len(files) // 2; W, H = ${W} // 2, ${H} // 2
sheet = Image.new('RGB', (2 * W, n * H))
for i in range(n):
    for c in range(2):
        f = files[i + c * n]
        im = Image.open(f).convert('RGB').resize((W, H), Image.LANCZOS)
        ImageDraw.Draw(im).text((6, 4), f.split('/')[-1][1:-4], fill=(255, 220, 120))
        sheet.paste(im, (c * W, i * H))
sheet.save(sys.argv[1])
`, `${out}/scope.png`, ...files])
if (!process.env.KEEP) for (const f of files) fs.unlinkSync(f)
console.log('sheet', `${out}/scope.png`, `(${n} rows: the bare lens | the detail's eye)`)
await b.close()
