/**
 * 字体推荐，按档选型。中文分三档，最推荐在前。英文一档，都偏艺术标题。等宽一档，两款拉丁等宽。
 * 这里登记选型名字。黑体、宋体、楷体、仿宋、圆体已经在字体目录里，写名字就会下载。
 * 其余要自己带文件：`<font family="ChillReunion" src="…" />`。
 */

export type RecommendedFont = {
  /** 写进 `font-family` 或 `<font family>` 的名字 */
  family: string
  title: string
  /** 已经在字体目录里，写名字就会准备，不必再带文件 */
  builtin?: boolean
}

export type FontRecommendation = {
  /** 最推荐、推荐、其他、英文、等宽 */
  name: string
  /** 这一档怎么用 */
  use: string
  fonts: RecommendedFont[]
}

/** 顺序即选型顺序。 */
export const RECOMMENDED_FONTS: readonly FontRecommendation[] = [
  {
    name: '最推荐',
    use: '优先选用',
    fonts: [
      { family: 'ChillDuanSans', title: '寒蝉端黑体', builtin: true },
      { family: 'ChillDuanHeiSong', title: '寒蝉端黑宋', builtin: true },
    ],
  },
  {
    name: '推荐',
    use: '常用',
    fonts: [
      { family: 'ChillCalligraphyChunQiu', title: '寒蝉书体·春秋' },
      { family: 'ChillLongCangKai', title: '寒蝉龙藏楷书' },
      { family: 'ChillDINGothic', title: '寒蝉德黑体' },
      { family: 'ChillGSans', title: '寒蝉高黑体' },
      { family: 'ChillJinshuSongCC', title: '寒蝉锦书宋 CC' },
      { family: 'ChillKai', title: '寒蝉楷体', builtin: true },
      { family: 'ChillKSans', title: '寒蝉宽黑体' },
      { family: 'ChillHuoSongF', title: '寒蝉活宋体·復' },
      { family: 'ChillHuoKai', title: '寒蝉活楷体' },
      { family: 'ChillHuoGothicF', title: '寒蝉活黑体·復' },
      { family: 'ChillHuoFangSong', title: '寒蝉活仿宋', builtin: true },
      { family: 'ChillHuoFangKaiF', title: '寒蝉活仿楷·復' },
      { family: 'ChillReunion', title: '寒蝉团圆体' },
      { family: 'ChillRoundF', title: '寒蝉全圆体', builtin: true },
      { family: 'ChillRoundM', title: '寒蝉半圆体' },
      { family: 'ChillRoundGothic', title: '寒蝉圆黑体' },
      { family: 'ChillZhuo', title: '寒蝉手拙体' },
      { family: 'ChillInorganic', title: '寒蝉无机体' },
      { family: 'ChillOrganic', title: '寒蝉有机体' },
      { family: 'ChillYunmoGothic', title: '寒蝉云墨黑' },
      { family: 'ChillZhuoKai', title: '寒蝉拙楷体' },
    ],
  },
  {
    name: '其他',
    use: '备选',
    fonts: [
      { family: 'AlimamaShuHeiTi', title: '阿里妈妈数黑体' },
      { family: 'JingNanBoBoHei', title: '荆南波波黑体' },
      { family: 'ZiKuXingQiuFeiYangTi', title: '字库星球飞扬体' },
      { family: 'DouYuZhuiGuangTi', title: '斗鱼追光体' },
      { family: 'XiHuanTi', title: '字制区喜脉喜欢体' },
      { family: 'SlideYouran', title: '演示悠然小楷' },
      { family: 'ZhiMangXing', title: '钟齐志莽行书' },
      { family: 'MaokenFengYaSong', title: '猫啃网风雅宋' },
      { family: 'DymonShouXieTi', title: '呆萌手写体' },
      { family: 'MaoKenTangYuan', title: '猫啃网糖圆体' },
      { family: 'NanxiChuxiaSong', title: '南西初夏宋' },
      { family: 'YEFONTXiaoShiTou', title: '也字工厂小石头' },
      { family: 'QianTuBiFengShouXieTi', title: '千图笔锋手写体' },
      { family: 'WenxinXile', title: '文心喜乐体' },
      { family: 'XuandongKaishu', title: '玄冬楷书' },
      { family: 'JingNanYuanTi', title: '荆南圆体' },
    ],
  },
  {
    name: '英文',
    use: '艺术标题',
    fonts: [
      { family: 'Playfair', title: 'Playfair Display', builtin: true },
      { family: 'Fraunces', title: 'Fraunces', builtin: true },
      { family: 'Instrument', title: 'Instrument Serif', builtin: true },
      { family: 'Cormorant', title: 'Cormorant Garamond', builtin: true },
      { family: 'AbrilFatface', title: 'Abril Fatface', builtin: true },
      { family: 'Cinzel', title: 'Cinzel', builtin: true },
      { family: 'Syne', title: 'Syne', builtin: true },
      { family: 'Monoton', title: 'Monoton', builtin: true },
      { family: 'GreatVibes', title: 'Great Vibes', builtin: true },
    ],
  },
  {
    name: '等宽',
    use: '代码',
    fonts: [
      { family: 'JetBrainsMono', title: 'JetBrains Mono', builtin: true },
      { family: 'SpaceMono', title: 'Space Mono', builtin: true },
    ],
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

/** 用家族名或中文名查一档推荐。 */
export function recommendedFont(name: string): { group: string; font: RecommendedFont } | undefined {
  return recommendedByKey.get(name.trim().toLowerCase())
}
