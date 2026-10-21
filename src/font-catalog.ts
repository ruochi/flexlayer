/**
 * 可直接使用的字体。`role` 不是 `default` 的，写 `font-family` 就会下载并注册。
 * 地址必须是字体文件。`fonts.googleapis.com/css2` 返回的是样式表，不能写进 `<font src>`。
 */

export type CatalogFace = {
  file: string
  weight: number
  url: string
  /** 注册到画布上的名字。常规档与 `family` 相同，粗体加 Bold */
  registeredAs: string
  /** `url` 是 zip 时，要取出的条目路径 */
  entry?: string
}

export type CatalogFont = {
  /** 写进 `font-family` 的名字 */
  family: string
  title: string
  /** `default` 是没写字体时的那一款，不走多档注册 */
  role: 'default' | 'builtin' | 'google'
  source: string
  license: string
  covers: string
  /** 适合放哪 */
  use: string
  sample: string
  /** 字重轴或档位说明 */
  weights: string
  aliases: string[]
  faces: CatalogFace[]
}

const FONTSOURCE = 'https://cdn.jsdelivr.net/npm/@fontsource'

function woff(pkg: string, version: string, file: string, weight: number, registeredAs: string): CatalogFace {
  return { file, weight, registeredAs, url: `${FONTSOURCE}/${pkg}@${version}/files/${file}` }
}

/** Material Symbols 的字体名。网页上的 class 也会选这套。字重按 100–700 的整百取最近一档。 */
export const ICON_FONT_FAMILY = 'Symbols'

function symbolFace(weight: number, registeredAs: string): CatalogFace {
  return woff(
    'material-symbols-outlined',
    V,
    `material-symbols-outlined-latin-${weight}-normal.woff`,
    weight,
    registeredAs,
  )
}

const V = '5.2.8'

export const DEFAULT_FONT: CatalogFont = {
  family: 'ChillDuanSans',
  title: '寒蝉端黑体',
  role: 'default',
  source: 'https://banling1.oss-cn-beijing.aliyuncs.com/weixin/dc/fonts/ChillDuanSansVF.ttf',
  license: '随字体文件',
  covers: '简体中文、拉丁',
  use: '正文默认',
  sample: '春眠不觉晓',
  weights: '可变，轴约 300–800',
  aliases: ['寒蝉端黑体', '黑体'],
  faces: [
    {
      file: 'ChillDuanSansVF.ttf',
      weight: 300,
      registeredAs: 'ChillDuanSans',
      url: 'https://banling1.oss-cn-beijing.aliyuncs.com/weixin/dc/fonts/ChillDuanSansVF.ttf',
    },
  ],
}

/** 写了名字就会准备的字体。顺序即文档顺序。 */
export const REGISTERED_FONTS: CatalogFont[] = [
  {
    family: 'ChillDuanHeiSong',
    title: '寒蝉端黑宋',
    role: 'builtin',
    source: 'https://github.com/Warren2060/ChillDuanHeiSong/releases/download/v1.200/ChillDuanHeiSongPro_v1.2.zip',
    license: 'OFL',
    covers: '简体中文',
    use: '正文宋体',
    sample: '春眠不觉晓',
    weights: '400',
    aliases: ['宋体', 'Song', '寒蝉端黑宋'],
    faces: [
      {
        file: 'ChillDuanHeiSongPro_Regular.otf',
        weight: 400,
        registeredAs: 'ChillDuanHeiSong',
        url: 'https://github.com/Warren2060/ChillDuanHeiSong/releases/download/v1.200/ChillDuanHeiSongPro_v1.2.zip',
        entry: '寒蝉端黑宋Pro v1.2/ChillDuanHeiSongPro_Regular.otf',
      },
    ],
  },
  {
    family: 'ChillKai',
    title: '寒蝉楷体',
    role: 'builtin',
    source: 'https://github.com/Warren2060/Chillkai/releases/download/v2.000/ChillKai.zip',
    license: 'OFL',
    covers: '简体中文',
    use: '楷体',
    sample: '春眠不觉晓',
    weights: '400',
    aliases: ['楷体', 'Kai', '寒蝉楷体'],
    faces: [
      {
        file: 'ChillKai.woff',
        weight: 400,
        registeredAs: 'ChillKai',
        url: 'https://github.com/Warren2060/Chillkai/releases/download/v2.000/ChillKai.zip',
        entry: 'ChillKai/ChillKai.woff',
      },
    ],
  },
  {
    family: 'ChillHuoFangSong',
    title: '寒蝉活仿宋',
    role: 'builtin',
    source: 'https://github.com/Warren2060/ChillMovableType/releases/download/HuoFangSongv0.100/ChillHuoFangSong.zip',
    license: 'OFL',
    covers: '简体中文',
    use: '仿宋',
    sample: '春眠不觉晓',
    weights: '400',
    aliases: ['仿宋', '寒蝉活仿宋'],
    faces: [
      {
        file: 'ChillHuoFangSong_Regular.otf',
        weight: 400,
        registeredAs: 'ChillHuoFangSong',
        url: 'https://github.com/Warren2060/ChillMovableType/releases/download/HuoFangSongv0.100/ChillHuoFangSong.zip',
        entry: 'ChillHuoFangSong_Regular.otf',
      },
    ],
  },
  {
    family: 'ChillRoundF',
    title: '寒蝉全圆体',
    role: 'builtin',
    source: 'https://github.com/Warren2060/ChillRound/releases/download/v3.000/ChillRoundF.ttf',
    license: 'OFL',
    covers: '简体中文',
    use: '圆体',
    sample: '春眠不觉晓',
    weights: '400',
    aliases: ['圆体', '寒蝉全圆体'],
    faces: [
      {
        file: 'ChillRoundF.ttf',
        weight: 400,
        registeredAs: 'ChillRoundF',
        url: 'https://github.com/Warren2060/ChillRound/releases/download/v3.000/ChillRoundF.ttf',
      },
    ],
  },
  {
    family: 'Brush',
    title: '马善政毛笔楷书',
    role: 'builtin',
    source: 'Ma Shan Zheng（Google Fonts，简体子集）',
    license: 'OFL',
    covers: '简体中文',
    use: '书法标题',
    sample: '春眠不觉晓',
    weights: '400',
    aliases: ['书法', '毛笔', 'mashanzheng', 'ma shan zheng'],
    faces: [
      {
        ...woff('ma-shan-zheng', V, 'ma-shan-zheng-chinese-simplified-400-normal.woff', 400, 'Brush'),
        file: 'MaShanZheng-Regular.woff',
      },
    ],
  },
  {
    family: 'Inter',
    title: 'Inter',
    role: 'google',
    source: 'Inter（Google Fonts，拉丁子集）',
    license: 'OFL',
    covers: '拉丁',
    use: '界面与英文正文',
    sample: 'Hello',
    weights: '400、700',
    aliases: ['inter'],
    faces: [
      woff('inter', V, 'inter-latin-400-normal.woff', 400, 'Inter'),
      woff('inter', V, 'inter-latin-700-normal.woff', 700, 'InterBold'),
    ],
  },
  {
    family: 'JetBrainsMono',
    title: 'JetBrains Mono',
    role: 'google',
    source: 'JetBrains Mono（Google Fonts，拉丁子集）',
    license: 'OFL',
    covers: '拉丁',
    use: '代码与等宽',
    sample: 'const n = 1',
    weights: '400、700',
    aliases: ['jetbrains mono', 'jetbrains-mono', '等宽'],
    faces: [
      woff('jetbrains-mono', V, 'jetbrains-mono-latin-400-normal.woff', 400, 'JetBrainsMono'),
      woff('jetbrains-mono', V, 'jetbrains-mono-latin-700-normal.woff', 700, 'JetBrainsMonoBold'),
    ],
  },
  {
    family: 'SpaceMono',
    title: 'Space Mono',
    role: 'google',
    source: 'Space Mono（Google Fonts，拉丁子集）',
    license: 'OFL',
    covers: '拉丁',
    use: '宽体等宽',
    sample: 'const n = 1',
    weights: '400、700',
    aliases: ['space mono', 'space-mono'],
    faces: [
      woff('space-mono', V, 'space-mono-latin-400-normal.woff', 400, 'SpaceMono'),
      woff('space-mono', V, 'space-mono-latin-700-normal.woff', 700, 'SpaceMonoBold'),
    ],
  },
  {
    family: 'Playfair',
    title: 'Playfair Display',
    role: 'google',
    source: 'Playfair Display（Google Fonts，拉丁子集）',
    license: 'OFL',
    covers: '拉丁',
    use: '英文标题',
    sample: 'Hello',
    weights: '400、700',
    aliases: ['playfair display'],
    faces: [
      woff('playfair-display', V, 'playfair-display-latin-400-normal.woff', 400, 'Playfair'),
      woff('playfair-display', V, 'playfair-display-latin-700-normal.woff', 700, 'PlayfairBold'),
    ],
  },
  {
    family: 'Baskerville',
    title: 'Libre Baskerville',
    role: 'google',
    source: 'Libre Baskerville（Google Fonts，拉丁子集）',
    license: 'OFL',
    covers: '拉丁',
    use: '英文正文衬线',
    sample: 'Hello',
    weights: '400、700',
    aliases: ['libre baskerville'],
    faces: [
      woff('libre-baskerville', V, 'libre-baskerville-latin-400-normal.woff', 400, 'Baskerville'),
      woff('libre-baskerville', V, 'libre-baskerville-latin-700-normal.woff', 700, 'BaskervilleBold'),
    ],
  },
  {
    family: 'Oswald',
    title: 'Oswald',
    role: 'google',
    source: 'Oswald（Google Fonts，拉丁子集）',
    license: 'OFL',
    covers: '拉丁',
    use: '窄标题',
    sample: 'HELLO',
    weights: '400、700',
    aliases: ['oswald'],
    faces: [
      woff('oswald', V, 'oswald-latin-400-normal.woff', 400, 'Oswald'),
      woff('oswald', V, 'oswald-latin-700-normal.woff', 700, 'OswaldBold'),
    ],
  },
  {
    family: 'SpaceGrotesk',
    title: 'Space Grotesk',
    role: 'google',
    source: 'Space Grotesk（Google Fonts，拉丁子集）',
    license: 'OFL',
    covers: '拉丁',
    use: '几何无衬线',
    sample: 'Hello',
    weights: '400、700',
    aliases: ['space grotesk'],
    faces: [
      woff('space-grotesk', V, 'space-grotesk-latin-400-normal.woff', 400, 'SpaceGrotesk'),
      woff('space-grotesk', V, 'space-grotesk-latin-700-normal.woff', 700, 'SpaceGroteskBold'),
    ],
  },
  {
    family: 'Cormorant',
    title: 'Cormorant Garamond',
    role: 'google',
    source: 'Cormorant Garamond（Google Fonts，拉丁子集）',
    license: 'OFL',
    covers: '拉丁',
    use: '细衬线标题',
    sample: 'Hello',
    weights: '400、700',
    aliases: ['cormorant garamond', 'cormorant'],
    faces: [
      woff('cormorant-garamond', V, 'cormorant-garamond-latin-400-normal.woff', 400, 'Cormorant'),
      woff('cormorant-garamond', V, 'cormorant-garamond-latin-700-normal.woff', 700, 'CormorantBold'),
    ],
  },
  {
    family: 'Bebas',
    title: 'Bebas Neue',
    role: 'google',
    source: 'Bebas Neue（Google Fonts，拉丁子集）',
    license: 'OFL',
    covers: '拉丁',
    use: '全大写展示字',
    sample: 'HELLO',
    weights: '400',
    aliases: ['bebas neue'],
    faces: [woff('bebas-neue', '5.2.6', 'bebas-neue-latin-400-normal.woff', 400, 'Bebas')],
  },
  {
    family: 'Newsreader',
    title: 'Newsreader',
    role: 'google',
    source: 'Newsreader（Google Fonts，拉丁子集）',
    license: 'OFL',
    covers: '拉丁',
    use: '阅读衬线',
    sample: 'Hello',
    weights: '400、700',
    aliases: ['newsreader'],
    faces: [
      woff('newsreader', V, 'newsreader-latin-400-normal.woff', 400, 'Newsreader'),
      woff('newsreader', V, 'newsreader-latin-700-normal.woff', 700, 'NewsreaderBold'),
    ],
  },
  {
    family: 'Fraunces',
    title: 'Fraunces',
    role: 'google',
    source: 'Fraunces（Google Fonts，拉丁子集）',
    license: 'OFL',
    covers: '拉丁',
    use: '软衬线标题',
    sample: 'Hello',
    weights: '400、700',
    aliases: ['fraunces'],
    faces: [
      woff('fraunces', V, 'fraunces-latin-400-normal.woff', 400, 'Fraunces'),
      woff('fraunces', V, 'fraunces-latin-700-normal.woff', 700, 'FrauncesBold'),
    ],
  },
  {
    family: 'Instrument',
    title: 'Instrument Serif',
    role: 'google',
    source: 'Instrument Serif（Google Fonts，拉丁子集）',
    license: 'OFL',
    covers: '拉丁',
    use: '展示衬线',
    sample: 'Hello',
    weights: '400',
    aliases: ['instrument serif'],
    faces: [woff('instrument-serif', V, 'instrument-serif-latin-400-normal.woff', 400, 'Instrument')],
  },
  {
    family: 'AbrilFatface',
    title: 'Abril Fatface',
    role: 'google',
    source: 'Abril Fatface（Google Fonts，拉丁子集）',
    license: 'OFL',
    covers: '拉丁',
    use: '粗胖海报衬线',
    sample: 'Hello',
    weights: '400',
    aliases: ['abril fatface'],
    faces: [woff('abril-fatface', '5.3.0', 'abril-fatface-latin-400-normal.woff', 400, 'AbrilFatface')],
  },
  {
    family: 'Cinzel',
    title: 'Cinzel',
    role: 'google',
    source: 'Cinzel（Google Fonts，拉丁子集）',
    license: 'OFL',
    covers: '拉丁',
    use: '罗马碑刻大写',
    sample: 'HELLO',
    weights: '400、700',
    aliases: ['cinzel'],
    faces: [
      woff('cinzel', '5.3.0', 'cinzel-latin-400-normal.woff', 400, 'Cinzel'),
      woff('cinzel', '5.3.0', 'cinzel-latin-700-normal.woff', 700, 'CinzelBold'),
    ],
  },
  {
    family: 'Syne',
    title: 'Syne',
    role: 'google',
    source: 'Syne（Google Fonts，拉丁子集）',
    license: 'OFL',
    covers: '拉丁',
    use: '前卫几何标题',
    sample: 'Hello',
    weights: '400、700',
    aliases: ['syne'],
    faces: [
      woff('syne', '5.3.0', 'syne-latin-400-normal.woff', 400, 'Syne'),
      woff('syne', '5.3.0', 'syne-latin-700-normal.woff', 700, 'SyneBold'),
    ],
  },
  {
    family: 'Monoton',
    title: 'Monoton',
    role: 'google',
    source: 'Monoton（Google Fonts，拉丁子集）',
    license: 'OFL',
    covers: '拉丁',
    use: '霓虹线条大字',
    sample: 'HELLO',
    weights: '400',
    aliases: ['monoton'],
    faces: [woff('monoton', '5.3.0', 'monoton-latin-400-normal.woff', 400, 'Monoton')],
  },
  {
    family: 'GreatVibes',
    title: 'Great Vibes',
    role: 'google',
    source: 'Great Vibes（Google Fonts，拉丁子集）',
    license: 'OFL',
    covers: '拉丁',
    use: '花体手写',
    sample: 'Hello',
    weights: '400',
    aliases: ['great vibes'],
    faces: [woff('great-vibes', '5.3.0', 'great-vibes-latin-400-normal.woff', 400, 'GreatVibes')],
  },
  {
    family: 'STIXTwoMath',
    title: 'STIX Two Math',
    role: 'google',
    source: 'STIX Two Math（Google Fonts）',
    license: 'OFL',
    covers: '拉丁、希腊、数学符号',
    use: '公式。`<math>` 默认用它',
    sample: '∑ 𝑥²',
    weights: '400',
    aliases: ['stix two math', 'stixmath', 'stix'],
    faces: [woff('stix-two-math', '5.3.0', 'stix-two-math-latin-400-normal.woff', 400, 'STIXTwoMath')],
  },
  {
    family: 'XiaoWei',
    title: '站酷小薇',
    role: 'google',
    source: 'ZCOOL XiaoWei（Google Fonts，简体子集）',
    license: 'OFL',
    covers: '简体中文',
    use: '宋意标题',
    sample: '春眠不觉晓',
    weights: '400',
    aliases: ['站酷小薇', 'zcool xiaowei', 'zcoolxiaowei'],
    faces: [woff('zcool-xiaowei', V, 'zcool-xiaowei-chinese-simplified-400-normal.woff', 400, 'XiaoWei')],
  },
  {
    family: 'KuaiLe',
    title: '站酷快乐体',
    role: 'google',
    source: 'ZCOOL KuaiLe（Google Fonts，简体子集）',
    license: 'OFL',
    covers: '简体中文',
    use: '活泼标题',
    sample: '春眠不觉晓',
    weights: '400',
    aliases: ['站酷快乐体', 'zcool kuaile', 'zcoolkuaile'],
    faces: [woff('zcool-kuaile', V, 'zcool-kuaile-chinese-simplified-400-normal.woff', 400, 'KuaiLe')],
  },
  {
    family: 'MaoCao',
    title: '刘建毛草',
    role: 'google',
    source: 'Liu Jian Mao Cao（Google Fonts，简体子集）',
    license: 'OFL',
    covers: '简体中文',
    use: '手写',
    sample: '春眠不觉晓',
    weights: '400',
    aliases: ['刘建毛草', 'liu jian mao cao', 'liujianmaocao'],
    faces: [woff('liu-jian-mao-cao', V, 'liu-jian-mao-cao-chinese-simplified-400-normal.woff', 400, 'MaoCao')],
  },
  {
    family: ICON_FONT_FAMILY,
    title: 'Material Symbols',
    role: 'google',
    source: 'Material Symbols Outlined（Google Fonts）',
    license: 'Apache-2.0',
    covers: '图标',
    use: '图标。写 <span class="material-symbols-outlined">home</span>，字重用 font-weight',
    sample: 'home',
    weights: '100、200、300、400、500、600、700',
    aliases: ['图标', 'material symbols', 'material-symbols', 'material symbols outlined', 'material-symbols-outlined'],
    faces: [
      symbolFace(100, 'Symbols100'),
      symbolFace(200, 'Symbols200'),
      symbolFace(300, 'Symbols300'),
      symbolFace(400, 'Symbols'),
      symbolFace(500, 'Symbols500'),
      symbolFace(600, 'Symbols600'),
      symbolFace(700, 'Symbols700'),
    ],
  },
]

export const CATALOG_FONTS: CatalogFont[] = [DEFAULT_FONT, ...REGISTERED_FONTS]
