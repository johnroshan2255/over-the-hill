// pace.mjs — THE HONEST FRAME TIME, shared by the harnesses (2026-11-10). `gpuDone()` (queue.onSubmittedWorkDone)
// answers ~0.6 s late on PlayCanvas's RELEASE build under a running game — a CONSTANT, whatever the frame costs (the
// debug build's error scopes flush the queue every call; the release build's nothing does). "200 frames, GPU-drained"
// charged that constant to 200 frames: +2.9 ms a frame, on every number taken since 2026-11-07 (docs/PERF.md). So: TWO
// windows of different lengths, each drained, and the SLOPE between them — the constant cancels.
//   import { PACE } from './pace.mjs';  const ms = await page.evaluate(PACE)            // or PACE_FN(short, long)
export const PACE_FN = (n1 = 150, n2 = 750) => `(async () => {
  const o = window.__oth
  const run = async (n) => { await o.gpuDone(); const t0 = performance.now(); await new Promise((r) => { let k = 0; const f = () => { if (++k < n) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) }); await o.gpuDone(); return performance.now() - t0 }
  const a = await run(${n1}), b = await run(${n2})
  return (b - a) / ${n2 - n1}
})()`
export const PACE = PACE_FN()
