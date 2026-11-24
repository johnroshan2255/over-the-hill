// lagproxy.mjs <listen port> <target port> <latency ms> <jitter ms> — A BAD LINE between the game and the server, for
// the co-op harnesses (syncplay.mjs LAGGY=): a TCP proxy that holds every chunk, each way, `latency` ms plus up to
// `jitter` more — in order, as TCP keeps it (a chunk never goes before the one ahead of it: a late one holds the rest
// back, as a real line's does). Point a second dev server at it:
//   node scripts/harness/lagproxy.mjs 5281 5280 80 60 &
//   OVERHILL_SERVER=http://127.0.0.1:5281 npx vite --port 5201 --strictPort &
import net from 'node:net'

const [listen, target, latency, jitter] = process.argv.slice(2).map(Number)
const delayed = (from, to) => {
  let last = 0
  from.on('data', (chunk) => {
    const now = Date.now(), at = Math.max(last, now + latency + Math.random() * jitter)
    last = at
    setTimeout(() => { if (!to.destroyed) to.write(chunk) }, at - now)
  })
  from.on('close', () => setTimeout(() => to.destroy(), latency + jitter + 50))
  from.on('error', () => {})
}
net.createServer((c) => {
  const s = net.connect(target, '127.0.0.1')
  delayed(c, s)
  delayed(s, c)
}).listen(listen, () => console.log(`lagproxy :${listen} → :${target}, ${latency} ms + up to ${jitter} ms each way`))
