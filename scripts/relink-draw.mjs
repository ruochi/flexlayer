import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

const dist = new URL('../dist/', import.meta.url)
const draw = new URL('../native/flexlayer-render/draw/', import.meta.url)

for (const name of readdirSync(dist)) {
  if (!name.endsWith('.js')) continue
  const file = new URL(name, dist)
  const text = readFileSync(file, 'utf8')
  const next = text.replaceAll(/(native\/flexlayer-render\/draw\/[\w-]+)\.mjs/g, (all, stem) => {
    if (stem.endsWith('-dist')) return all
    const twin = stem.slice(stem.lastIndexOf('/') + 1) + '-dist.mjs'
    if (!existsSync(new URL(twin, draw))) return all
    return `${stem}-dist.mjs`
  })
  if (next !== text) writeFileSync(file, next)
}
