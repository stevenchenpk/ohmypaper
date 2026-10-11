import type { CslName } from './names'

/** 结构化后的一条文献，字段名沿用 CSL-JSON，方便以后接 citation-js 等工具 */
export interface CslItem {
  id: string
  type: CslType
  title?: string
  author?: CslName[]
  editor?: CslName[]
  translator?: CslName[]
  /** 期刊名、报纸名、析出文献所在的书名或会议录名 */
  'container-title'?: string
  /** 会议名称（GB/T 7714—2025 会议论文不带出版项时） */
  'event-title'?: string
  issued?: CslDate
  accessed?: CslDate
  volume?: string
  issue?: string
  page?: string
  edition?: string
  version?: string
  'publisher-place'?: string
  /** 出版者；学位论文为授予单位，网页为发布平台 */
  publisher?: string
  /** 标准编号、专利申请号或公开号 */
  number?: string
  /** 学位论文的学位类型等 */
  genre?: string
  URL?: string
  DOI?: string
  ISSN?: string
  ISBN?: string
  abstract?: string
  keyword?: string
  language?: string
}

export type CslType =
  | 'article-journal'
  | 'book'
  | 'chapter'
  | 'thesis'
  | 'paper-conference'
  | 'article-newspaper'
  | 'report'
  | 'standard'
  | 'patent'
  | 'webpage'
  | 'dataset'
  | 'article'
  | 'map'
  | 'software'
  | 'manuscript'
  | 'collection'
  | 'document'

export interface CslDate {
  'date-parts'?: [[number, number?, number?]]
  /** 解析不了的日期原样保留 */
  raw?: string
}

/** 解析结果：结构化字段 + 原始信息 + 解析时的提示 */
export interface StructuredReference {
  csl: CslItem
  /** 来源格式 */
  source: 'gbt7714' | 'endnote' | 'noteexpress' | 'refworks'
  /** GB/T 7714 文献类型标识（J、M、D…）；题录导入时按类型映射得到 */
  typeCode: string | null
  /** 载体标识（OL、CD…） */
  carrier: string | null
  /** 作者列表是否以"等"或"et al"省略 */
  etAl: boolean
  /** 序号，取自 [n]；没有为 null */
  index: number | null
  raw: string
  /** 解析不确定或字段缺失的地方，给核验和体检参考 */
  warnings: string[]
}

export const TYPE_CODE_TO_CSL: Record<string, CslType> = {
  J: 'article-journal',
  M: 'book',
  D: 'thesis',
  C: 'paper-conference',
  N: 'article-newspaper',
  R: 'report',
  S: 'standard',
  P: 'patent',
  EB: 'webpage',
  DS: 'dataset',
  PP: 'article',
  G: 'collection',
  A: 'manuscript',
  CM: 'map',
  CP: 'software',
  DB: 'dataset',
  Z: 'document',
}

export function dateFrom(s: string): CslDate {
  const m = s.trim().match(/^(\d{4})(?:[-./年](\d{1,2}))?(?:[-./月](\d{1,2}))?日?$/)
  if (!m) return { raw: s.trim() }
  const parts: [number, number?, number?] = [Number(m[1])]
  if (m[2]) parts.push(Number(m[2]))
  if (m[3]) parts.push(Number(m[3]))
  return { 'date-parts': [parts] }
}

export function yearOf(item: CslItem): number | null {
  return item.issued?.['date-parts']?.[0]?.[0] ?? null
}
