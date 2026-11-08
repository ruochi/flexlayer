import { readLayerRoot, prepareAssets, layoutSync } from '../src/layout.ts'
import { resolveCamera } from '../src/camera.ts'
import { readFileSync } from 'node:fs'

const opened = readLayerRoot(readFileSync('../flexlayer/examples/solids.layer','utf8'))
const assets = await prepareAssets(opened.root, '/Users/ruochi/project/flexlayer-mac/flexlayer/examples', { fonts: opened.fonts })
const doc = layoutSync(opened.root, assets)
const layer = doc.root.kind === 'layer' ? doc.root : null
console.log('perspective', layer?.perspective, 'view', (layer as any)?.cameraView)
const cam = resolveCamera('fov 30, orbit 28 32, distance 1250, at 480 560 0', 960, 600)
console.log(JSON.stringify(cam.camera))
