/** 和 flexlayer-render 的材质表同一份名字和默认色。测试会跟插件的 `matcapNames()` 对一下。 */
export const MATCAP_DEFAULTS: Record<string, string> = {
  clay: '#d4cfc4',
  plastic: '#e4e0d8',
  metal: '#c2c6cb',
  mirror: '#e4e7eb',
  brushed: '#c8ccd1',
}

export const MATCAP_NAMES = Object.keys(MATCAP_DEFAULTS)
