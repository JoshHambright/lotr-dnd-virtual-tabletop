/**
 * Bundles the server into one file.
 *
 * The shared packages are TypeScript source with bundler-style imports, which
 * Node cannot resolve on its own, and a container should not be running an
 * experimental type-stripping flag in the first place. Bundling settles both:
 * the image runs plain JavaScript on a stock Node.
 */

import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // A native module cannot be bundled; it is installed in the image instead.
  external: ['better-sqlite3'],
  // ESM output plus CommonJS dependencies needs these shims in scope.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module'",
      "import { fileURLToPath as __fileURLToPath } from 'node:url'",
      "import { dirname as __pathDirname } from 'node:path'",
      'const require = __createRequire(import.meta.url)',
      'const __filename = __fileURLToPath(import.meta.url)',
      'const __dirname = __pathDirname(__filename)',
    ].join('\n'),
  },
})

console.log('server bundled -> dist/server.js')
