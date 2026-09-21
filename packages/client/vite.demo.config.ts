import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Builds the standalone demo — the real app against an in-tab server — as a
 * self-contained bundle that can be published and opened anywhere.
 */
export default defineConfig({
  root: 'src/demo',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../dist-demo',
    emptyOutDir: true,
    target: 'es2022',
  },
})
