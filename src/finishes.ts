/**
 * 一个 finish 的完整物理定义。
 *
 * 这张表是唯一来源：TS 解析、Cycles 导出都从这里读，数值跟
 * `flexlayer-render/src/material.rs` 的 `PRESETS` 逐项对齐（`finishes.spec.ts`
 * 会核对）。作者写裸名字、写数字、写 `finish` 子句，落到的是同一行，所以
 * `metal`、`metal 0.28`、`finish metal, roughness 0.28` 渲染结果完全一样。
 */
export type FinishName =
  | 'matte'
  | 'plastic'
  | 'metal'
  | 'glass'
  | 'clay'
  | 'mirror'
  | 'brushed'
  | 'lamp'
  | 'neon'

export type FinishPreset = {
  /** 不写 `fill` 时用的固有色。 */
  color: string
  roughness: number
  metalness: number
  clearcoat: number
  clearcoatRoughness: number
  sheen: number
  anisotropy: number
  transmission: number
  ior: number
  /** 自发光强度。`lamp` / `neon` 之外都是 0。 */
  emissiveStrength: number
}

const OPAQUE: Omit<FinishPreset, 'color' | 'roughness' | 'metalness'> = {
  clearcoat: 0,
  clearcoatRoughness: 0.05,
  sheen: 0,
  anisotropy: 0,
  transmission: 0,
  ior: 1.5,
  emissiveStrength: 0,
}

export const FINISHES: Record<FinishName, FinishPreset> = {
  matte: { ...OPAQUE, color: '#e4e0d8', roughness: 1, metalness: 0 },
  plastic: { ...OPAQUE, color: '#e4e0d8', roughness: 0.36, metalness: 0 },
  metal: { ...OPAQUE, color: '#c2c6cb', roughness: 0.28, metalness: 1 },
  glass: { ...OPAQUE, color: '#e8f2f0', roughness: 0.08, metalness: 0, transmission: 1 },
  clay: { ...OPAQUE, color: '#d4cfc4', roughness: 0.92, metalness: 0 },
  mirror: { ...OPAQUE, color: '#e4e7eb', roughness: 0.045, metalness: 1, clearcoatRoughness: 0.02 },
  brushed: { ...OPAQUE, color: '#c8ccd1', roughness: 0.4, metalness: 1, anisotropy: 0.9 },
  lamp: { ...OPAQUE, color: '#ffe6c2', roughness: 1, metalness: 0, emissiveStrength: 8 },
  neon: { ...OPAQUE, color: '#3ad8ff', roughness: 1, metalness: 0, emissiveStrength: 8 },
}

export const FINISH_NAMES = Object.keys(FINISHES) as FinishName[]

/** 自发光 finish：没有表面可调粗糙度，写数字会被拒。 */
export const EMISSIVE_FINISHES: ReadonlySet<string> = new Set(['lamp', 'neon'])

export function isFinishName(name: string): name is FinishName {
  return Object.prototype.hasOwnProperty.call(FINISHES, name)
}
