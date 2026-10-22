// Native mesh renderer wrapper
import { getNativeAddon } from './native-loader.mjs'

const addon = await getNativeAddon()

export function renderMeshNative(batches, width, height, camera, shadowMap = null, samples = 4) {
  if (!addon || !addon.renderMeshNative) {
    throw new Error('Native mesh renderer not available')
  }
  
  // Convert batches to native format
  const nativeBatches = batches.map(batch => ({
    positions: batch.positions,
    normals: batch.normals,
    uvs: batch.uvs || undefined,
    indices: batch.indices,
    r: batch.r,
    g: batch.g,
    b: batch.b,
    a: batch.a,
    material: batch.material === 'plastic' ? 1 : batch.material === 'metal' ? 2 : batch.material === 'glass' ? 3 : 0,
    roughness: batch.roughness,
    shaded: batch.shaded,
    doubleSided: batch.doubleSided,
    depthWrite: batch.depthWrite,
    castShadow: batch.castShadow,
    receiveShadow: batch.receiveShadow,
    toLayer: Array.from(batch.toLayer),
    originX: batch.originX,
    originY: batch.originY,
    owner: batch.owner,
    texture: batch.texture || undefined,
    textureWidth: batch.tw || 0,
    textureHeight: batch.th || 0,
    emissiveR: batch.emissiveR || 0,
    emissiveG: batch.emissiveG || 0,
    emissiveB: batch.emissiveB || 0,
  }))
  
  const input = {
    batches: nativeBatches,
    width,
    height,
    camera,
    shadowMap: shadowMap ? {
      depth: shadowMap.depth,
      width: shadowMap.width,
      height: shadowMap.height,
      rightX: shadowMap.right.x,
      rightY: shadowMap.right.y,
      rightZ: shadowMap.right.z,
      upX: shadowMap.up.x,
      upY: shadowMap.up.y,
      upZ: shadowMap.up.z,
      towardX: shadowMap.toward.x,
      towardY: shadowMap.toward.y,
      towardZ: shadowMap.toward.z,
      minU: shadowMap.minU,
      minV: shadowMap.minV,
      scaleU: shadowMap.scaleU,
      scaleV: shadowMap.scaleV,
      bias: shadowMap.bias,
    } : undefined,
    samples,
  }
  
  return addon.renderMeshNative(input)
}

export function rasterizeFill(config, batches, grounds = []) {
  if (!addon || !addon.rasterizeFill) {
    throw new Error('Native rasterizeFill is not available')
  }
  const nativeBatches = batches.map((batch) => ({
    positions: batch.positions,
    normals: batch.normals,
    uvs: batch.uvs || undefined,
    colors: batch.colors || undefined,
    indices: batch.indices,
    segmentIndices: batch.segmentIndices || undefined,
    pointIndices: batch.pointIndices || undefined,
    toLayer: Array.from(batch.toLayer),
    originX: batch.originX,
    originY: batch.originY,
    r: batch.r,
    g: batch.g,
    b: batch.b,
    a: batch.a,
    doubleSided: batch.doubleSided,
    shaded: batch.shaded,
    depthWrite: batch.depthWrite,
    castShadow: batch.castShadow,
    receiveShadow: batch.receiveShadow,
    material: batch.material,
    roughness: batch.roughness,
    matcap: batch.matcap || undefined,
    texture: batch.texture || undefined,
    tw: batch.tw || 0,
    th: batch.th || 0,
    emissiveR: batch.emissiveR || 0,
    emissiveG: batch.emissiveG || 0,
    emissiveB: batch.emissiveB || 0,
    owner: batch.owner,
    hasOutline: !!batch.outline,
    outlineX: batch.outline?.x ?? 0,
    outlineY: batch.outline?.y ?? 0,
    outlineZ: batch.outline?.z ?? 0,
    outlineR: batch.outline?.r ?? 0,
    linePx: batch.linePx ?? 1,
    pointPx: batch.pointPx ?? 1,
    albedo: batch.albedoMap?.rgba || undefined,
    albedoW: batch.albedoMap?.w ?? 0,
    albedoH: batch.albedoMap?.h ?? 0,
    albedoFlipY: batch.albedoMap?.flipY ?? true,
    albedoRepeatU: batch.albedoMap?.repeatU ?? 1,
    albedoRepeatV: batch.albedoMap?.repeatV ?? 1,
    albedoOffsetU: batch.albedoMap?.offsetU ?? 0,
    albedoOffsetV: batch.albedoMap?.offsetV ?? 0,
    albedoWrapS: batch.albedoMap?.wrapS ?? 1001,
    albedoWrapT: batch.albedoMap?.wrapT ?? 1001,
    hasAlbedo: !!batch.albedoMap,
    hasLines: !!batch.lines,
    lineMargin: batch.lines
      ? Math.max(batch.lines.widths[0], batch.lines.widths[1], batch.lines.widths[2], batch.lines.halo)
      : 0,
  }))
  const nativeGrounds = grounds.map((ground) => ({
    toLayer: Array.from(ground.toLayer),
    opacity: ground.opacity,
    hasFill: ground.hasFill,
    fillR: ground.fillR,
    fillG: ground.fillG,
    fillB: ground.fillB,
    fillA: ground.fillA,
    inkR: ground.inkR,
    inkG: ground.inkG,
    inkB: ground.inkB,
    inkA: ground.inkA,
    shadowBlur: ground.shadowBlur,
    receiveShadow: ground.receiveShadow,
  }))
  return addon.rasterizeFill(config, nativeBatches, nativeGrounds)
}

export function meshStrokeRuns(batches, depth, owners, pw, ph, parallel, focal, camX, camY, vanishX, vanishY, originX, originY, scaleX, scaleY, scale, mapX, mapY, canvasW, canvasH) {
  if (!addon || !addon.meshStrokeRuns) {
    throw new Error('Native meshStrokeRuns is not available')
  }
  return addon.meshStrokeRuns(batches, depth, owners, pw, ph, parallel, focal, camX, camY, vanishX, vanishY, originX, originY, scaleX, scaleY, scale, mapX, mapY, canvasW, canvasH)
}

export function circleOfConfusionNative(focal, z, aperture, focus, maxBlur, sharp) {
  return addon.circleOfConfusion(focal, z, aperture, focus, maxBlur, sharp)
}

export function planDepthOfField(pixels, width, height, depth, sharp, focal, aperture, focus, maxBlur, pixelScale) {
  return addon.planDepthOfField(pixels, width, height, depth, sharp, focal, aperture, focus, maxBlur, pixelScale)
}

export function compositeDof(nearest, coc, levels, sigmas, width, height, pad, dw, dh, pixelScale) {
  return addon.compositeDof(nearest, coc, levels, sigmas, width, height, pad, dw, dh, pixelScale)
}

export function downsampleSurfaceNative(color, depth, owners, sw, sh, dw, dh) {
  return addon.downsampleSurface(color, depth, owners, sw, sh, dw, dh)
}

export function coverStrokesNative(color, depth, sharp, w, h) {
  return addon.coverStrokes(color, depth, sharp, w, h)
}

export function clampCornersNative(w, h, topLeft, topRight, bottomRight, bottomLeft) {
  return addon.clampCorners(w, h, topLeft, topRight, bottomRight, bottomLeft)
}

export function roundRectCommands(x, y, w, h, rx, ry) {
  return addon.roundRectCommands(x, y, w, h, rx, ry)
}

export function roundedCornerCommands(x, y, w, h, tl, tr, br, bl) {
  return addon.roundedCornerCommands(x, y, w, h, tl, tr, br, bl)
}

export function borderQuads(x, y, w, h, top, right, bottom, left) {
  return addon.borderQuads(x, y, w, h, top, right, bottom, left)
}

export function buildSphereMesh(radius, tx, ty) {
  return addon.buildSphereMesh(radius, tx, ty)
}

export function buildBoxMesh(hw, hh, hd, rx, edges, tx, ty) {
  return addon.buildBoxMesh(hw, hh, hd, rx, edges, tx, ty)
}

export function buildCylinderMesh(axisZ, radius, height, rx, rims, tx, ty) {
  return addon.buildCylinderMesh(axisZ, radius, height, rx, rims, tx, ty)
}

export function buildTorusMesh(major, tube, tx, ty) {
  return addon.buildTorusMesh(major, tube, tx, ty)
}

export function buildTubeMesh(radius, ox, oy, rings) {
  return addon.buildTubeMesh(radius, ox, oy, rings)
}

export function buildExtrudeMesh(depth, fillRule, ox, oy, rings) {
  return addon.buildExtrudeMesh(depth, fillRule, ox, oy, rings)
}

export function meshExtractEdges(positions, indices) {
  return addon.meshExtractEdges(positions, indices)
}

export function uniformSphereNative(toLayer, originX, originY, x, y, z, radius) {
  return addon.uniformSphere(toLayer, originX, originY, x, y, z, radius)
}

export function transformPointNative(toLayer, ox, oy, gx, gy, gz) {
  return addon.transformPoint(toLayer, ox, oy, gx, gy, gz)
}

export function transformNormalNative(toLayer, nx, ny, nz) {
  return addon.transformNormal(toLayer, nx, ny, nz)
}

export function sphereRingPoints(cx, cy, cz, radius, vx, vy, parallel, focal) {
  if (!addon || !addon.sphereRingPoints) {
    throw new Error('Native sphereRingPoints is not available')
  }
  return addon.sphereRingPoints(cx, cy, cz, radius, vx, vy, parallel, focal)
}
