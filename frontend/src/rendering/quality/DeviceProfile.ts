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
