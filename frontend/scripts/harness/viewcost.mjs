// viewcost.mjs [tier] — WHAT EACH VIEW COSTS (2026-11-24, the user: "if we are in first person … we don't need to render
// the car's outer body or shaders right — check all"): the car on the chase camera and in first person, on foot in third
// person and in first person — the draws, the triangles, the page's JavaScript a frame and the GPU's frame (pace.mjs:
// uncapped 1080p, drained) — and in the car's first person, each part of the car hidden in turn: what it costs there.
//   node scripts/harness/viewcost.mjs ultra        env: PORT (5200), PARTS=0 (skip the parts)
import puppeteer from 'puppeteer-core'
import { PACE } from './pace.mjs'

const tier = process.argv[2] || 'ultra'
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=1920,1080', '--mute-audio'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 } })
const p = await b.newPage()
p.on('pageerror', (e) => console.log('[pageerror]', e.message))
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&hour=12&dpr=fixed&time=0&weather=clear&sound=0&save=0&companion=off`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await p.evaluate(() => window.__oth.drive(true))
await sleep(3000)
const ft = async () => { const a = []; for (let i = 0; i < 3; i++) a.push(await p.evaluate(PACE)); a.sort((x, y) => x - y); return a[1] }
const st = () => p.evaluate(() => { const s = window.__oth.stats(); return { draws: s.draws, tris: s.tris, cpu: +s.cpuMs.toFixed(2) } })
const measure = async (name) => {
  await sleep(1500)
  const s = await st(), g = await ft()
  console.log(`${name.padEnd(16)} GPU ${g.toFixed(3)} ms · ${s.draws} draws · ${(s.tris / 1000).toFixed(0)} k tris · JS ${s.cpu} ms`)
  return { name, gpu: g, ...s }
}
const rows = []
// THE CAR: the chase camera, then first person
await p.evaluate(() => { const o = window.__oth; if (o.fpp) o.thirdPerson() })
rows.push(await measure('car · chase'))
await p.keyboard.press('KeyV')
rows.push(await measure('car · first'))
// … each part of the car hidden in turn, in first person
if (process.env.PARTS !== '0') {
  const parts = await p.evaluate(() => {
    const c = window.__oth.car, out = []
    c.root.traverse((o) => { if (o !== c.root && (o.isMesh || o.isGroup) && o.parent === c.root) out.push(o.name || o.type) })
    return out
  })
  console.log('the car\'s parts:', parts.join(', '))
  const toggle = (i, v) => p.evaluate((i, v) => { const c = window.__oth.car, kids = c.root.children.filter((o) => o.isMesh || o.isGroup); const k = kids[i]; if (k) { k.userData.__keep ??= k.visible; k.visible = v ? k.userData.__keep : false } }, i, v)
  for (let i = 0; i < parts.length; i++) {
    let on = 0, off = 0
    for (let r = 0; r < 2; r++) { await toggle(i, true); await sleep(300); on += await p.evaluate(PACE); await toggle(i, false); await sleep(300); off += await p.evaluate(PACE) }
    await toggle(i, true)
    console.log(`   ${parts[i].padEnd(24)} ${((on - off) / 2).toFixed(3)} ms`)
  }
  const shadowCost = async () => { let on = 0, off = 0; for (let r = 0; r < 2; r++) { await p.evaluate(() => (window.__oth.car.shadowMesh.visible = true)); on += await p.evaluate(PACE); await p.evaluate(() => (window.__oth.car.shadowMesh.visible = false)); off += await p.evaluate(PACE) } return (on - off) / 2 }
  console.log(`   ${'contact shadow'.padEnd(24)} ${(await shadowCost()).toFixed(3)} ms`)
}
await p.keyboard.press('KeyV')
// ON FOOT: third, first
await p.evaluate(() => window.__oth.foot())
for (let i = 0; i < 40; i++) { await sleep(250); if (await p.evaluate(() => window.__oth.onFoot && window.__oth.hero.state === 'move')) break }
rows.push(await measure('foot · third'))
await p.keyboard.press('KeyV')
rows.push(await measure('foot · first'))
console.log(JSON.stringify(rows))
await b.close()
