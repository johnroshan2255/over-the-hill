/**
 * THE WARDENS' SCRIPT (2026-11-12, docs/NEXT_outland.md §1 — "the writing's cipher"): their stones are cut in their own
 * letters. A traveller can't read them at first; every stone READ teaches a few (the commonest first, three a stone), and
 * the card fills in — after nine stones it's all plain. Go back to an old stone and it reads better than it did.
 *
 * The letters are OURS: 26 glyphs drawn here (a stem and one to three strokes on a 3 × 3 lattice, from a fixed seed —
 * no font has them, so none can be missing on a phone), kept as one hidden SVG sprite; a letter not learned yet is a
 * `<use>` of its glyph, set in the line like a character.
 */

/** The order the letters are learned in (the commonest first: the first stones give the most). */
const LEARN = 'etaonshirdlucmwfgypbvkjxqz'
/** Letters known after `n` stones read. */
export const lettersKnown = (n: number): number => Math.min(26, n * 3)
/** The letters stone number `n` (1-based) taught (upper case, '' once all are known). */
export const lettersTaught = (n: number): string => LEARN.slice(lettersKnown(n - 1), lettersKnown(n)).toUpperCase().split('').join(' ')

let sprite = false
/** The 26 glyphs as SVG symbols (#wg-a … #wg-z), added to the page once. */
function ensureSprite(): void {
  if (sprite) return
  sprite = true
  let s = 0x5eed1e55
  const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5) >>> 0) / 4294967296)
  const X = [1, 3, 5], Y = [1, 5, 9]
  const seen = new Set<string>()
  let html = ''
  for (let i = 0; i < 26; i++) {
    for (;;) {
      // a stem (left, middle, right — or, now and then, none) and 1–3 strokes between lattice points, never a flat bar
      // at the foot or the head only (they'd read as underlines)
      const stem = rnd() < 0.86 ? Math.floor(rnd() * 3) : -1
      const strokes = new Set<string>()
      const n = 1 + Math.floor(rnd() * 2.6) + (stem < 0 ? 1 : 0)
      for (let t = 0; t < 12 && strokes.size < n; t++) {
        const a = Math.floor(rnd() * 3), b = Math.floor(rnd() * 3), c = Math.floor(rnd() * 3), d = Math.floor(rnd() * 3)
        if ((a === c && b === d) || (a === c && a === stem) || (b === d && b !== 1) || Math.abs(b - d) > 1) continue
        const k = a < c || (a === c && b < d) ? `M${X[a]} ${Y[b]}L${X[c]} ${Y[d]}` : `M${X[c]} ${Y[d]}L${X[a]} ${Y[b]}`
        strokes.add(k)
      }
      const path = [stem >= 0 ? `M${X[stem]} ${Y[0]}L${X[stem]} ${Y[2]}` : '', ...[...strokes].sort()].join('')
      if (strokes.size < n || seen.has(path)) continue
      seen.add(path)
      html += `<symbol id="wg-${String.fromCharCode(97 + i)}" viewBox="0 0 6 10"><path d="${path}"/></symbol>`
      break
    }
  }
  const el = document.createElement('div')
  el.style.display = 'none'
  el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${html}</svg>`
  document.body.append(el)
}

/** `text` as the page shows it to someone who has read `stones` Warden stones: the letters not learned yet as glyphs. */
export function wardenHtml(text: string, stones: number): string {
  const k = lettersKnown(stones)
  if (k >= 26) return text
  ensureSprite()
  const known = new Set(LEARN.slice(0, k))
  let out = ''
  for (const ch of text) {
    const lo = ch.toLowerCase()
    out += lo >= 'a' && lo <= 'z' && !known.has(lo) ? `<svg class="wg"><use href="#wg-${lo}"/></svg>` : ch
  }
  return out
}
