// garageshots.mjs [ids…] — THE GARAGE'S PICTURES (2026-11-16, the user: "while selecting cars show an image of the car
// there — now we don't know which one we are going to select"): each garage car as the game draws it, in its factory
// colour, from the front three-quarter, the HUD hidden — 1280 × 720 shot, saved at 640 × 360 to
// src/assets/ui/cars/<id>.jpg (the menu's tiles and side panel: ui/Menu.ts). `moto`: the motorbike. Needs `npm run dev`.
//   node scripts/harness/garageshots.mjs                 (all)          node scripts/harness/garageshots.mjs forty moto
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const OUT = new URL('../../src/assets/ui/cars/', import.meta.url)
fs.mkdirSync(OUT, { recursive: true })
const ALL = ['offroader', 'sierra', 'powerline', 'fortyfive', 'squarebody', 'bronc', 'scoutling', 'steppe', 'eightyeight', 'guardian', 'gelande', 'forty', 'seventy', 'lynx', 'wayfarer', 'wagon63', 'grandwagon', 'boar', 'woodbox', 'moto']
const ids = process.argv.length > 2 ? process.argv.slice(2) : ALL
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const small = await b.newPage()
// (the shot scaled to the tile's size in a page of its own: a canvas, a JPEG)
const shrink = (png) => small.evaluate(async (s) => {
  const im = new Image(); await new Promise((r) => { im.onload = r; im.src = 'data:image/png;base64,' + s })
  const c = document.createElement('canvas'); c.width = 640; c.height = 360
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, 640, 360)
  return c.toDataURL('image/jpeg', 0.82).split(',')[1]
}, png.toString('base64'))
for (const id of ids) {
  const p = await b.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errs.push(m.text().slice(0, 200)) })
  await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=ultra&dpr=fixed&time=0&hour=13&weather=clear&sound=0&save=0&radar=0&${id === 'moto' ? 'ride=moto' : `car=${id}`}`, { waitUntil: 'load', timeout: 120000 })
  await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 180000, polling: 200 })
  await sleep(2500)
  await p.bringToFront()
  // the HUD out of the picture: everything on the page but the game's canvas
  await p.addStyleTag({ content: 'body > *:not(canvas) { display: none !important }' })
  // the camera at the front three-quarter, as far off as the thing is long
  await p.evaluate((moto) => {
    const o = window.__oth, t = moto ? o.moto ?? o.two : o.car, root = t.root, q = root.quaternion, P = root.position
    // (the motorbike: a longer look for its size, its rider on it, the car parked by it out of the picture)
    const L = moto ? 3.4 : t.model.half.z * 2, H = moto ? 1.5 : t.model.half.y * 2
    if (moto) { o.car.root.visible = false; if (o.car.shadowMesh) o.car.shadowMesh.visible = false }
    const V = (v) => o.camera.position.clone().set(v[0], v[1], v[2]).applyQuaternion(q).add(P)
    const a = V([-0.6 * L, 0.2 * L + 0.55 * H, -0.8 * L]), c = V([0, 0.46 * H, 0.02 * L])
    o.view(a.x, a.z, a.y - o.world.map.height(a.x, a.z), Math.atan2(-(c.x - a.x), -(c.z - a.z)), Math.atan2(c.y - a.y, Math.hypot(c.x - a.x, c.z - a.z)))
  }, id === 'moto')
  await sleep(1200)
  const jpg = await shrink(await p.screenshot({ type: 'png' }))
  fs.writeFileSync(new URL(`${id}.jpg`, OUT), Buffer.from(jpg, 'base64'))
  console.log(id, `${(Buffer.from(jpg, 'base64').length / 1024).toFixed(0)} kB`, errs.length ? 'ERRORS: ' + [...new Set(errs)].join(' | ') : '')
  await p.close()
}
await b.close()
