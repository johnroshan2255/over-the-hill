// THE CAR DAMAGE'S NUMBERS, out of its spec: docs/DAMAGE.md ends its "numbers" section in a fenced ```json block — what
// the game reads. This writes it to proto/damage.json, which the game (src/oth/Damage.ts) and, later, the server load:
// one set of numbers, the spec's.
//   node scripts/oth/damage.mjs          (in frontend/; --check: fails if proto/damage.json is out of date)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const doc = path.resolve(here, '../../../docs/DAMAGE.md'), out = path.resolve(here, '../../../proto/damage.json')
const TICK_HZ = 20
const md = fs.readFileSync(doc, 'utf8')
const blocks = [...md.matchAll(/```json\n([\s\S]*?)```/g)]
if (!blocks.length) throw new Error('docs/DAMAGE.md: no json block')
const d = JSON.parse(blocks[blocks.length - 1][1])
if (d.id !== 'damage') throw new Error('docs/DAMAGE.md: the json block is not the damage\'s')
// every time is a whole number of ticks; the engine's power table falls with its health
const walk = (o, at) => { for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, `${at}.${k}`); else if (/Ticks$/.test(k) && (!Number.isInteger(v) || v < 0)) throw new Error(`${at}.${k} = ${v} is not a whole number of ticks`) } }
walk(d, 'damage')
const P = d.engine.power
for (let i = 1; i < P.length; i++) if (!(P[i][0] < P[i - 1][0] && P[i][1] <= P[i - 1][1])) throw new Error('engine.power: health and power must fall together')
if (!(d.engine.steamAt > d.engine.smokeAt && d.engine.smokeAt > d.engine.misfireAt && d.engine.misfireAt > d.engine.fireAt)) throw new Error('engine: steamAt > smokeAt > misfireAt > fireAt')
const json = JSON.stringify({ tickHz: TICK_HZ, ...d, spec: 'docs/DAMAGE.md' }, null, 2) + '\n'
if (process.argv.includes('--check')) {
  if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== json) { console.error('proto/damage.json is out of date: node scripts/oth/damage.mjs'); process.exit(1) }
  console.log('proto/damage.json is up to date')
} else {
  fs.writeFileSync(out, json)
  const kmh = (v) => Math.round(v * 3.6)
  console.log('proto/damage.json:')
  console.log(`  a crash from ${d.crash.minDv} m/s of ΔV in a step (${kmh(d.crash.minDv)} km/h)`)
  for (const v of [5, 10, 14, 20, 28]) {
    const r = Math.min(d.deform.radius.max, d.deform.radius.base + d.deform.radius.perDv * v), dep = Math.min(d.deform.maxPerHit, d.deform.depthPerDv * (v - d.crash.minDv))
    console.log(`  ΔV ${String(v).padStart(2)} m/s (${String(kmh(v)).padStart(3)} km/h): dent ${(dep * 100).toFixed(0).padStart(2)} cm deep, ${r.toFixed(2)} m round; engine −${Math.round(d.engine.bayDamagePerDv * (v - d.crash.minDv))} of ${d.engine.health} (in the bay); axle +${(d.wheel.bendPerDv * (v - d.crash.minDv) * 57.3).toFixed(1)}° at the wheel`)
  }
  console.log(`  burning ${d.engine.burnTicks / TICK_HZ} s before it goes up`)
}
