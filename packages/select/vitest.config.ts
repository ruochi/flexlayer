import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {
      flexlayer: fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    poolOptions: {
      forks: { singleFork: true },
    },
  },
})
