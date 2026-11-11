// THE WALLS ANTI-ALIASED (2026-11-11, the user: "the lines and the repeated M shape pattern … all over the unlocked
// maps"): the outland's cliffs (the gorges' cuts, the canyon, the mesa, the terraces, the roads' deep banks) fall
// 40–160 m in ~10 m — one 8 m cell of the world's grid (far.bin). Where such a wall runs ACROSS the grid, each cell's
// bilinear patch (the ground's vertex shader, MapData.height, the physics' tiles — all the same) kinks a different way:
// the wall's top and foot became a row of spikes, an M after an M along every diagonal cliff.
//
// The cure is in the data: no two neighbouring cells may differ by more than T × their distance (T = 2.2: 65°) — the
// excess slides down (thermal erosion: what leaves the top is laid at the foot, the volume kept), so a wall is a few
// cells wide and its faces near-planar, which bilinear interpolation draws exactly: no spikes. Walls stay walls (65°
// over 40–160 m), the rim moves back ~7 m, the foot out as much.
//
// Kept exactly as they were (weight 0, eased to 1 over the next 16 m): the box and its 24 m seam; every outland road
// within 15 m of its centre line (the bed, the bilinear support of its ±3.3 m) — the bot drove these; the outland
// bridges' ends (20 m) and no ground raised under a deck; the canyon's fall (lip and foot, 60 m), the Skyfall Overlook's
// deck, the Giant's Gate, the World Tree, the ranger towers, the view points; a lake's shore never lowered under its
// water (+0.5 m).
//
//   node scripts/oth/walls.mjs [C=10] [WRITE=0]
// Reads far.bin as it was before (scripts/oth/.cache/valley-prewalls/far.bin — saved there on the first run), writes
// public/oth/valley/far.bin. RE-RUN AFTER wilds.py (delete .cache/valley-prewalls first: its far.bin is then stale).
import fs from 'node:fs'
import path from 'node:path'

const env = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')))
const C = Number(env.C ?? 10)
const WRITE = env.WRITE !== '0'
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..')
const DIR = path.join(ROOT, 'public/oth/valley')
const CACHE = path.join(ROOT, 'scripts/oth/.cache/valley-prewalls')
const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'meta.json'), 'utf8'))
const t0 = performance.now()
const log = (...a) => console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s]`, ...a)

if (!fs.existsSync(path.join(CACHE, 'far.bin'))) {
  fs.mkdirSync(CACHE, { recursive: true })
  fs.copyFileSync(path.join(DIR, 'far.bin'), path.join(CACHE, 'far.bin'))
  log('saved the walls-free far.bin to', CACHE)
}
const F = meta.far, n = F.n, step = F.step, origin = F.origin
const raw = new Uint16Array(fs.readFileSync(path.join(CACHE, 'far.bin')).buffer.slice(0))
if (raw.length !== n * n) throw new Error(`far.bin: ${raw.length} cells, meta says ${n}²`)
const H = new Float64Array(n * n)
for (let k = 0; k < n * n; k++) H[k] = (raw[k] / 65535) * F.range + F.min
const H0 = H.slice()
const X = (i) => origin + i * step

// ------------------------------------------------------------------------------------------------ what's kept
const W = new Float32Array(n * n).fill(1)
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const keep = (x, z, r, ease = 16) => {   // a disc kept (r m) and eased back to free over `ease` m
  const R = r + ease, i0 = Math.max(0, Math.floor((x - R - origin) / step)), i1 = Math.min(n - 1, Math.ceil((x + R - origin) / step))
  const j0 = Math.max(0, Math.floor((z - R - origin) / step)), j1 = Math.min(n - 1, Math.ceil((z + R - origin) / step))
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(X(i) - x, X(j) - z), k = j * n + i
    W[k] = Math.min(W[k], ss(r, R, d))
  }
}
const segKeep = (ax, az, bx, bz, r, ease = 16) => {
  const L = Math.hypot(bx - ax, bz - az), m = Math.max(1, Math.ceil(L / 4))
  for (let s = 0; s <= m; s++) keep(ax + ((bx - ax) * s) / m, az + ((bz - az) * s) / m, r, ease)
}
// the box and its seam (the far grid's box cells are the box's own heights)
const HALF = 2048, PLAY = meta.outland.play ?? 6144   // (and the land beyond the playable part: seen from kilometres off, under the haze)
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
  const e = Math.max(Math.abs(X(i)), Math.abs(X(j)))
  W[j * n + i] = Math.min(W[j * n + i], ss(HALF + 24, HALF + 40, e), 1 - ss(PLAY + 200, PLAY + 400, e))
}
const O = meta.outland
for (const line of O.trails.lines) for (let s = 1; s < line.length; s++) segKeep(line[s - 1][0], line[s - 1][1], line[s][0], line[s][1], 15)
const decks = []
for (const b of meta.bridges ?? []) if (b.outland) { keep(b.x0, b.z0, 20); keep(b.x1, b.z1, 20); decks.push(b) }
for (const f of meta.water.falls ?? []) if (f.outland) { keep(f.x, f.z, 60); keep(f.bx, f.bz, 40); segKeep(f.x, f.z, f.bx, f.bz, 30) }
for (const p of O.places) {
  if (p.kind === 'view') keep(p.x, p.z, p.deck ? 45 : 30)
  else if (p.kind === 'arch') keep(p.x, p.z, 70)
  else if (p.kind === 'worldtree') keep(p.x, p.z, 70)
}
for (const l of meta.landmarks ?? []) if (l.outland) keep(l.x, l.z, 25)
for (const st of O.stages ?? []) { /* (their gates and boards stand on their roads: kept with them) */ }

// ------------------------------------------------------------------------------------------------ the bend limited
// (each cell's bend along the two axes and the two diagonals — H[k+o] + H[k−o] − 2 H[k] — held to C (×2 on a
// diagonal: its cells are √2 apart); a cell over it moves halfway to what would meet it. Gauss–Seidel, in place, on a
// frontier: a cell that moved wakes its neighbours. A smooth flank, however steep (Raven Peak falls 40 m a cell), bends
// little: it is left as it is)
const OFF = [1, n, n + 1, n - 1]
const LIMC = [C, C, 2 * C, 2 * C]
const bend = (k) => {
  let worst = 0, q = -1
  for (let o = 0; o < 4; o++) {
    const e = H[k + OFF[o]] + H[k - OFF[o]] - 2 * H[k], ex = Math.abs(e) - LIMC[o]
    if (ex > worst) { worst = ex; q = o }
  }
  return [worst, q]
}
let front = [], mark = new Uint8Array(n * n)
for (let j = 2; j < n - 2; j++) for (let i = 2; i < n - 2; i++) { const k = j * n + i; if (W[k] > 0 && bend(k)[0] > 0) { front.push(k); mark[k] = 1 } }
log(`C ${C} m a cell (${(C / step / step).toFixed(3)} /m): ${front.length} cells over it (${(front.length / (n * n) * 100).toFixed(2)} %)`)
let it = 0, worst = Infinity
for (; it < 1500 && front.length; it++) {
  const next = []
  worst = 0
  for (const k of front) mark[k] = 0
  for (const k of front) {
    const w = W[k]
    if (w <= 0) continue
    let moved = 0
    for (let o = 0; o < 4; o++) {
      const e = H[k + OFF[o]] + H[k - OFF[o]] - 2 * H[k], ex = Math.abs(e) - LIMC[o]
      if (ex <= 0.02) continue
      if (w > 0.5 && ex > worst) worst = ex
      const t = 0.5 * ex * Math.sign(e) * 0.5 * w   // (half of what would meet it, eased: the frontier comes back)
      H[k] += t; moved += Math.abs(t)
    }
    if (moved > 0.005) for (const d of [0, 1, -1, n, -n, n + 1, n - 1, -n + 1, -n - 1]) {
      const m = k + d, ii = m % n, jj = (m / n) | 0
      if (!mark[m] && ii >= 2 && jj >= 2 && ii < n - 2 && jj < n - 2 && W[m] > 0) { mark[m] = 1; next.push(m) }
    }
  }
  front = next
  if (it % 100 === 0) log(`  pass ${it}: ${front.length} cells moving, the worst bend over ${worst.toFixed(2)} m`)
}
log(`${it} passes, the worst bend left ${worst.toFixed(2)} m over`)

// ------------------------------------------------------------------------------------------------ the guards
let lakeFix = 0, deckFix = 0
for (const L of O.lakes ?? []) {
  const x1 = L.x1 ?? L.x, z1 = L.z1 ?? L.z, R = L.r
  const i0 = Math.max(0, Math.floor((Math.min(L.x, x1) - R - origin) / step)), i1 = Math.min(n - 1, Math.ceil((Math.max(L.x, x1) + R - origin) / step))
  const j0 = Math.max(0, Math.floor((Math.min(L.z, z1) - R - origin) / step)), j1 = Math.min(n - 1, Math.ceil((Math.max(L.z, z1) + R - origin) / step))
  const bx = x1 - L.x, bz = z1 - L.z, bb = Math.max(bx * bx + bz * bz, 1e-4)
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const px = X(i) - L.x, pz = X(j) - L.z, t = Math.min(1, Math.max(0, (px * bx + pz * bz) / bb))
    if (Math.hypot(px - bx * t, pz - bz * t) > R) continue
    const k = j * n + i, lv = L.level + 0.5
    if (H0[k] >= lv && H[k] < lv) { H[k] = lv; lakeFix++ }
  }
}
for (const b of decks) {
  const L = Math.hypot(b.x1 - b.x0, b.z1 - b.z0), ux = (b.x1 - b.x0) / L, uz = (b.z1 - b.z0) / L, hw = b.w / 2 + 3
  const i0 = Math.max(0, Math.floor((Math.min(b.x0, b.x1) - hw - origin) / step)), i1 = Math.min(n - 1, Math.ceil((Math.max(b.x0, b.x1) + hw - origin) / step))
  const j0 = Math.max(0, Math.floor((Math.min(b.z0, b.z1) - hw - origin) / step)), j1 = Math.min(n - 1, Math.ceil((Math.max(b.z0, b.z1) + hw - origin) / step))
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const px = X(i) - b.x0, pz = X(j) - b.z0, s = px * ux + pz * uz
    if (s < -4 || s > L + 4 || Math.abs(-px * uz + pz * ux) > hw) continue
    const y = (b.y0 ?? b.y) + ((b.y1 ?? b.y) - (b.y0 ?? b.y)) * Math.min(1, Math.max(0, s / L)) - 0.4, k = j * n + i
    if (H[k] > Math.max(H0[k], y)) { H[k] = Math.max(H0[k], y); deckFix++ }
  }
}
log(`guards: ${lakeFix} shore cells held over their water, ${deckFix} cells held under a deck`)

// ------------------------------------------------------------------------------------------------ the report
let moved = 0, sum = 0, mx = 0, after = 0
for (let k = 0; k < n * n; k++) { const d = Math.abs(H[k] - H0[k]); if (d > 0.05) { moved++; sum += d; if (d > mx) mx = d } }
let afterFree = 0
for (let j = 2; j < n - 2; j++) for (let i = 2; i < n - 2; i++) if (bend(j * n + i)[0] > 0.5) { after++; if (W[j * n + i] > 0.99) afterFree++ }
{ const big = []; for (let k = 0; k < n * n; k++) { const d = H[k] - H0[k]; if (Math.abs(d) > 40) big.push([Math.round(X(k % n)), Math.round(X((k / n) | 0)), Math.round(d)]) } big.sort((a, b) => Math.abs(b[2]) - Math.abs(a[2])); log(`moved > 40 m: ${big.length} cells; the most: ${JSON.stringify(big.slice(0, 8))}`) }
log(`${moved} cells moved (${(moved * step * step / 1e6).toFixed(1)} km²), by ${(sum / Math.max(1, moved)).toFixed(2)} m on average, ${mx.toFixed(1)} m at most; ${after} cells still bent over the limit (kept ones), ${afterFree} of them free`)
if (WRITE) {
  const out = new Uint16Array(n * n)
  for (let k = 0; k < n * n; k++) out[k] = Math.max(0, Math.min(65535, Math.round(((H[k] - F.min) / F.range) * 65535)))
  fs.writeFileSync(path.join(DIR, 'far.bin'), Buffer.from(out.buffer))
  log('wrote', path.join(DIR, 'far.bin'))
}
