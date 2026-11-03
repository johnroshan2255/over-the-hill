import * as pc from 'playcanvas'
import { gfx, initGfx } from './core'
import { CustomToneMapping, NoToneMapping, outputState, pushGlobals } from './material'
import { Color, Quaternion, Vector3, Vector4 } from './math'
import { type Camera, OrthographicCamera, PerspectiveCamera, type Scene } from './scene'
import { FloatType, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, NearestFilter, RGBAFormat, TargetTexture, UnsignedByteType } from './texture'

/**
 * THE RENDERER (docs/MIGRATION.md): three's WebGLRenderer kept as far as the game uses it — pixel ratio, size, clear
 * colour, auto-clear, render targets with viewport / scissor, tone mapping on / off and its exposure, the frame's
 * counts — driving PlayCanvas: per render, the scene synced (gfx/scene.ts), the globals written to the scope, ONE
 * camera entity set from our camera (pose, projection, target, rect, clear) and `app.renderComposition` run with only it.
 */
export class RenderTarget {
  readonly isWebGLRenderTarget = true
  readonly textures: TargetTexture[]
  readonly viewport: Vector4
  readonly scissor: Vector4
  scissorTest = false
  /** the PlayCanvas target */
  pc: pc.RenderTarget
  constructor(public width: number, public height: number, o: { count?: number; type?: number; format?: number; depthBuffer?: boolean; generateMipmaps?: boolean; minFilter?: number; magFilter?: number; samples?: number } = {}) {
    const n = o.count ?? 1, d = gfx().device
    const fmt = o.type === HalfFloatType ? pc.PIXELFORMAT_RGBA16F : o.type === FloatType ? pc.PIXELFORMAT_RGBA32F : pc.PIXELFORMAT_RGBA8
    const mips = !!o.generateMipmaps && (o.minFilter ?? LinearFilter) === LinearMipmapLinearFilter
    const filt = (f: number | undefined) => (f === NearestFilter ? pc.FILTER_NEAREST : f === LinearMipmapLinearFilter ? (mips ? pc.FILTER_LINEAR_MIPMAP_LINEAR : pc.FILTER_LINEAR) : pc.FILTER_LINEAR)
    const bufs: pc.Texture[] = []
    for (let i = 0; i < n; i++) bufs.push(new pc.Texture(d, { name: 'oth-rt', width, height, format: fmt, mipmaps: mips, minFilter: filt(o.minFilter), magFilter: filt(o.magFilter), addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE }))
    this.pc = new pc.RenderTarget({ colorBuffers: bufs, depth: o.depthBuffer ?? true, samples: o.samples ?? 1 })
    this.textures = bufs.map((b) => new TargetTexture(b))
    this.viewport = new Vector4(0, 0, width, height)
    this.scissor = new Vector4(0, 0, width, height)
    void RGBAFormat; void UnsignedByteType
  }
  get texture(): TargetTexture { return this.textures[0] }
  dispose(): void { this.pc.destroy(); for (const t of this.textures) t.pcTexture().destroy() }
}
export { RenderTarget as WebGLRenderTarget }

export class Renderer {
  readonly domElement: HTMLCanvasElement
  toneMapping = CustomToneMapping
  toneMappingExposure = 1
  autoClear = true
  private pr = 1
  private w = 1
  private h = 1
  private readonly clearColor = new Color(0, 0, 0)
  private clearAlpha = 1
  private target: RenderTarget | null = null
  private readonly cams = new Map<Camera, pc.Entity>()
  private active: pc.Entity | null = null
  readonly info = {
    autoReset: true,
    render: { calls: 0, triangles: 0, frame: 0 },
    memory: { geometries: 0, textures: 0 },
    programs: [] as unknown[],
    reset: () => { this.info.render.calls = 0; this.info.render.triangles = 0 },
  }

  private constructor(canvas: HTMLCanvasElement) { this.domElement = canvas }

  /** The device up (WebGL2, or WebGPU with ?api=webgpu), the renderer on it. */
  static async create(canvas: HTMLCanvasElement, o: { antialias: boolean; api?: 'webgl2' | 'webgpu'; powerPreference?: 'high-performance' | 'low-power' }): Promise<Renderer> {
    await initGfx(canvas, o)
    return new Renderer(canvas)
  }

  get backend(): string { return gfx().device.deviceType }
  getContext(): WebGL2RenderingContext | null { return (gfx().device as unknown as { gl?: WebGL2RenderingContext }).gl ?? null }
  setPixelRatio(r: number): void { this.pr = r; this.resize() }
  getPixelRatio(): number { return this.pr }
  setSize(w: number, h: number): void { this.w = w; this.h = h; this.resize() }
  private resize(): void {
    const W = Math.max(1, Math.round(this.w * this.pr)), H = Math.max(1, Math.round(this.h * this.pr))
    this.domElement.style.width = `${this.w}px`
    this.domElement.style.height = `${this.h}px`
    gfx().device.resizeCanvas(W, H)
  }
  setClearColor(c: Color | number, a = 1): void { if (typeof c === 'number') this.clearColor.set(c); else this.clearColor.copy(c); this.clearAlpha = a }
  getClearColor(t: Color): Color { return t.copy(this.clearColor) }
  getClearAlpha(): number { return this.clearAlpha }
  setRenderTarget(rt: RenderTarget | null): void { this.target = rt }
  getRenderTarget(): RenderTarget | null { return this.target }
  /** (PlayCanvas compiles a shader the first time it's drawn) */
  async compileAsync(..._: unknown[]): Promise<void> {}
  initTexture(t: { pcTexture(): unknown }): void { t.pcTexture() }

  private entity(cam: Camera): pc.Entity {
    let e = this.cams.get(cam)
    if (!e) {
      e = new pc.Entity(`oth-cam-${cam.id}`)
      e.addComponent('camera', { clearColorBuffer: true, clearDepthBuffer: true, clearStencilBuffer: false, frustumCulling: true, aspectRatioMode: pc.ASPECT_MANUAL })
      gfx().app.root.addChild(e)
      e.enabled = false
      this.cams.set(cam, e)
    }
    return e
  }

  /** THE FRAME (PlayCanvas's own loop draws it: main.ts runs the game in the app's 'update'): the scene synced, the
   *  globals written, this camera made the one PlayCanvas renders with. */
  prepare(scene: Scene, camera: Camera): void {
    this.setup(scene, camera)
    this.main = this.active
    this.info.render.calls = scene.info.calls
    this.info.render.triangles = scene.info.triangles
    this.info.render.frame++
  }
  private main: pc.Entity | null = null

  /** Draw now (offscreen: the impostor bake) — the frame's camera held off while it does. */
  render(scene: Scene, camera: Camera): void {
    const G = gfx()
    const main = this.main
    this.setup(scene, camera)
    if (main && main !== this.active) main.enabled = false
    G.device.frameStart()
    G.app.renderComposition(G.app.scene.layers)
    G.device.frameEnd()
    if (main && main !== this.active) { this.active!.enabled = false; main.enabled = true; this.active = main }
  }

  /** PlayCanvas's own stats panel (MiniStats: frame time, FPS, draw calls, CPU / GPU timings, VRAM) — F3 / ?stats=1. */
  showStats(on: boolean): void {
    if (on && !this.stats) {
      const o = pc.MiniStats.getDefaultOptions() as { stats: { name: string; stats: string[]; decimalPlaces?: number; unitsName?: string; watermark: number }[]; startSizeIndex: number }
      o.stats.unshift({ name: 'FPS', stats: ['frame.fps'], decimalPlaces: 0, unitsName: '', watermark: 500 })
      o.startSizeIndex = 1
      this.stats = new pc.MiniStats(gfx().app, o as never)
    }
    if (this.stats) this.stats.enabled = on
  }
  private stats: pc.MiniStats | null = null

  private setup(scene: Scene, camera: Camera): void {
    const G = gfx()
    if (camera.parent === null) camera.updateMatrixWorld()
    camera.matrixWorld.decompose(_p, _q, _s)
    scene.sync(_p)
    // the converted shaders' output: tone-mapped and sRGB to the screen, linear into a target (three's rule)
    outputState.toneMap = this.toneMapping === NoToneMapping ? 0 : 1
    outputState.srgb = this.target ? 0 : 1
    outputState.exposure = this.toneMappingExposure
    pushGlobals()
    // the camera
    const e = this.entity(camera), c = e.camera!
    if (this.active && this.active !== e) this.active.enabled = false
    e.enabled = true
    this.active = e
    e.setPosition(_p.x, _p.y, _p.z)
    e.setRotation(_q.x, _q.y, _q.z, _q.w)
    if (camera instanceof PerspectiveCamera) {
      c.projection = pc.PROJECTION_PERSPECTIVE
      c.fov = camera.fov
      c.aspectRatio = camera.aspect
    } else if (camera instanceof OrthographicCamera) {
      c.projection = pc.PROJECTION_ORTHOGRAPHIC
      c.orthoHeight = (camera.top - camera.bottom) / 2
      c.aspectRatio = (camera.right - camera.left) / (camera.top - camera.bottom)
    }
    c.nearClip = camera.near
    c.farClip = camera.far
    if (c.layers.length !== 1 || c.layers[0] !== scene.layer.id) c.layers = [scene.layer.id]
    const rt = this.target
    c.renderTarget = (rt ? rt.pc : null) as pc.RenderTarget
    const W = rt ? rt.width : G.device.width, H = rt ? rt.height : G.device.height
    if (rt) {
      const v = rt.viewport, s = rt.scissorTest ? rt.scissor : rt.viewport
      _r.set(v.x / W, v.y / H, v.z / W, v.w / H); c.rect = _r
      _r.set(s.x / W, s.y / H, s.z / W, s.w / H); c.scissorRect = _r
    } else {
      _r.set(0, 0, 1, 1); c.rect = _r; c.scissorRect = _r
    }
    const bg = scene.background
    _c.set(bg ? bg.r : this.clearColor.r, bg ? bg.g : this.clearColor.g, bg ? bg.b : this.clearColor.b, bg ? 1 : this.clearAlpha)
    c.clearColor = _c
    c.clearColorBuffer = this.autoClear
    c.clearDepthBuffer = this.autoClear
  }

  /** Start PlayCanvas's frame loop: `update(dt)` runs the game each frame, then PlayCanvas renders. */
  start(update: () => void): void {
    const app = gfx().app
    app.on('update', update)
    app.start()
  }
  /** (a paused game draws nothing) */
  set drawing(on: boolean) { gfx().app.autoRender = on }

  /** Resolve when the GPU has finished all the work submitted so far (the harness's honest frame time). */
  async gpuDone(): Promise<void> {
    const d = gfx().device as unknown as { wgpu?: GPUDevice; gl?: WebGL2RenderingContext }
    if (d.wgpu) await d.wgpu.queue.onSubmittedWorkDone()
    else if (d.gl) d.gl.readPixels(0, 0, 1, 1, d.gl.RGBA, d.gl.UNSIGNED_BYTE, new Uint8Array(4))
  }
}
export { Renderer as WebGLRenderer }

const _p = new Vector3(), _s = new Vector3(), _q = new Quaternion()
const _r = new pc.Vec4(), _c = new pc.Color()
