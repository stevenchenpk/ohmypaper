// schema v2：出处、适用范围、冲突三组字段，以及规则结论分三类
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Ajv from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import { crossCheck } from '../scripts/school-crosscheck.mjs'
import type { SchoolProfile } from '../src/format/profile'
import { ruleStatus } from '../src/format/rule-status'
import { citationStyleFor } from '../src/format/checks/references'

const schema = JSON.parse(readFileSync(join(__dirname, '../schools/schema.json'), 'utf8'))
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema)

const base = (): SchoolProfile => ({
  school: { name: '示例大学', code: 'example' },
  degree: 'bachelor',
  cohort: 2026,
  status: 'draft',
  sources: [
    { title: '本科毕业论文撰写规范', url: 'https://example.edu.cn/a.pdf', version: '2025-10' },
    { title: '某学院补充通知', url: 'https://example.edu.cn/b.html', version: '2026-03' },
  ],
  maintainers: ['someone'],
  last_verified: '2026-10-12',
  format: { margins_cm: { top: 2.5, bottom: 2.5, left: 2.5, right: 2 } },
  references: { standard: 'GB/T 7714-2015', style: 'numeric' },
  provenance: {
    '/format/margins_cm': {
      source: 0,
      locator: '1.2 页面设置',
      quote: '上、下、左边距 2.5cm，右边距 2.0cm',
      authority: 'school_mandatory',
      effective: '2025-10',
      supersedes: '2024-11',
      verified_at: '2026-10-12',
      verified_by: 'someone',
      review: 'reviewed',
      check: 'auto',
    },
  },
})

describe('schema v2 字段', () => {
  it('带出处、范围、冲突的档案能通过校验', () => {
    const p = { ...base(), scope: { cohorts: [2026], departments: null }, conflicts: [] }
    expect(validate(p), JSON.stringify(validate.errors)).toBe(true)
    expect(crossCheck(p)).toEqual([])
  })

  it('版本只能写到月份', () => {
    const p = base()
    p.sources[0].version = '2025-10-01'
    expect(validate(p)).toBe(false)
  })

  it('authority 只能取规定的几种', () => {
    const p = base() as unknown as { provenance: Record<string, { authority: string }> }
    p.provenance['/format/margins_cm'].authority = 'official'
    expect(validate(p)).toBe(false)
  })

  it('出处下标越界、字段不存在、版本倒挂都报出来', () => {
    const p = base()
    p.provenance!['/format/margins_cm'].source = 5
    p.provenance!['/format/margins_cm'].supersedes = '2026-01'
    p.provenance!['/format/body'] = { ...p.provenance!['/format/margins_cm'], source: 0, supersedes: null }
    const problems = crossCheck(p)
    expect(problems.some((x: string) => x.includes('超出 sources'))).toBe(true)
    expect(problems.some((x: string) => x.includes('supersedes 应早于 effective'))).toBe(true)
    expect(problems.some((x: string) => x.includes('/format/body 指向的字段不存在'))).toBe(true)
  })
})

describe('规则结论分三类', () => {
  it('复核过的学校强制条款：已确认', () => {
    expect(ruleStatus(base(), '/format/margins_cm')).toBe('confirmed')
  })

  it('没有出处记录：只算一般建议', () => {
    expect(ruleStatus(base(), '/references/standard')).toBe('advisory')
  })

  it('未复核：只算一般建议', () => {
    const p = base()
    p.provenance!['/format/margins_cm'].review = 'unreviewed'
    expect(ruleStatus(p, '/format/margins_cm')).toBe('advisory')
  })

  it('值为空或只能人工检查：无法判断', () => {
    expect(ruleStatus(base(), '/format/body')).toBe('unknown')
    const p = base()
    p.provenance!['/format/margins_cm'].check = 'manual'
    expect(ruleStatus(p, '/format/margins_cm')).toBe('unknown')
  })

  it('有冲突：无法判断，不替学校裁决', () => {
    const p = base()
    p.conflicts = [{ path: '/format/margins_cm/right', claims: [{ source: 0, value: 2 }, { source: 1, value: 2.5 }] }]
    expect(ruleStatus(p, '/format/margins_cm')).toBe('unknown')
  })

  it('只适用部分学院：学生没选学院就无法判断', () => {
    const p = { ...base(), scope: { departments: ['计算机学院'] } }
    expect(ruleStatus(p, '/format/margins_cm')).toBe('unknown')
    expect(ruleStatus(p, '/format/margins_cm', { department: '计算机学院' })).toBe('confirmed')
  })

  it('学院通知：选了学院才算已确认', () => {
    const p = base()
    p.provenance!['/format/margins_cm'].authority = 'department_notice'
    expect(ruleStatus(p, '/format/margins_cm')).toBe('advisory')
    expect(ruleStatus(p, '/format/margins_cm', { department: '计算机学院' })).toBe('confirmed')
  })
})

describe('引用体例：学校没规定时看学生实际用的哪种', () => {
  it('学校写明了就照办', () => {
    expect(citationStyleFor('numeric', false)).toEqual({ value: 'numeric', inferred: false })
    expect(citationStyleFor('author-year', true)).toEqual({ value: 'author-year', inferred: false })
  })

  it.each(['either', 'unknown', null, undefined] as const)('%s：文献表带序号按顺序编码制，不带序号按著者-出版年制', (declared) => {
    expect(citationStyleFor(declared, true)).toEqual({ value: 'numeric', inferred: true })
    expect(citationStyleFor(declared, false)).toEqual({ value: 'author-year', inferred: true })
  })
})
