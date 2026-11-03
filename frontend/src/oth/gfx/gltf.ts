import * as pc from 'playcanvas'
import { BufferAttribute, BufferGeometry, type TypedArray } from './geometry'
import { Material } from './material'
import { Color } from './math'
import { Group, Mesh, Object3D } from './scene'
import { SRGBColorSpace, Texture } from './texture'

/**
 * glTF (docs/MIGRATION.md): the GLB files the game loads — the cars (assets/loadModels.ts bakes them into its own
 * geometry) and the desert's formations (Draco-compressed: decoded by PlayCanvas's Draco workers on Google's decoder in
 * /draco). The result is what three's GLTFLoader gave the game: a node tree (names sanitized the same way, glTF `extras`
 * as `userData`, a one-primitive mesh node IS the mesh), geometry attributes named position / normal / uv / uv1 / color
 * / tangent, and materials as data (name, linear colour, the base-colour texture, transparency) — never drawn as such.
 */
export class MeshStandardMaterial extends Material {
  readonly isMeshStandardMaterial = true
  color = new Color(1, 1, 1)
  map: Texture | null = null
  emissive = new Color(0, 0, 0)
  emissiveIntensity = 1
  metalness = 1
  roughness = 1
}

export class DRACOLoader {
  path = '/draco/'
  setDecoderPath(p: string): this { this.path = p; return this }
}
let dracoUp: string | null = null

const NAMES: Record<string, string> = { POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv', TEXCOORD_1: 'uv1', COLOR_0: 'color', TANGENT: 'tangent' }
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }
const ARRAYS: Record<number, new (b: ArrayBuffer, o: number, n: number) => TypedArray> = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }
const PC_ARRAYS: Record<number, new (b: ArrayBuffer, o: number, n: number) => TypedArray> = { 0: Int8Array, 1: Uint8Array, 2: Int16Array, 3: Uint16Array, 4: Int32Array, 5: Uint32Array, 6: Float32Array }
/** three's PropertyBinding.sanitizeNodeName */
const sanitize = (n: string) => n.replace(/\s/g, '_').replace(/[[\].:/]/g, '')

interface Json {
  scene?: number
  scenes?: { nodes: number[]; extras?: Record<string, unknown> }[]
  nodes?: { name?: string; mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; extras?: Record<string, unknown> }[]
  meshes?: { name?: string; extras?: Record<string, unknown>; primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number; extensions?: { KHR_draco_mesh_compression?: { bufferView: number; attributes: Record<string, number> } } }[] }[]
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }[]
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[]
  buffers?: { byteLength: number; uri?: string }[]
  materials?: { name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: { index: number }; metallicFactor?: number; roughnessFactor?: number }; emissiveFactor?: number[]; alphaMode?: string; doubleSided?: boolean; extras?: Record<string, unknown> }[]
  textures?: { source?: number }[]
  images?: { bufferView?: number; mimeType?: string; uri?: string }[]
}

export class GLTFLoader {
  private draco: DRACOLoader | null = null
  setDRACOLoader(d: DRACOLoader): this { this.draco = d; return this }

  async loadAsync(url: string, onProgress?: (e: { loaded: number; total: number; lengthComputable: boolean }) => void): Promise<{ scene: Group; scenes: Group[] }> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`glTF ${url}: ${res.status}`)
    const total = Number(res.headers.get('content-length') ?? 0)
    let buf: ArrayBuffer
    if (onProgress && res.body) {
      const reader = res.body.getReader(), parts: Uint8Array[] = []
      let loaded = 0
      for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); loaded += value.length; onProgress({ loaded, total, lengthComputable: total > 0 }) }
      const all = new Uint8Array(loaded); let o = 0
      for (const p of parts) { all.set(p, o); o += p.length }
      buf = all.buffer
    } else buf = await res.arrayBuffer()
    return this.parse(buf, url)
  }

  async parse(data: ArrayBuffer, url = ''): Promise<{ scene: Group; scenes: Group[] }> {
    const dv = new DataView(data)
    let json: Json, bin: ArrayBuffer | null = null
    if (dv.getUint32(0, true) === 0x46546c67) {
      let o = 12
      json = {} as Json
      while (o < dv.byteLength) {
        const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true)
        if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(data, o + 8, len)))
        else if (type === 0x004e4942) bin = data.slice(o + 8, o + 8 + len)
        o += 8 + len
      }
    } else json = JSON.parse(new TextDecoder().decode(new Uint8Array(data)))
    const base = url.replace(/[^/]*$/, '')
    const buffers = await Promise.all((json.buffers ?? []).map(async (b, i) => (b.uri ? (await fetch(b.uri.startsWith('data:') ? b.uri : base + b.uri)).arrayBuffer() : i === 0 && bin ? bin : new ArrayBuffer(b.byteLength))))
    const view = (i: number) => { const v = json.bufferViews![i]; return { buf: buffers[v.buffer], off: v.byteOffset ?? 0, len: v.byteLength, stride: v.byteStride } }
    const accessor = (i: number): { array: TypedArray; size: number; normalized: boolean } => {
      const a = json.accessors![i], size = COMPONENTS[a.type], T = ARRAYS[a.componentType]
      if (a.bufferView === undefined) return { array: new T(new ArrayBuffer(a.count * size * T.prototype.BYTES_PER_ELEMENT), 0, a.count * size), size, normalized: !!a.normalized }
      const v = view(a.bufferView), el = T.prototype.BYTES_PER_ELEMENT, off = v.off + (a.byteOffset ?? 0)
      if (v.stride && v.stride !== size * el) {
        // interleaved: copied out
        const out = new T(new ArrayBuffer(a.count * size * el), 0, a.count * size), src = new DataView(v.buf)
        const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType] as 'getFloat32'
        for (let n = 0; n < a.count; n++) for (let c = 0; c < size; c++) out[n * size + c] = src[get](off + n * v.stride + c * el, true)
        return { array: out, size, normalized: !!a.normalized }
      }
      return { array: new T(v.buf.slice(off, off + a.count * size * el), 0, a.count * size), size, normalized: !!a.normalized }
    }
    // textures (images decoded once each)
    const images = new Map<number, Promise<Texture>>()
    const texture = (ti: number) => {
      const src = json.textures![ti].source ?? 0
      let p = images.get(src)
      if (!p) images.set(src, (p = (async () => {
        const im = json.images![src]
        const blob = im.bufferView !== undefined ? new Blob([new Uint8Array(view(im.bufferView).buf, view(im.bufferView).off, view(im.bufferView).len)], { type: im.mimeType }) : await (await fetch(im.uri!.startsWith('data:') ? im.uri! : base + im.uri)).blob()
        const bmp = await createImageBitmap(blob, { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' } as ImageBitmapOptions)
        const t = new Texture(bmp)
        t.flipY = false
        t.colorSpace = SRGBColorSpace
        t.needsUpdate = true
        return t
      })()))
      return p
    }
    const materials = await Promise.all((json.materials ?? []).map(async (m) => {
      const mat = new MeshStandardMaterial()
      mat.name = m.name ?? ''
      const pbr = m.pbrMetallicRoughness ?? {}
      const f = pbr.baseColorFactor ?? [1, 1, 1, 1]
      mat.color.setRGB(f[0], f[1], f[2])
      mat.opacity = f[3]
      if (pbr.baseColorTexture) mat.map = await texture(pbr.baseColorTexture.index)
      if (m.emissiveFactor) mat.emissive.setRGB(m.emissiveFactor[0], m.emissiveFactor[1], m.emissiveFactor[2])
      mat.metalness = pbr.metallicFactor ?? 1
      mat.roughness = pbr.roughnessFactor ?? 1
      mat.transparent = m.alphaMode === 'BLEND'
      mat.side = m.doubleSided ? 2 : 0
      mat.userData = { ...(m.extras ?? {}) }
      return mat
    }))
    // meshes: one geometry per primitive (Draco ones decoded by PlayCanvas's workers)
    const decode = (buffer: ArrayBuffer) => new Promise<{ indices: ArrayBuffer; vertices: ArrayBuffer; attributes: { id: number; dataType: number; numComponents: number; offset: number }[]; stride: number }>((resolve, reject) => {
      if (dracoUp !== this.draco!.path) { dracoUp = this.draco!.path; pc.dracoInitialize({ jsUrl: `${this.draco!.path}draco_wasm_wrapper.js`, wasmUrl: `${this.draco!.path}draco_decoder.wasm`, numWorkers: 2 }) }
      pc.dracoDecode(buffer, (err: unknown, r: never) => (err ? reject(err) : resolve(r)))
    })
    const meshes = await Promise.all((json.meshes ?? []).map((m) => Promise.all(m.primitives.map(async (p) => {
      const g = new BufferGeometry()
      const draco = p.extensions?.KHR_draco_mesh_compression
      if (draco && this.draco) {
        const v = view(draco.bufferView)
        const r = await decode(v.buf.slice(v.off, v.off + v.len))
        const n = r.vertices.byteLength / r.stride
        for (const [sem, id] of Object.entries(draco.attributes)) {
          const at = r.attributes.find((a) => a.id === id)
          const name = NAMES[sem] ?? sem.toLowerCase()
          if (!at) continue
          const T = PC_ARRAYS[at.dataType], el = T.prototype.BYTES_PER_ELEMENT, out = new T(new ArrayBuffer(n * at.numComponents * el), 0, n * at.numComponents)
          const src = new T(r.vertices, 0, r.vertices.byteLength / el), stride = r.stride / el, off = at.offset / el
          for (let i = 0; i < n; i++) for (let c = 0; c < at.numComponents; c++) out[i * at.numComponents + c] = src[i * stride + off + c]
          const acc = json.accessors![p.attributes[sem]]
          g.setAttribute(name, new BufferAttribute(out, at.numComponents, !!acc?.normalized))
        }
        g.setIndex(new BufferAttribute(n <= 65535 ? new Uint16Array(r.indices) : new Uint32Array(r.indices), 1))
      } else {
        for (const [sem, ai] of Object.entries(p.attributes)) {
          const a = accessor(ai)
          g.setAttribute(NAMES[sem] ?? sem.toLowerCase(), new BufferAttribute(a.array, a.size, a.normalized))
        }
        if (p.indices !== undefined) g.setIndex(new BufferAttribute(accessor(p.indices).array, 1))
      }
      return { g, material: p.material !== undefined ? materials[p.material] : new MeshStandardMaterial() }
    }))))
    // the node tree
    const node = (i: number): Object3D => {
      const n = json.nodes![i]
      let o: Object3D
      if (n.mesh !== undefined) {
        const md = json.meshes![n.mesh], prims = meshes[n.mesh]
        const make = (k: number) => { const m = new Mesh(prims[k].g, prims[k].material); m.name = sanitize(md.name ?? `mesh_${n.mesh}`) + (prims.length > 1 ? `_${k}` : ''); m.userData = { ...(md.extras ?? {}) }; return m }
        if (prims.length === 1) o = make(0)
        else { o = new Group(); prims.forEach((_, k) => o.add(make(k))) }
      } else o = new Group()
      if (n.name !== undefined) o.name = sanitize(n.name)
      o.userData = { ...o.userData, ...(n.extras ?? {}) }
      if (n.matrix) { o.matrix.fromArray(n.matrix); o.matrix.decompose(o.position, o.quaternion, o.scale) }
      else {
        if (n.translation) o.position.fromArray(n.translation)
        if (n.rotation) o.quaternion.fromArray(n.rotation)
        if (n.scale) o.scale.fromArray(n.scale)
      }
      for (const c of n.children ?? []) o.add(node(c))
      return o
    }
    const scenes = (json.scenes ?? [{ nodes: (json.nodes ?? []).map((_, i) => i) }]).map((s) => {
      const g = new Group()
      for (const i of s.nodes) g.add(node(i))
      g.userData = { ...(s.extras ?? {}) }
      return g
    })
    const scene = scenes[json.scene ?? 0]
    scene.updateMatrixWorld(true)
    return { scene, scenes }
  }
}
