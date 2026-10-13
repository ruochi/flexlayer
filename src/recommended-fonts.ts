/**
 * 按气质推荐字体，给画面选型用。粗黑体在前。
 * 这里只登记名字。寒蝉端黑体已在字体目录里，是默认字体。
 * 其余要自己带文件：`<font family="DeYiHei" src="…" />`。
 */

export type RecommendedFont = {
  /** 写进 `font-family` 或 `<font family>` 的名字 */
  family: string
  title: string
  /** 字体目录里已有。没写字体时用这一款 */
  builtin?: boolean
}

export type FontRecommendation = {
  /** 粗黑体、瘦黑体、圆体、宋体、手写体、广告体 */
  name: string
  /** 这一组适合放哪 */
  use: string
  fonts: RecommendedFont[]
}

/** 顺序即选型顺序。 */
export const RECOMMENDED_FONTS: readonly FontRecommendation[] = [
  {
    name: '粗黑体',
    use: '主标题',
    fonts: [{ family: 'ChillDuanSans', title: '寒蝉端黑体', builtin: true }],
  },
  {
    name: '瘦黑体',
    use: '细长黑体',
    fonts: [
      { family: 'DeYiHei', title: '得意黑' },
      { family: 'ZhuoTeQingYaTi', title: '卓特清雅体' },
    ],
  },
  {
    name: '圆体',
    use: '圆角标题',
    fonts: [
      { family: 'JingNanBoBoHei', title: '荆南波波黑体' },
      { family: 'JingNanYuanTi', title: '荆南圆体' },
      { family: 'MaoKenZhuYuanTi', title: '猫啃珠圆体' },
      { family: 'TangYuanTi', title: '猫啃糖圆体' },
    ],
  },
  {
    name: '宋体',
    use: '宋体标题与正文',
    fonts: [
      { family: 'FengYaSong', title: '猫啃风雅宋体' },
      { family: 'NaXiChuXiaSong', title: '南西初夏宋体' },
    ],
  },
  {
    name: '手写体',
    use: '手写',
    fonts: [{ family: 'YeZiGongChangXiaoShiTou', title: '也字工厂小石头体' }],
  },
  {
    name: '广告体',
    use: '广告标题',
    fonts: [{ family: 'DouYuZhuiGuangTi', title: '斗鱼追光体' }],
  },
]

const recommendedByKey = new Map<string, { group: string; font: RecommendedFont }>()
for (const group of RECOMMENDED_FONTS) {
  for (const font of group.fonts) {
    const hit = { group: group.name, font }
    recommendedByKey.set(font.family.toLowerCase(), hit)
    recommendedByKey.set(font.title.trim().toLowerCase(), hit)
  }
}

/** 用家族名或中文名查一组推荐。 */
export function recommendedFont(name: string): { group: string; font: RecommendedFont } | undefined {
  return recommendedByKey.get(name.trim().toLowerCase())
}
