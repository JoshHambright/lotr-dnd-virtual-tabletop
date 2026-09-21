import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    target: 'es2022',
  },
  test: {
    root: '.',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
