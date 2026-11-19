// THE WEAPONS' NUMBERS, out of their spec files: each docs/weapons/*.md ends in a fenced ```json block — the numbers
// the game reads (docs/WEAPONS.md). This collects them into proto/weapons.json, which the game
// (src/oth/weapons.ts) and the server load: one set of numbers, the spec's.
//   node scripts/oth/weapons.mjs          (in frontend/; --check: fails if proto/weapons.json is out of date)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const docs = path.resolve(here, '../../../docs/weapons'), out = path.resolve(here, '../../../proto/weapons.json')
const TICK_HZ = 20
const weapons = {}
for (const f of fs.readdirSync(docs).filter((f) => f.endsWith('.md')).sort()) {
  const md = fs.readFileSync(path.join(docs, f), 'utf8')
  const blocks = [...md.matchAll(/```json\n([\s\S]*?)```/g)]
  if (!blocks.length) throw new Error(`${f}: no json block`)
  const w = JSON.parse(blocks[blocks.length - 1][1])
  if (!w.id || weapons[w.id]) throw new Error(`${f}: no id, or the id twice`)
  // every time is a whole number of ticks
  const walk = (o, at) => { for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object') walk(v, `${at}.${k}`); else if (/Ticks$/.test(k) && (!Number.isInteger(v) || v < 0)) throw new Error(`${f}: ${at}.${k} = ${v} is not a whole number of ticks`) } }
  walk(w, w.id)
  for (const c of w.cuts ?? []) for (const k of ['windup', 'edge', 'recover']) if (!Number.isInteger(c[k])) throw new Error(`${f}: cut ${c.id}.${k} is not a whole number of ticks`)
  weapons[w.id] = { ...w, spec: `docs/weapons/${f}` }
}
const json = JSON.stringify({ tickHz: TICK_HZ, health: 100, zones: { head: 1.52, limb: 0.9 }, order: ['pistol', 'ak47', 'sniper', 'katana'], weapons }, null, 2) + '\n'
if (process.argv.includes('--check')) {
  if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== json) { console.error('proto/weapons.json is out of date: node scripts/oth/weapons.mjs'); process.exit(1) }
  console.log('proto/weapons.json is up to date')
} else {
  fs.writeFileSync(out, json)
  console.log(`proto/weapons.json: ${Object.keys(weapons).join(', ')}`)
  for (const w of Object.values(weapons)) if (w.kind === 'gun') console.log(`  ${w.name.padEnd(13)} ${w.auto ? 'auto' : 'single'}  1 shot / ${w.fireTicks} ticks = ${(w.fireTicks * 1000) / TICK_HZ} ms (${Math.round((60 * TICK_HZ) / w.fireTicks)} a minute)  reload ${w.reloadTicks / TICK_HZ} s  ${w.magazine} + ${w.reserve}`)
}
