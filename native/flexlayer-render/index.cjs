'use strict'
const { existsSync } = require('fs')
const { join } = require('path')

const { platform, arch } = process

function musl() {
  if (!process.report || typeof process.report.getReport !== 'function') return false
  return !process.report.getReport().header.glibcVersionRuntime
}

function binaryName() {
  if (platform === 'linux' && arch === 'x64') {
    return musl() ? 'flexlayer-render.linux-x64-musl.node' : 'flexlayer-render.linux-x64-gnu.node'
  }
  if (platform === 'linux' && arch === 'arm64') {
    return musl() ? 'flexlayer-render.linux-arm64-musl.node' : 'flexlayer-render.linux-arm64-gnu.node'
  }
  if (platform === 'darwin' && arch === 'arm64') return 'flexlayer-render.darwin-arm64.node'
  if (platform === 'darwin' && arch === 'x64') return 'flexlayer-render.darwin-x64.node'
  if (platform === 'win32' && arch === 'x64') return 'flexlayer-render.win32-x64-msvc.node'
  if (platform === 'win32' && arch === 'arm64') return 'flexlayer-render.win32-arm64-msvc.node'
  return null
}

const name = binaryName()
const file = name && join(__dirname, name)
if (!file || !existsSync(file)) {
  throw new Error('flexlayer-render has no binary for ' + platform + '-' + arch)
}

const binding = require(file)
module.exports = binding
