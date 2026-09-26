/**
 * Touch gestures, in a real browser with a real touchscreen.
 *
 *   pnpm demo && node scripts/touch-checks.mjs
 *
 * The unit tests in `packages/client/test/input.test.ts` prove the pinch
 * arithmetic. They cannot prove it is wired up, and the first time this script
 * ran it caught two things they had no way to catch: the previous frame of a
 * gesture was held by reference, so every pinch measured as no movement at all;
 * and the fog brush painted on press, so a GM placing two fingers to zoom left
 * a dab of fog behind every time.
 *
 * Multi-touch goes through CDP rather than Playwright's own touchscreen, which
 * is one finger only — and one finger is exactly what these gestures are not.
 *
 * Not part of `pnpm verify`: it needs a browser binary, and the gate should not
 * need one. It has its own CI job.
 *
 * Set CHROMIUM_PATH to use a browser that is already on the machine rather than
 * one Playwright downloads — which is what the container this was written in
 * needs, since its Chromium predates the pinned Playwright.
 */

import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

// The standalone demo bundle: the real UI and the real rules engine against a
// server running in the same tab. `pnpm demo` builds it.
const ROOT = new URL('../packages/client/dist-demo/', import.meta.url).pathname
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mjs': 'text/javascript' }

const server = createServer(async (request, response) => {
  const path = request.url === '/' ? '/index.html' : request.url.split('?')[0]
  try {
    const body = await readFile(join(ROOT, path))
    response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
    response.end(body)
  } catch {
    response.writeHead(404).end('no')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

// A pre-installed Chromium takes precedence over the one Playwright would
// fetch: this container ships one, and its build number will not always match
// whatever version of Playwright the lockfile has settled on.
const executablePath = process.env.CHROMIUM_PATH
const browser = await chromium.launch(executablePath ? { executablePath } : {})
const context = await browser.newContext({
  // A landscape tablet, which is how the GM said they would hold it.
  viewport: { width: 1180, height: 820 },
  hasTouch: true,
  deviceScaleFactor: 2,
})
const page = await context.newPage()
const cdp = await context.newCDPSession(page)

const failures = []
const check = (label, ok) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`)
  if (!ok) failures.push(label)
}

await page.goto(base)
await page.waitForSelector('canvas.map-canvas', { timeout: 15000 })
await page.waitForTimeout(600)

const zoom = () => page.textContent('.map-hud__zoom')

async function touch(type, points) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 8, radiusY: 8, force: 1 })),
  })
}

/** Two fingers moving apart, in steps, like a hand does. */
async function pinch(centre, from, to, steps = 10) {
  const at = (gap) => [
    { x: centre.x - gap / 2, y: centre.y },
    { x: centre.x + gap / 2, y: centre.y },
  ]
  await touch('touchStart', at(from))
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', at(from + ((to - from) * i) / steps))
    await page.waitForTimeout(16)
  }
  await touch('touchEnd', [])
}

/** Two fingers travelling together. */
async function twoFingerPan(centre, dx, dy, steps = 10) {
  const at = (ox, oy) => [
    { x: centre.x - 80 + ox, y: centre.y + oy },
    { x: centre.x + 80 + ox, y: centre.y + oy },
  ]
  await touch('touchStart', at(0, 0))
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', at((dx * i) / steps, (dy * i) / steps))
    await page.waitForTimeout(16)
  }
  await touch('touchEnd', [])
}

const box = await page.locator('canvas.map-canvas').boundingBox()
const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

// --- Pinch to zoom ----------------------------------------------------------
const before = await zoom()
await pinch(centre, 120, 420)
await page.waitForTimeout(400)
const afterOpen = await zoom()
check(`pinching out zooms in (${before} -> ${afterOpen})`, parseInt(afterOpen) > parseInt(before))

await pinch(centre, 420, 120)
await page.waitForTimeout(400)
const afterClose = await zoom()
check(`pinching in zooms out (${afterOpen} -> ${afterClose})`, parseInt(afterClose) < parseInt(afterOpen))

// --- Two-finger pan ---------------------------------------------------------
// Nothing on screen reports the offset, so this is checked by the map pixels
// moving: grab the canvas before and after and require them to differ.
const shot = async () => (await page.locator('canvas.map-canvas').screenshot()).toString('base64')
const panBefore = await shot()
await twoFingerPan(centre, 220, 120)
await page.waitForTimeout(400)
check('two fingers move the map', (await shot()) !== panBefore)
check('and did not change the zoom', (await zoom()) === afterClose)

// --- The one that matters: two fingers must not paint fog -------------------
const revealButton = page.locator('button.chip', { hasText: 'Reveal' })
if (await revealButton.count()) {
  await revealButton.first().click()
  await page.waitForTimeout(300)

  // A two-finger *tap*: both down, both up, nothing moves. No zoom change, so
  // any pixel difference is fog and nothing else. This isolates the bug that a
  // pinch-and-compare test cannot, because a pinch never returns to exactly
  // the scale it started from.
  const tapBefore = await shot()
  await touch('touchStart', [
    { x: centre.x - 70, y: centre.y },
    { x: centre.x + 70, y: centre.y },
  ])
  await page.waitForTimeout(120)
  await touch('touchEnd', [])
  await page.waitForTimeout(500)
  check('a two-finger tap paints no fog', (await shot()) === tapBefore)

  // And a single finger still paints, or the fix above broke the tool.
  const strokeBefore = await shot()
  await touch('touchStart', [{ x: centre.x - 150, y: centre.y - 80 }])
  for (let i = 1; i <= 8; i++) {
    await touch('touchMove', [{ x: centre.x - 150 + i * 25, y: centre.y - 80 }])
    await page.waitForTimeout(16)
  }
  await touch('touchEnd', [])
  await page.waitForTimeout(500)
  check('one finger still paints fog', (await shot()) !== strokeBefore)

  // A single tap with the brush should dab, not do nothing.
  const dabBefore = await shot()
  await touch('touchStart', [{ x: centre.x + 180, y: centre.y + 120 }])
  await page.waitForTimeout(80)
  await touch('touchEnd', [])
  await page.waitForTimeout(500)
  check('a single tap still dabs fog', (await shot()) !== dabBefore)

  // Two fingers still zoom while the brush is selected.
  const zoomBeforePinch = await zoom()
  await pinch(centre, 150, 400)
  await page.waitForTimeout(500)
  check('two fingers still zoom with the brush selected', (await zoom()) !== zoomBeforePinch)
} else {
  check('the Reveal tool is reachable (GM seat)', false)
}

await browser.close()
server.close()
console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll touch checks passed')
process.exit(failures.length ? 1 : 0)
