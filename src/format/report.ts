/** 格式体检的结果结构。界面和测试都只依赖这里的类型。 */

export type Severity = 'error' | 'warning' | 'info'

export type Category = 'page' | 'body' | 'headings' | 'figures' | 'page_numbers' | 'references' | 'cleanup'

export const CATEGORY_LABEL: Record<Category, string> = {
  page: '页面设置',
  body: '正文版式',
  headings: '标题与目录',
  figures: '图表题注',
  page_numbers: '页眉页码',
  references: '参考文献',
  cleanup: '提交前清理',
}

// 三层措辞：与规则不符 / 检测到（问题或待核对项）/ 未检查，需人工确认（见 Report.skipped）
const SEVERITY_TEXT: Record<Severity, string> = {
  error: '与所选规则不符',
  warning: '检测到问题',
  info: '检测到，请核对',
}

/** 没选学校时没有"所选规则"，只有通用要求（国标和排版惯例） */
export function severityLabel(s: Severity, hasProfile: boolean): string {
  return s === 'error' && !hasProfile ? '与通用要求不符' : SEVERITY_TEXT[s]
}

export interface Location {
  /** 段落序号（0 起） */
  paragraph?: number
  /** 分节序号（0 起） */
  section?: number
  /** 段落开头的几十个字，方便在 Word 里搜索定位 */
  excerpt: string
  /** 所在章节标题 */
  context?: string
}

export interface Issue {
  /** 稳定的检查项编号，测试和后续"忽略此项"用 */
  id: string
  category: Category
  severity: Severity
  title: string
  detail?: string
  expected?: string
  actual?: string
  /** 最多列出的位置；total 是实际出现的总数 */
  locations: Location[]
  total?: number
  /** 依据：学校档案或国标条款 */
  basis: string
}

export interface CheckNote {
  category: Category
  item: string
  /** 未检查的原因；通过的项为 undefined */
  reason?: string
}

export interface Report {
  profileLabel: string | null
  issues: Issue[]
  passed: CheckNote[]
  skipped: CheckNote[]
  stats: {
    paragraphs: number
    bodyParagraphs: number
    headings: number
    sections: number
    references: number
  }
  /** 从文档中抽出的参考文献原文，供引用核验使用 */
  references: string[]
  /** 引用对账（顺序编码制）：正文标号与文献表的对应；著者-出版年制或没找到参考文献表时为 null */
  citationMap: CitationMap | null
  /** 引用对账（著者-出版年制）；顺序编码制或没找到参考文献表时为 null */
  authorYearMap: AuthorYearMap | null
}

export interface AuthorYearMap {
  /** entry：对上的文献表条目（references 下标）；没对上或区分不出为 null */
  citations: { raw: string; author: string | null; year: number; suffix: string | null; location: Location; narrative: boolean; entry: number | null }[]
  /** 与 Report.references 同序 */
  references: { author: string | null; year: number | null; suffix: string | null; text: string; timesCited: number; firstCited: Location | null }[]
  /** 以下都是 citations / references 的下标 */
  missing: number[]
  yearMismatch: { citation: number; listed: string[] }[]
  needSuffix: number[]
  listSuffixMissing: number[][]
  uncited: number[]
  unreadEntries: number[]
  /** 可能被引用、但区分不出是哪篇的条目 */
  maybeCited: number[]
  /** 像引用却认不出著者的写法；非空时"都被引用""都对得上"不能显示为通过 */
  unresolved: { raw: string; location: Location }[]
  noteRefs: number
}

export interface CitationLink {
  raw: string
  numbers: number[]
  location: Location
  superscript: boolean
  /** 没有方括号的上标数字 */
  bare: boolean
}

export interface ReferenceLink {
  /** 文献表中的编号；读不出为 null */
  number: number | null
  /** 与 Report.references 同序 */
  text: string
  timesCited: number
  firstCited: Location | null
}

export interface CitationMap {
  citations: CitationLink[]
  references: ReferenceLink[]
  /** 正文引了、文献表里没有的编号 */
  missing: number[]
  /** 文献表里有、正文没引的条目（references 下标） */
  uncited: number[]
  /** 没按首次引用先后编号的编号 */
  outOfOrder: number[]
  /** 写法有误的标号原文 */
  malformed: string[]
  /** 可能有没读到的引用；任何一项非零时，"都被引用""顺序正确"都不能显示为通过 */
  uncertain: {
    /** 有文献管理软件（Zotero、EndNote、NoteExpress 等）引用域、却没读出标号的段落数 */
    unreadFieldParagraphs: number
    /** 正文和附录里的脚注、尾注引用标记个数 */
    noteRefs: number
    /** 跟在拉丁字母后面、分不清是引用还是指数的上标数字 */
    ambiguous: CitationLink[]
  }
}

export const MAX_LOCATIONS = 5
