/**
 * Emits `artifact.html` beside the demo build.
 *
 * A published artifact is wrapped in the host's own document skeleton, so the
 * page it is given must be skeleton-free — no doctype, no <html>, no <head>.
 * Vite emits a complete document, so this rewrites it into the fragment the
 * host expects, carrying over whatever hashed asset names the build produced.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2] ?? 'packages/client/dist-demo'
const built = readFileSync(join(dir, 'index.html'), 'utf8')

const js = built.match(/src="\.?\/?(assets\/[^"]+\.js)"/)?.[1]
const css = built.match(/href="\.?\/?(assets\/[^"]+\.css)"/)?.[1]
if (!js) throw new Error('No script found in the built page')

const page = `<title>Virtual Tabletop Demo</title>
${css ? `<link rel="stylesheet" href="${css}" />\n` : ''}<style>
  /* The app commits to one look — ink on vellum, lit low, so the map is the
     brightest thing on screen. It paints its own ground rather than borrowing
     the host's, so it holds on either theme. */
  html,
  body,
  #root {
    height: 100%;
    margin: 0;
    background: #14100c;
  }
</style>
<div id="root"></div>
<script type="module" src="${js}"></script>
`

writeFileSync(join(dir, 'artifact.html'), page)
console.log(`artifact.html -> ${js}${css ? `, ${css}` : ''}`)
