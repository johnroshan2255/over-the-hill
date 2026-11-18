import fs from 'node:fs'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

// THE BIG BINARIES PACKED (2026-11-18, the user: "check the initial download, make sure it's low"): every .glb and
// .wasm the bundle emits, over 32 kB and at least 8 % smaller gzipped, is written GZIPPED under its own name — the game
// unpacks what starts with gzip's magic (src/oth/gfx/gltf.ts `unpacked`: every model goes through GLTFLoader.parse,
// naga's WebAssembly through core.ts). Hosts compress scripts; few compress .glb — the 4×4 went out as 2.3 MB (0.74
// packed), naga as 2.1 (0.76). PACK=0: off. (public/ is copied as it is: the cave's and the places' Draco files gain
// nothing; PlayCanvas fetches Draco's own .wasm itself.)
function packAssets(): Plugin {
  return {
    name: 'oth-pack-assets',
    apply: 'build',
    generateBundle(_o, bundle) {
      if (process.env.PACK === '0') return
      let n = 0, before = 0, after = 0
      for (const f of Object.values(bundle)) {
        if (f.type !== 'asset' || !/\.(glb|wasm)$/.test(f.fileName)) continue
        const src = typeof f.source === 'string' ? Buffer.from(f.source) : Buffer.from(f.source)
        if (src.length < 32768) continue
        const gz = zlib.gzipSync(src, { level: 9 })
        if (gz.length > src.length * 0.92) continue
        f.source = gz
        n++; before += src.length; after += gz.length
      }
      console.log(`\npacked ${n} models / wasm: ${(before / 1e6).toFixed(1)} → ${(after / 1e6).toFixed(1)} MB`)
    },
  }
}

// LAN=1 (npm run dev:lan / preview:lan): HTTPS with the self-signed certificate in .cert/ (made with openssl, not in
// git) — a phone or another PC on the Wi-Fi gets WebGPU only in a secure context (https, or localhost)
const cert = new URL('.cert/', import.meta.url)
const https = process.env.LAN === '1' && fs.existsSync(new URL('key.pem', cert))
  ? { key: fs.readFileSync(new URL('key.pem', cert)), cert: fs.readFileSync(new URL('cert.pem', cert)) }
  : undefined

// PLAYCANVAS'S RELEASE BUILD, in dev too (2026-11-07): its package's 'development' export is the DEBUG build — an error
// scope round every GPU call, the vertex buffers validated, the uniforms checked each draw — ~1 ms of a 2.9 ms frame on
// the Windows PC (docs/PERF.md); and its modular release folder was incomplete here, so `vite build` failed. The
// single-file release build serves both. PCDEBUG=1 npm run dev: the debug build (its warnings) when you need them.
const pcBuild = fileURLToPath(new URL(`node_modules/playcanvas/build/${process.env.PCDEBUG === '1' ? 'playcanvas.dbg.mjs' : 'playcanvas.mjs'}`, import.meta.url))

// RAPIER'S WEBASSEMBLY OUT OF ITS SCRIPT (the same day): the -compat build carries its 3.1 MB .wasm as a base64
// string inside the JavaScript — 4.1 MB of text that gzips to 1.6 MB (base64 hides the bytes' patterns) and then sits
// in the page's memory for good. In the build its `toByteArray("…").buffer` becomes a fetch of the same bytes, emitted
// as a file of their own (packAssets gzips it: 1.2 MB; unpacked by its magic, as gltf.ts `unpacked` does). The dev
// server and the node tests keep the package as it is; if the package's text ever stops matching, it's left alone
// and the build says so.
function rapierWasm(): Plugin {
  return {
    name: 'oth-rapier-wasm',
    apply: 'build',
    transform(code, id) {
      if (!/@dimforge[\\/]rapier3d-compat[\\/]dist[\\/]rapier\.mjs/.test(id)) return null
      const m = /([\w$]+)\.toByteArray\("([A-Za-z0-9+/=]{100000,})"\)\.buffer/.exec(code)
      if (!m) { this.warn('rapier3d-compat: the inlined WebAssembly was not found — left as it is (base64 in the script)'); return null }
      const wasm = Buffer.from(m[2], 'base64')
      if (wasm.readUInt32BE(0) !== 0x0061736d) { this.warn('rapier3d-compat: the inlined string is not WebAssembly — left as it is'); return null }
      const ref = this.emitFile({ type: 'asset', name: 'rapier.wasm', source: wasm })
      const load = `(yield fetch(import.meta.ROLLUP_FILE_URL_${ref}).then((r)=>{if(!r.ok)throw new Error("rapier.wasm: "+r.status);return r.arrayBuffer()}).then((b)=>new DataView(b).getUint16(0)===0x1f8b?new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer():b))`
      return { code: code.slice(0, m.index) + load + code.slice(m.index + m[0].length), map: null }
    },
  }
}

export default defineConfig({
  plugins: [rapierWasm(), packAssets()],
  worker: { format: 'es' },
  resolve: { alias: [{ find: /^playcanvas$/, replacement: pcBuild }] },
  // (each build its own pre-bundled copy: two dev servers, one of each, never serve each other's)
  cacheDir: process.env.PCDEBUG === '1' ? 'node_modules/.vite-dbg' : 'node_modules/.vite',
  // THE SERVER (backend/, Rust — docs/MULTIPLAYER.md): /v1 (its API and the worlds' WebSockets) passed through to it, so
  // the game talks to the page's own origin (a phone on the LAN too); OVERHILL_SERVER= another address
  server: { https, proxy: { '/v1': { target: process.env.OVERHILL_SERVER ?? 'http://127.0.0.1:5280', ws: true, changeOrigin: true } }, fs: { allow: ['..'] } },
  preview: { https, proxy: { '/v1': { target: process.env.OVERHILL_SERVER ?? 'http://127.0.0.1:5280', ws: true, changeOrigin: true } } },

  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        // (rapier's wasm and three in their own chunks: cached across releases that only touch the game's code)
        manualChunks(id) {
          if (id.includes('@dimforge/rapier3d')) return 'rapier'
          if (id.includes('/three/')) return 'three'
        },
      },
    },
  },
})
