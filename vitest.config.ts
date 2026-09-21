import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text', 'lcov'],
      // The core packages are where correctness lives — the reducer, the role
      // filtering, the dice and the fog mask. A gap here is a gap at the
      // table, so they are gated far harder than the UI.
      include: ['packages/core/src/**', 'packages/dice/src/**', 'packages/protocol/src/**'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
})
