// shifttest.mjs <outDir> <car> — drive off in first person and watch the gear lever and the hand through the shifts
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [out, id = 'forty', extra = ''] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const b = await puppeteer.launch({ executablePath: process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const p = await b.newPage()
const errs = []
p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text().slice(0, 200)) })
await p.goto(`http://localhost:5200/?tier=ultra&dpr=fixed&time=0&hour=13&weather=clear&sound=0&save=0&car=${id}${extra ? '&' + extra : ''}`, { waitUntil: 'load', timeout: 120000 })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 180000, polling: 200 })
await p.evaluate(() => window.__oth.drive(true)); await sleep(2000)
await p.keyboard.press('KeyV'); await sleep(800)
await p.keyboard.down('KeyW')
const log = []; let shots = 0, last = ''
for (let i = 0; i < 90; i++) {
  await sleep(90)
  const s = await p.evaluate(() => { const c = window.__oth.car, D = c.sim.drivetrain, a = c.anim; return { v: +(c.sim.speed * 3.6).toFixed(0), g: D?.gear, to: D?.gearTarget, sh: D?.shifting, sel: D?.selector, at: a?.at?.map((x) => +x.toFixed(2)), k: +(c.shiftGrip?.k ?? 0).toFixed(2), rpm: D ? Math.round(D.we * 30 / Math.PI) : 0 } })
  const key = `${s.g}/${s.to}/${s.at}/${s.k > 0.5}`
  if (key !== last) { log.push(JSON.stringify(s)); last = key }
  if (s.k > 0.75 && shots < 3) { await p.screenshot({ path: `${out}/${id}_shift${shots++}.png` }) }
}
await p.keyboard.up('KeyW')
await p.screenshot({ path: `${out}/${id}_speed.png` })
console.log(log.join('\n'))
console.log('errors:', errs.length ? [...new Set(errs)].join(' | ') : 'none')
await b.close()
