// garageui.mjs <outDir> — THE GARAGE's screens shot on a desktop, a phone and a phone held sideways: the Vehicle tab (its
// pictures), scrolled, and the Paint tab. (2026-11-16, docs/NEXT_garage.md.) Needs `npm run dev`.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true })
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const click = (p, text) => p.evaluate((t) => { const e = [...document.querySelectorAll('button, .oh-tab, .oh-item, [role=button]')].find((x) => x.textContent.trim().toLowerCase().startsWith(t.toLowerCase())); if (e) e.click(); return !!e }, text)
for (const [name, vp] of [['desk', { width: 1280, height: 720 }], ['phone', { width: 360, height: 740, isMobile: true, hasTouch: true }], ['phone-land', { width: 740, height: 360, isMobile: true, hasTouch: true }]]) {
  const p = await b.newPage(); await p.setViewport(vp)
  const errs = []; p.on('pageerror', (e) => errs.push(e.message))
  await p.goto('http://localhost:5200/', { waitUntil: 'load', timeout: 120000 }); await sleep(1500)
  console.log(name, 'garage', await click(p, 'Garage')); await sleep(900)
  await p.screenshot({ path: `${out}/${name}_vehicle.png` })
  await p.evaluate(() => { const l = document.querySelector('.oh-list'); if (l) l.scrollTop = 600 }); await sleep(600)
  await p.screenshot({ path: `${out}/${name}_vehicle2.png` })
  console.log(name, 'paint', await click(p, 'Paint')); await sleep(600)
  await p.screenshot({ path: `${out}/${name}_paint.png` })
  if (errs.length) console.log('ERR', errs.join(' | '))
  await p.close()
}
await b.close()
