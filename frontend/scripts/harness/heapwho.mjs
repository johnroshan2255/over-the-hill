// heapwho.mjs <file.heapsnapshot> — WHO HOLDS IT: a breadth-first walk from the snapshot's roots (the shortest way to
// every object), then the self size of one kind of node (KIND: a substring of "type name", default the ArrayBuffers'
// bytes) summed by the named part of that way (the last DEPTH property / variable names). env KIND, DEPTH (4), TOP (60)
//   node --max-old-space-size=12000 scripts/harness/heapwho.mjs game.heapsnapshot
import fs from 'node:fs'
const s = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const KIND = process.env.KIND ?? 'JSArrayBufferData', DEPTH = Number(process.env.DEPTH || 4), TOP = Number(process.env.TOP || 60)
const m = s.snapshot.meta, NF = m.node_fields.length, EF = m.edge_fields.length
const types = m.node_types[0], etypes = m.edge_types[0], strs = s.strings, N = s.nodes, E = s.edges
const iT = m.node_fields.indexOf('type'), iN = m.node_fields.indexOf('name'), iS = m.node_fields.indexOf('self_size'), iE = m.node_fields.indexOf('edge_count')
const eT = m.edge_fields.indexOf('type'), eN = m.edge_fields.indexOf('name_or_index'), eTo = m.edge_fields.indexOf('to_node')
const n = N.length / NF, first = new Uint32Array(n + 1)
for (let i = 0, e = 0; i < n; i++) { first[i] = e; e += N[i * NF + iE] } first[n] = E.length / EF
const par = new Int32Array(n).fill(-1), pedge = new Int32Array(n).fill(-1), q = new Uint32Array(n)
let qh = 0, qt = 0
q[qt++] = 0; par[0] = 0
while (qh < qt) {
  const i = q[qh++]
  for (let e = first[i]; e < first[i + 1]; e++) {
    const t = etypes[E[e * EF + eT]]
    if (t === 'weak' || t === 'shortcut') continue
    const to = E[e * EF + eTo] / NF
    if (par[to] >= 0) continue
    par[to] = i; pedge[to] = e; q[qt++] = to
  }
}
const ename = (e) => { const t = etypes[E[e * EF + eT]], v = E[e * EF + eN]; return t === 'element' ? '[]' : t === 'hidden' || t === 'internal' ? null : strs[v] }
const SKIP = new Set(['backing_store', 'buffer', 'elements', 'context', 'table', 'properties', 'array', 'value', 'map', 'prototype', 'shared', 'script'])
const by = new Map()
let total = 0
for (let i = 0; i < n; i++) {
  const key0 = `${types[N[i * NF + iT]]} ${strs[N[i * NF + iN]]}`
  if (!key0.includes(KIND)) continue
  const sz = N[i * NF + iS]; total += sz
  const parts = []
  for (let j = i, d = 0; j > 0 && par[j] >= 0 && parts.length < DEPTH && d < 60; j = par[j], d++) {
    const nm = ename(pedge[j]); if (nm === null || SKIP.has(nm)) continue
    if (nm === '[]' && parts[parts.length - 1] === '[]') continue
    parts.push(nm)
  }
  if (par[i] < 0) parts.push('(unreached)')
  const key = parts.reverse().join('.')
  const r = by.get(key) ?? [0, 0]; r[0] += sz; r[1]++; by.set(key, r)
}
const mb = (x) => (x / 1048576).toFixed(1).padStart(7)
console.log(`${KIND}: ${mb(total)} MB`)
for (const [k, [sz, c]] of [...by].sort((a, b) => b[1][0] - a[1][0]).slice(0, TOP)) console.log(`${mb(sz)} MB ${String(c).padStart(7)}×  ${k}`)
