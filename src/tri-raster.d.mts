export const MESH_SAMPLES: 4

export function walkTriangle(
  width: number,
  height: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  visit: (x: number, y: number, w0: number, w1: number, w2: number) => void,
): void

export function resolveGrid(
  color: Uint8ClampedArray,
  sw: number,
  dw: number,
  dh: number,
  samples: number,
  dst: Uint8ClampedArray,
): boolean
