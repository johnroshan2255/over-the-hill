import fs from 'node:fs'
import { defineConfig } from 'vite'

// LAN=1 (npm run dev:lan / preview:lan): HTTPS with the self-signed certificate in .cert/ (made with openssl, not in
// git) — a phone or another PC on the Wi-Fi gets WebGPU only in a secure context (https, or localhost)
const cert = new URL('.cert/', import.meta.url)
const https = process.env.LAN === '1' && fs.existsSync(new URL('key.pem', cert))
  ? { key: fs.readFileSync(new URL('key.pem', cert)), cert: fs.readFileSync(new URL('cert.pem', cert)) }
  : undefined

export default defineConfig({
  worker: { format: 'es' },
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
