import { describe, expect, it } from 'vitest'
import { emptyDossier } from '../src/dossier/schema'
import type { AiLogEntry, Dossier } from '../src/dossier/schema'
import { generateDeclaration } from '../src/declaration/generate'
import type { AiPolicy } from '../src/declaration/generate'

const fudan: AiPolicy = {
  allowed: ['文献检索与整理', '图表类型推荐与制作辅助', '方法不属于论文创新点时的代码与方法辅助', '参考文献格式检查'],
  forbidden: [
    '研究设计与数据分析（含结论）',
    '生成或改动原始数据',
    '创作结果图片与重要插图',
    '生成论文正文，以及用 AI 进行语言润色和翻译',
    '评审专家使用 AI 评审论文',
    '涉密内容使用任何 AI',
  ],
  disclosure: '须在本科毕业论文（设计）承诺书中明确披露：工具名称与版本、使用时间与用途、输出内容及其在论文中的位置，并保留使用 AI 前的原始材料备查（第五条）。',
}

const entry = (o: Partial<AiLogEntry>): AiLogEntry => ({
  id: 'x', date: '2026-11-03', tool: 'DeepSeek', version: 'V3', purpose: 'polish', stage: 'writing',
  section: '第三章', verification: '逐句对照原文', note: null, ...o,
})
const dossier = (log: AiLogEntry[]): Dossier => ({ ...emptyDossier(new Date('2026-01-01')), ai_log: log })

const three = dossier([
  entry({ id: 'a', purpose: 'translate', date: '2026-11-05', tool: 'GPT', version: '5', stage: 'literature', section: '文献综述' }),
  entry({ id: 'b', purpose: 'polish' }),
  entry({ id: 'c', purpose: 'search', stage: 'literature', date: '2026-10-01', tool: 'Kimi', version: 'k2', section: null, verification: '逐条去数据库核对' }),
])

describe('空记录', () => {
  it('未确认时给出 missing，不产出文字', () => {
    const r = generateDeclaration(dossier([]), fudan)
    expect(r.missing).toEqual(['还没有 AI 使用记录'])
    expect(r.text).toBe('')
    expect(r.markdown).toBe('')
  })
  it('confirmNone 生成未使用版本', () => {
    const r = generateDeclaration(dossier([]), null, { confirmNone: true })
    expect(r.text).toContain('本人在论文写作过程中未使用生成式人工智能工具。')
    expect(r.text).toContain('本声明根据作者本人记录整理，内容由作者负责。')
    expect(r.missing).toEqual([])
  })
})

describe('表格与分组', () => {
  const r = generateDeclaration(three, null)
  it('Markdown 表头与行', () => {
    expect(r.markdown).toContain('| 日期 | 工具及版本 | 用途 | 环节/章节 | 本人如何核实 |')
    expect(r.markdown).toContain('| 2026-11-03 | DeepSeek V3 | 润色 | 写作 / 第三章 | 逐句对照原文 |')
  })
  it('按用途顺序分组（润色在检索之前）', () => {
    expect(r.text.indexOf('【润色】')).toBeLessThan(r.text.indexOf('【检索】'))
    expect(r.text).toContain('1. 2026-11-03，DeepSeek V3')
  })
  it('竖线被转义', () => {
    const m = generateDeclaration(dossier([entry({ verification: 'a|b' })]), null).markdown
    expect(m).toContain('a\\|b')
  })
})

describe('missing', () => {
  it('版本与核实为空时逐条指出', () => {
    const r = generateDeclaration(dossier([entry({ version: '', verification: null })]), null)
    expect(r.missing).toEqual(['2026-11-03 DeepSeek：还没填工具版本。', '2026-11-03 DeepSeek：还没填你是怎么核实 AI 输出的。'])
    expect(r.text).toContain('（待补充）')
  })
  it('学校要求位置时检查章节', () => {
    const log = dossier([entry({ section: '' })])
    expect(generateDeclaration(log, fudan).missing.join()).toContain('章节')
    expect(generateDeclaration(log, null).missing).toEqual([])
  })
})

describe('禁止项警告（复旦）', () => {
  const r = generateDeclaration(three, fudan)
  const msgs = r.warnings.map((w) => w.message)
  it('润色与翻译会警告', () => {
    expect(msgs).toContain('你在 2026-11-03 用 DeepSeek 做了润色，本校规定将『生成论文正文，以及用 AI 进行语言润色和翻译』列为禁止项，请先和导师确认。')
    expect(r.warnings.some((w) => w.entryId === 'a' && w.kind === 'forbidden')).toBe(true)
  })
  it('检索不警告', () => {
    expect(r.warnings.some((w) => w.entryId === 'c')).toBe(false)
  })
  it('同一条目同一政策项只警告一次', () => {
    expect(r.warnings.filter((w) => w.entryId === 'b')).toHaveLength(1)
  })
  it('没有政策时无警告，且警告不影响生成', () => {
    expect(generateDeclaration(three, null).warnings).toEqual([])
    expect(r.text).toContain('【润色】')
  })
  it('允许项提到导师同意时提示', () => {
    const p: AiPolicy = { allowed: ['文献检索，须经导师同意'], forbidden: [] }
    const w = generateDeclaration(three, p).warnings
    expect(w).toHaveLength(1)
    expect(w[0].kind).toBe('consent')
  })
})

describe('披露要求与措辞', () => {
  it('原文逐字引用并提醒未核实', () => {
    const r = generateDeclaration(three, fudan)
    expect(r.text).toContain(fudan.disclosure!)
    expect(r.markdown).toContain(fudan.disclosure!)
    expect(r.text).toContain('本校披露要求（原文）')
    expect(r.text).toContain('没有核实')
  })
  it('任何输出都不含“留痕”“模板”', () => {
    for (const d of [three, dossier([])]) {
      for (const p of [fudan, null]) {
        const r = generateDeclaration(d, p, { confirmNone: true })
        const all = [r.text, r.markdown, ...r.missing, ...r.warnings.map((w) => w.message)].join('\n')
        expect(all).not.toMatch(/留痕|模板/)
      }
    }
  })
})
