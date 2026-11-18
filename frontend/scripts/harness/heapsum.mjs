// heapsum.mjs <file.heapsnapshot> — a heap snapshot summed: self size by node type + constructor name, and the biggest
// single objects (with the first edge that holds them). node --max-old-space-size=8192 scripts/harness/heapsum.mjs <file>
import fs from 'node:fs'
const s = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const m = s.snapshot.meta, NF = m.node_fields.length, EF = m.edge_fields.length
const types = m.node_types[0], etypes = m.edge_types[0], strs = s.strings, N = s.nodes, E = s.edges
const iT = m.node_fields.indexOf('type'), iN = m.node_fields.indexOf('name'), iS = m.node_fields.indexOf('self_size'), iE = m.node_fields.indexOf('edge_count')
const eT = m.edge_fields.indexOf('type'), eN = m.edge_fields.indexOf('name_or_index'), eTo = m.edge_fields.indexOf('to_node')
const by = new Map(), big = [], n = N.length / NF
// (the parent of each node: the first edge into it — for the big ones' names)
const firstIn = new Int32Array(n).fill(-1), firstName = new Array(n)
for (let i = 0, e = 0; i < n; i++) {
  const ec = N[i * NF + iE]
  for (let k = 0; k < ec; k++, e += EF) {
    const to = E[e + eTo] / NF
    if (firstIn[to] < 0 && etypes[E[e + eT]] !== 'weak') { firstIn[to] = i; const t = etypes[E[e + eT]]; firstName[to] = t === 'element' || t === 'hidden' ? `[${E[e + eN]}]` : strs[E[e + eN]] }
  }
}
let total = 0
for (let i = 0; i < n; i++) {
  const t = types[N[i * NF + iT]], nm = strs[N[i * NF + iN]], sz = N[i * NF + iS]
  total += sz
  const key = `${t} ${t === 'object' || t === 'native' || t === 'closure' ? nm.slice(0, 60) : t === 'string' || t === 'concatenated string' || t === 'sliced string' ? '' : nm.slice(0, 40)}`
  const r = by.get(key) ?? [0, 0]; r[0] += sz; r[1]++; by.set(key, r)
  if (sz > 1 << 20) big.push([sz, i])
}
const mb = (x) => (x / 1048576).toFixed(1).padStart(7)
console.log(`total self ${mb(total)} MB over ${n} nodes`)
for (const [k, [sz, c]] of [...by].sort((a, b) => b[1][0] - a[1][0]).slice(0, Number(process.env.TOP || 45))) console.log(`${mb(sz)} MB ${String(c).padStart(9)}×  ${k}`)
console.log('\nbiggest single (> 1 MB):')
for (const [sz, i] of big.sort((a, b) => b[0] - a[0]).slice(0, 40)) {
  const chain = []; let j = i
  for (let d = 0; d < 6 && j >= 0; d++) { chain.push(`${firstName[j] ?? '?'}`); j = firstIn[j]; if (j >= 0) { const nm = strs[N[j * NF + iN]]; chain[chain.length - 1] += `<${types[N[j * NF + iT]] === 'object' ? nm.slice(0, 24) : types[N[j * NF + iT]]}>` } }
  console.log(`${mb(sz)} MB  ${types[N[i * NF + iT]]} ${strs[N[i * NF + iN]].slice(0, 30)}  ← ${chain.join(' ← ')}`)
}
