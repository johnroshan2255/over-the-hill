// ropeclips.mjs <outDir> — THE TOW ROPE'S MOVES LOOKED AT (Winch.ts; made in Blender, scripts/oth/fight.py SET=rope):
// solo, the walker on foot; each clip played where he stands and filmed from his right and his front, a strip of
// frames each — to see the moves as the game plays them (the hands, the knee, the weight), not only as Blender does.
//   node scripts/harness/ropeclips.mjs <outdir>   env: PORT (5200), ONLY=hook_take,hook_attach
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const out = process.argv[2] ?? 'ropeclips'
fs.mkdirSync(out, { recursive: true })
const CHROME = process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: [`--use-angle=${process.platform === 'win32' ? 'd3d11' : 'metal'}`, '--ignore-gpu-blocklist', '--mute-audio', '--window-size=900,600'], defaultViewport: { width: 900, height: 600 } })
const p = await b.newPage()
p.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)))
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=high&hour=11&dpr=fixed&time=0&weather=clear&sound=0&save=0&companion=off`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth?.ready && window.__oth.car?.sim, { timeout: 180000, polling: 250 })
await sleep(3000)
await p.evaluate(() => window.__oth.foot())
await p.waitForFunction(() => window.__oth.onFoot && window.__oth.hero.state === 'move' && !window.__oth.hero.playing?.startsWith('car_'), { timeout: 20000, polling: 200 })
// (out from the car, in the open)
await p.evaluate(() => { const o = window.__oth, h = o.hero; h.appear(h.pos.x - Math.sin(h.heading + 1.2) * 6, h.pos.z - Math.cos(h.heading + 1.2) * 6, h.heading) })
await sleep(1500)
await p.evaluate((url) => window.__oth.hero.loadClips(url), (await p.evaluate(() => [...document.scripts].length)) && '/src/assets/models/human/rope.glb')
if (process.env.CARRY) {
  // (as in play: the hook taken off the bumper first, then carried — the move played from the carry)
  await p.evaluate(() => { const o = window.__oth, h = o.hero, c = o.car, M = c.root.matrixWorld.elements, z = c.model.front - 1.2; h.appear(M[8] * z + M[12], M[10] * z + M[14], c.sim.heading + Math.PI) })
  await sleep(800)
  await p.evaluate(() => window.__oth.winch.press())
  await p.waitForFunction(() => window.__oth.winch.state === 'hand' && !window.__oth.winch.busy, { timeout: 20000, polling: 200 })
  await p.evaluate(() => { const o = window.__oth, h = o.hero; h.appear(h.pos.x - Math.sin(h.heading) * 5, h.pos.z - Math.cos(h.heading) * 5, h.heading) })
  await sleep(1500)
  console.log('carrying:', JSON.stringify(await p.evaluate(() => { const g = window.__oth.hero.grip; return { lOn: g.lOn, rOn: g.rOn, l: g.l, lqOn: g.lqOn, ik: !!window.__oth.hero.handIK } })))
}
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : ['hook_take', 'hook_attach', 'hook_detach', 'hook_stow']
for (const clip of ONLY) {
  for (const [view, x, y, z] of [['right', 2.4, 1.0, 0.0], ['front', 0.9, 1.1, -2.6]]) {
    const len = await p.evaluate((c) => { const o = window.__oth, h = o.hero; if (o.winch.state === 'hand') o.winch.move(c, 0.43, () => {}, () => {}); else h.strike(c, { force: true }); return h.clipLength(c) }, clip)
    await sleep(400)
    console.log(clip, view, JSON.stringify(await p.evaluate(() => { const h = window.__oth.hero, g = h.grip; return { playing: h.playing, lOn: g.lOn, rOn: g.rOn, ik: !!h.handIK, upper: h.upper?.clip.name ?? null } })))
    const n = 8, frames = []
    for (let i = 0; i < n; i++) {
      await p.evaluate((x, y, z) => window.__oth.spectate(x, y, z, 0.75), x, y, z)
      await sleep(20)
      frames.push(await p.screenshot({ clip: { x: 225, y: 60, width: 450, height: 480 }, encoding: 'base64' }))
      await sleep(Math.max(0, (len * 1000) / n - 60))
    }
    await p.evaluate(() => window.__oth.spectate())
    fs.writeFileSync(`${out}/${clip}-${view}.json`, JSON.stringify(frames))
    await sleep(800)
  }
}
await b.close()
