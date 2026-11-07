import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

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

export default defineConfig({
  worker: { format: 'es' },
  resolve: { alias: [{ find: /^playcanvas$/, replacement: pcBuild }] },
  // (each build its own pre-bundled copy: two dev servers, one of each, never serve each other's)
  cacheDir: process.env.PCDEBUG === '1' ? 'node_modules/.vite-dbg' : 'node_modules/.vite',
  server: { https },
  preview: { https },
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
