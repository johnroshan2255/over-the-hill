import * as GFX from './gfx'
import type { Atmosphere } from './Atmosphere'
import { type Builder, SURF } from './Bridges'
import { C } from './Kit'
import { gltfParts, kitMaterial, type KitMatDef } from './Pieces'
import type { TerrainShadow } from './TerrainShadow'
import placesUrl from '../assets/models/places/places.glb?url'
import placesMeta from '../assets/models/places/places.json'

/**
 * THE VALLEY'S BUILDINGS, MODELLED (docs/MULTIPLAYER.md step 4b — the user, 2026-11-09: "the houses, the broken house,
 * the ghost / terror houses are all boxes and look unreal — make those good quality"): scripts/oth/places.py's cabins,
 * the ranger station, the ghost house, the hamlet's cabin, the stone house ruins, the barn, the garage — real geometry in
 * the building kit's tiling scans (its textures shared), the paint and the ambient occlusion in the vertices.
 *
 *   PLACED by Locations.ts (`Ctx.model`): a landmark's buildings MERGED PER MATERIAL (a cabin ~10 draws), shown and
 *     hidden with the landmark (the hills, the tier's reach — Landmarks.cull).
 *   THE GLASS is the landmarks' own (`panes`): places.json's panes drawn into the landmark's mesh, so a lit window
 *     glows from dusk and the ghost house's upstairs one gutters, as before.
 */
export const PLACES_META = placesMeta as unknown as { materials: Record<string, KitMatDef>; buildings: Record<string, { panes: [number, number, number, number, number, number, number, string][] }> }

export interface Places { parts: Record<string, { mat: string; geo: GFX.BufferGeometry }[]>; mats: Record<string, GFX.ShaderMaterial> }
let placesP: Promise<Places> | null = null
export function loadPlaces(atmos: Atmosphere, shadow: TerrainShadow, farGrid: GFX.Vector4): Promise<Places> {
  return (placesP ??= (async () => {
    const gltf = await new GFX.GLTFLoader().setDRACOLoader(new GFX.DRACOLoader().setDecoderPath('/draco/')).loadAsync(placesUrl)
    const parts = gltfParts(gltf, new Set(Object.keys(PLACES_META.buildings).flatMap((n) => [n, `${n}${FAR}`])))
    const mats: Places['mats'] = {}
    await Promise.all(Object.entries(PLACES_META.materials).map(async ([name, d]) => { mats[name] = await kitMaterial(d, atmos, shadow, farGrid, { VCOL_FULL: '' }) }))
    return { parts, mats }
  })())
}

/** THE FAR LOD (places.py far_lod: the small parts dropped, decimated to ~12 %): drawn past FAR_M from the camera. */
export const FAR = '__far'
export const FAR_M = 70

/** Is there a model of this name? */
export const hasPlace = (name: string): boolean => name in PLACES_META.buildings

/** A building's window GLASS into a landmark's mesh (its frame: the model placed at (x, z) turned rot): lit (glows at
 *  night), dark, broken (dark, shards), boarded (dark behind the boards), eerie (the ghost house's cold light). */
export function panes(b: Builder, name: string, x = 0, z = 0, rot = 0): void {
  const cs = Math.cos(rot), sn = Math.sin(rot), Y = new GFX.Vector3(0, 1, 0)
  for (const [px, py, pz, nx0, nz0, hw, hh, state] of PLACES_META.buildings[name]?.panes ?? []) {
    const c = new GFX.Vector3(x + px * cs + pz * sn, py, z - px * sn + pz * cs)
    const out = new GFX.Vector3(nx0 * cs + nz0 * sn, 0, -nx0 * sn + nz0 * cs), along = new GFX.Vector3(out.z, 0, -out.x)
    b.setSurf(state === 'eerie' ? SURF.eerie : SURF.plain)
    if (state === 'lit') b.setGlow(1)
    b.box(c, along, Y, out, hw, hh, 0.012, state === 'broken' || state === 'boarded' ? C.dark : C.glass)
    b.setGlow(0)
    b.setSurf(SURF.plain)
    if (state === 'broken') for (const [u, v, s] of [[-0.6, 0.5, 0.3], [0.55, -0.4, 0.25], [0.2, 0.7, 0.2]]) {
      const p = c.clone().addScaledVector(out, 0.015).addScaledVector(along, u * hw).addScaledVector(Y, v * hh)
      b.tri(p, p.clone().addScaledVector(along, s * hw).addScaledVector(Y, -s * hh * 1.5), p.clone().addScaledVector(along, -s * hw * 0.6).addScaledVector(Y, -s * hh * 0.9), [0.08, 0.1, 0.11])
    }
    b.setSurf(SURF.wood)
  }
}

/** A building placed (its world matrix) under a landmark (its index). */
export interface PlaceInstance { name: string; m: GFX.Matrix4; li: number; tint?: readonly number[] }
/** places.py's BODY paint (the vertices marked in their colour's alpha): a placement's tint takes its place. */
const BODY = 0.7
/** (every placement's colours as floats — merged with the painted ones, one layout) */
function painted(geo: GFX.BufferGeometry, tint: readonly number[] | undefined): GFX.BufferGeometry {
  const c = geo.getAttribute('color') as GFX.BufferAttribute | undefined
  if (!c || c.itemSize < 4) return geo
  const a = c.array as Float32Array | Uint16Array | Uint8Array
  const norm = a instanceof Float32Array ? 1 : a instanceof Uint16Array ? 65535 : 255
  const out = new Float32Array(c.count * 4)
  for (let i = 0; i < c.count; i++) {
    const k = i * 4, body = a[k + 3] / norm > 0.5
    for (let j = 0; j < 3; j++) out[k + j] = (a[k + j] / norm) * (body && tint ? tint[j] / BODY : 1)
    out[k + 3] = a[k + 3] / norm
  }
  geo.setAttribute('color', new GFX.BufferAttribute(out, 4))
  return geo
}

/** Each landmark's buildings merged per material — one group a landmark, holding two: [0] NEAR (the full models) and
 *  [1] FAR (their far LOD); `userData.c` its middle (Landmarks.cull shows one or the other by the camera's distance). */
export function buildPlaces(p: Places, list: PlaceInstance[], parent: GFX.Group): Map<number, GFX.Group> {
  const out = new Map<number, GFX.Group>()
  const lis = [...new Set(list.map((it) => it.li))]
  for (const li of lis) {
    const g = new GFX.Group(), box = new GFX.Box3()
    for (const suffix of ['', FAR]) {
      const mm = new Map<string, GFX.BufferGeometry[]>()
      for (const it of list) {
        if (it.li !== li) continue
        for (const part of p.parts[it.name + suffix] ?? p.parts[it.name] ?? []) {
          let l = mm.get(part.mat)
          if (!l) mm.set(part.mat, (l = []))
          const geo = part.geo.clone().applyMatrix4(it.m)
          l.push(painted(geo, it.tint))
        }
      }
      const lod = new GFX.Group()
      for (const [mat, geos] of mm) {
        const geo = GFX.mergeGeometries(geos), material = p.mats[mat]
        for (const x of geos) x.dispose()
        if (!geo || !material) continue
        geo.computeBoundingSphere()
        if (!suffix) { geo.computeBoundingBox(); box.union(geo.boundingBox!) }
        lod.add(new GFX.Mesh(geo, material))
      }
      lod.visible = !suffix
      g.add(lod)
    }
    g.userData.c = box.isEmpty() ? new GFX.Vector3() : box.getCenter(new GFX.Vector3())
    parent.add(g)
    out.set(li, g)
  }
  return out
}
