/**
 * 学校规则档案（schools/<学校>/<学位>-<届次>.yaml）在引擎里的类型，
 * 以及把档案里给人看的写法（"1.5 倍""0.5 行""宋体"）换成可比较的值。
 * 字段定义以 schools/schema.json 为准。
 */

import type { LineSpacing } from './docx'

export interface TextStyleRule {
  font_cn?: string | null
  font_en?: string | null
  size_pt?: number | null
  line_spacing?: string | null
  first_line_indent_chars?: number | null
  space_before?: string | null
  space_after?: string | null
  bold?: boolean | null
  align?: 'left' | 'center' | 'right' | 'justify' | null
}

export interface HeadingRule extends TextStyleRule {
  numbering?: string | null
}

export interface SchoolProfile {
  school: { name: string; code: string; department?: string | null }
  degree: 'bachelor' | 'master' | 'doctor'
  cohort: number
  status: 'draft' | 'reviewed' | 'outdated'
  sources: {
    title: string
    url: string
    published?: string | null
    /** 文件版本，发布月份 YYYY-MM */
    version?: string | null
    doc_number?: string | null
    archive_url?: string | null
    sha256?: string | null
    note?: string | null
  }[]
  maintainers: string[]
  last_verified: string
  references?: {
    standard?: 'GB/T 7714-2015' | 'GB/T 7714-2025' | 'APA-7' | 'other' | null
    style?: 'numeric' | 'author-year' | null
    min_count?: number | null
    min_foreign?: number | null
  }
  format?: {
    paper?: 'A4' | null
    margins_cm?: { top?: number; bottom?: number; left?: number; right?: number; gutter?: number } | null
    body?: TextStyleRule | null
    headings?: (HeadingRule | null)[] | null
    reference_entries?: TextStyleRule | null
    header?: { required?: boolean; text?: string | null } | null
    page_numbers?: {
      front_matter?: 'lower_roman' | 'upper_roman' | 'arabic' | 'none' | null
      body?: 'arabic' | 'none' | null
      body_starts_at?: number | null
      position?: 'footer_center' | 'footer_right' | 'footer_outside' | 'header_right' | 'header_outside' | null
    } | null
    header_footer?: string | null
    page_numbering?: string | null
    blind_review?: string | null
  }
  ai_policy?: Record<string, unknown> | null
  scope?: ProfileScope | null
  /** 逐条出处，键是字段路径（JSON Pointer），如 /format/margins_cm */
  provenance?: Record<string, RuleProvenance> | null
  conflicts?: RuleConflict[] | null
}

export interface ProfileScope {
  cohorts?: number[] | null
  /** null 表示全校 */
  departments?: string[] | null
  document_types?: string[] | null
  excludes?: string[] | null
}

export type RuleAuthority =
  | 'school_mandatory'
  | 'school_template'
  | 'department_notice'
  | 'major_requirement'
  | 'recommendation'
  | 'secondary'

export interface RuleProvenance {
  source: number
  locator?: string | null
  quote?: string | null
  authority: RuleAuthority
  /** 依据文件的发布月份 YYYY-MM */
  effective?: string | null
  supersedes?: string | null
  verified_at?: string | null
  verified_by?: string | null
  review: 'unreviewed' | 'reviewed' | 'disputed'
  check: 'auto' | 'partial' | 'manual'
  check_note?: string | null
}

export interface RuleConflict {
  path: string
  claims: { source: number; value: unknown; quote?: string | null }[]
  note?: string | null
}

/** "1.5 倍" → multiple 1.5；"固定值 20 磅" → exact 20 */
export function parseLineSpacing(text: string): LineSpacing | null {
  const t = text.replace(/\s+/g, '')
  if (t === '单倍') return { kind: 'multiple', value: 1 }
  let m = t.match(/^(\d+(?:\.\d+)?)倍$/)
  if (m) return { kind: 'multiple', value: Number(m[1]) }
  m = t.match(/^(固定值|最小值)(\d+(?:\.\d+)?)磅$/)
  if (m) return { kind: m[1] === '固定值' ? 'exact' : 'atLeast', pt: Number(m[2]) }
  return null
}

export function describeLineSpacing(ls: LineSpacing): string {
  if (ls.kind === 'multiple') return ls.value === 1 ? '单倍' : `${round(ls.value)} 倍`
  return `${ls.kind === 'exact' ? '固定值' : '最小值'} ${round(ls.pt)} 磅`
}

export function sameLineSpacing(a: LineSpacing, b: LineSpacing): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'multiple' && b.kind === 'multiple') return Math.abs(a.value - b.value) < 0.02
  return Math.abs((a as { pt: number }).pt - (b as { pt: number }).pt) < 0.3
}

/** "0.5 行" → { lines: 0.5 }；"12 磅" → { pt: 12 } */
export function parseSpacing(text: string): { lines: number } | { pt: number } | null {
  const m = text.replace(/\s+/g, '').match(/^(\d+(?:\.\d+)?)(行|磅)$/)
  if (!m) return null
  return m[2] === '行' ? { lines: Number(m[1]) } : { pt: Number(m[1]) }
}

const FONT_ALIASES: Record<string, string[]> = {
  宋体: ['simsun', '宋体', 'nsimsun', '新宋体', '宋体-简', 'songti sc', 'stsong', '华文宋体'],
  黑体: ['simhei', '黑体', '黑体-简', 'heiti sc', 'stheiti', '华文黑体'],
  楷体: ['kaiti', '楷体', '楷体_gb2312', 'kaiti_gb2312', 'kaiti sc', 'stkaiti', '华文楷体'],
  仿宋: ['fangsong', '仿宋', '仿宋_gb2312', 'fangsong_gb2312', 'stfangsong', '华文仿宋'],
  微软雅黑: ['microsoft yahei', '微软雅黑'],
  'Times New Roman': ['times new roman', 'times'],
  Arial: ['arial'],
}

/** 把 SimSun、宋体、新宋体 等写法归到同一个名字，便于比较 */
export function canonicalFont(name: string | null): string | null {
  if (!name) return null
  const key = name.trim().toLowerCase()
  for (const [canon, aliases] of Object.entries(FONT_ALIASES)) if (aliases.includes(key)) return canon
  return name.trim()
}

export function sameFont(actual: string | null, expected: string): boolean {
  return canonicalFont(actual) === canonicalFont(expected)
}

const SIZE_NAMES: [number, string][] = [
  [42, '初号'], [36, '小初'], [26, '一号'], [24, '小一'], [22, '二号'], [18, '小二'], [16, '三号'],
  [15, '小三'], [14, '四号'], [12, '小四'], [10.5, '五号'], [9, '小五'], [7.5, '六号'],
]

/** 12 → "小四（12 磅）" */
export function describeSize(pt: number): string {
  const name = SIZE_NAMES.find(([v]) => Math.abs(v - pt) < 0.01)?.[1]
  return name ? `${name}（${round(pt)} 磅）` : `${round(pt)} 磅`
}

export function round(n: number): number {
  return Math.round(n * 100) / 100
}

export const ALIGN_LABEL = { left: '左对齐', center: '居中', right: '右对齐', justify: '两端对齐' } as const

export function profileLabel(p: SchoolProfile): string {
  const degree = { bachelor: '本科', master: '硕士', doctor: '博士' }[p.degree]
  return `${p.school.name}${p.school.department ? ` ${p.school.department}` : ''} · ${degree} · ${p.cohort} 届`
}
