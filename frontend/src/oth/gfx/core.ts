import * as pc from 'playcanvas'
import nagaWasm from 'naga-wasm/naga_bg.wasm?url'

/**
 * THE DEVICE (docs/MIGRATION.md): one PlayCanvas graphics device and app for the page — WebGL2 by default (on the M4
 * it ran this vertex-heavy world 1.7–2.4× faster than WebGPU — the spike), WebGPU with `?api=webgpu` (our GLSL turned
 * into WGSL at runtime by glslang + twgsl, vendored under /lib). Nothing of PlayCanvas's own frame loop runs: the
 * game's loop calls Renderer.render, which drives `app.renderComposition` itself.
 */
export interface Gfx {
  app: pc.AppBase
  device: pc.GraphicsDevice
  /** the world layer (the main scene) */
  world: pc.Layer
}
let G: Gfx | null = null

export function gfx(): Gfx {
  if (!G) throw new Error('gfx: the device is not up yet (initGfx)')
  return G
}

export async function initGfx(canvas: HTMLCanvasElement, o: { api?: 'webgl2' | 'webgpu'; antialias: boolean; samples?: number; powerPreference?: 'high-performance' | 'low-power' }): Promise<Gfx> {
  // (?api=webgpu-only: no fallback — a debug switch, so a failed WebGPU start shows its error)
  const types = o.api === 'webgpu' ? (new URLSearchParams(location.search).get('api') === 'webgpu-only' ? [pc.DEVICETYPE_WEBGPU] : [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2]) : [pc.DEVICETYPE_WEBGL2]
  const device = await pc.createGraphicsDevice(canvas, {
    deviceTypes: types,
    antialias: o.antialias,
    alpha: false,
    depth: true,
    stencil: false,
    // TRANSIENT (2026-11-03): the canvas's MSAA colour and its depth live only in a tiled GPU's tile memory (Apple,
    // the phones' Mali / Adreno: Metal's / Vulkan's memoryless) — never in RAM, never loaded or stored; resolved
    // straight to the screen. Elsewhere an ordinary attachment. (Also clears the stencil PlayCanvas's depth format
    // carries — it was loaded every frame.)
    transientColor: true,
    transientDepth: true,
    powerPreference: o.powerPreference ?? 'high-performance',
    // (no glslangUrl / twgslUrl — 2026-11-17, the download: naga translates every shader (fastWgsl); glslang + twgsl
    //  (2.6 MB of WebAssembly) are only its fallback — fetched once the game is playing, not before it starts)
  } as never)
  device.maxPixelRatio = 1
  // FEWER MSAA SAMPLES (2026-11-07, quality.ts: a weak GPU's 2×): on WebGL2 PlayCanvas draws into its own multisampled
  // back buffer of `device.samples` (the most the GPU has, ≤ 4) and blits it to the canvas — made again from
  // `samples` at every resize, so set here it holds. WebGPU allows only 1 or 4: left as it is there.
  const dev = device as unknown as { samples: number; backBuffer: { destroy(): void }; createBackbuffer(fb: null): void }
  if (!device.isWebGPU && o.samples && dev.samples > 1 && o.samples < dev.samples) {
    dev.samples = o.samples
    dev.backBuffer.destroy()
    dev.createBackbuffer(null)
  }
  if (device.isWebGPU) await fastWgsl(device)
  const opts = new pc.AppOptions()
  opts.graphicsDevice = device
  opts.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem]
  opts.resourceHandlers = []
  const app = new pc.AppBase(canvas)
  app.init(opts)
  app.setCanvasFillMode(pc.FILLMODE_NONE)
  app.setCanvasResolution(pc.RESOLUTION_FIXED, canvas.width || 1, canvas.height || 1)
  // (none of PlayCanvas's own lighting: every material is ours)
  app.scene.clusteredLightingEnabled = false
  const world = app.scene.layers.getLayerById(pc.LAYERID_WORLD)!
  // three's order: renderOrder first, then (opaque) by material, (transparent) far → near — Scene.sync writes drawOrder
  world.opaqueSortMode = pc.SORTMODE_MANUAL
  world.transparentSortMode = pc.SORTMODE_MANUAL
  G = { app, device, world }
  // (the harness's handle on the engine: scripts/harness/wgslcheck.mjs reads the WebGPU transpile)
  ;(window as unknown as { __pc: typeof pc }).__pc = pc
  return G
}

/**
 * OUR GLSL ON WEBGPU (docs/MIGRATION.md): PlayCanvas turns a GLSL shader into WGSL with glslang (→ SPIR-V) and twgsl
 * (Tint: SPIR-V → WGSL). From unoptimised SPIR-V that WGSL passes every argument by pointer through a copy — on the M4
 * our terrain's ground paint ran 15× slower than the same GLSL on WebGL2. NAGA (wgpu's translator, naga-wasm) goes
 * GLSL → WGSL directly, plain functions: used for every shader, glslang + twgsl kept for any naga can't read.
 * Both ways the module turns off WGSL's derivative-uniformity check (GLSL allows a texture sample in a branch on a
 * varying — a leaf card's, the paint's — WGSL refuses it unless told).
 */
type Glslang = { compileGLSL(src: string, type: string): unknown }
type Twgsl = { convertSpirV2WGSL(code: unknown): string }
/** glslang + twgsl, as PlayCanvas would have loaded them (their scripts from /lib, each its WebAssembly). */
let fallback: Promise<{ glslang: Glslang; twgsl: Twgsl }> | null = null
function loadFallback(): Promise<{ glslang: Glslang; twgsl: Twgsl }> {
  return (fallback ??= (async () => {
    const url = (p: string) => new URL(p, document.baseURI).toString()
    const [twgsl, glslang] = await Promise.all([
      import(/* @vite-ignore */ url('/lib/twgsl/twgsl.js')).then(() => (window as unknown as { twgsl(w: string): Promise<Twgsl> }).twgsl(url('/lib/twgsl/twgsl.wasm'))),
      import(/* @vite-ignore */ url('/lib/glslang/glslang.js')).then((m: { default(): Promise<Glslang> }) => m.default()),
    ])
    return { glslang, twgsl }
  })())
}
async function fastWgsl(device: pc.GraphicsDevice): Promise<void> {
  const d = device as unknown as { glslang?: Glslang; twgsl?: Twgsl }
  const head = 'diagnostic(off, derivative_uniformity);\n'
  let naga: typeof import('naga-wasm') | null = null
  try { naga = await import('naga-wasm'); await naga.init({ module_or_path: nagaWasm }) } catch (e) { console.warn('naga unavailable — glslang + twgsl for every shader', e); naga = null }
  // (the fallback: needed before the first shader if naga isn't there; else fetched once the game is playing)
  let real: { glslang: Glslang; twgsl: Twgsl } | null = null
  if (!naga) real = await loadFallback()
  else {
    const later = () => void loadFallback().then((r) => (real = r)).catch((e) => console.warn('glslang + twgsl unavailable', e))
    addEventListener('overhill:started', later, { once: true })
  }
  const compile = (src: string, type: string) => real!.glslang.compileGLSL(src, type), convert = (code: unknown) => real!.twgsl.convertSpirV2WGSL(code)
  const glslang: Glslang = { compileGLSL: () => null }, tw: Twgsl = { convertSpirV2WGSL: () => '' }
  d.glslang = glslang; d.twgsl = tw
  // (naga's preprocessor has no token pasting — only PlayCanvas's unused texture2D helpers use it — and Vulkan GLSL
  //  needs no precision statements)
  // PlayCanvas declares all eight colour outputs on WebGPU (it strips the unused ones only for WebGL on Apple): an
  // output nothing writes is dropped here (one mention = its declaration) — eight outputs a pixel cost real bandwidth
  const clean = (src: string) => {
    const uses = new Map<string, number>()
    for (const m of src.matchAll(/\bpcFragColor([1-7])\b/g)) uses.set(m[1], (uses.get(m[1]) ?? 0) + 1)
    return src.split('\n').filter((l) => {
      if (l.includes('##') || /^\s*precision\s/.test(l)) return false
      const o = /^\s*layout\s*\(\s*location\s*=\s*([1-7])\s*\)\s*out\b.*\bpcFragColor\1\s*;/.exec(l)
      return !(o && uses.get(o[1]) === 1)
    }).join('\n')
  }
  glslang.compileGLSL = (src: string, type: string) => ({ deferred: true, src, type })
  tw.convertSpirV2WGSL = (code: unknown) => {
    const c = code as { deferred?: boolean; src: string; type: string }
    if (!c?.deferred) return head + convert(code)
    if (naga) {
      try { return head + naga.translate({ from: 'glsl', source: clean(c.src), parse: { stage: c.type as 'vertex' | 'fragment' }, to: 'wgsl' }) }
      catch (e) { console.warn('naga: falling back to glslang + twgsl for a shader —', (e as { formatted?: string }).formatted ?? e) }
    }
    if (!real) { void loadFallback().then((r) => (real = r)); throw new Error('naga could not translate a shader and glslang + twgsl are still loading') }
    return head + convert(compile(c.src, c.type))
  }
}

