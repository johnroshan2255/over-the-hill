// pack.mjs — the maps' grids made small for the download (2026-11-17, the user: "we can't publish this game if its
// initial download is too much"): each .bin a world's loader reads → <name>.pk beside it, LOSSLESS (the game decodes
// it to the very same bytes: src/oth/pack.ts). 27 MB of the valley's grids sent raw → ~7 MB.
//   Uint16 heights (height.bin, far.bin): each sample predicted by the plane through its left, up and up-left
//     neighbours; the residual (16-bit, wrapped) zig-zagged, its high bytes then its low bytes — gzip.
//   Uint8 grids (mask, trail, mud: 1–4 channels): each channel's left-neighbour delta (8-bit, wrapped), one channel
//     after another — gzip.
// A .pk: gzip( 'OHPK' · u8 version 1 · u8 kind (1 u16, 2 u8) · u8 channels · u8 0 · u32 width · u32 height · payload ).
// Run after any bake that writes a .bin (terrain.py, outland.py, wilds.py, walls.mjs):
//   node scripts/oth/pack.mjs [public/oth/valley]      (checks each by decoding it back)
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ['public/oth/valley']

function header(kind, ch, w, h) {
  const b = Buffer.alloc(16)
  b.write('OHPK', 0, 'ascii'); b[4] = 1; b[5] = kind; b[6] = ch; b[7] = 0
  b.writeUInt32LE(w, 8); b.writeUInt32LE(h, 12)
  return b
}

function packU16(src, n) {
  const a = new Uint16Array(src.buffer, src.byteOffset, n * n), hi = new Uint8Array(n * n), lo = new Uint8Array(n * n)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i
    const p = j === 0 ? (i === 0 ? 0 : a[k - 1]) : i === 0 ? a[k - n] : a[k - 1] + a[k - n] - a[k - n - 1]
    const d = (((a[k] - p) % 65536) + 65536) % 65536, s = d >= 32768 ? d - 65536 : d   // (the residual, 16-bit signed)
    const z = s >= 0 ? s * 2 : -s * 2 - 1                                               // (zig-zag: small either way)
    hi[k] = z >> 8; lo[k] = z & 255
  }
  return Buffer.concat([header(1, 1, n, n), Buffer.from(hi), Buffer.from(lo)])
}

function packU8(src, w, h, ch) {
  const out = new Uint8Array(w * h * ch)
  for (let c = 0; c < ch; c++) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = (j * w + i) * ch + c, prev = i === 0 ? 0 : src[k - ch]
    out[c * w * h + j * w + i] = (src[k] - prev + 256) & 255
  }
  return Buffer.concat([header(2, ch, w, h), Buffer.from(out)])
}

// (the decoder, as src/oth/pack.ts has it — every file is checked by it before it's written)
function unpack(gz) {
  const b = zlib.gunzipSync(gz), kind = b[5], ch = b[6], w = b.readUInt32LE(8), h = b.readUInt32LE(12), p = b.subarray(16)
  if (kind === 1) {
    const a = new Uint16Array(w * h)
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i, z = (p[k] << 8) | p[w * h + k], s = z & 1 ? -((z + 1) >> 1) : z >> 1
      const q = j === 0 ? (i === 0 ? 0 : a[k - 1]) : i === 0 ? a[k - w] : a[k - 1] + a[k - w] - a[k - w - 1]
      a[k] = (q + s) & 65535
    }
    return Buffer.from(a.buffer)
  }
  const a = new Uint8Array(w * h * ch)
  for (let c = 0; c < ch; c++) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = (j * w + i) * ch + c
    a[k] = (p[c * w * h + j * w + i] + (i === 0 ? 0 : a[k - ch])) & 255
  }
  return Buffer.from(a.buffer)
}

for (const dir of dirs) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))
  const files = [['height.bin', 'u16', meta.inner.n], ['far.bin', 'u16', meta.far.n], ['mask.bin', 'u8', meta.mask.n], ['trail.bin', 'u8', meta.inner.n], ['mud.bin', 'u8', meta.mask.n]]
  let raw = 0, packed = 0
  for (const [f, kind, n] of files) {
    const p = path.join(dir, f)
    if (!fs.existsSync(p)) continue
    const src = fs.readFileSync(p)
    const body = kind === 'u16' ? packU16(src, n) : packU8(src, n, n, src.length / (n * n))
    const gz = zlib.gzipSync(body, { level: 9 })
    if (!unpack(gz).equals(src)) throw new Error(`${p}: the packed file doesn't decode to the same bytes`)
    fs.writeFileSync(p.replace(/\.bin$/, '.pk'), gz)
    raw += src.length; packed += gz.length
    console.log(`${p.padEnd(34)} ${(src.length / 1e6).toFixed(2).padStart(6)} MB → ${(gz.length / 1e6).toFixed(2).padStart(5)} MB`)
  }
  console.log(`${dir}: ${(raw / 1e6).toFixed(1)} MB → ${(packed / 1e6).toFixed(1)} MB (checked: decodes to the same bytes)`)
}
