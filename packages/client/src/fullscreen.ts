/**
 * Going full screen.
 *
 * Worth having for a reason that is easy to miss: the app's own chrome is small
 * and the browser's is not. On a tablet the address bar and tab strip take a
 * band off the top of a map that is already sharing the screen with a video
 * call, and on a projector or a television the browser furniture is the only
 * thing on screen that is not the game.
 *
 * Deliberately not clever. The Fullscreen API is one call, it is refused unless
 * a person asked for it, and every part of it can be missing — Safari on an
 * iPhone has no element fullscreen at all, and an iPad only gained it in 16.4.
 * So everything here is written to be absent rather than to be polyfilled, and
 * the caller is expected to hide its button when `isSupported` is false.
 */

/**
 * Whether this browser will full-screen an element at all.
 *
 * Checked against the document rather than a feature string, because the
 * permissions policy can withhold it — an iframe without `allow="fullscreen"`
 * has the method and is refused every time it is called.
 */
export function isSupported(): boolean {
  return typeof document !== 'undefined' && document.fullscreenEnabled === true
}

export function isFullscreen(): boolean {
  return typeof document !== 'undefined' && document.fullscreenElement !== null
}

/**
 * Turns full screen on or off, and reports where it ended up.
 *
 * Swallows the rejection on purpose. A refusal is not an error worth showing
 * anybody: the browser declines when the gesture was not user-initiated or the
 * policy forbids it, and in both cases the honest outcome is that the button
 * did not work, which the returned value already says.
 */
export async function toggleFullscreen(element: Element = document.documentElement): Promise<boolean> {
  try {
    if (isFullscreen()) {
      await document.exitFullscreen()
    } else {
      await element.requestFullscreen({ navigationUI: 'hide' })
    }
  } catch {
    // Fall through: the state below is the truth, whatever was asked for.
  }
  return isFullscreen()
}

/**
 * Calls back whenever full screen changes, however it changed.
 *
 * Needed because Escape and F11 leave full screen without going anywhere near
 * the button, so a component tracking its own boolean would show the wrong
 * label for the rest of the session.
 */
export function watchFullscreen(onChange: (fullscreen: boolean) => void): () => void {
  const handler = () => onChange(isFullscreen())
  document.addEventListener('fullscreenchange', handler)
  return () => document.removeEventListener('fullscreenchange', handler)
}
