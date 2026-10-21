import { nodeVersionError } from './node-version.js'

const problem = nodeVersionError()
if (problem) throw new Error(problem)
