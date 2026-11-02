// desertcost.mjs [tiers] — what the desert costs per tier, beside the valley: uncapped 1920×1080, still free-camera views,
// the frame time over 1.5 s (its slowest and fastest tenth dropped, ×3), draws, triangles and the formations' cells
// drawn. `node scripts/harness/desertcost.mjs low,ultra` (needs `npm run dev`, :5200).
import puppeteer from 'puppeteer-core'
const tiers = (process.argv[2] || 'low,ultra').split(',')
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ft = () => p.evaluate(() => new Promise((r) => { const d = []; const t = performance.now(); let l = t; const tick = () => { const n = performance.now(); d.push(n - l); l = n; if (n - t < 1500) requestAnimationFrame(tick); else { d.sort((a, b) => a - b); const k = Math.floor(d.length * 0.1), m = d.slice(k, d.length - k); r(m.reduce((a, b) => a + b, 0) / m.length) } }; requestAnimationFrame(tick) }))
const VIEWS = {
  valley: [['spawn', -116, 1066, 1.8, 0, -0.04], ['cliff', 640, -1180, 120, -0.75, -0.08]],
  desert: [['pass', -120, 1700, 2.2, 0, -0.02], ['oasis', -560, 250, 12, -1.0, -0.12], ['canyon', -800, 150, 3, 1.57, 0.08], ['escarp', -100, 1250, 60, 3.1416, -0.05], ['aerial', 400, -300, 250, 2.4, -0.3], ['ksar', 900, 940, 30, -2.356, -0.25]],
}
for (const tier of tiers) for (const world of ['valley', 'desert']) {
  await p.goto(`http://localhost:5200/?tier=${tier}&hour=15&drive=0&dpr=fixed&time=0&world=${world}&weather=clear&sound=0`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth && window.__oth.ready, { timeout: 120000, polling: 200 })
  await sleep(2000)
  for (const [name, x, z, h, yaw, pitch] of VIEWS[world]) {
    await p.evaluate(([x, z, h, yaw, pitch]) => window.__oth.view(x, z, h, yaw, pitch), [x, z, h, yaw, pitch])
    await sleep(2500)
    let t = 0
    for (let i = 0; i < 3; i++) t += await ft()
    const s = await p.evaluate(() => { const o = window.__oth, st = o.stats(); return { draws: st.draws, tris: st.tris, cells: o.world.formations?.drawn ?? 0 } })
    console.log(`${tier.padEnd(6)} ${world.padEnd(7)} ${name.padEnd(8)} ${(t / 3).toFixed(3)} ms (${(3000 / t).toFixed(0)} fps)  ${s.draws} draws  ${(s.tris / 1e3).toFixed(0)}k tris  ${s.cells} formation cells`)
  }
}
console.log('errors:', errs.length ? errs : 'none')
await b.close()
