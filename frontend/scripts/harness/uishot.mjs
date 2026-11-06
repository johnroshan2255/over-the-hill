// uishot.mjs [outDir] — THE UI at every size: the title screen and the HUD (car, motorbike) on a small phone (portrait +
// landscape, touch), a tablet, and desktop 1280×720 / 1920×1080. Checks that no two controls overlap and none leaves
// the screen; screenshots each. Env: URL (https://localhost:5301), ONLY=name filter.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const out = process.argv[2] || 'uishots'
fs.mkdirSync(out, { recursive: true })
const BASE = process.env.URL || 'https://localhost:5301'
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ANGLE = process.platform === 'win32' ? 'd3d11' : 'metal'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', acceptInsecureCerts: true, args: [`--use-angle=${ANGLE}`, '--ignore-gpu-blocklist', '--mute-audio', '--ignore-certificate-errors'] })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const phone = (w, h) => ({ width: w, height: h, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: w > h })
const desk = (w, h) => ({ width: w, height: h, deviceScaleFactor: 1 })
const DEVICES = [
  ['phone-portrait', phone(360, 740)], ['phone-landscape', phone(740, 360)],
  ['phone-short-landscape', phone(640, 320)], ['tablet', phone(1024, 768)],
  ['desk-720', desk(1280, 720)], ['desk-1080', desk(1920, 1080)], ['desk-small', desk(900, 600)],
]
const GAME = '?tier=low&hour=11&time=0&sound=0&save=0&weather=clear'
const SCENES = [['title', '/'], ['settings', '/', 'settings'], ['car', `/${GAME}`], ['moto', `/${GAME}&ride=moto`], ['radar', `/${GAME}&radar=1`], ['foot', `/${GAME}&ride=foot`], ['wheel', `/${GAME}`, 'wheel'], ['pause', `/${GAME}`, 'pause']]

// every visible control / HUD plate: its box; pairs that intersect, and boxes off screen
const CHECK = () => {
  const wheel = document.querySelector('.oth-wheel.on svg')
  const sel = wheel ? '.oth-wheel.on svg, .oth-fs, .oth-menubtn' : document.querySelector('.oh-front') ? '.oh-front button, .oh-brand, .oh-main, .oh-hints, .oh-panel, .oth-fs' : 'button, .oth-stick, .oth-coins, .oth-sign.on, .oth-compass, #drive .spd, #drive .help, .oth-radar-box, .oth-radar-plate.on, .oth-prompt.on'
  const boxes = [...document.querySelectorAll(sel)].filter((e) => {
    const s = getComputedStyle(e), r = e.getBoundingClientRect()
    return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05 && r.width > 0 && r.height > 0 && !e.closest('.oth-map:not(.on)')
  }).map((e) => ({ e, r: e.getBoundingClientRect(), n: (e.className || e.tagName) + (e.dataset.k ? `[${e.dataset.k}]` : '') + (e.textContent ? ` "${e.textContent.trim().slice(0, 12)}"` : '') }))
  const W = innerWidth, H = innerHeight, bad = []
  for (const a of boxes) if (a.r.left < -1 || a.r.top < -1 || a.r.right > W + 1 || a.r.bottom > H + 1) bad.push(`off-screen: ${a.n}`)
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], c = boxes[j]
    if (a.e.contains(c.e) || c.e.contains(a.e)) continue
    const ox = Math.min(a.r.right, c.r.right) - Math.max(a.r.left, c.r.left), oy = Math.min(a.r.bottom, c.r.bottom) - Math.max(a.r.top, c.r.top)
    if (ox > 1 && oy > 1) bad.push(`overlap: ${a.n} × ${c.n}`)
  }
  return bad
}

const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message))
let fails = 0
for (const [scene, path, act] of SCENES) {
  for (const [dn, vp] of DEVICES) {
    const name = `${scene}_${dn}`
    if (process.env.ONLY && !name.includes(process.env.ONLY)) continue
    await p.setViewport(vp)
    await p.goto(BASE + path, { waitUntil: 'load' })
    if (scene === 'title' || scene === 'settings') await p.waitForSelector('.oh-main', { timeout: 30000 })
    else await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 120000, polling: 200 })
    await sleep(scene === 'title' || scene === 'settings' ? 900 : 2500)
    if (scene === 'foot') await sleep(7000)
    if (scene === 'moto') await sleep(1500) // (?ride=moto: on it once the car has stood a moment)
    if (act === 'wheel') await p.evaluate(() => document.querySelector('.oth-menubtn')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
    if (act === 'settings') await p.evaluate(() => [...document.querySelectorAll('.oh-item')].find((b) => b.textContent.startsWith('Settings'))?.click())
    if (act === 'pause') await p.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })))
    if (act) await sleep(500)
    const bad = await p.evaluate(CHECK)
    await p.screenshot({ path: `${out}/${name}.png` })
    fails += bad.length
    console.log(`${name.padEnd(30)} ${bad.length ? '✗ ' + bad.join(' | ') : '✓'}`)
  }
}
console.log('page errors:', errs.length ? [...new Set(errs)] : 'none')
console.log(fails ? `${fails} problems` : 'all clear')
await b.close()
