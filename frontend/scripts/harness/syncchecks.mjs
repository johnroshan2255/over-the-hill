// syncchecks.mjs — the THINGS DONE TOGETHER for syncplay.mjs: three players doing things at once, every screen asked
// what it believes, and a late joiner and a reload. Each step's agreement is checked on all screens.
export async function checks({ pa, pb, pc, open, accts, world, check, sleep, out }) {
  let ok = true
  const chk = (c, w) => { check(c, w); if (!c) ok = false }
  const all = { A: pa, B: pb, C: pc }
  const sidOf = (p, name) => p.evaluate((n) => { for (const r of window.__oth.coop.session.remotes.values()) if (r.name === n) return r.sid; return -1 }, name)
  /** What page p believes of player `name` (null: them themselves → its own session). */
  const view = (p, name) => p.evaluate((n) => {
    const c = window.__oth.coop, S = c.session
    if (S.me.name === n) {
      const dm = window.__oth.car.damage
      let sum = 0; if (dm) for (const m of dm.meshes) for (let i = 0; i < m.dmg.length; i++) sum += m.dmg[i]
      return { hp: S.hp, down: S.down, weapon: window.__oth.arsenal.current ?? 'fists', dmg: +sum.toFixed(1), car: window.__oth.car.id }
    }
    for (const r of S.remotes.values()) if (r.name === n) {
      const a = c.remotes['avatars'].get(r.sid), dm = a?.car.damage
      let sum = 0; if (dm) for (const m of dm.meshes) for (let i = 0; i < m.dmg.length; i++) sum += m.dmg[i]
      return { hp: r.hp, down: r.down, weapon: r.weapon, dmg: +sum.toFixed(1), car: r.car || a?.car.id }
    }
    return null
  }, name)
  /** A trigger pull: held 90 ms (a key down and up in one go fell between two frames — no shot). */
  const tap = async (p) => { await p.keyboard.down('KeyJ'); await sleep(90); await p.keyboard.up('KeyJ') }
  const stats = (p) => p.evaluate(() => ({ ...window.__oth.arsenal.stats, onFoot: window.__oth.onFoot, cur: window.__oth.arsenal.current }))
  const agree = async (name, key, pages = all) => {
    const vals = {}
    for (const [k, p] of Object.entries(pages)) vals[k] = (await view(p, name))?.[key]
    const vs = Object.values(vals)
    return { same: vs.every((v) => JSON.stringify(v) === JSON.stringify(vs[0])), vals }
  }
  // everyone out of their car and stood still; A and C draw pistols; B stands 12 m before A
  for (const p of [pa, pb, pc]) {
    if (await p.evaluate(() => window.__oth.onFoot)) continue
    // (C rides: off the bike — back into the car — then out of it)
    if (await p.evaluate(() => window.__oth.riding)) { await p.evaluate(() => window.__oth.ride()); await sleep(1500) }
    // (the car stopped first — the handbrake held: A's drive ends reversing, and at more than 5 km/h it's "Stop the car
    //  to get out")
    await p.keyboard.down('Space')
    for (let i = 0; i < 30; i++) { if ((await p.evaluate(() => window.__oth.car.speedKmh)) < 2) break; await sleep(200) }
    await p.keyboard.up('Space')
    await p.evaluate(() => window.__oth.foot())
    await sleep(500)
  }
  // (what the server says no to, each shooter's — the answers to intents sent without a req)
  for (const p of [pa, pc]) await p.evaluate(() => { window.__no = []; window.__oth.coop.session.on((e) => { if (e.t === 'err' && e.req === null) window.__no.push(e.msg) }) })
  for (let i = 0; i < 30; i++) { await sleep(300); const s = await Promise.all([pa, pb, pc].map((p) => p.evaluate(() => window.__oth.onFoot && window.__oth.hero.state === 'move'))); if (s.every(Boolean)) break }
  // (the fight staged on open ground 45 m back from the start, clear of the parked cars — a car between two players
  //  takes the bullets, as it should)
  const A0 = await pa.evaluate(() => {
    const o = window.__oth, h = o.hero, m = o.map
    let best = null
    for (let k = 0; k < 24; k++) {
      const a = k * 0.2618, x = h.pos.x + Math.sin(a) * 45, z = h.pos.z + Math.cos(a) * 45
      let lo = 1e9, hi = -1e9
      for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) { const y = m.height(x + i * 3, z + j * 3); lo = Math.min(lo, y); hi = Math.max(hi, y) }
      if (m.waterAt(x, z) !== null || o.world.trees.nearest(x, z, 14)) continue
      if (!best || hi - lo < best.s) best = { x, z, s: hi - lo }
    }
    const at = best ?? { x: h.pos.x, z: h.pos.z }
    h.appear(at.x, at.z, h.heading)
    return { x: at.x, z: at.z, h: h.heading }
  })
  await pb.evaluate((a) => window.__oth.hero.appear(a.x - Math.sin(a.h) * 12, a.z - Math.cos(a.h) * 12, a.h + Math.PI), A0)
  await pc.evaluate((a) => window.__oth.hero.appear(a.x + Math.cos(a.h) * 10, a.z - Math.sin(a.h) * 10, a.h), A0)
  await pa.evaluate(() => window.__oth.arsenal.equip('pistol'))
  await pc.evaluate(() => window.__oth.arsenal.equip('ak47'))
  await sleep(2000)
  let g = await agree('Asha', 'weapon')
  chk(g.same && g.vals.A === 'pistol', `all agree A holds the pistol (${JSON.stringify(g.vals)})`)
  g = await agree('Chen', 'weapon')
  chk(g.same && g.vals.C === 'ak47', `all agree C holds the AK-47 (${JSON.stringify(g.vals)})`)
  // A fires at B — and B fells a tree, and C plants a flag, at the same time
  const aimAt = (p, name) => p.evaluate((n) => {
    const o = window.__oth, h = o.hero.pos, c = o.coop
    for (const r of c.session.remotes.values()) if (r.name === n) { const t = c.remotes['avatars'].get(r.sid).pos; const dx = t.x - h.x, dz = t.z - h.z, dy = t.y + 1.2 - (h.y + 1.66); o.aim(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))); return true }
    return false
  }, name)
  /** Until page p's last SENT pose is within 3 m of (x, z): what the server checks against. */
  const posted = (p, x, z) => p.waitForFunction((x, z) => { const L = window.__oth.coop['last'].p; return Math.hypot(L.x - x, L.z - z) < 3 }, { timeout: 8000, polling: 100 }, x, z).catch(() => {})
  const tree = await pb.evaluate(() => {
    const o = window.__oth, p = o.hero.pos, i = o.world.trees.nearestIndex(p.x, p.z, 200)
    if (i < 0) return null
    const t = o.world.trees.treeAt(i)
    return { i, x: t.x, z: t.z, h: t.h }
  })
  await Promise.all([
    (async () => { await sleep(600); for (let k = 0; k < 6; k++) { await aimAt(pa, 'Ravi'); await tap(pa); await sleep(350); if ((await view(pb, 'Ravi')).hp < 100) break } })(),
    (async () => { if (tree) { await sleep(2500); await pb.evaluate((t) => window.__oth.hero.appear(t.x + 1.6, t.z, 0), tree); await posted(pb, tree.x + 1.6, tree.z); await sleep(200); await pb.evaluate((t) => window.__oth.coop.session.ask({ t: 'cut_tree', tree: t.i, x: t.x, z: t.z, h: t.h }).catch((e) => e.message), tree) } })(),
    (async () => { await pc.evaluate(async () => { const o = window.__oth, p = o.hero.pos, S = o.coop.session; for (const [dx, dz] of [[20, 0], [-20, 0], [0, 20], [0, -20], [30, 30]]) { try { await S.ask({ t: 'claim', x: p.x + dx, z: p.z + dz, r: 14 }); return } catch { /* try another */ } } }) })(),
  ])
  await sleep(1500)
  console.log('A fired:', JSON.stringify(await stats(pa)), 'refused:', JSON.stringify(await pa.evaluate(() => window.__no)))
  g = await agree('Ravi', 'hp')
  chk(g.same && g.vals.B < 100 && g.vals.B > 0, `all agree on B's health after A's pistol hits (${JSON.stringify(g.vals)})`)
  // (B back where the fight is, for what follows)
  await pb.evaluate((a) => window.__oth.hero.appear(a.x - Math.sin(a.h) * 12, a.z - Math.cos(a.h) * 12, a.h + Math.PI), A0)
  await sleep(1500)
  if (tree) {
    const st = await Promise.all([pa, pb, pc].map((p) => p.evaluate((i) => window.__oth.coop.session.stumps.has(i), tree.i)))
    chk(st.every(Boolean), `the tree B felled is down on every screen (${st})`)
  }
  const cl = await Promise.all([pa, pb, pc].map((p) => p.evaluate(() => [...window.__oth.coop.session.claims.values()].map((c) => c.owner_name).join(','))))
  chk(cl.every((c) => c === cl[0] && c.includes('Chen')), `C's land is on every screen (${JSON.stringify(cl)})`)
  // A's car takes a blow (parked where A got out): all three see the same dent
  console.log('A before the blow:', JSON.stringify(await pa.evaluate(() => { const o = window.__oth, c = o.car; return { damage: !!c.damage, onFoot: o.onFoot, parked: c.parked, id: c.id, kmh: +c.speedKmh.toFixed(1) } })))
  await pa.evaluate(() => window.__oth.car.damage?.hit(0.4, 0.7, -2.0, 0, 0, 1, 14, 'crash'))
  await sleep(1200)
  g = await agree('Asha', 'dmg')
  chk(g.same && g.vals.A > 0, `all agree on A's car's dents (${JSON.stringify(g.vals)})`)
  // C and A both fire at B at once: B goes down; all agree, B's health 0
  await pc.evaluate(() => { window.__oth.arsenal.ammo.ak47 = [30, 90] })
  await Promise.all([
    (async () => { await aimAt(pc, 'Ravi'); await pc.keyboard.down('KeyJ'); for (let k = 0; k < 10; k++) { await aimAt(pc, 'Ravi'); await sleep(100) } await pc.keyboard.up('KeyJ') })(),
    (async () => { for (let k = 0; k < 3; k++) { await aimAt(pa, 'Ravi'); await tap(pa); await sleep(300) } })(),
  ])
  await sleep(800)
  console.log('A, C fired:', JSON.stringify(await stats(pa)), JSON.stringify(await stats(pc)), 'refused:', JSON.stringify(await pa.evaluate(() => window.__no)), JSON.stringify(await pc.evaluate(() => window.__no)))
  g = await agree('Ravi', 'down')
  chk(g.same && g.vals.B === true, `two shooting at once: all agree B is down (${JSON.stringify(g.vals)})`)
  // D JOINS LATE: told A's pistol, C's AK-47, A's dented car, the felled tree, C's land, that B is down
  const pd = await open(accts[3])
  await sleep(3500)
  const dv = { A: await view(pd, 'Asha'), C: await view(pd, 'Chen'), B: await view(pd, 'Ravi') }
  const aSelf = await view(pa, 'Asha')
  console.log('D, late, sees:', JSON.stringify(dv))
  chk(dv.A?.weapon === 'pistol' && dv.C?.weapon === 'ak47', 'D (late) sees the weapons in A\'s and C\'s hands')
  chk(Math.abs((dv.A?.dmg ?? 0) - aSelf.dmg) < 0.05 * Math.max(1, aSelf.dmg), `D (late) sees A's car as dented as A does (${dv.A?.dmg} / ${aSelf.dmg})`)
  if (tree) chk(await pd.evaluate((i) => window.__oth.coop.session.stumps.has(i), tree.i), 'D (late) sees the felled tree')
  chk(await pd.evaluate(() => [...window.__oth.coop.session.claims.values()].some((c) => c.owner_name === 'Chen')), "D (late) sees C's land")
  chk(dv.B?.down === true || dv.B?.hp === 100, `D (late) sees B down — or already up (${JSON.stringify(dv.B)})`)
  // B up again; B RELOADS: the others see them go and come back; they're as hurt as they were
  for (let i = 0; i < 30; i++) { await sleep(300); if (!(await pb.evaluate(() => window.__oth.coop.session.down))) break }
  // (B, up again, is back by B's own car: put on the open ground again, 12 m before A — a car between takes the bullets)
  await pa.evaluate((a) => window.__oth.hero.appear(a.x, a.z, a.h), A0)
  await pb.evaluate((a) => window.__oth.hero.appear(a.x - Math.sin(a.h) * 12, a.z - Math.cos(a.h) * 12, a.h + Math.PI), A0)
  await posted(pb, A0.x - Math.sin(A0.h) * 12, A0.z - Math.cos(A0.h) * 12)
  await pa.evaluate(() => { window.__oth.arsenal.equip('pistol'); window.__oth.arsenal.ammo.pistol = [17, 68] })
  for (let k = 0; k < 8; k++) { await aimAt(pa, 'Ravi'); await tap(pa); await sleep(400); if ((await view(pb, 'Ravi')).hp < 100) break }
  await sleep(400)
  const hpBefore = await pb.evaluate(() => window.__oth.coop.session.hp)
  console.log('A shot at B before the reload:', JSON.stringify(await stats(pa)), 'refused:', JSON.stringify(await pa.evaluate(() => window.__no)), 'B:', JSON.stringify(await pb.evaluate(() => ({ onFoot: window.__oth.onFoot, down: window.__oth.coop.session.down, hp: window.__oth.coop.session.hp }))))
  await pb.reload({ waitUntil: 'load' })
  await pb.waitForFunction(() => window.__oth?.ready && window.__oth.coop, { timeout: 180_000, polling: 250 })
  await sleep(2500)
  const hpAfter = await pb.evaluate(() => window.__oth.coop.session.hp)
  chk(hpBefore < 100 && hpAfter === hpBefore, `B reloads: as hurt as before (${hpBefore} → ${hpAfter})`)
  const seesB = await Promise.all([pa, pc, pd].map((p) => sidOf(p, 'Ravi')))
  chk(seesB.every((s) => s > 0), `A, C and D have B again after the reload (${seesB})`)
  const bSees = await pb.evaluate(() => ({ claims: window.__oth.coop.session.claims.size, others: window.__oth.coop.session.remotes.size, aw: [...window.__oth.coop.session.remotes.values()].find((r) => r.name === 'Asha')?.weapon }))
  chk(bSees.others === 3 && bSees.claims >= 1 && bSees.aw === 'pistol', `B, back, sees the three others, the land, A's pistol (${JSON.stringify(bSees)})`)
  await pa.screenshot({ path: `${out}/a_end.png` })
  await pd.screenshot({ path: `${out}/d_late.png` })
  return ok
}
