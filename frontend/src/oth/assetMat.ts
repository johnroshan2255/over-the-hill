import * as GFX from './gfx'
import type { Atmosphere } from './Atmosphere'
import type { TerrainShadow } from './TerrainShadow'
import { VEHICLE_FRAG_SRC } from './Vehicle'

/**
 * THE MODELLED ASSETS' MATERIAL (2026-11-09): what scripts/oth/assetkit.py bakes — a set of parts with one atlas,
 * colour + tangent normals (WebP) — drawn as the character is: the car's surface shader (OTH_SPEC, the map, its normal
 * map — Vehicle.ts USE_NORMALMAP_OTH), the world's sun, sky, terrain shadow and haze. One material per set; its parts
 * (Gather's logs, the trailer, the building kit) merged or placed as plain meshes.
 */
const VERT = /* glsl */ `
out vec3 vWorld;
out vec3 vLocal;
out vec3 vN;
out vec2 vUv;
out vec3 vCol;
out float vPaint;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vLocal = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  vCol = vec3(1.0);
  vPaint = 0.0;
  gl_Position = projectionMatrix * viewMatrix * w;
}`

const textures = new Map<string, Promise<GFX.Texture>>()
/** A WebP texture, decoded once (shared by every material that asks for it). */
export function webpTexture(url: string, srgb: boolean): Promise<GFX.Texture> {
  let p = textures.get(url)
  if (!p) textures.set(url, (p = (async () => {
    const bmp = await createImageBitmap(await (await fetch(url)).blob(), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' } as ImageBitmapOptions)
    const t = new GFX.Texture(bmp)
    t.flipY = false
    if (srgb) t.colorSpace = GFX.SRGBColorSpace
    t.anisotropy = 4
    t.needsUpdate = true
    return t
  })()))
  return p
}

/** The material for a baked set: its colour atlas and normal atlas. */
export async function assetMaterial(atmos: Atmosphere, shadow: TerrainShadow, farGrid: GFX.Vector4, colourUrl: string, normalUrl: string): Promise<GFX.ShaderMaterial> {
  const [tex, texN] = await Promise.all([webpTexture(colourUrl, true), webpTexture(normalUrl, false)])
  return new GFX.ShaderMaterial({
    glslVersion: GFX.GLSL3,
    uniforms: {
      ...atmos.uniforms, ...shadow.uniforms, uFarGrid: { value: farGrid }, uMap: { value: tex }, uNormalMap: { value: texN }, uPaintMask: { value: null },
      uPaint: { value: new GFX.Color(1, 1, 1) }, uSunHere: { value: 1 }, uCoat: { value: 0 }, uCoatColor: { value: new GFX.Color(0.8, 0.6, 0.42) }, uCarBase: { value: 0 },
    },
    defines: { OTH_SPEC: '', MIST_K: '0.45', NO_GRAIN: '', USE_MAP_OTH: '', USE_NORMALMAP_OTH: '' },
    vertexShader: VERT, fragmentShader: VEHICLE_FRAG_SRC(),
  })
}

/** A baked set's parts by name: each geometry in its own frame and where the GLB put it (`at`: its world matrix) —
 *  `placed(name)` the geometry moved there. */
export interface Parts { geo: Record<string, GFX.BufferGeometry>; at: Record<string, GFX.Matrix4>; placed(name: string): GFX.BufferGeometry | null }
export async function loadParts(url: string): Promise<Parts> {
  const gltf = await new GFX.GLTFLoader().setDRACOLoader(new GFX.DRACOLoader().setDecoderPath('/draco/')).loadAsync(url)
  const geo: Record<string, GFX.BufferGeometry> = {}, at: Record<string, GFX.Matrix4> = {}
  gltf.scene.updateMatrixWorld(true)
  gltf.scene.traverse((o: GFX.Object3D) => {
    const m = o as GFX.Mesh
    if (!m.isMesh) return
    const name = (m.name || m.parent?.name || '').replace(/\.\d+$/, '')
    geo[name] = m.geometry
    at[name] = m.matrixWorld.clone()
  })
  return { geo, at, placed: (n) => (geo[n] ? geo[n].clone().applyMatrix4(at[n]) : null) }
}
