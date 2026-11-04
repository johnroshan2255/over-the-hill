// placeshot.mjs <dir> [tier] — the PLACES framed: every landmark of the given kinds (env KINDS, default 'camp'; WORLD,
// default desert; MAX, default 4), the camera DIST m off in front of it (its rot; default 16) and 5 m up, looking at it — to check the camps'
// and the buildings' scale and style. Needs `npm run dev` (PORT, default 5200).
//   PORT=5200 WORLD=desert KINDS=camp,ksar node scripts/harness/placeshot.mjs <dir> ultra
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [dir = 'vg/places', tier = 'ultra'] = process.argv.slice(2)
fs.mkdirSync(dir, { recursive: true })
const KINDS = (process.env.KINDS || 'camp').split(',')
const MAX = Number(process.env.MAX || 4), DIST = Number(process.env.DIST || 16)
const CHROME = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
await p.goto(`http://localhost:${process.env.PORT || 5200}/?world=${process.env.WORLD || 'desert'}&tier=${tier}&hour=${process.env.HOUR || 11}&drive=0&dpr=fixed&time=0&weather=clear&sound=0&save=0`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready, { timeout: 180000, polling: 200 })
await p.addStyleTag({ content: 'body > :not(canvas):not([style*="radial-gradient"]) { display: none !important; }' })
const marks = await p.evaluate((kinds) => window.__oth.world.map.meta.landmarks.filter((l) => kinds.includes(l.kind)).map((l) => ({ kind: l.kind, name: l.name, x: l.x, z: l.z, rot: l.rot ?? 0 })), KINDS)
console.log(`${marks.length} of ${KINDS.join(', ')}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (const [i, m] of marks.slice(0, MAX).entries()) {
  // (from in front of it — its own +z, turned by rot — and a little to the side, above, looking at it)
  const fx = Math.sin(m.rot + 0.5), fz = Math.cos(m.rot + 0.5)
  const cx = m.x + DIST * fx, cz = m.z + DIST * fz
  await p.evaluate((q) => window.__oth.view(...q), [cx, cz, 5, Math.atan2(-(m.x - cx), -(m.z - cz)), -0.22])
  await sleep(1800)
  const f = `${dir}/${m.kind}_${i}.png`
  await p.screenshot({ path: f })
  console.log(f, m.name, Math.round(m.x), Math.round(m.z))
}
console.log('errors:', errs.length ? errs : 'none')
await b.close()
