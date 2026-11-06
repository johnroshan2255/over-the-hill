import * as pc from 'playcanvas'
import { gfx } from './core'
import { Color, Matrix3, Matrix4, Vector2, Vector3, Vector4 } from './math'
import { Texture } from './texture'

/**
 * MATERIALS (docs/MIGRATION.md): three's ShaderMaterial kept — GLSL 3 sources, `uniforms` of `{ value }` objects,
 * defines, blending / depth / side / alpha-to-coverage — over PlayCanvas ShaderMaterials.
 *
 * THE SHADER CONVERSION (once per material layout): our GLSL 3 → PlayCanvas's GLSL dialect —
 *   top-level `in` / `out` → `attribute` / `varying` (vertex), `in` → `varying` (fragment); our FRAG_OUT dropped
 *   (PlayCanvas maps gl_FragColor); three's built-ins → PlayCanvas's (`projectionMatrix` → matrix_projection,
 *   `viewMatrix` → matrix_view, `modelMatrix` → matrix_model, `modelViewMatrix`, `normalMatrix`, `cameraPosition` →
 *   view_position, `position` / `normal` / `uv` declared as attributes, `instanceMatrix` → four instance attributes);
 *   `#include <tonemapping_fragment>` / `<colorspace_fragment>` → OTH_OUTPUT_GLSL (the hue-keeping Neutral tone map of
 *   toneMap.ts and linear → sRGB — both switched by the renderer per target, as three's are); defines prepended.
 *   Every attribute gets a vertex slot: position SEMANTIC_POSITION (PlayCanvas's bounds read it), the rest ATTR1…15.
 *
 * UNIFORMS: the GLOBAL ones (the atmosphere's, the terrain shadow's — `registerGlobals`) are written once a frame to
 * the device's scope; a material's own are pushed to its PlayCanvas material each frame it's drawn (three's mutable
 * `{ value }` objects — the modules mutate them freely).
 */
export const FrontSide = 0
export const BackSide = 1
export const DoubleSide = 2
export const NoBlending = 0
export const NormalBlending = 1
export const AdditiveBlending = 2
export const SubtractiveBlending = 3
export const MultiplyBlending = 4
export const CustomBlending = 5
export const AddEquation = 100
export const SubtractEquation = 101
export const ReverseSubtractEquation = 102
export const MinEquation = 103
export const MaxEquation = 104
export const ZeroFactor = 200
export const OneFactor = 201
export const SrcColorFactor = 202
export const OneMinusSrcColorFactor = 203
export const SrcAlphaFactor = 204
export const OneMinusSrcAlphaFactor = 205
export const DstAlphaFactor = 206
export const OneMinusDstAlphaFactor = 207
export const DstColorFactor = 208
export const OneMinusDstColorFactor = 209
export const GLSL3 = '300 es'
export const NoToneMapping = 0
export const LinearToneMapping = 1
export const CustomToneMapping = 5
export const NeutralToneMapping = 7
export const ACESFilmicToneMapping = 4
export const AgXToneMapping = 6

const FACTOR: Record<number, number> = {
  [ZeroFactor]: pc.BLENDMODE_ZERO, [OneFactor]: pc.BLENDMODE_ONE, [SrcColorFactor]: pc.BLENDMODE_SRC_COLOR, [OneMinusSrcColorFactor]: pc.BLENDMODE_ONE_MINUS_SRC_COLOR,
  [SrcAlphaFactor]: pc.BLENDMODE_SRC_ALPHA, [OneMinusSrcAlphaFactor]: pc.BLENDMODE_ONE_MINUS_SRC_ALPHA, [DstAlphaFactor]: pc.BLENDMODE_DST_ALPHA,
  [OneMinusDstAlphaFactor]: pc.BLENDMODE_ONE_MINUS_DST_ALPHA, [DstColorFactor]: pc.BLENDMODE_DST_COLOR, [OneMinusDstColorFactor]: pc.BLENDMODE_ONE_MINUS_DST_COLOR,
}
const EQUATION: Record<number, number> = { [AddEquation]: pc.BLENDEQUATION_ADD, [SubtractEquation]: pc.BLENDEQUATION_SUBTRACT, [ReverseSubtractEquation]: pc.BLENDEQUATION_REVERSE_SUBTRACT, [MinEquation]: pc.BLENDEQUATION_MIN, [MaxEquation]: pc.BLENDEQUATION_MAX }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface IUniform<T = any> { value: T }
type UniformValue = number | boolean | Vector2 | Vector3 | Vector4 | Color | Matrix3 | Matrix4 | Texture | null | number[] | Float32Array

// ------------------------------------------------------------------------------------------------- global uniforms
const globals: Record<string, IUniform<UniformValue>>[] = []
const globalObjects = new Set<IUniform<UniformValue>>()
const globalNames = new Set<string>()
/** Uniform objects shared by every material (the atmosphere, the terrain shadow): written once a frame to the scope. */
export function registerGlobals(u: Record<string, IUniform<unknown>>): void {
  globals.push(u as Record<string, IUniform<UniformValue>>)
  for (const k in u) { globalObjects.add(u[k] as IUniform<UniformValue>); globalNames.add(k) }
}
const scratch = new Map<string, Float32Array>()
/** A uniform's value as PlayCanvas takes it (vectors and matrices into a reused array per name). */
function pcValue(name: string, v: UniformValue): number | Float32Array | pc.Texture | number[] | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof Texture) return v.pcTexture()
  if (v instanceof Float32Array || Array.isArray(v)) return v
  const arr = (n: number) => { let a = scratch.get(name); if (!a || a.length !== n) scratch.set(name, (a = new Float32Array(n))); return a }
  if (v instanceof Vector3) { const a = arr(3); a[0] = v.x; a[1] = v.y; a[2] = v.z; return a }
  if (v instanceof Color) { const a = arr(3); a[0] = v.r; a[1] = v.g; a[2] = v.b; return a }
  if (v instanceof Vector4) { const a = arr(4); a[0] = v.x; a[1] = v.y; a[2] = v.z; a[3] = v.w; return a }
  if (v instanceof Vector2) { const a = arr(2); a[0] = v.x; a[1] = v.y; return a }
  if (v instanceof Matrix4 || v instanceof Matrix3) return v.elements
  return null
}
/** A 1×1 texture for a sampler nothing set (WebGL sampled (0, 0, 0, 1) from an empty unit). */
const defaults = new Map<string, pc.Texture>()
function defaultTexture(kind: 'f' | 'u' | 'i'): pc.Texture {
  let t = defaults.get(kind)
  if (!t) {
    const fmt = kind === 'f' ? pc.PIXELFORMAT_RGBA8 : kind === 'u' ? pc.PIXELFORMAT_R16U : pc.PIXELFORMAT_R16I
    t = new pc.Texture(gfx().device, { name: 'oth-default', width: 1, height: 1, format: fmt, mipmaps: false, minFilter: pc.FILTER_NEAREST, magFilter: pc.FILTER_NEAREST })
    const d = t.lock() as unknown as { fill(v: number): void; [i: number]: number }
    d.fill(0)
    if (kind === 'f') d[3] = 255
    t.unlock()
    defaults.set(kind, t)
  }
  return t
}

/** The renderer's per-render state the converted shaders read (tone mapping on / off, sRGB out or linear). */
export const outputState = { toneMap: 1, srgb: 1, exposure: 1 }
const scopeIds = new Map<string, pc.ScopeId>()
export function pushGlobals(): void {
  const scope = gfx().device.scope
  const set = (name: string, v: unknown) => {
    let id = scopeIds.get(name)
    if (!id) scopeIds.set(name, (id = scope.resolve(name)))
    if (v !== null) id.setValue(v as number)
  }
  for (const g of globals) for (const k in g) set(k, pcValue(`g:${k}`, g[k].value))
  set('uOthToneMap', outputState.toneMap)
  set('uOthSRGB', outputState.srgb)
  set('toneMappingExposure', outputState.exposure)
}

// ------------------------------------------------------------------------------------------------- the conversion
/** The tone map (toneMap.ts's hue-keeping Neutral) and the output encode, read by every converted fragment shader. */
const OTH_OUTPUT_GLSL = /* glsl */ `
uniform float uOthToneMap;
uniform float uOthSRGB;
uniform float toneMappingExposure;
vec3 othToneMap(vec3 color) {
  const float StartCompression = 0.8 - 0.04;
  const float Desaturation = 0.15;
  color *= toneMappingExposure;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  float m = max(color.r, max(color.g, color.b));
  color *= m > 1e-5 ? max(1.0 - offset / m, 0.0) : 0.0;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < StartCompression) return color;
  float d = 1. - StartCompression;
  float newPeak = 1. - d * d / (peak + d - StartCompression);
  color *= newPeak / peak;
  float g = 1. - 1. / (Desaturation * (peak - newPeak) + 1.);
  return mix(color, vec3(newPeak), g);
}
vec4 othOutput(vec4 v) {
  return uOthSRGB > 0.5 ? vec4(mix(pow(max(v.rgb, vec3(0.0)), vec3(0.41666)) * 1.055 - vec3(0.055), v.rgb * 12.92, vec3(lessThanEqual(v.rgb, vec3(0.0031308)))), v.a) : v;
}
`

export interface Layout {
  /** attribute name → PlayCanvas semantic */
  semantics: Record<string, string>
  /** colour outputs (more than one: an MRT shader, e.g. the impostor bake's albedo + normal) */
  outputs: number
  /** the sampler uniforms (name → float / uint / int): a null one gets a default texture (WebGPU binds every one) */
  samplers: Record<string, 'f' | 'u' | 'i'>
  /** the converted sources */
  vs: string
  fs: string
  key: string
}

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36) }

/** Top-level `in` / `out` declarations → PlayCanvas's `attribute` / `varying` (by statement, so a shader written on one
 *  line converts too; functions' parameters and anything inside braces left alone). */
function convertIO(src: string, stage: 'v' | 'f'): string {
  // brace depth at every character (comments skipped)
  const depth = new Int16Array(src.length + 1)
  let d = 0
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') depth[i++] = d; depth[i] = d; continue }
    if (src[i] === '{') d++
    else if (src[i] === '}') d--
    depth[i] = d
  }
  return src.replace(/(^|[;{}\n])(\s*)(flat\s+|smooth\s+)?(?:layout\s*\([^)]*\)\s*)?(in|out)(\s+)(?=(?:highp\s+|mediump\s+|lowp\s+)?\w+\s+\w+\s*(?:\[[^\]]*\])?\s*;)/g,
    (m, pre: string, ws: string, q: string | undefined, kind: string, sp: string, at: number) => {
      if (depth[at] !== 0 && pre !== '}') return m
      if (pre === '}' && depth[at] !== 0) return m
      const word = stage === 'v' ? (kind === 'in' ? 'attribute' : 'varying') : kind === 'in' ? 'varying' : null
      return word ? `${pre}${ws}${q ?? ''}${word}${sp}` : m
    })
}

function forWebGPU(src: string): string {
  const floats = [...src.matchAll(/uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?sampler2D\s+(\w+)\s*;/g)].map((m) => m[1])
  for (const n of new Set(floats)) src = src.replace(new RegExp(`\\b(texture|textureLod|textureGrad|textureOffset|textureLodOffset|textureProj)\\s*\\(\\s*${n}\\s*,`, 'g'), `$1(sampler2D(${n}, ${n}_sampler),`)
  // (a sampler as a function's parameter: integer ones read by texelFetch — a texture is enough)
  return src.replace(/([(,]\s*)(?:highp\s+|mediump\s+|lowp\s+)?(u|i)sampler2D(\s+\w+)/g, '$1$2texture2D$3')
}

const hasWord = (src: string, w: string) => new RegExp(`\\b${w}\\b`).test(src)

/** Convert one material's sources for PlayCanvas (with its defines and whether it's drawn instanced by matrix). */
export function convert(vertex: string, fragment: string, defines: Record<string, unknown>, instanceMatrix: boolean, vertexColors = false, has: Set<string> | null = null): Layout {
  const defs = Object.entries(defines).map(([k, v]) => `#define ${k} ${v === true || v === '' ? '' : String(v)}`).join('\n')
  // the fragment: our FRAG_OUT (PlayCanvas declares its own output), three's tone-map / colour-space includes
  let fs = fragment
    .replace(/layout\s*\(\s*location\s*=\s*0\s*\)\s*out\s+highp\s+vec4\s+pc_fragColor\s*;/g, '')
    .replace(/#define\s+gl_FragColor\s+pc_fragColor/g, '')
    .replace(/#include\s*<tonemapping_fragment>/g, 'if (uOthToneMap > 0.5) gl_FragColor.rgb = othToneMap(gl_FragColor.rgb);')
    .replace(/#include\s*<colorspace_fragment>/g, 'gl_FragColor = othOutput(gl_FragColor);')
  // more than one colour output (MRT): `layout(location = k) out vec4 name;` → PlayCanvas's pcFragColor<k>
  let outputs = 1
  fs = fs.replace(/layout\s*\(\s*location\s*=\s*(\d+)\s*\)\s*out\s+(?:highp\s+|mediump\s+|lowp\s+)?vec4\s+(\w+)\s*;/g, (_, k: string, name: string) => {
    outputs = Math.max(outputs, Number(k) + 1)
    return `\n#define ${name} pcFragColor${k}\n`
  })
  // a single unnamed-location output (`out vec4 outColor;`) is PlayCanvas's pcFragColor0
  fs = fs.replace(/(^|[;}\n])\s*out\s+(?:highp\s+|mediump\s+|lowp\s+)?vec4\s+(\w+)\s*;/g, (_, pre: string, name: string) => `${pre}\n#define ${name} pcFragColor0\n`)
  fs = convertIO(fs, 'f')
  let vs = convertIO(vertex, 'v')
  const builtins = (src: string, stage: 'v' | 'f') => {
    const p: string[] = []
    if (hasWord(src, 'modelMatrix') || hasWord(src, 'modelViewMatrix') || hasWord(src, 'normalMatrix')) p.push('uniform mat4 matrix_model;', '#define modelMatrix matrix_model')
    if (hasWord(src, 'viewMatrix') || hasWord(src, 'modelViewMatrix') || hasWord(src, 'normalMatrix')) p.push('uniform mat4 matrix_view;', '#define viewMatrix matrix_view')
    if (hasWord(src, 'projectionMatrix')) p.push('uniform mat4 matrix_projection;', '#define projectionMatrix matrix_projection')
    if (hasWord(src, 'modelViewMatrix')) p.push('#define modelViewMatrix (matrix_view * matrix_model)')
    if (hasWord(src, 'normalMatrix')) p.push('uniform mat3 matrix_normal;', '#define normalMatrix (mat3(matrix_view) * matrix_normal)')
    if (hasWord(src, 'cameraPosition')) p.push('uniform vec3 view_position;', '#define cameraPosition view_position')
    if (stage === 'v') {
      const declared = (w: string) => new RegExp(`attribute\\s+\\w+\\s+${w}\\s*;`).test(src)
      if (hasWord(src, 'position') && !declared('position')) p.push('attribute vec3 position;')
      if (hasWord(src, 'normal') && !declared('normal')) p.push('attribute vec3 normal;')
      if (hasWord(src, 'uv') && !declared('uv')) p.push('attribute vec2 uv;')
      // (three: vertexColors declares the colour attribute, vec3)
      if (vertexColors && hasWord(src, 'color') && !declared('color')) p.push('#define USE_COLOR', 'attribute vec3 color;')
      if (instanceMatrix) p.push('#define USE_INSTANCING', 'attribute vec4 instanceMatrix0;', 'attribute vec4 instanceMatrix1;', 'attribute vec4 instanceMatrix2;', 'attribute vec4 instanceMatrix3;', '#define instanceMatrix mat4(instanceMatrix0, instanceMatrix1, instanceMatrix2, instanceMatrix3)')
    }
    return p.join('\n')
  }
  vs = `${defs}\n${builtins(vs, 'v')}\n${vs}`
  fs = `${defs}\n${builtins(fs, 'f')}\n${/othToneMap|othOutput/.test(fs) ? OTH_OUTPUT_GLSL : ''}\n${fs}`
  // an attribute the geometry doesn't have: a constant at WebGL's default (0, 0, 0, 1) — WebGPU needs every declared
  // attribute in the vertex buffers, WebGL quietly read the default
  if (has) {
    vs = vs.replace(/^(\s*)attribute\s+(?:highp\s+|mediump\s+|lowp\s+)?(\w+)\s+(\w+)\s*;/gm, (m, ws: string, type: string, name: string) => {
      if (has.has(name) || /^instanceMatrix\d$/.test(name)) return m
      const zero = type === 'float' ? '0.0' : type === 'int' ? '0' : type === 'uint' ? '0u' : type === 'vec4' ? 'vec4(0.0, 0.0, 0.0, 1.0)' : `${type}(0)`
      return `${ws}const ${type} ${name} = ${zero};`
    })
  }
  // the vertex slots: position on POSITION (location 0), every other attribute on ATTR1 … ATTR15
  const semantics: Record<string, string> = {}
  let slot = 1
  for (const m of vs.matchAll(/^\s*attribute\s+(?:highp\s+|mediump\s+|lowp\s+)?\w+\s+(\w+)\s*;/gm)) {
    const name = m[1]
    if (semantics[name]) continue
    if (name === 'position') semantics[name] = pc.SEMANTIC_POSITION
    else {
      if (slot > 15) throw new Error(`gfx: more than 16 attributes in a shader (${name})`)
      semantics[name] = `ATTR${slot++}`
    }
  }
  // WEBGPU: PlayCanvas splits each sampler uniform into a texture + `<name>_sampler`, and Vulkan GLSL samples a texture
  // through `sampler2D(tex, sampler)` — every sampling call on one rewritten so; a sampler PARAMETER becomes a texture
  // (only texelFetch reads one: samplerless). WebGL2 keeps the sources as they are.
  if (gfx().device.isWebGPU) { vs = forWebGPU(vs); fs = forWebGPU(fs) }
  const samplers: Record<string, 'f' | 'u' | 'i'> = {}
  for (const m of (vs + '\n' + fs).matchAll(/uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?(u|i)?sampler2D\s+(\w+)\s*;/g)) samplers[m[2]] = (m[1] as 'u' | 'i') ?? 'f'
  const key = hash(vs + '\u0000' + fs)
  return { semantics, vs, fs, key, outputs, samplers }
}

// ------------------------------------------------------------------------------------------------- materials
let materialIds = 0

export class Material {
  readonly isMaterial = true
  readonly id = ++materialIds
  name = ''
  transparent = false
  opacity = 1
  blending = NormalBlending
  blendSrc = SrcAlphaFactor
  blendDst = OneMinusSrcAlphaFactor
  blendEquation = AddEquation
  blendSrcAlpha: number | null = null
  blendDstAlpha: number | null = null
  blendEquationAlpha: number | null = null
  premultipliedAlpha = false
  depthTest = true
  depthWrite = true
  side = FrontSide
  alphaToCoverage = false
  polygonOffset = false
  polygonOffsetFactor = 0
  polygonOffsetUnits = 0
  colorWrite = true
  /** Depth test EQUAL, not LESS-EQUAL (the shading pass after a depth pre-pass — Trees.ts: only the surface the pre-pass
   *  kept is shaded, once, with no discard to stop the early depth test). */
  depthEqual = false
  toneMapped = true
  visible = true
  vertexColors = false
  userData: Record<string, unknown> = {}
  /** bumped by `needsUpdate = true` (defines / sources changed → the shader rebuilt) */
  version = 0
  set needsUpdate(v: boolean) { if (v) this.version++ }
  /** (scene.ts: the PlayCanvas materials made for this, by layout key) */
  readonly gpu = new Map<string, pc.ShaderMaterial>()
  disposed = false
  dispose(): void {
    this.disposed = true
    for (const m of this.gpu.values()) m.destroy()
    this.gpu.clear()
  }

  /** The state signature (scene.ts re-applies the state when it changes). */
  stateKey(): string {
    return `${this.transparent}|${this.blending}|${this.blendSrc}|${this.blendDst}|${this.blendEquation}|${this.blendSrcAlpha}|${this.blendDstAlpha}|${this.premultipliedAlpha}|${this.depthTest}|${this.depthWrite}|${this.side}|${this.alphaToCoverage}|${this.polygonOffset}|${this.polygonOffsetFactor}|${this.polygonOffsetUnits}|${this.colorWrite}|${this.depthEqual}`
  }

  /** Blend / depth / cull / coverage onto a PlayCanvas material (three's rules — WebGLState.setBlending). */
  applyState(m: pc.Material): void {
    const B = pc.BlendState
    let bs: pc.BlendState
    const pm = this.premultipliedAlpha
    if (this.blending === NoBlending || (this.blending === NormalBlending && !this.transparent)) bs = B.NOBLEND
    else if (this.blending === NormalBlending) bs = pm ? new B(true, pc.BLENDEQUATION_ADD, pc.BLENDMODE_ONE, pc.BLENDMODE_ONE_MINUS_SRC_ALPHA, pc.BLENDEQUATION_ADD, pc.BLENDMODE_ONE, pc.BLENDMODE_ONE_MINUS_SRC_ALPHA)
      : new B(true, pc.BLENDEQUATION_ADD, pc.BLENDMODE_SRC_ALPHA, pc.BLENDMODE_ONE_MINUS_SRC_ALPHA, pc.BLENDEQUATION_ADD, pc.BLENDMODE_ONE, pc.BLENDMODE_ONE_MINUS_SRC_ALPHA)
    else if (this.blending === AdditiveBlending) bs = pm ? new B(true, pc.BLENDEQUATION_ADD, pc.BLENDMODE_ONE, pc.BLENDMODE_ONE)
      : new B(true, pc.BLENDEQUATION_ADD, pc.BLENDMODE_SRC_ALPHA, pc.BLENDMODE_ONE, pc.BLENDEQUATION_ADD, pc.BLENDMODE_ONE, pc.BLENDMODE_ONE)
    else if (this.blending === MultiplyBlending) bs = new B(true, pc.BLENDEQUATION_ADD, pc.BLENDMODE_DST_COLOR, pc.BLENDMODE_ONE_MINUS_SRC_ALPHA, pc.BLENDEQUATION_ADD, pc.BLENDMODE_ZERO, pc.BLENDMODE_ONE)
    else if (this.blending === SubtractiveBlending) bs = new B(true, pc.BLENDEQUATION_ADD, pc.BLENDMODE_ZERO, pc.BLENDMODE_ONE_MINUS_SRC_COLOR, pc.BLENDEQUATION_ADD, pc.BLENDMODE_ZERO, pc.BLENDMODE_ONE)
    else bs = new B(true, EQUATION[this.blendEquation], FACTOR[this.blendSrc], FACTOR[this.blendDst], EQUATION[this.blendEquationAlpha ?? this.blendEquation], FACTOR[this.blendSrcAlpha ?? this.blendSrc], FACTOR[this.blendDstAlpha ?? this.blendDst])
    if (!this.colorWrite) { bs = bs.clone(); bs.setColorWrite(false, false, false, false) }
    m.blendState = bs
    m.depthState = new pc.DepthState(this.depthTest ? (this.depthEqual ? pc.FUNC_EQUAL : pc.FUNC_LESSEQUAL) : pc.FUNC_ALWAYS, this.depthTest && this.depthWrite)
    m.cull = this.side === DoubleSide ? pc.CULLFACE_NONE : this.side === BackSide ? pc.CULLFACE_FRONT : pc.CULLFACE_BACK
    m.alphaToCoverage = this.alphaToCoverage
    m.depthBias = this.polygonOffset ? this.polygonOffsetUnits : 0
    m.slopeDepthBias = this.polygonOffset ? this.polygonOffsetFactor : 0
  }
}

export class ShaderMaterial extends Material {
  readonly isShaderMaterial = true
  uniforms: Record<string, IUniform>
  defines: Record<string, unknown>
  vertexShader: string
  fragmentShader: string
  glslVersion: string | null = null
  constructor(p: Partial<{ uniforms: Record<string, IUniform<unknown>>; defines: Record<string, unknown>; vertexShader: string; fragmentShader: string; glslVersion: string; vertexColors: boolean; transparent: boolean; depthWrite: boolean; depthTest: boolean; side: number; blending: number; alphaToCoverage: boolean; premultipliedAlpha: boolean; toneMapped: boolean; polygonOffset: boolean; polygonOffsetFactor: number; polygonOffsetUnits: number; blendSrc: number; blendDst: number; blendEquation: number; blendSrcAlpha: number; blendDstAlpha: number; colorWrite: boolean; depthEqual: boolean; name: string }> = {}) {
    super()
    this.uniforms = p.uniforms ?? {}
    this.defines = p.defines ?? {}
    this.vertexShader = p.vertexShader ?? 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
    this.fragmentShader = p.fragmentShader ?? 'void main() { gl_FragColor = vec4(1.0); }'
    const { uniforms: _u, defines: _d, vertexShader: _v, fragmentShader: _f, ...rest } = p
    Object.assign(this, rest)
  }

  /** The PlayCanvas material for this material's sources + defines (and drawn instanced by matrix or not). */
  pcMaterial(instanceMatrix: boolean, attrs: string[]): { m: pc.ShaderMaterial; layout: Layout } {
    const sig = `${this.version}|${instanceMatrix}|${attrs.join(',')}`
    let entry = this.layouts.get(sig)
    if (!entry) {
      const layout = convert(this.vertexShader, this.fragmentShader, this.defines, instanceMatrix, this.vertexColors, new Set(attrs))
      const m = new pc.ShaderMaterial({ uniqueName: `oth_${layout.key}`, vertexGLSL: layout.vs, fragmentGLSL: layout.fs, attributes: layout.semantics, ...(layout.outputs > 1 ? { fragmentOutputTypes: Array(layout.outputs).fill('vec4') } : {}) })
      m.name = this.name || `oth_${this.id}`
      entry = { m, layout, state: '' }
      this.layouts.set(sig, entry)
      this.gpu.set(sig, m)
    }
    const st = this.stateKey()
    if (entry.state !== st) { entry.state = st; this.applyState(entry.m); entry.m.update() }
    return entry
  }
  private readonly layouts = new Map<string, { m: pc.ShaderMaterial; layout: Layout; state: string }>()

  /** This frame's own (non-global) uniforms onto the PlayCanvas material; a sampler with no texture gets a default. */
  pushUniforms(m: pc.ShaderMaterial, layout: Layout): void {
    for (const k in this.uniforms) {
      const u = this.uniforms[k] as IUniform<UniformValue>
      if (globalObjects.has(u)) continue
      const v = pcValue(`${this.id}:${k}`, u.value)
      if (v !== null) m.setParameter(k, v as number)
    }
    for (const k in layout.samplers) {
      const u = this.uniforms[k]
      if ((u && u.value) || (!u && globalNames.has(k))) continue
      m.setParameter(k, defaultTexture(layout.samplers[k]) as never)
    }
  }

  clone(): ShaderMaterial {
    const c = new ShaderMaterial({ uniforms: this.uniforms, defines: { ...this.defines }, vertexShader: this.vertexShader, fragmentShader: this.fragmentShader })
    Object.assign(c, { transparent: this.transparent, blending: this.blending, depthTest: this.depthTest, depthWrite: this.depthWrite, side: this.side, alphaToCoverage: this.alphaToCoverage, premultipliedAlpha: this.premultipliedAlpha, toneMapped: this.toneMapped })
    return c
  }
}

/** three's MeshBasicMaterial (a flat colour) as a shader material — the winch's cable. */
export class MeshBasicMaterial extends ShaderMaterial {
  readonly color: Color
  constructor(p: { color?: Color; side?: number; transparent?: boolean; opacity?: number } = {}) {
    const color = p.color ?? new Color(1, 1, 1)
    super({
      side: p.side, transparent: p.transparent,
      uniforms: { uColor: { value: color }, uOpacity: { value: p.opacity ?? 1 } },
      vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; void main() { gl_FragColor = vec4(uColor, uOpacity);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
    })
    this.color = color
  }
}
