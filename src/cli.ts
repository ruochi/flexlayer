#!/usr/bin/env node
import { nodeVersionError } from './node-version.js'

const problem = nodeVersionError()
if (problem) {
  console.error(problem)
  process.exit(1)
}

const { main } = await import('./cli-main.js')
main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
