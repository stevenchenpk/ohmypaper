import type { DocxModel, Paragraph } from '../docx'
import type { SchoolProfile } from '../profile'
import { profileLabel } from '../profile'
import { type Category, type CheckNote, type Issue, type Location, MAX_LOCATIONS } from '../report'
import { type Structure, locate } from '../structure'

export class CheckContext {
  readonly issues: Issue[] = []
  readonly passed: CheckNote[] = []
  readonly skipped: CheckNote[] = []

  constructor(
    readonly doc: DocxModel,
    readonly s: Structure,
    readonly profile: SchoolProfile | null,
  ) {}

  /** 学校档案作为依据时的说明 */
  get schoolBasis(): string {
    const p = this.profile
    if (!p) return ''
    const src = p.sources[0]?.title
    return `${profileLabel(p)}${src ? `：${src}` : ''}`
  }

  add(issue: Omit<Issue, 'locations' | 'total'> & { locations?: Location[]; total?: number }) {
    const locations = issue.locations ?? []
    this.issues.push({
      ...issue,
      locations: locations.slice(0, MAX_LOCATIONS),
      total: issue.total ?? (locations.length > MAX_LOCATIONS ? locations.length : undefined),
    })
  }

  /** 按段落汇总的问题：自动截取位置 */
  addForParagraphs(paras: Paragraph[], issue: Omit<Issue, 'locations' | 'total'>) {
    this.add({ ...issue, locations: paras.map((p) => locate(p, this.s)), total: paras.length })
  }

  pass(category: Category, item: string) {
    this.passed.push({ category, item })
  }

  skip(category: Category, item: string, reason: string) {
    this.skipped.push({ category, item, reason })
  }
}

/** 统计出现最多的几个实际值，如 "等线（37 段）、宋体（2 段）" */
export function topValues(values: string[], unit = '段'): string {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([v, n]) => `${v}（${n} ${unit}）`)
    .join('、')
}
