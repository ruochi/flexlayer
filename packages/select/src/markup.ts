function sizeOf(width: number, height: number): string {
  return `style="width:${width}px; height:${height}px"`
}

/**
 * 文字插在主体后面的三层写法：原图、留给文字的空位、抠好的主体。
 * `subject` 和原图一样大，两行 `style` 抄同一份，一定对齐。文字放进第二层，`y` 取主体顶边往下一截。
 */
export function sandwichMarkup(input: { src: string; subject: string; width: number; height: number }): string {
  const size = sizeOf(input.width, input.height)
  return [
    `<layer width="${input.width}" height="${input.height}" background="#000">`,
    `  <img src="${input.src}" ${size} />`,
    `  <!-- 文字放这里：<layer x y anchor="bottom" anchor-box="ink"><h1>…</h1></layer> -->`,
    `  <img src="${input.subject}" ${size} />`,
    `</layer>`,
    ``,
  ].join('\n')
}
