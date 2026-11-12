// aptouch.mjs [outDir] — THE AUTOPILOT ON A PHONE (emulated: Pixel 5 landscape, touch): the AUTOPILOT button over the
// speedometer shows once a destination is set; a tap turns it on; it drives; a touch on a pedal / a steering button
// takes the wheel back. Screenshots: ap_button.png (shown), ap_on.png (driving), ap_off.png (after the takeover).
// Needs `npm run dev` (PORT 5200). An EMULATION — the layout and the touch events, not a phone's GPU or thumbs.
import puppeteer, { KnownDevices } from 'puppeteer-core'
import fs from 'node:fs'
const out = process.argv[2] || 'screenshots/aptouch'; fs.mkdirSync(out, { recursive: true })
const b = await puppeteer.launch({ executablePath: process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: [process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] })
const p = await b.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const dev = KnownDevices['Pixel 5 landscape']
await p.emulate({ ...dev, viewport: { ...dev.viewport, deviceScaleFactor: 1 } })
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=low&hour=13&time=0&sound=0&save=0&weather=clear`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 180000, polling: 200 })
// on an outland road, a destination 600 m along it
const L = await p.evaluate(() => { const o = window.__oth, l = [...o.world.map.meta.outland.trails.lines].sort((a, c) => c.length - a.length)[0], k = Math.floor(l.length * 0.35), a = l[k], c = l[k + 75]; o.drive(true); o.car.sim.place(a[0], o.world.map.height(a[0], a[1]) + 0.9, a[1], Math.atan2(-(l[k + 2][0] - a[0]), -(l[k + 2][1] - a[1]))); o.guide.set({ world: o.world.id, x: c[0], z: c[1], name: 'Waypoint' }, { x: a[0], z: a[1] }); return { touch: document.body.classList.contains('touch') } })
await sleep(2500)
const btn = await p.$('.oth-ap')
const box = btn ? await btn.boundingBox() : null
console.log('touch layout:', L.touch, '| the button:', box ? `shown at ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}×${Math.round(box.height)}` : 'NOT SHOWN', '| text:', await p.evaluate(() => document.querySelector('.oth-ap')?.textContent))
await p.screenshot({ path: `${out}/ap_button.png` })
if (box) await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
await sleep(600)
console.log('after the tap: autopilot on =', await p.evaluate(() => window.__oth.autopilot.on))
await sleep(7000)
const s1 = await p.evaluate(() => ({ on: window.__oth.autopilot.on, v: +(Math.abs(window.__oth.car.sim.speed) * 3.6).toFixed(0) }))
console.log('7 s on:', JSON.stringify(s1))
await p.screenshot({ path: `${out}/ap_on.png` })
// the takeover: a touch on the first control of the touch pad
const pad = await p.evaluate(() => [...document.querySelectorAll('.oth-touch button, .oth-touch [data-k], .oth-touch > *')].map((e) => { const r = e.getBoundingClientRect(); return { t: (e.textContent || '').trim().slice(0, 12), c: e.className, x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width } }).filter((q) => q.w > 20))
console.log('the pad:', pad.map((q) => `${q.t || q.c}@${Math.round(q.x)},${Math.round(q.y)}`).join('  '))
const gas = pad.find((q) => /gas|▲|go|acc/i.test(q.t + q.c)) ?? pad[pad.length - 1]
if (gas) { await p.touchscreen.touchStart(gas.x, gas.y); await sleep(500); await p.touchscreen.touchEnd() }
await sleep(500)
console.log(`after a touch on "${gas?.t || gas?.c}": autopilot on =`, await p.evaluate(() => window.__oth.autopilot.on), '| toast:', await p.evaluate(() => [...document.querySelectorAll('[class*=toast]')].map((e) => e.textContent).join(' / ')))
await p.screenshot({ path: `${out}/ap_off.png` })
console.log('errors:', errs.length ? [...new Set(errs)].join(' | ').slice(0, 400) : 'none')
await b.close()
