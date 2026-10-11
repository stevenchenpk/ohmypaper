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
}

export const MAX_LOCATIONS = 5
