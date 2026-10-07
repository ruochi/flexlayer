/** 根号笔画：小钩在左下，斜笔收到钩的中部，横线盖住被开方内容。坐标原点在根号盒子左上角，y 向下。 */
export type SqrtPathCtx = {
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
}

export function paintMathSqrtPath(
  ctx: SqrtPathCtx,
  width: number,
  height: number,
  surdWidth: number,
  thickness: number,
): void {
  const sw = Math.min(Math.max(surdWidth, thickness * 2), Math.max(width - thickness / 2, thickness * 2))
  const top = thickness / 2
  const bottom = Math.max(top, height - thickness / 2)
  const tipX = sw * 0.32
  const midX = sw * 0.58
  const midY = bottom - (bottom - top) * 0.22
  const startX = thickness / 2
  const startY = bottom - (bottom - top) * 0.38

  ctx.beginPath()
  ctx.moveTo(startX, startY)
  ctx.lineTo(tipX, bottom)
  ctx.lineTo(midX, midY)
  ctx.lineTo(sw, top)
  ctx.lineTo(Math.max(sw, width - thickness / 2), top)
}
