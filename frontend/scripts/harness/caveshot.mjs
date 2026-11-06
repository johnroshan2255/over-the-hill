// caveshot.mjs [dir] — the caves framed (the tunnel and each one-way cave: front, side, above, inside, the skylight);
// env ONLY (a name part), HOUR. Needs `npm run dev` on 5200.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const dir = process.argv[2] || '/Users/johnroshan/Downloads/Projects/overhill/screenshots'
const only = process.env.ONLY
fs.mkdirSync(dir, { recursive: true })
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 } })
const p = await b.newPage()
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
await p.goto(`http://localhost:5200/?world=valley&tier=ultra&hour=${process.env.HOUR || 14}&drive=0&dpr=fixed&time=0&weather=clear&sound=0&save=0`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready, { timeout: 180000, polling: 200 })
await p.addStyleTag({ content: 'body > :not(canvas):not([style*="radial-gradient"]) { display: none !important; }' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const caves = await p.evaluate(() => window.__oth.world.places.filter((q) => q.kind === 'tunnel' || q.kind === 'grotto').map((l) => ({ x: l.x, z: l.z, rot: l.rot, name: l.name, kind: l.kind, style: l.style, zc: l.dark?.z1 ?? 0 })))
console.log(caves)
for (const l of caves) {
  const tag = (l.name).replace(/[^a-z0-9]+/gi, '-')
  if (only && !tag.includes(only)) continue
  const sx = Math.sin(l.rot), cz = Math.cos(l.rot)
  const P = (lx, lz) => [l.x + lx * cz + lz * sx, l.z - lx * sx + lz * cz]
  const look = (f, t) => Math.atan2(-(t[0] - f[0]), -(t[1] - f[1]))
  const views = l.kind === 'tunnel' ? [
    ['a_front', P(3, 52), 2.6, P(0, 0), -0.05], ['b_front_side', P(-22, 46), 4, P(0, 10), -0.08], ['c_side_high', P(70, 10), 18, P(0, 0), -0.12],
    ['d_inside', P(0.5, -6), 2.2, P(0, 40), 0.12], ['e_mouth_close', P(2, 26), 2.0, P(0, 0), 0.08],
  ] : [
    ['a_front', P(3, l.style === 'den' ? 16 : 30), 2.4, P(0, l.zc / 2), 0.02], ['b_front_side', P(-22, 26), 7, P(0, l.zc / 2), -0.12], ['c_above', P(45, l.zc + 40), 30, P(0, l.zc), -0.4],
    ['d_inside', P(1, -2), 2.0, P(0, l.zc), 0.1], ['e_inside_out', P(0, l.zc * 0.85), 2.0, P(0, 30), 0.05],
    ...(l.style === 'sky' ? [['f_skylight', P(-8, l.zc + 6), 2.0, P(0, l.zc), 0.45]] : []),
  ]
  for (const [n, from, h, to, pitch] of views) {
    await p.evaluate((a) => window.__oth.view(...a), [from[0], from[1], h, look(from, to), pitch])
    await sleep(2000)
    const f = `${dir}/cave_${tag}_${n}.png`; await p.screenshot({ path: f }); console.log(f)
  }
}
console.log('errors:', errs.slice(0, 5))
await b.close().catch(() => {}); process.exit(0)
