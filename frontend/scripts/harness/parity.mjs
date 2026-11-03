// parity.mjs [outDir] [views] [extra] — THE MIGRATION'S EYE (docs/MIGRATION.md): the same views on this build (:5200)
// and on `main` (three.js, :5201 — `git worktree add ../overhill-main main`, its vite on 5201), screenshots side by side
// (left: main, right: this build) + each page's console errors. Views: a comma list of names from VIEWS below, or 'all'.
//   node scripts/harness/parity.mjs <out> spawn,forest "tier=low"
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const out = process.argv[2] || 'parity'
const want = (process.argv[3] || 'all').split(',')
const extra = process.argv[4] ? `&${process.argv[4]}` : ''
fs.mkdirSync(out, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const VIEWS = {
  // name: [world, drive?, x, z, h, yaw, pitch, hour]
  spawn: ['valley', true, 0, 0, 0, 0, 0, 12],
  forest: ['valley', false, 260, 640, 2.2, 0.6, -0.05, 12],
  lake: ['valley', false, -160, -1320, 3, -1.2, -0.04, 12],
  meadow: ['valley', false, -60, 980, 1.8, 2.6, -0.06, 16.5],
  cliff: ['valley', false, 1102, -1700, 2.2, 0, -0.02, 12],
  aerial: ['valley', false, 0, 1400, 220, 3.1, -0.35, 15],
  dusk: ['valley', false, 260, 640, 2.2, 0.6, -0.05, 19.2],
  night: ['valley', true, 0, 0, 0, 0, 0, 23],
  oasis: ['desert', false, -330, 420, 3, -1.2, -0.02, 12],
  plain: ['desert', false, -300, 1100, 2, 0.3, 0.02, 12],
}
const names = want[0] === 'all' ? Object.keys(VIEWS) : want
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--window-size=960,540', '--mute-audio'], defaultViewport: { width: 960, height: 540, deviceScaleFactor: 1 } })
const shots = {}
for (const [port, tag] of [[5201, 'main'], [5200, 'pc']]) {
  const p = await b.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/favicon|404|deprecated/i.test(m.text())) errs.push(m.text().slice(0, 300)) })
  let loaded = ''
  for (const n of names) {
    const [world, drive, x, z, h, yaw, pitch, hour] = VIEWS[n]
    const url = `http://localhost:${port}/?tier=${process.env.TIER || 'ultra'}&hour=${hour}&dpr=fixed&time=0&weather=clear&world=${world}&sound=0&save=0${extra}`
    if (url !== loaded) {
      await p.goto(url, { waitUntil: 'load' })
      try { await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car?.sim, { timeout: 120000, polling: 250 }) } catch { console.log(tag, n, 'NOT READY', errs.slice(0, 5)); continue }
      loaded = url
    }
    await p.evaluate((a) => { const o = window.__oth; o.setHour(a.hour); if (a.drive) o.drive(true); else o.view(a.x, a.z, a.h, a.yaw, a.pitch) }, { drive, x, z, h, yaw, pitch, hour })
    await new Promise((r) => setTimeout(r, 2500))
    const file = `${out}/${n}_${tag}.png`
    await p.screenshot({ path: file })
    shots[n] = { ...(shots[n] ?? {}), [tag]: file }
  }
  console.log(tag, 'errors:', errs.length ? [...new Set(errs)].slice(0, 12) : 'none')
  await p.close()
}
await b.close()
// side by side (macOS sips can't compose; python with PIL if present, else leave the pairs)
import { execSync } from 'node:child_process'
try {
  execSync(`python3 -c "
import sys
from PIL import Image
for n in sys.argv[1:]:
    a = Image.open('${out}/'+n+'_main.png'); b = Image.open('${out}/'+n+'_pc.png')
    c = Image.new('RGB', (a.width + b.width + 6, max(a.height, b.height)), (255, 255, 255))
    c.paste(a, (0, 0)); c.paste(b, (a.width + 6, 0)); c.save('${out}/'+n+'.png')
" ${Object.keys(shots).filter((n) => shots[n].main && shots[n].pc).join(' ')}`, { stdio: 'inherit' })
} catch { console.log('(no PIL: the pairs are left as _main / _pc)') }
console.log('views:', Object.keys(shots).join(', '))
