/**
 * Preload script for injecting native addon into sandboxed script context.
 * This runs in the child process BEFORE the permission model activates,
 * allowing the native addon to load. User scripts then access the pre-loaded
 * functions via globalThis.__flexlayerNativeAddon without needing fs-read permissions.
 */

try {
  const path = require('node:path')
  const fs = require('node:fs')
  
  // Find the flexlayer-render native addon
  // This module is in src/ or dist/, so package root is one level up
  const thisFile = typeof __filename !== 'undefined' ? __filename : require.resolve('./native-preload.cjs')
  const thisDir = path.dirname(thisFile)
  const packageRoot = path.dirname(thisDir)
  const renderDir = path.join(packageRoot, 'native', 'flexlayer-render')
  
  if (fs.existsSync(renderDir)) {
    const indexPath = path.join(renderDir, 'index.cjs')
    if (fs.existsSync(indexPath)) {
      const addon = require(indexPath)
      // Inject all native functions into global scope
      globalThis.__flexlayerNativeAddon = addon
    }
  }
} catch (err) {
  // Addon loading failed - wrappers will fall back to JS implementations
  // Don't throw here; let the main script continue
}
