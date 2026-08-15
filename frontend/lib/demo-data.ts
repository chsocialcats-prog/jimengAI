// 纯 UI 演示数据 —— 不接入真实后端 / AI

export type WorkStatus = 'published' | 'draft'
export type WorkTag = '奇幻' | '校园' | '悬疑' | '科幻' | '治愈' | '恋爱' | '冒险'

// 开始冒险前需玩家填写的作品自定义字段
export interface SetupField {
  id: string
  label: string
  type: 'text' | 'textarea' | 'select'
  placeholder?: string
  required?: boolean
  hint?: string
  options?: string[]
  defaultValue?: string
}

// 某作品的开场引导配置(玩家身份 / 姓名 / 自定义字段)
export const setupConfig: { intro: string; fields: SetupField[] } = {
  intro:
    '在踏入《樱色车站的约定》之前,先确定你在这个故事里的身份吧。这些设定会影响 NPC 对你的称呼与剧情走向。',
  fields: [
    {
      id: 'playerName',
      label: '你的名字',
      type: 'text',
      placeholder: '例如:悠人',
      required: true,
      hint: '绫濑花以及其他角色会这样称呼你。',
    },
    {
      id: 'gender',
      label: '性别 / 称呼',
      type: 'select',
      required: true,
      options: ['少年', '少女', '不明示'],
      defaultValue: '少年',
    },
    {
      id: 'identity',
      label: '身份设定',
      type: 'select',
      required: true,
      options: ['同班同学', '隔壁班的学长', '刚转来的转学生', '车站的常客'],
      defaultValue: '同班同学',
      hint: '决定你与女主角初始的关系距离。',
    },
    {
      id: 'persona',
      label: '一句话人设(可选)',
      type: 'textarea',
      placeholder: '例如:表面开朗、其实很怕离别的摄影社成员。',
      hint: 'AI 会参考这段描述来塑造你的对话风格。',
    },
  ],
}

export interface Work {
  id: string
  title: string
  author: string
  cover: string
  tags: WorkTag[]
  summary: string
  status: WorkStatus
  updatedAt: string
  plays: number
  favorites: number
  saves: number // 已有存档数
  accent: string // 卡片点缀色 token 名
}

export const works: Work[] = [
  {
    id: 'w1',
    title: '樱色车站的约定',
    author: '柚子茶',
    cover: '/images/covers/sakura-station.png',
    tags: ['治愈', '恋爱', '校园'],
    summary: '毕业前的最后一个春天,你在无人的车站遇见了那个总是独自看樱花的转学生。每一次对话,都在悄悄改变你们的结局。',
    status: 'published',
    updatedAt: '2 小时前',
    plays: 12480,
    favorites: 3210,
    saves: 2,
    accent: 'chart-1',
  },
  {
    id: 'w2',
    title: '云端图书馆',
    author: '墨鱼丸',
    cover: '/images/covers/sky-library.png',
    tags: ['奇幻', '治愈'],
    summary: '一座漂浮在云海之上的图书馆,收藏着所有未被讲完的故事。作为新任守书人,你需要倾听旅人的心愿,并为他们续写结局。',
    status: 'published',
    updatedAt: '昨天',
    plays: 8640,
    favorites: 2170,
    saves: 1,
    accent: 'chart-2',
  },
  {
    id: 'w3',
    title: '深夜便利店奇谭',
    author: '柚子茶',
    cover: '/images/covers/night-store.png',
    tags: ['悬疑', '奇幻'],
    summary: '凌晨三点,只在特定时刻营业的便利店。你是唯一的店员,而走进来的客人,似乎都不太"寻常"。',
    status: 'published',
    updatedAt: '3 天前',
    plays: 15920,
    favorites: 4880,
    saves: 3,
    accent: 'chart-3',
  },
  {
    id: 'w4',
    title: '星屑列车 0 号线',
    author: '棉花糖',
    cover: '/images/covers/star-train.png',
    tags: ['科幻', '冒险'],
    summary: '一列穿行于记忆与星海之间的列车。乘客们付出一段回忆换取车票,而你,是这趟旅程的向导。',
    status: 'draft',
    updatedAt: '5 天前',
    plays: 0,
    favorites: 0,
    saves: 0,
    accent: 'chart-4',
  },
  {
    id: 'w5',
    title: '猫町咖啡屋',
    author: '棉花糖',
    cover: '/images/covers/cat-cafe.png',
    tags: ['治愈', '校园'],
    summary: '一间被猫咪们经营的小小咖啡屋。作为唯一的人类店员,你要和店长——一只傲娇的三花猫,一起招待形形色色的客人。',
    status: 'published',
    updatedAt: '1 周前',
    plays: 6320,
    favorites: 1980,
    saves: 1,
    accent: 'chart-5',
  },
  {
    id: 'w6',
    title: '雾都侦探社',
    author: '墨鱼丸',
    cover: '/images/covers/foggy-detective.png',
    tags: ['悬疑', '冒险'],
    summary: '维多利亚风格的雾之都,离奇案件接连发生。你与搭档需要在有限的对话回合中,找出隐藏在谎言背后的真相。',
    status: 'draft',
    updatedAt: '2 周前',
    plays: 0,
    favorites: 0,
    saves: 0,
    accent: 'chart-2',
  },
]

export const allTags: WorkTag[] = ['奇幻', '校园', '悬疑', '科幻', '治愈', '恋爱', '冒险']

// ---------- 创作素材库 ----------

export type MaterialType = 'character' | 'worldbook' | 'template'

export interface CharacterCard {
  id: string
  type: 'character'
  name: string
  avatar: string
  role: string
  personality: string[]
  description: string
  greeting: string
  updatedAt: string
  usedIn: number
}

export interface WorldBook {
  id: string
  type: 'worldbook'
  name: string
  icon: string
  entries: number
  description: string
  keys: string[]
  updatedAt: string
  usedIn: number
}

export interface ReplyTemplate {
  id: string
  type: 'template'
  name: string
  format: '第一人称' | '第三人称' | '剧本体'
  length: '简短' | '适中' | '详尽'
  description: string
  sample: string
  updatedAt: string
  usedIn: number
}

export const characters: CharacterCard[] = [
  {
    id: 'c1',
    type: 'character',
    name: '绫濑 花',
    avatar: '/images/avatars/aya.png',
    role: '转学生 · 女主角',
    personality: ['温柔', '内向', '细腻', '藏着心事'],
    description: '总是独自在车站看樱花的转学生,说话轻声细语,却在不经意间流露出与年龄不符的成熟与忧伤。',
    greeting: '「啊……你也常来这个车站吗?樱花,今年好像开得特别早呢。」',
    updatedAt: '2 小时前',
    usedIn: 2,
  },
  {
    id: 'c2',
    type: 'character',
    name: '店长(三花猫)',
    avatar: '/images/avatars/cat.png',
    role: '咖啡屋店长',
    personality: ['傲娇', '毒舌', '其实很温柔'],
    description: '猫町咖啡屋的经营者,一只会说人话的三花猫。表面嫌弃客人,实则默默记得每位常客的喜好。',
    greeting: '「哼,又是你。……老位置,美式加两块方糖,对吧?别以为我记得你就是喜欢你。」',
    updatedAt: '1 周前',
    usedIn: 1,
  },
  {
    id: 'c3',
    type: 'character',
    name: '守书人 · 昴',
    avatar: '/images/avatars/subaru.png',
    role: '向导 · 神秘角色',
    personality: ['博学', '沉稳', '温和', '略带疏离'],
    description: '云端图书馆的前任守书人,如今作为向导引领新人。知晓无数故事的结局,却对自己的故事绝口不提。',
    greeting: '「欢迎来到云端。在这里,每一本书都是一个还没说完的愿望——包括你的。」',
    updatedAt: '昨天',
    usedIn: 1,
  },
  {
    id: 'c4',
    type: 'character',
    name: '侦探 · 薇薇安',
    avatar: '/images/avatars/vivian.png',
    role: '搭档 · 侦探',
    personality: ['敏锐', '毒舌', '理性', '偶尔孩子气'],
    description: '雾都最负盛名的私家侦探,观察力惊人。习惯用推理游戏来考验搭档,嘴上不饶人,关键时刻却绝对可靠。',
    greeting: '「迟到了三分钟,袖口有咖啡渍,而且——你今天遇到麻烦了,对吧?坐下,慢慢说。」',
    updatedAt: '2 周前',
    usedIn: 1,
  },
]

export const worldbooks: WorldBook[] = [
  {
    id: 'wb1',
    type: 'worldbook',
    name: '樱色小镇设定集',
    icon: '/images/avatars/aya.png',
    entries: 24,
    description: '海边小镇的地理、季节、校园与主要 NPC 关系网,包含关键事件的时间线设定。',
    keys: ['车站', '樱花', '海边高中', '毕业典礼', '烟火大会'],
    updatedAt: '2 小时前',
    usedIn: 1,
  },
  {
    id: 'wb2',
    type: 'worldbook',
    name: '云端图书馆世界观',
    icon: '/images/avatars/subaru.png',
    entries: 38,
    description: '关于漂浮图书馆的运作规则、书籍的魔法体系、守书人的职责与禁忌。',
    keys: ['守书人', '未完成之书', '云海', '心愿', '墨水潮汐'],
    updatedAt: '昨天',
    usedIn: 2,
  },
  {
    id: 'wb3',
    type: 'worldbook',
    name: '雾都地理与案件档案',
    icon: '/images/avatars/vivian.png',
    entries: 41,
    description: '维多利亚风格都市的街区分布、警局关系、历史悬案与关键证物设定。',
    keys: ['雾之都', '侦探社', '苏格兰场', '连环案', '怀表'],
    updatedAt: '2 周前',
    usedIn: 1,
  },
]

export const templates: ReplyTemplate[] = [
  {
    id: 't1',
    type: 'template',
    name: '细腻文学向',
    format: '第三人称',
    length: '详尽',
    description: '注重环境描写与心理刻画,适合治愈、恋爱题材,营造沉浸的阅读氛围。',
    sample: '风穿过站台,卷起几片早开的樱瓣。她微微垂下眼睫,声音轻得几乎要融进风里……',
    updatedAt: '3 天前',
    usedIn: 3,
  },
  {
    id: 't2',
    type: 'template',
    name: '轻快对话向',
    format: '第一人称',
    length: '适中',
    description: '以对话推动为主,节奏明快,适合日常、校园与轻松向剧情。',
    sample: '我耸了耸肩:「行吧,那就听你的。不过丑话说在前面——出了事你可别甩锅给我。」',
    updatedAt: '5 天前',
    usedIn: 2,
  },
  {
    id: 't3',
    type: 'template',
    name: '悬疑剧本体',
    format: '剧本体',
    length: '简短',
    description: '以场景 + 台词的剧本格式呈现,信息密度高,适合推理与快节奏冒险。',
    sample: '【深夜·侦探社】\n薇薇安:(点燃台灯)证据都在这儿了。现在,说说你不在场的证明。',
    updatedAt: '1 周前',
    usedIn: 1,
  },
]

// ---------- 冒险主界面演示消息 ----------

export interface StoryMessage {
  id: string
  role: 'narrator' | 'player' | 'system'
  content: string
  time: string
  model?: string
  tokens?: number
}

export const storyMessages: StoryMessage[] = [
  {
    id: 'm1',
    role: 'system',
    content: '存档「樱色车站 · 第一章」已载入 · 当前进度 3/12',
    time: '',
  },
  {
    id: 'm2',
    role: 'narrator',
    content:
      '傍晚的车站被染成一片温柔的橘红。末班车还有二十分钟,月台上只有你和她。绫濑花抱着书包,静静望着铁道旁那株开得正盛的樱树,发梢被晚风轻轻掀起。\n\n「今年的樱花……开得比去年早呢。」她像是自言自语,又像是在对你说。',
    time: '18:24',
    model: 'GPT-4o',
    tokens: 186,
  },
  {
    id: 'm3',
    role: 'player',
    content: '我走到她身边,顺着她的目光看向那株樱树:「是啊,可惜花期太短了。」',
    time: '18:25',
  },
  {
    id: 'm4',
    role: 'narrator',
    content:
      '她转过头看了你一眼,眼底闪过一丝惊讶,随即弯起嘴角,那是你第一次看见她如此温柔的笑。\n\n「花期短,才更要好好记住吧。」她轻声说,「就像……有些人,有些约定一样。」\n\n晚风送来一片花瓣,恰好落在你们之间。',
    time: '18:25',
    model: 'GPT-4o',
    tokens: 203,
  },
]

export const storyOptions: string[] = [
  '伸手接住那片飘落的花瓣',
  '问她所说的「约定」是什么意思',
  '沉默地陪她一起看樱花',
]

// ---------- 冒险状态区演示数据 ----------

export interface PlayerAttr {
  name: string
  value: number
  max: number
  delta?: number
  color: string
}

export const playerAttrs: PlayerAttr[] = [
  { name: '好感度', value: 62, max: 100, delta: +8, color: 'chart-1' },
  { name: '信任', value: 45, max: 100, delta: +5, color: 'chart-2' },
  { name: '心境', value: 78, max: 100, delta: -3, color: 'chart-3' },
  { name: '勇气', value: 50, max: 100, color: 'chart-4' },
]

export interface Relation {
  name: string
  avatar: string
  status: string
  level: number
}

export const relations: Relation[] = [
  { name: '绫濑 花', avatar: '/images/avatars/aya.png', status: '心动的预感', level: 3 },
]

export const worldState = {
  time: '春 · 傍晚',
  location: '海滨车站 · 月台',
  weather: '微风 · 樱花飘落',
  chapter: '第一章 · 相遇',
}

export const memoryNotes: string[] = [
  '你与绫濑花在车站初次交谈,气氛融洽。',
  '她提到了一个尚未说明的「约定」。',
  '今年樱花开得比往年早。',
]

// ---------- 存档 / 会话 ----------

export interface SaveSlot {
  id: string
  workTitle: string
  cover: string
  chapter: string
  progress: number
  updatedAt: string
  auto: boolean
  readonly?: boolean
}

export const saveSlots: SaveSlot[] = [
  {
    id: 's1',
    workTitle: '樱色车站的约定',
    cover: '/images/covers/sakura-station.png',
    chapter: '第一章 · 相遇',
    progress: 25,
    updatedAt: '刚刚(自动保存)',
    auto: true,
  },
  {
    id: 's2',
    workTitle: '深夜便利店奇谭',
    cover: '/images/covers/night-store.png',
    chapter: '第三章 · 不速之客',
    progress: 60,
    updatedAt: '2 天前',
    auto: false,
  },
  {
    id: 's3',
    workTitle: '云端图书馆',
    cover: '/images/covers/sky-library.png',
    chapter: '序章 · 就任',
    progress: 10,
    updatedAt: '1 周前',
    auto: false,
    readonly: true,
  },
]
