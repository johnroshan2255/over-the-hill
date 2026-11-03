// SPIKE (docs/MIGRATION.md, phase 1): PlayCanvas on WebGL2 vs WebGPU with a load like the game's — a 256² terrain grid,
// 40 small meshes each with its own material, 200 k instanced grass blades — at 1080p uncapped. ?api=webgl2|webgpu
// ?msaa=0|4 ?load=none|heavy. Reports window.__ms (trimmed mean frame), window.__js (rAF JavaScript per frame).
import * as pc from 'playcanvas'

const q = new URLSearchParams(location.search)
const api = q.get('api') ?? 'webgl2'
const msaa = Number(q.get('msaa') ?? 4)
const load = q.get('load') ?? 'heavy'
const canvas = document.getElementById('c') as HTMLCanvasElement

const device = await pc.createGraphicsDevice(canvas, { deviceTypes: [api === 'webgpu' ? pc.DEVICETYPE_WEBGPU : pc.DEVICETYPE_WEBGL2], antialias: msaa > 1, alpha: false, powerPreference: 'high-performance' } as never)
device.maxPixelRatio = 1
const opts = new pc.AppOptions()
opts.graphicsDevice = device
opts.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem]
opts.resourceHandlers = []
const app = new pc.AppBase(canvas)
app.init(opts)
app.setCanvasFillMode(pc.FILLMODE_NONE)
app.setCanvasResolution(pc.RESOLUTION_FIXED, 1920, 1080)
;(window as unknown as { __info: unknown }).__info = { device: device.deviceType, renderer: (device as unknown as { unmaskedRenderer?: string }).unmaskedRenderer }

const cam = new pc.Entity('cam')
cam.addComponent('camera', { clearColor: new pc.Color(0.55, 0.7, 0.85), farClip: 9000, nearClip: 0.3, fov: 55 })
cam.setPosition(0, 40, 160)
cam.lookAt(0, 0, 0)
app.root.addChild(cam)
const world = app.scene.layers.getLayerById(pc.LAYERID_WORLD)!

const mat = (name: string, vs: [string, string], fs: [string, string], attributes: Record<string, string>) => new pc.ShaderMaterial({ uniqueName: name, vertexGLSL: vs[0], fragmentGLSL: fs[0], vertexWGSL: vs[1], fragmentWGSL: fs[1], attributes })

// the terrain: a 256² grid, heights in the vertex shader
const terrainMat = mat('terrain', [`
attribute vec3 aPos; uniform mat4 matrix_model; uniform mat4 matrix_viewProjection; uniform float uT; varying vec3 vN; varying float vH;
void main(void) { vec3 p = aPos; p.y = sin(p.x * 0.05 + uT) * 6.0 + cos(p.z * 0.04) * 8.0; vH = p.y;
  vN = normalize(vec3(-cos(p.x * 0.05 + uT) * 0.3, 1.0, sin(p.z * 0.04) * 0.32)); gl_Position = matrix_viewProjection * matrix_model * vec4(p, 1.0); }`, `
attribute aPos: vec3f; uniform matrix_model: mat4x4f; uniform matrix_viewProjection: mat4x4f; uniform uT: f32; varying vN: vec3f; varying vH: f32;
@vertex fn vertexMain(input: VertexInput) -> VertexOutput { var output: VertexOutput; var p = input.aPos;
  p.y = sin(p.x * 0.05 + uniform.uT) * 6.0 + cos(p.z * 0.04) * 8.0; output.vH = p.y;
  output.vN = normalize(vec3f(-cos(p.x * 0.05 + uniform.uT) * 0.3, 1.0, sin(p.z * 0.04) * 0.32));
  output.position = uniform.matrix_viewProjection * uniform.matrix_model * vec4f(p, 1.0); return output; }`], [`
varying vec3 vN; varying float vH; uniform vec3 uSun;
void main(void) { float l = max(dot(normalize(vN), uSun), 0.0); vec3 c = mix(vec3(0.35, 0.5, 0.25), vec3(0.75, 0.68, 0.45), clamp(vH * 0.08 + 0.5, 0.0, 1.0)); gl_FragColor = vec4(c * (0.35 + 0.65 * l), 1.0); }`, `
varying vN: vec3f; varying vH: f32; uniform uSun: vec3f;
@fragment fn fragmentMain(input: FragmentInput) -> FragmentOutput { var output: FragmentOutput; let l = max(dot(normalize(input.vN), uniform.uSun), 0.0);
  let c = mix(vec3f(0.35, 0.5, 0.25), vec3f(0.75, 0.68, 0.45), clamp(input.vH * 0.08 + 0.5, 0.0, 1.0)); output.color = vec4f(c * (0.35 + 0.65 * l), 1.0); return output; }`], { aPos: pc.SEMANTIC_POSITION })
terrainMat.setParameter('uSun', [0.4, 0.8, 0.3])

const grid = (n: number, size: number) => {
  const pos = new Float32Array((n + 1) * (n + 1) * 3), idx = new Uint32Array(n * n * 6)
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const k = (j * (n + 1) + i) * 3; pos[k] = (i / n - 0.5) * size; pos[k + 2] = (j / n - 0.5) * size }
  let o = 0
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1; idx.set([a, c, b, b, c, d], o); o += 6 }
  const m = new pc.Mesh(device)
  m.setPositions(pos)
  m.setIndices(idx)
  m.update(pc.PRIMITIVE_TRIANGLES)
  return m
}
const add = (mesh: pc.Mesh, material: pc.Material, x = 0, y = 0, z = 0) => {
  const e = new pc.Entity()
  e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, material)] })
  e.setPosition(x, y, z)
  app.root.addChild(e)
  return e
}

if (load === 'heavy') {
  add(grid(256, 1600), terrainMat)
  // 40 small meshes, each with its own material (its own colour uniform)
  const box = pc.Mesh.fromGeometry(device, new pc.BoxGeometry())
  for (let i = 0; i < 40; i++) {
    const m = mat(`box`, [`attribute vec3 aPos; uniform mat4 matrix_model; uniform mat4 matrix_viewProjection; void main(void) { gl_Position = matrix_viewProjection * matrix_model * vec4(aPos * 3.0, 1.0); }`,
      `attribute aPos: vec3f; uniform matrix_model: mat4x4f; uniform matrix_viewProjection: mat4x4f; @vertex fn vertexMain(input: VertexInput) -> VertexOutput { var output: VertexOutput; output.position = uniform.matrix_viewProjection * uniform.matrix_model * vec4f(input.aPos * 3.0, 1.0); return output; }`],
      [`uniform vec3 uCol; void main(void) { gl_FragColor = vec4(uCol, 1.0); }`, `uniform uCol: vec3f; @fragment fn fragmentMain(input: FragmentInput) -> FragmentOutput { var output: FragmentOutput; output.color = vec4f(uniform.uCol, 1.0); return output; }`], { aPos: pc.SEMANTIC_POSITION })
    m.setParameter('uCol', [Math.random(), Math.random(), Math.random()])
    add(box, m, Math.cos(i) * 60, 15, Math.sin(i * 1.7) * 60)
  }
  // 200 k grass blades: one triangle-strip blade (3 tris) instanced, per-instance x / z / height
  const N = Number(q.get('n') ?? 200000)
  const blade = new pc.Mesh(device)
  blade.setPositions(new Float32Array([-0.05, 0, 0, 0.05, 0, 0, -0.04, 0.5, 0, 0.04, 0.5, 0, 0, 1, 0]))
  blade.setIndices(new Uint16Array([0, 1, 2, 2, 1, 3, 2, 3, 4]))
  blade.update(pc.PRIMITIVE_TRIANGLES)
  const fmt = new pc.VertexFormat(device, [{ semantic: pc.SEMANTIC_ATTR10, components: 4, type: pc.TYPE_FLOAT32 }], N)
  const inst = new Float32Array(N * 4)
  for (let i = 0; i < N; i++) { inst[i * 4] = (Math.random() - 0.5) * 180; inst[i * 4 + 1] = (Math.random() - 0.5) * 180; inst[i * 4 + 2] = 0.4 + Math.random() * 0.6; inst[i * 4 + 3] = Math.random() * 6.28 }
  const vb = new pc.VertexBuffer(device, fmt, N, { data: inst.buffer })
  const grassMat = mat('grass', [`
attribute vec3 aPos; attribute vec4 aInst; uniform mat4 matrix_viewProjection; uniform float uT; varying float vY;
void main(void) { float s = sin(aInst.w), c = cos(aInst.w); vec3 p = vec3(aPos.x * c, aPos.y * aInst.z, aPos.x * s);
  p.x += sin(uT + aInst.x * 0.3) * 0.15 * aPos.y; vec3 w = vec3(aInst.x, sin(aInst.x * 0.05 + uT) * 6.0 + cos(aInst.y * 0.04) * 8.0, aInst.y) + p; vY = aPos.y;
  gl_Position = matrix_viewProjection * vec4(w, 1.0); }`, `
attribute aPos: vec3f; attribute aInst: vec4f; uniform matrix_viewProjection: mat4x4f; uniform uT: f32; varying vY: f32;
@vertex fn vertexMain(input: VertexInput) -> VertexOutput { var output: VertexOutput; let s = sin(input.aInst.w); let c = cos(input.aInst.w);
  var p = vec3f(input.aPos.x * c, input.aPos.y * input.aInst.z, input.aPos.x * s); p.x += sin(uniform.uT + input.aInst.x * 0.3) * 0.15 * input.aPos.y;
  let w = vec3f(input.aInst.x, sin(input.aInst.x * 0.05 + uniform.uT) * 6.0 + cos(input.aInst.y * 0.04) * 8.0, input.aInst.y) + p; output.vY = input.aPos.y;
  output.position = uniform.matrix_viewProjection * vec4f(w, 1.0); return output; }`], [`
varying float vY; void main(void) { gl_FragColor = vec4(mix(vec3(0.2, 0.35, 0.12), vec3(0.6, 0.75, 0.3), vY), 1.0); }`, `
varying vY: f32; @fragment fn fragmentMain(input: FragmentInput) -> FragmentOutput { var output: FragmentOutput; output.color = vec4f(mix(vec3f(0.2, 0.35, 0.12), vec3f(0.6, 0.75, 0.3), input.vY), 1.0); return output; }`],
  { aPos: pc.SEMANTIC_POSITION, aInst: pc.SEMANTIC_ATTR10 })
  grassMat.cull = pc.CULLFACE_NONE
  const mi = new pc.MeshInstance(blade, grassMat)
  mi.setInstancing(vb)
  mi.cull = false
  const e = new pc.Entity()
  e.addComponent('render', { meshInstances: [mi] })
  app.root.addChild(e)
  for (const m of [terrainMat, grassMat]) m.update()
}
void world

let t = 0
app.on('update', (dt: number) => { t += dt; terrainMat.setParameter('uT', t * 0.2) })
app.start()

// measure: 2 s warm-up, then 3 s of frames (trimmed mean), and the JavaScript per frame
const W = window as unknown as { __ms?: number; __js?: number; __rafMs?: number }
const raf = window.requestAnimationFrame.bind(window)
let js = 0
window.requestAnimationFrame = (cb) => raf((x) => { const s = performance.now(); cb(x); js += performance.now() - s })
setTimeout(() => {
  const d: number[] = []; let l = performance.now(); const t0 = l, j0 = js
  const tick = () => { const n = performance.now(); d.push(n - l); l = n; if (n - t0 < 3000) raf(tick); else { W.__js = (js - j0) / d.length; d.sort((a, b) => a - b); const k = Math.floor(d.length * 0.1), m = d.slice(k, d.length - k); W.__rafMs = m.reduce((a, b) => a + b, 0) / m.length; drained() } }
  raf(tick)
}, 2000)
// the GPU's real pace: 300 frames submitted, then wait until the GPU has finished all of them
const drained = async () => {
  const wait = async () => {
    const dev = device as unknown as { wgpu?: GPUDevice; gl?: WebGL2RenderingContext }
    if (dev.wgpu) await dev.wgpu.queue.onSubmittedWorkDone()
    else if (dev.gl) { const px = new Uint8Array(4); dev.gl.readPixels(0, 0, 1, 1, dev.gl.RGBA, dev.gl.UNSIGNED_BYTE, px) }
  }
  await wait()
  const t0 = performance.now()
  let n = 0
  await new Promise<void>((res) => { const f = () => { if (++n < 300) raf(f); else res() }; raf(f) })
  await wait()
  W.__ms = (performance.now() - t0) / 300
}
