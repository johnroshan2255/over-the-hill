/**
 * THE MAPS' GRIDS, PACKED (scripts/oth/pack.mjs — 2026-11-17, the user: "we can't publish this game if its initial
 * download is too much"): a world's .bin grids are sent as .pk — gzip over a predictor's residuals — and turned back
 * here into the very same bytes (the packer checks that before it writes). The valley's 27 MB → 7 MB.
 *   kind 1, Uint16: the plane through the left, up and up-left samples predicts each one; the residual zig-zagged,
 *     its high bytes then its low bytes.
 *   kind 2, Uint8 × channels: each channel's left-neighbour delta, one channel after another.
 * The gzip is the browser's own (DecompressionStream): no library, in the map worker.
 */
export async function unpack(gz: ArrayBuffer): Promise<ArrayBuffer> {
  const raw = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
  const b = new Uint8Array(raw), dv = new DataView(raw)
  if (b[0] !== 0x4f || b[1] !== 0x48 || b[2] !== 0x50 || b[3] !== 0x4b) throw new Error('not a packed grid')
  const kind = b[5], ch = b[6], w = dv.getUint32(8, true), h = dv.getUint32(12, true), p = b.subarray(16), n = w * h
  if (kind === 1) {
    const a = new Uint16Array(n)
    for (let j = 0; j < h; j++) {
      const r = j * w
      for (let i = 0; i < w; i++) {
        const k = r + i, z = (p[k] << 8) | p[n + k], s = z & 1 ? -((z + 1) >> 1) : z >> 1
        const q = j === 0 ? (i === 0 ? 0 : a[k - 1]) : i === 0 ? a[k - w] : a[k - 1] + a[k - w] - a[k - w - 1]
        a[k] = (q + s) & 65535
      }
    }
    return a.buffer
  }
  const a = new Uint8Array(n * ch)
  for (let c = 0; c < ch; c++) {
    const src = p.subarray(c * n, (c + 1) * n)
    for (let j = 0; j < h; j++) {
      const r = j * w
      let prev = 0
      for (let i = 0; i < w; i++) { prev = (src[r + i] + prev) & 255; a[(r + i) * ch + c] = prev }
    }
  }
  return a.buffer
}

/** A world's grid file: its packed .pk if there is one, else the raw .bin (a bake not yet packed). */
export async function fetchGrid(base: string, file: string): Promise<ArrayBuffer> {
  const pk = await fetch(`${base}/${file.replace(/\.bin$/, '.pk')}`)
  if (pk.ok) return unpack(await pk.arrayBuffer())
  return (await fetch(`${base}/${file}`)).arrayBuffer()
}
