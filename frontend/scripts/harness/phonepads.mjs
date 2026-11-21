// phonepads.mjs [outDir] — THE PHONE'S WEAPON BUTTONS, SEEN (oth/Weapons.ts `mk`): a phone held sideways and upright,
// on foot with each weapon in the hands — where FIRE / AIM · SCOPE / RELOAD (PUNCH / KICK) lie against the stick, JUMP,
// SPRINT, the door and the buttons along the top; each button's box printed, any that overlap another or leave the
// screen named.
//   node scripts/harness/phonepads.mjs screenshots/phonepads     env: PORT (5200), URL (the whole origin, e.g. https://localhost:5300)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const out = process.argv[2] || 'screenshots/phonepads'
fs.mkdirSync(out, { recursive: true })
const ORIGIN = process.env.URL || `http://localhost:${process.env.PORT || 5200}`
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio', '--ignore-certificate-errors'] })
let ok = true
for (const [name, W, H] of [['wide', 844, 390], ['small', 740, 360], ['tall', 390, 844]]) {
  const p = await b.newPage()
  await p.setViewport({ width: W, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  p.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)))
  await p.goto(`${ORIGIN}/?tier=low&mobile=1&hour=12&dpr=fixed&time=0&weather=clear&sound=0&save=0&ride=foot&weapons=all&companion=enemy`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
  await p.evaluate(() => window.__oth.drive(true))
  for (let i = 0; i < 80; i++) { await sleep(500); if (await p.evaluate(() => window.__oth.onFoot && window.__oth.hero.state === 'move')) break }
  for (const w of ['pistol', 'ak47', 'sniper', 'fists']) {
    await p.evaluate((w) => { window.__oth.arsenal.equip(w === 'fists' ? null : w) }, w)
    await sleep(1500)
    await p.screenshot({ path: `${out}/${name}_${w}.png` })
    // every button on the screen: its box
    const boxes = await p.evaluate(() => [...document.querySelectorAll('button')].filter((e) => { const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 8 && r.height > 8 }).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.textContent || e.getAttribute('data-k') || e.className || '?').trim().slice(0, 12) || e.className.slice(0, 14) || e.getAttribute('data-k') || '?', x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), pad: e.hasAttribute('data-weapon-pad') } }))
    const pads = boxes.filter((q) => q.pad)
    const bad = []
    for (const a of pads) {
      if (a.x < 0 || a.y < 0 || a.x + a.w > innerWidthOf(W) || a.y + a.h > H) bad.push(`${a.t} leaves the screen`)
      for (const c of boxes) if (c !== a && a.x < c.x + c.w - 2 && c.x < a.x + a.w - 2 && a.y < c.y + c.h - 2 && c.y < a.y + a.h - 2) bad.push(`${a.t} over ${c.t}`)
    }
    console.log(`${name} ${W}×${H} ${w.padEnd(7)} pads: ${pads.map((q) => `${q.t} ${q.x},${q.y} ${q.w}`).join(' | ') || '(none)'}${bad.length ? '   FAIL: ' + [...new Set(bad)].join('; ') : '   ok'}`)
    if (bad.length) ok = false
  }
  await p.close()
}
function innerWidthOf(w) { return w }
await b.close()
console.log(ok ? 'ALL PASS' : 'SOME FAILED')
process.exit(ok ? 0 : 1)
