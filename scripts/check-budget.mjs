/**
 * Fail when a bench-3d scene is more than 15% over the plan budget.
 *   npx tsx scripts/check-budget.mjs bench-3d.json
 *
 * Budgets are the draft limits from the kernel plan, in milliseconds.
 * macbook-pro is 800. The 1080p solid scene is 200. Five cards are 60.
 * The torus row uses the 150ms knot budget.
 */
import { readFileSync } from 'node:fs'

const budgets = {
  'box-sphere-ground': 200,
  'torus-ground': 200,
  torus: 150,
  strokes: 200,
  cards: 60,
  'macbook-pro': 800,
  // QUALITY-6 §F.2.3: 30 frames of a camera orbit, whole run.
  'anim-orbit-30': 8000,
}

const file = process.argv[2]
if (!file) {
  console.error('usage: npx tsx scripts/check-budget.mjs bench-3d.json')
  process.exit(1)
}
const report = JSON.parse(readFileSync(file, 'utf8'))
const scenes = Array.isArray(report.scenes) ? report.scenes : []
let failed = false
for (const row of scenes) {
  const budget = budgets[row.name]
  if (budget == null) {
    console.error(`no budget for ${row.name}`)
    failed = true
    continue
  }
  const limit = budget * 1.15
  const ok = row.ms <= limit
  console.log(`${row.name}  ${row.ms} ms  budget ${budget} ms  limit ${limit.toFixed(0)} ms  ${ok ? 'ok' : 'OVER'}`)
  if (!ok) failed = true
}
if (failed) process.exit(1)
