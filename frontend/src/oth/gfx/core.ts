import * as pc from 'playcanvas'

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

export async function initGfx(canvas: HTMLCanvasElement, o: { api?: 'webgl2' | 'webgpu'; antialias: boolean; powerPreference?: 'high-performance' | 'low-power' }): Promise<Gfx> {
  const types = o.api === 'webgpu' ? [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2] : [pc.DEVICETYPE_WEBGL2]
  const device = await pc.createGraphicsDevice(canvas, {
    deviceTypes: types,
    antialias: o.antialias,
    alpha: false,
    depth: true,
    stencil: false,
    powerPreference: o.powerPreference ?? 'high-performance',
    glslangUrl: '/lib/glslang/glslang.js',
    twgslUrl: '/lib/twgsl/twgsl.js',
  } as never)
  device.maxPixelRatio = 1
  const opts = new pc.AppOptions()
  opts.graphicsDevice = device
  opts.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem]
  opts.resourceHandlers = []
  const app = new pc.AppBase(canvas)
  app.init(opts)
  app.setCanvasFillMode(pc.FILLMODE_NONE)
  app.setCanvasResolution(pc.RESOLUTION_FIXED, canvas.width || 1, canvas.height || 1)
  app.autoRender = false
  // (none of PlayCanvas's own lighting: every material is ours)
  app.scene.clusteredLightingEnabled = false
  const world = app.scene.layers.getLayerById(pc.LAYERID_WORLD)!
  // three's order: renderOrder first, then (opaque) by material, (transparent) far → near — Scene.sync writes drawOrder
  world.opaqueSortMode = pc.SORTMODE_MANUAL
  world.transparentSortMode = pc.SORTMODE_MANUAL
  G = { app, device, world }
  return G
}
