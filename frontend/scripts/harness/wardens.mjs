// wardens.mjs [outDir] [tier] <view> … — THE WARDENS' COUNTRY looked at (src/oth/Wardens.ts): each view is
//   name=<site name regexp>[#n],dist,up[,ang[,pitch[,hour]]]     the camera `dist` m from the n-th site whose name matches, `up` m
//                                                          over ITS ground, looking at it from the bearing `ang` (rad;
//                                                          f0.5: 0.5 rad round from the way its figure faces)
//   name=@x:z,dist,up[,ang[,pitch]]                        … or from a point
// e.g.  node scripts/harness/wardens.mjs screenshots/w ultra "kneel=Kneeling,60,14,0.6,0.1" "head=Fallen Head#1,30,6"
// env  Q (extra URL params, "a=1&b=2"), HEADFUL=1 (a real window), HOUR (13), EVAL (a JS expression run in the page first,
// its value printed), SITES=1 (print the sites' count by style), WAIT (ms a view settles: 2600)
// STONE=<n> [SEEN=<k>]: the car set beside the n-th writing with k stones read before — its card shot (stone.png).
// BEACON=1: the car set under the first beacon tower — the crystal before / after (beacon_0.png, beacon_1.png).
// STAIR=1: the car at the foot of the gentlest stair, W held — does it climb (stair_0..2.png, the y trace).
// VAULT=1 [VAULT_N=n]: the car before a sealed vault, the winch on its keystone, the brake held — the door falls, the car drives in.
// COURT=1 [COURT_N=n]: the car down a sunken court's stair (W) and back out (S) — the y traces.
// MIRE=1 [MIRE_N=n]: the car along the road through a mire (MapData.mires), W held — its speed and the mud under it.
// Needs `npm run dev` (PORT 5200).
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [out = 'screenshots/wardens', tier = 'ultra', ...specs] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true })
const b = await puppeteer.launch({ executablePath: process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: process.env.HEADFUL ? false : 'new', args: [process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1280,720'], defaultViewport: { width: 1280, height: 720 } })
const p = await b.newPage(); const errs = []
p.on('pageerror', (e) => errs.push(e.message))
p.on('console', (m) => { if (/^wkit:/.test(m.text())) console.log(m.text()); if (m.type() === 'error' || (m.type() === 'warn' && /exceeds|Invalid|invalid|not set/.test(m.text()))) errs.push(m.text().split('\n')[0]) })
if (process.env.SEEN) await p.evaluateOnNewDocument((k) => { try { localStorage.setItem('oth.wtexts.valley', JSON.stringify(Array.from({ length: k }, (_, i) => -1 - i))) } catch {} }, +process.env.SEEN)
await p.goto(`http://localhost:${process.env.PORT || 5200}/?tier=${tier}&dpr=fixed&time=0&hour=${process.env.HOUR || 13}&weather=clear&sound=0&save=0${process.env.Q ? `&${process.env.Q}` : ''}`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__oth && window.__oth.ready && window.__oth.car.sim, { timeout: 180000, polling: 200 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (process.env.SITES) console.log('sites:', JSON.stringify(await p.evaluate(() => { const c = {}; for (const l of window.__oth.world.places) if (l.kind === 'warden') c[l.style] = (c[l.style] ?? 0) + 1; return c })))
if (process.env.EVAL) console.log('eval:', JSON.stringify(await p.evaluate(process.env.EVAL)))
for (const spec of specs) {
  const [nm, rest] = spec.split('='), [pat, dist = 40, up = 6, ang = 0.6, pitch = -0.1, hour] = rest.split(',')
  const at = await p.evaluate((pat) => {
    const o = window.__oth, m = o.world.map
    if (pat[0] === '@') { const [x, z] = pat.slice(1).split(':').map(Number); return { x, z, y: m.height(x, z), name: pat } }
    const [re, n = '0'] = pat.split('#'), R = new RegExp(re)
    const l = o.world.places.filter((q) => R.test(q.name) || R.test(q.style ?? ''))[+n]
    return l ? { x: l.x, z: l.z, y: m.height(l.x, l.z), name: l.name, face: l.face ?? 0 } : null
  }, pat)
  if (!at) { console.log('no site matches', pat); continue }
  if (hour !== undefined) await p.evaluate((h) => { window.__oth.atmos.hour = h }, +hour)
  const A = String(ang)[0] === 'f' ? (at.face ?? 0) + +(String(ang).slice(1) || 0) : +ang   // (f0.5: 0.5 rad round from its front)
  const cx = at.x + dist * Math.sin(A), cz = at.z + dist * Math.cos(A)
  await p.evaluate((x, z, y, yaw, pitch) => { const o = window.__oth; o.view(x, z, Math.max(1.5, y - o.world.map.height(x, z)), yaw, pitch) }, cx, cz, at.y + +up, A, +pitch)
  await sleep(+(process.env.WAIT || 2600)); await p.screenshot({ path: `${out}/${nm}.png` })
  console.log('shot', nm, at.name, `(${at.x.toFixed(0)}, ${at.z.toFixed(0)})`)
}
if (process.env.STONE) {
  const t = await p.evaluate((n) => { const o = window.__oth, w = o.world.wardens, t = w.texts[n], m = o.world.map; o.drive(true); o.car.sim.place(t.x + 4, m.height(t.x + 4, t.z + 3) + 0.8, t.z + 3, 0); return t }, +process.env.STONE)
  await sleep(4500); await p.screenshot({ path: `${out}/stone.png` })
  console.log('stone', JSON.stringify(t), '| card:', await p.evaluate(() => document.querySelector('.oth-note')?.textContent?.slice(0, 200)), '| toast:', await p.evaluate(() => [...document.querySelectorAll('[class*=toast]')].map((e) => e.textContent).join(' / ')))
}
if (process.env.BEACON) {
  const l = await p.evaluate(() => { const o = window.__oth, l = o.world.places.find((q) => q.kind === 'warden' && q.style === 'tower'), m = o.world.map; return { x: l.x, z: l.z, r: l.r, y: m.height(l.x, l.z), name: l.name, lit: o.world.wardens.beacons() } })
  console.log('beacon', JSON.stringify(l))
  await p.evaluate((l) => window.__oth.view(l.x + 60, l.z + 60, 30, Math.atan2(60, 60), 0.12), l); await sleep(2500); await p.screenshot({ path: `${out}/beacon_0.png` })
  await p.evaluate((l) => { const o = window.__oth; o.drive(true); o.car.sim.place(l.x + l.r + 3, o.world.map.height(l.x + l.r + 3, l.z) + 0.8, l.z, 0) }, l); await sleep(6500)
  console.log('after:', JSON.stringify(await p.evaluate(() => window.__oth.world.wardens.beacons())), '| toast:', await p.evaluate(() => [...document.querySelectorAll('[class*=toast]')].map((e) => e.textContent).join(' / ')))
  await p.screenshot({ path: `${out}/beacon_car.png` })
  await p.evaluate((l) => window.__oth.view(l.x + 60, l.z + 60, 30, Math.atan2(60, 60), 0.12), l); await sleep(2500); await p.screenshot({ path: `${out}/beacon_1.png` })
}
if (process.env.STAIR) {
  // the car at the foot of the gentlest stair near a temple, W held: does it climb onto the platform?
  const st = await p.evaluate(() => {
    const o = window.__oth, cols = o.world.props.colliders.filter((c) => c.q && c.ground && c.hy === 0.35)
    const rot = (q, v) => { const [x, y, z, w] = q, [vx, vy, vz] = v; const ix = w * vx + y * vz - z * vy, iy = w * vy + z * vx - x * vz, iz = w * vz + x * vy - y * vx, iw = -x * vx - y * vy - z * vz; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x] }
    const all = cols.map((c) => { const d = rot(c.q, [0, 0, 1]); return { x: c.x, y: c.y, z: c.z, hz: c.hz, hx: c.hx, dx: d[0], dy: d[1], dz: d[2] } }).filter((c) => c.hx > 2.5)
    all.sort((a, b) => Math.abs(a.dy) - Math.abs(b.dy))
    return { n: cols.length, total: o.world.props.colliders.length, tilted: o.world.props.colliders.filter((c) => c.q).length, s: all[+(new URLSearchParams(location.search).get('stairn') ?? 0)] }
  })
  console.log('stairs:', st.n, 'colliders:', st.total, 'tilted:', st.tilted, 'this one:', JSON.stringify(st.s))
  const s = st.s, hl = Math.hypot(s.dx, s.dz), ux = s.dx / hl, uz = s.dz / hl, bx = s.x + ux * (s.hz * hl + 7), bz = s.z + uz * (s.hz * hl + 7)
  await p.evaluate((bx, bz, yaw) => { const o = window.__oth; o.drive(true); o.car.sim.place(bx, o.world.map.height(bx, bz) + 0.8, bz, yaw) }, bx, bz, Math.atan2(ux, uz))
  await sleep(2500)
  const y0 = await p.evaluate(() => window.__oth.car.root.position.y)
  await p.screenshot({ path: `${out}/stair_0.png` })
  await p.keyboard.down('KeyW')
  const tr = []
  for (let k = 0; k < 12; k++) { await sleep(500); tr.push(await p.evaluate(() => { const P = window.__oth.car.root.position; return [+P.x.toFixed(1), +P.y.toFixed(2), +P.z.toFixed(1)] })); if (k === 3) await p.screenshot({ path: `${out}/stair_1.png` }) }
  await p.keyboard.up('KeyW'); await sleep(800)
  await p.screenshot({ path: `${out}/stair_2.png` })
  console.log('y0', y0.toFixed(2), 'ramp top y', (s.y + Math.abs(s.dy) * s.hz).toFixed(2), 'trace y:', tr.map((t) => t[1]).join(' '))
}
if (process.env.VAULT) {
  // the car 13 m in front of a sealed vault, square to its door: E (the winch takes the keystone), the brake held — the
  // door falls; then W: in over the fallen slab
  const v = await p.evaluate((n) => { const o = window.__oth, l = o.world.places.filter((q) => q.style === 'vault')[n], k = o.world.wardens.keystones().find((q) => q.site === l.id); return { x: l.x, z: l.z, face: l.face, kx: k.x, kz: k.z, name: l.name } }, +(process.env.VAULT_N || 0))
  const fx = Math.sin(v.face), fz = Math.cos(v.face), cx = v.kx + fx * 13, cz = v.kz + fz * 13
  await p.evaluate((cx, cz, yaw) => { const o = window.__oth; o.drive(true); o.car.sim.place(cx, o.world.map.height(cx, cz) + 0.8, cz, yaw) }, cx, cz, Math.atan2(fx, fz))
  await sleep(3000); await p.screenshot({ path: `${out}/vault_0.png` })
  await p.keyboard.press('KeyE'); await sleep(300)
  console.log('vault', v.name, '| hooked:', await p.evaluate(() => window.__oth.winch.attached), '| toast:', await p.evaluate(() => [...document.querySelectorAll('[class*=toast]')].map((e) => e.textContent).join(' / ')))
  await p.keyboard.down('Space')
  for (let k = 0; k < 24; k++) { await sleep(500); if (k === 3) await p.screenshot({ path: `${out}/vault_1.png` }); if (await p.evaluate(() => window.__oth.world.wardens.vaultCount[0]) > 0) { console.log('opened after', (k + 1) * 0.5, 's'); break } }
  await p.keyboard.up('Space')
  await sleep(600); await p.screenshot({ path: `${out}/vault_2.png` }); await sleep(1500)
  console.log('open:', JSON.stringify(await p.evaluate(() => window.__oth.world.wardens.vaultCount)), '| toast:', await p.evaluate(() => [...document.querySelectorAll('[class*=toast]')].map((e) => e.textContent).join(' / ')))
  await p.screenshot({ path: `${out}/vault_3.png` })
  await p.keyboard.down('KeyW'); await sleep(4200); await p.keyboard.up('KeyW'); await sleep(1500)
  const c = await p.evaluate(() => { const P = window.__oth.car.root.position; return [P.x, P.y, P.z] })
  console.log('car after W:', c.map((q) => q.toFixed(1)).join(' '), '| from the door:', Math.hypot(c[0] - v.kx, c[2] - v.kz).toFixed(1), 'm, inside:', ((c[0] - v.kx) * fx + (c[2] - v.kz) * fz < 0))
  await p.screenshot({ path: `${out}/vault_4.png` })
}
if (process.env.COURT) {
  // the car at the top of a sunken court's stair, facing in: W (down the steps onto the floor), then S (back up and out)
  const c = await p.evaluate((n) => { const o = window.__oth, c = o.world.map.courts[n]; return c }, +(process.env.COURT_N || 0))
  const a = c.side * Math.PI / 2, fx = Math.sin(a), fz = Math.cos(a), sx = c.x + fx * 26, sz = c.z + fz * 26
  await p.evaluate((sx, sz, yaw) => { const o = window.__oth; o.drive(true); o.car.sim.place(sx, o.world.map.height(sx, sz) + 0.8, sz, yaw) }, sx, sz, Math.atan2(fx, fz))
  await sleep(2500)
  const Y = () => p.evaluate(() => { const P = window.__oth.car.root.position; return [+P.x.toFixed(1), +P.y.toFixed(2), +P.z.toFixed(1)] })
  const y0 = await Y(); const tr = []
  await p.keyboard.down('KeyW'); for (let k = 0; k < 5; k++) { await sleep(500); tr.push((await Y())[1]) } await p.keyboard.up('KeyW')
  await p.keyboard.down('Space'); await sleep(1500); await p.keyboard.up('Space'); const yIn = await Y()
  await p.screenshot({ path: `${out}/court_car_in.png` })
  // (turned round on the floor — set down facing the stair — and W: out forwards)
  await p.evaluate((x, z, y, yaw) => window.__oth.car.sim.place(x, y, z, yaw), c.x + fx * 4.5, c.z + fz * 4.5, c.floor + 1.2, Math.atan2(-fx, -fz)); await sleep(1500)
  await p.keyboard.down('KeyW'); const tr2 = []; for (let k = 0; k < 14; k++) { await sleep(500); tr2.push((await Y())[1]) } await p.keyboard.up('KeyW')
  const yOut = await Y()
  await p.screenshot({ path: `${out}/court_car_out.png` })
  console.log('court', JSON.stringify(c), '| start', y0.join(' '), '| down:', tr.join(' '), '| in:', yIn.join(' '), `(floor ${c.floor.toFixed(1)}, rim ${c.rim.toFixed(1)})`, '| back up:', tr2.join(' '), '| out:', yOut.join(' '))
}
if (process.env.MIRE) {
  // the car on the road 90 m before a mire, along the road, W held: its speed and the mud under it, through and out
  const m = await p.evaluate((n) => {
    const o = window.__oth, M = o.world.map.mires[n], L = o.world.map.meta.outland.trails.lines
    let best = null, bd = 1e9
    for (const l of L) for (let k = 12; k < l.length - 12; k++) { const d = Math.hypot(l[k][0] - M.x, l[k][1] - M.z); if (d < bd) { bd = d; best = [l[k - 11], l[k - 9], l[k + 11]] } }
    return { M, a: best[0], b: best[1], c: best[2] }
  }, +(process.env.MIRE_N || 0))
  await p.evaluate((a, b) => { const o = window.__oth; o.drive(true); o.car.sim.place(a[0], o.world.map.height(a[0], a[1]) + 0.8, a[1], Math.atan2(-(b[0] - a[0]), -(b[1] - a[1]))) }, m.a, m.b)
  await sleep(2000); await p.keyboard.down('KeyW'); const tr = []
  for (let k = 0; k < 30; k++) { await sleep(500); tr.push(await p.evaluate((M) => { const o = window.__oth, P = o.car.root.position; return [Math.round(Math.hypot(P.x - M.x, P.z - M.z)), +(Math.abs(o.car.sim.speed) * 3.6).toFixed(0), +o.world.map.mudAt(P.x, P.z).toFixed(2)] }, m.M)); if (k === 9) await p.screenshot({ path: `${out}/mire_drive.png` }) }
  await p.keyboard.up('KeyW')
  console.log('mire', JSON.stringify(m.M), '| [m from its middle, km/h, mud]:', tr.map((t) => t.join('/')).join(' '))
}
console.log('errors:', errs.length ? [...new Set(errs)].join(' | ').slice(0, 800) : 'none')
await b.close()
