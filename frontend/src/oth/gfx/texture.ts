import * as pc from 'playcanvas'
import { gfx } from './core'
import { Vector2 } from './math'

/**
 * TEXTURES (docs/MIGRATION.md): three's texture objects kept (format / type / filters / wrapping / mipmaps set as
 * fields, `needsUpdate` to upload) over PlayCanvas textures, made and uploaded on first use (`pcTexture()`).
 */
export const UnsignedByteType = 1009
export const ByteType = 1010
export const ShortType = 1011
export const UnsignedShortType = 1012
export const IntType = 1013
export const UnsignedIntType = 1014
export const FloatType = 1015
export const HalfFloatType = 1016
export const RGBAFormat = 1023
export const RedFormat = 1028
export const RedIntegerFormat = 1029
export const RGFormat = 1030
export const NearestFilter = 1003
export const NearestMipmapNearestFilter = 1004
export const NearestMipmapLinearFilter = 1005
export const LinearFilter = 1006
export const LinearMipmapNearestFilter = 1007
export const LinearMipmapLinearFilter = 1008
export const RepeatWrapping = 1000
export const ClampToEdgeWrapping = 1001
export const MirroredRepeatWrapping = 1002
export const NoColorSpace = ''
export const SRGBColorSpace = 'srgb'
export const LinearSRGBColorSpace = 'srgb-linear'

const FILTER: Record<number, number> = {
  [NearestFilter]: pc.FILTER_NEAREST, [LinearFilter]: pc.FILTER_LINEAR,
  [NearestMipmapNearestFilter]: pc.FILTER_NEAREST_MIPMAP_NEAREST, [NearestMipmapLinearFilter]: pc.FILTER_NEAREST_MIPMAP_LINEAR,
  [LinearMipmapNearestFilter]: pc.FILTER_LINEAR_MIPMAP_NEAREST, [LinearMipmapLinearFilter]: pc.FILTER_LINEAR_MIPMAP_LINEAR,
}
const ADDRESS: Record<number, number> = { [RepeatWrapping]: pc.ADDRESS_REPEAT, [ClampToEdgeWrapping]: pc.ADDRESS_CLAMP_TO_EDGE, [MirroredRepeatWrapping]: pc.ADDRESS_MIRRORED_REPEAT }

type Source = { data: ArrayBufferView | null; width: number; height: number } | HTMLCanvasElement | HTMLImageElement | ImageBitmap | OffscreenCanvas

export class Texture {
  readonly isTexture = true
  /** pixels: { data, width, height } (data textures) or anything drawable (an image, a canvas, a bitmap) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  image: any
  format = RGBAFormat
  type = UnsignedByteType
  internalFormat: string | null = null
  minFilter = LinearMipmapLinearFilter
  magFilter = LinearFilter
  wrapS = ClampToEdgeWrapping
  wrapT = ClampToEdgeWrapping
  generateMipmaps = true
  flipY = true
  anisotropy = 1
  colorSpace = NoColorSpace
  unpackAlignment = 4
  premultiplyAlpha = false
  repeat = new Vector2(1, 1)
  userData: Record<string, unknown> = {}
  name = ''
  /** bumped by `needsUpdate = true` — the next use uploads */
  version = 0
  private uploaded = -1
  private pc: pc.Texture | null = null
  /** A render target's colour buffer (made by the RenderTarget, never uploaded from here). */
  protected owned: pc.Texture | null = null

  constructor(image?: Source) {
    this.image = image ?? { data: null, width: 1, height: 1 }
  }

  set needsUpdate(v: boolean) { if (v) this.version++ }

  private pixelFormat(): number {
    const f = this.format, t = this.type
    if (this.internalFormat === 'R16UI' || f === RedIntegerFormat) return t === UnsignedByteType ? pc.PIXELFORMAT_R8U : pc.PIXELFORMAT_R16U
    if (f === RedFormat) return t === FloatType ? pc.PIXELFORMAT_R32F : t === HalfFloatType ? pc.PIXELFORMAT_R16F : pc.PIXELFORMAT_R8
    if (f === RGFormat) return t === FloatType ? pc.PIXELFORMAT_RG32F : t === HalfFloatType ? pc.PIXELFORMAT_RG16F : pc.PIXELFORMAT_RG8
    if (t === FloatType) return pc.PIXELFORMAT_RGBA32F
    if (t === HalfFloatType) return pc.PIXELFORMAT_RGBA16F
    return this.colorSpace === SRGBColorSpace ? pc.PIXELFORMAT_SRGBA8 : pc.PIXELFORMAT_RGBA8
  }

  /** The PlayCanvas texture, made / uploaded as needed. */
  pcTexture(): pc.Texture {
    if (this.owned) return this.owned
    const img = this.image as { data?: ArrayBufferView | null; width: number; height: number }
    const isData = !(this.image instanceof HTMLElement) && !(typeof ImageBitmap !== 'undefined' && this.image instanceof ImageBitmap) && !(typeof OffscreenCanvas !== 'undefined' && this.image instanceof OffscreenCanvas)
    const mip = this.generateMipmaps && (this.minFilter === LinearMipmapLinearFilter || this.minFilter === LinearMipmapNearestFilter || this.minFilter === NearestMipmapLinearFilter || this.minFilter === NearestMipmapNearestFilter)
    const fmt = this.pixelFormat()
    if (!this.pc || this.pc.width !== img.width || this.pc.height !== img.height || this.pc.format !== fmt || this.pc.mipmaps !== mip) {
      this.pc?.destroy()
      this.pc = new pc.Texture(gfx().device, {
        name: this.name || 'oth', width: img.width, height: img.height, format: fmt, mipmaps: mip,
        minFilter: FILTER[this.minFilter], magFilter: FILTER[this.magFilter],
        addressU: ADDRESS[this.wrapS], addressV: ADDRESS[this.wrapT], anisotropy: this.anisotropy,
        flipY: !isData && this.flipY,
      })
      this.uploaded = -1
    }
    const t = this.pc
    t.minFilter = FILTER[this.minFilter]; t.magFilter = FILTER[this.magFilter]
    t.addressU = ADDRESS[this.wrapS]; t.addressV = ADDRESS[this.wrapT]
    if (this.uploaded !== this.version) {
      this.uploaded = this.version
      if (isData) {
        if (img.data) {
          const dst = t.lock() as unknown as { set(a: ArrayLike<number>): void; length: number; constructor: unknown }
          const src = img.data as unknown as ArrayLike<number> & { constructor: unknown }
          // (the same type and size: handed to PlayCanvas as its level — not copied into its own first; 2026-11-07, docs/
          //  PERF.md "the hitches": the terrain shadow's 6 MB went through four copies at every bake)
          if (src.length === dst.length && src.constructor === dst.constructor) (t as unknown as { _levels: unknown[] })._levels[0] = src
          else if (src.length === dst.length) dst.set(src)
          else dst.set(new (dst.constructor as new (b: ArrayBuffer, o: number, l: number) => ArrayLike<number>)((img.data as ArrayBufferView).buffer as ArrayBuffer, (img.data as ArrayBufferView).byteOffset, dst.length))
          t.unlock()
        }
      } else {
        t.setSource(this.image as HTMLCanvasElement)
      }
    }
    return t
  }

  /**
   * Re-uploads only rows y0 … y1 of a DATA texture already on the GPU (the claims' ground edits: a few rows of the
   * 2049² height and normal grids, not their 8 MB each) — WebGL 2's texSubImage2D, the mips rebuilt on the GPU.
   * Anywhere else (WebGPU, not yet uploaded): the whole, at its next use.
   */
  updateRows(y0: number, y1: number): void {
    const t = this.pc, img = this.image as { data?: ArrayBufferView | null; width: number; height: number }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dev = gfx().device as any, impl = (t as any)?.impl
    if (!t || this.uploaded !== this.version || !img.data || !dev.gl || !impl?._glTexture) { this.needsUpdate = true; return }
    y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(img.height - 1, Math.ceil(y1))
    if (y1 < y0) return
    const gl = dev.gl as WebGL2RenderingContext, d = img.data as unknown as { length: number; BYTES_PER_ELEMENT: number; buffer: ArrayBuffer; byteOffset: number; constructor: new (b: ArrayBuffer, o: number, l: number) => ArrayBufferView }
    const per = d.length / img.height
    const rows = new d.constructor(d.buffer, d.byteOffset + y0 * per * d.BYTES_PER_ELEMENT, (y1 - y0 + 1) * per)
    dev.bindTextureOnUnit(t, 0)
    dev.setUnpackFlipY(false); dev.setUnpackPremultiplyAlpha(false); dev.setUnpackAlignment(1)
    gl.texSubImage2D(impl._glTarget, 0, 0, y0, img.width, y1 - y0 + 1, impl._glFormat, impl._glPixelType, rows)
    if (t.mipmaps) gl.generateMipmap(impl._glTarget)
  }

  dispose(): void {
    this.pc?.destroy()
    this.pc = null
  }
}

export class DataTexture extends Texture {
  constructor(data: ArrayBufferView | null, width: number, height: number, format = RGBAFormat, type = UnsignedByteType) {
    super({ data, width, height })
    this.format = format
    this.type = type
    // (three's DataTexture defaults: nearest, no mipmaps, no flip, rows tightly packed)
    this.minFilter = this.magFilter = NearestFilter
    this.generateMipmaps = false
    this.flipY = false
    this.unpackAlignment = 1
  }
}

export class CanvasTexture extends Texture {
  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas)
    this.needsUpdate = true
  }
}

/** A render target's colour buffer as a game texture (sampled by the materials that read the target). */
export class TargetTexture extends Texture {
  constructor(t: pc.Texture) {
    super({ data: null, width: t.width, height: t.height })
    this.owned = t
  }
  set target(t: pc.Texture) { this.owned = t; (this.image as { width: number }).width = t.width; (this.image as { height: number }).height = t.height }
}
