/// <reference lib="webworker" />
/**
 * The MAP LOADER's worker (MapData.load): fetches a world's files and computes what the game derives from them
 * (mapPrep.ts) off the main thread; the arrays come back transferred — no copy.
 */
import { prepareMap, transferables } from './mapPrep'

self.onmessage = async (e: MessageEvent<{ id: number; base: string; leaf: number; courts?: boolean; vales?: boolean; banks?: boolean; sculpt?: boolean; cliffs?: boolean; peaks?: boolean; soften?: boolean; walls?: boolean }>) => {
  const { id, base, leaf, courts, vales, banks, sculpt, cliffs, peaks, soften, walls } = e.data
  try {
    const p = await prepareMap(base, leaf, (f) => self.postMessage({ id, progress: f }), { courts, vales, banks, sculpt, cliffs, peaks, soften, walls })
    self.postMessage({ id, map: p }, transferables(p))
  } catch (err) {
    self.postMessage({ id, error: String(err) })
  }
}
