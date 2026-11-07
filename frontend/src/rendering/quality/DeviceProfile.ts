/** Device detection (overhill keeps only what the game uses from DARK's DeviceProfile). */
interface NavigatorExt extends Navigator {
  userAgentData?: { mobile?: boolean }
}

export function isMobileDevice(): boolean {
  const nav = navigator as NavigatorExt
  if (nav.userAgentData?.mobile) return true
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true
  // iPadOS reports as Mac; touch points give it away.
  return /Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints ?? 0) > 1
}

let renderer: string | null = null
/** The GPU's name as the browser reports it (WebGL's unmasked renderer: "ANGLE (Intel, Mesa Intel(R) UHD Graphics 600
 *  (GLK 2), OpenGL ES 3.2)", "ANGLE (Apple, ANGLE Metal Renderer: Apple M4, …)"), '' if it can't tell. Read once, from
 *  a throwaway WebGL2 context that is let go at once (before the game's own device is made). */
export function gpuName(): string {
  if (renderer !== null) return renderer
  renderer = ''
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '')
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  } catch {
    /* (no WebGL2: '' — the game's own start says so) */
  }
  return renderer
}

/**
 * A WEAK GPU (2026-11-07, docs/PERF.md "Chromebooks"): the integrated and phone-class chips a Chromebook or a cheap
 * laptop draws with — Intel HD / UHD / Iris Plus (not Iris Xe, not Arc), the ARM chips (Mali, Immortalis, PowerVR,
 * Adreno — not the X1 laptops'), software rendering. They get the phones' way of drawing ULTRA (quality.ts): the same
 * world, ranges and look, fewer pixels. Mid chips (Iris Xe, Radeon integrated) are not "weak": the adaptive resolution
 * (main.ts) covers them. A phone is already handled as a phone. ?gpu=weak / ?gpu=full forces it either way.
 */
export function isWeakGpu(force?: string | null): boolean {
  if (force === 'weak') return true
  if (force === 'full') return false
  return weakRenderer(gpuName())
}

/** (isWeakGpu's test on a GPU name — kept apart for DeviceProfile.test.ts) */
export function weakRenderer(r: string): boolean {
  if (!r) return false
  if (/SwiftShader|llvmpipe|softpipe|Microsoft Basic Render|Software/i.test(r)) return true
  if (/Adreno.*X\d|Adreno\(TM\) X/i.test(r)) return false // (Snapdragon X laptops: a laptop-class GPU)
  if (/Mali|Immortalis|PowerVR|Imagination|Adreno|Vivante|VideoCore|Mediatek/i.test(r)) return true
  if (/Intel/i.test(r)) return !/Iris\(R\) Xe|Iris Xe|Arc/i.test(r) && /UHD|HD Graphics|Iris/i.test(r)
  return false
}
