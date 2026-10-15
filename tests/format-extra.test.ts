import { describe, expect, it } from 'vitest'
import type { DocxModel, Paragraph } from '../src/format/docx'
import { checkModel } from '../src/format/engine'
import { tocEntryTitle } from '../src/format/checks/toc'

/** 用最少的字段拼一个段落，其余取常见默认值 */
function para(index: number, text: string, extra: Partial<Paragraph> = {}): Paragraph {
  return {
    index, text, styleId: null, styleName: null, headingLevel: null, inTable: false, inToc: false, numbered: false, listLabel: null, fieldCodes: [], noteRefs: 0,
    sectionIndex: 0, hasMath: false, align: 'justify', lineSpacing: { kind: 'multiple', value: 1.5 }, firstLineChars: 2, firstLinePt: null,
    spaceBefore: { lines: null, pt: 0 }, spaceAfter: { lines: null, pt: 0 },
    runs: [{ text, fontEn: 'Times New Roman', fontCn: '宋体', sizePt: 12, bold: false, superscript: false }],
    ...extra,
  }
}

function model(specs: [string, Partial<Paragraph>?][]): DocxModel {
  const paragraphs = specs.map(([t, e], i) => para(i, t, e))
  return {
    paragraphs,
    sections: [{ index: 0, lastParagraph: paragraphs.length - 1, pageWidthCm: 21, pageHeightCm: 29.7, margins: null, pageNumberFormat: 'arabic', pageNumberStart: null, titlePage: false, mirrorMargins: false, header: null, footer: { text: '1', hasPageField: true, pageFieldAlign: 'center' }, evenHeader: null, evenFooter: null }],
    trackedChanges: 0, comments: 0, highlights: 0, authors: [], evenAndOddHeaders: false, footnotes: 0, endnotes: 0,
  }
}

const H1 = { headingLevel: 1, align: 'center' as const }
const H2 = { headingLevel: 2 }
const CAP = { styleName: 'caption', align: 'center' as const }
const TOC1 = { inToc: true, styleName: 'toc 1' }
const TOC2 = { inToc: true, styleName: 'toc 2' }

const ids = (m: DocxModel) => checkModel(m, null).issues.map((i) => i.id)

describe('图表题注编号', () => {
  it('按章编号连续时不报', () => {
    expect(ids(model([
      ['第一章 绪论', H1], ['正文。'], ['图 1-1 框架', CAP], ['图 1-2 流程', CAP], ['表 1-1 样本', CAP],
      ['第二章 方法', H1], ['图 2-1 模型', CAP], ['表 2-1 变量', CAP],
    ]))).not.toContain('captions-sequence-figure')
  })

  it('跳号和章号不符都检出', () => {
    const r = checkModel(model([
      ['第一章 绪论', H1], ['图 1-1 框架', CAP], ['图 1-3 流程', CAP],
      ['第二章 方法', H1], ['图 1-4 模型', CAP],
    ]), null)
    const issue = r.issues.find((i) => i.id === 'captions-sequence-figure')!
    expect(issue).toBeDefined()
    expect(issue.detail).toContain('应为 图 1-2')
    expect(issue.detail).toContain('位于第 2 章')
  })

  it('全文编号跳号检出；按章和全文混用检出', () => {
    expect(ids(model([['第一章 绪论', H1], ['表 1 样本', CAP], ['表 3 变量', CAP]]))).toContain('captions-sequence-table')
    expect(ids(model([['第一章 绪论', H1], ['图 1-1 框架', CAP], ['图 2 流程', CAP]]))).toContain('captions-mixed')
  })

  it('正文里以"图 1"开头的长句不当题注', () => {
    expect(ids(model([['第一章 绪论', H1], ['图 3 展示了本文的研究框架，下面逐一说明各个部分的含义和它们之间的关系，以及为什么这样安排。']]))).not.toContain('captions-sequence-figure')
  })
})

describe('目录与正文标题一致', () => {
  it('目录行去掉点线和页码', () => {
    expect(tocEntryTitle('第一章 绪论\t1')).toBe('第一章 绪论')
    expect(tocEntryTitle('1.1 研究背景 ........ 12')).toBe('1.1 研究背景')
    expect(tocEntryTitle('摘  要\tI')).toBe('摘  要')
  })

  it('一致时不报，自动编号的标题也能对上', () => {
    expect(ids(model([
      ['目  录', H1], ['摘  要\tI', TOC1], ['第1章 绪论\t1', TOC1], ['1.1 背景\t1', TOC2],
      ['摘  要', H1], ['内容。'],
      ['绪论', { ...H1, numbered: true }], ['背景', { ...H2, numbered: true }],
    ]))).not.toContain('toc-outdated')
  })

  it('改了标题没更新目录时检出', () => {
    const r = checkModel(model([
      ['目  录', H1], ['第一章 绪论\t1', TOC1], ['1.1 研究背景\t1', TOC2],
      ['第一章 绪论', H1], ['1.1 研究背景与意义', H2], ['1.2 文献综述', H2],
    ]), null)
    const issue = r.issues.find((i) => i.id === 'toc-outdated')!
    expect(issue.detail).toContain('2 个标题不在目录中')
    expect(issue.detail).toContain('目录里有 1 项在正文中找不到')
  })
})

describe('无法判断的不能算通过', () => {
  const profile = {
    school: { name: '测试大学', code: 'test' }, degree: 'bachelor', cohort: 2026, status: 'draft',
    sources: [{ title: '规范', url: 'https://example.edu.cn' }], maintainers: [], last_verified: '2026-10-11',
    references: { standard: 'GB/T 7714-2025', style: 'numeric' },
    format: {
      paper: 'A4', margins_cm: { top: 2.5, bottom: 2.5, left: 3, right: 2.5 },
      body: { font_cn: '宋体', size_pt: 12 }, header: { text: '测试大学本科毕业论文' },
    },
  } as const
  const run = (m: DocxModel) => checkModel(m, profile as never)
  const passed = (r: ReturnType<typeof run>) => r.passed.map((p) => p.item)
  const skipped = (r: ReturnType<typeof run>) => r.skipped.map((p) => p.item)
  const base = (): DocxModel => model([['第一章 绪论', H1], ['正文第一段。[1]'], ['参考文献', H1], ['[1] 张三. 某研究[J]. 某学报, 2024(3): 12-19.']])

  it('页面尺寸和页边距都读不出时判为未检查', () => {
    const m = base()
    m.sections[0] = { ...m.sections[0], pageWidthCm: null, pageHeightCm: null }
    const r = run(m)
    expect(passed(r)).not.toContain('纸张大小')
    expect(passed(r)).not.toContain('页边距')
    expect(skipped(r)).toContain('纸张大小')
    expect(skipped(r)).toContain('页边距')
  })

  it('部分节读不出时，整项记未检查，不算通过', () => {
    const m = base()
    const sec = m.sections[0]
    m.sections = [
      { ...sec, lastParagraph: 0, margins: { top: 2.5, bottom: 2.5, left: 3, right: 2.5, gutter: 0 } },
      { ...sec, index: 1, margins: { top: null, bottom: 2.5, left: 3, right: 2.5, gutter: 0 } },
    ]
    m.paragraphs.slice(1).forEach((p) => (p.sectionIndex = 1))
    const r = run(m)
    expect(passed(r)).not.toContain('页边距')
    expect(r.skipped.find((s) => s.item === '页边距')?.reason).toContain('1 节')
    expect(r.skipped.find((s) => s.item === '页边距')?.reason).toContain('没发现问题')
  })

  it('字体字号读不出的段落不算符合要求', () => {
    const m = base()
    for (const p of m.paragraphs) p.runs = p.runs.map((r) => ({ ...r, fontCn: null, sizePt: null }))
    const r = run(m)
    expect(passed(r)).not.toContain('正文中文字体')
    expect(skipped(r)).toContain('正文中文字体')
    expect(skipped(r)).toContain('正文字号')
  })

  it('部分读不出、部分不符时，问题说明里写明无法判断的数量', () => {
    const m = base()
    m.paragraphs.splice(2, 0, para(2, '第二段。', { runs: [{ text: '第二段。', fontEn: null, fontCn: null, sizePt: 12, bold: false, superscript: false }] }))
    m.paragraphs.splice(3, 0, para(3, '第三段。', { runs: [{ text: '第三段。', fontEn: null, fontCn: '黑体', sizePt: 12, bold: false, superscript: false }] }))
    m.paragraphs.forEach((p, i) => (p.index = i))
    const issue = run(m).issues.find((i) => i.id === 'body-font-cn')!
    expect(issue.detail).toContain('另有 1 段无法从文件中读出')
  })

  it('档案只写了页眉文字、没写 required 时，没有页眉也要报', () => {
    expect(run(base()).issues.map((i) => i.id)).toContain('header-missing')
  })

  it('识别不出文献类型的条目，类型专属规则判为未检查', () => {
    const m = base()
    m.paragraphs[3] = para(3, '[1] 张三. 某研究. 某学报, 2024(3): 12-19.')
    const r = run(m)
    const rule = r.skipped.find((s) => s.category === 'references' && s.reason?.includes('1 条'))
    expect(rule).toBeDefined()
  })
})

describe('结果措辞', () => {
  it('没选学校时写"与通用要求不符"，选了学校写"与所选规则不符"', async () => {
    const { severityLabel } = await import('../src/format/report')
    expect(severityLabel('error', false)).toBe('与通用要求不符')
    expect(severityLabel('error', true)).toBe('与所选规则不符')
    expect(severityLabel('warning', false)).toBe('检测到问题')
  })
})

describe('自动编号的标题', () => {
  const profile = {
    school: { name: '测试大学', code: 'test' }, degree: 'bachelor', cohort: 2026, status: 'draft',
    sources: [{ title: '规范', url: 'https://example.edu.cn' }], maintainers: [], last_verified: '2026-10-11',
    references: { standard: 'GB/T 7714-2025', style: 'numeric' },
    format: { headings: [{ numbering: '第一章' }, { numbering: '1.1' }] },
  } as const
  const auto = (label: string, h: object) => ({ ...h, numbered: true, listLabel: label })

  it('按渲染出的编号检查写法：要求"第一章"、列表显示"第1章"时检出', () => {
    const r = checkModel(model([['绪论', auto('第1章', H1)], ['背景', auto('1.1', H2)], ['内容。']]), profile as never)
    const issue = r.issues.find((i) => i.id === 'h1-numbering')!
    expect(issue.actual).toBe('自动编号显示为"第1章"')
    expect(r.passed.map((p) => p.item)).toContain('二级标题编号写法')
  })

  it('二级标题的列表没跟一级标题关联、换章不重新开始时检出', () => {
    expect(ids(model([
      ['第一章 绪论', H1], ['背景', auto('1.1', H2)], ['意义', auto('1.2', H2)],
      ['第二章 方法', H1], ['步骤', auto('1.3', H2)],
    ]))).toContain('headings-number-sequence')
  })

  it('编号格式认不出时记"未检查"，不算通过', () => {
    const r = checkModel(model([['绪论', { ...H1, numbered: true }], ['内容。']]), profile as never)
    expect(r.skipped.map((p) => p.item)).toContain('一级标题自动编号')
    expect(r.passed.map((p) => p.item)).not.toContain('一级标题编号写法')
  })
})

describe('盲审匿名不打绿勾', () => {
  const blindProfile = {
    school: { name: '测试大学', code: 'test' }, degree: 'master', cohort: 2026, status: 'draft',
    sources: [{ title: '规范', url: 'https://example.edu.cn' }], maintainers: [], last_verified: '2026-10-11',
    format: { blind_review: '送审论文须隐去作者和导师信息' },
  } as const

  it('文档属性没有作者名时，不记通过，记"未检查"并写明没查的范围', () => {
    const m = { ...model([['第一章 绪论', H1], ['作者：张同学，学号 2022141234567'], ['正文。']]), reviewAuthors: ['李老师'] }
    const r = checkModel(m, blindProfile as never)
    const items = r.passed.map((p) => p.item)
    expect(items).not.toContain('文档属性中的作者信息')
    expect(items.some((i) => /匿名|作者/.test(i))).toBe(false)
    const s = r.skipped.find((p) => p.item === '盲审匿名')!
    expect(s).toBeDefined()
    expect(s.reason).toContain('文档属性里没有作者名')
    expect(s.reason).toContain('批注和修订的作者')
    expect(s.reason).toContain('李老师')
  })

  it('有作者名时照常警告，并且仍有"未检查"项', () => {
    const m = { ...model([['正文。']]), authors: ['张三'] }
    const r = checkModel(m, blindProfile as never)
    expect(r.issues.find((i) => i.id === 'cleanup-author-metadata')?.severity).toBe('warning')
    expect(r.skipped.map((p) => p.item)).toContain('盲审匿名')
  })

  it('不要求盲审时，属性里没作者名可以记通过，但不叫匿名', () => {
    const r = checkModel(model([['正文。']]), null)
    expect(r.passed.map((p) => p.item)).toContain('文档属性中的作者信息')
    expect(r.skipped.map((p) => p.item)).not.toContain('盲审匿名')
  })
})

describe('同一项不能既通过又未检查', () => {
  it('skip 撤掉同名的 pass，之后的 pass 也不再记', async () => {
    const { CheckContext } = await import('../src/format/checks/context')
    const ctx = new CheckContext(model([['正文。']]), { headings: [], refHeading: null, refEntries: [] } as never, null)
    ctx.pass('references', '无重复条目')
    ctx.skip('references', '无重复条目', '有 1 条无法判断')
    ctx.pass('references', '无重复条目')
    expect(ctx.passed).toEqual([])
    expect(ctx.skipped).toHaveLength(1)
  })

  it('bad.docx 不选学校：通过和未检查没有重名项', async () => {
    const { readFileSync } = await import('node:fs')
    const { checkDocx } = await import('../src/format/engine')
    const r = checkDocx(new Uint8Array(readFileSync(new URL('./fixtures/bad.docx', import.meta.url))), null)
    const skipped = new Set(r.skipped.map((s) => `${s.category}/${s.item}`))
    expect(r.passed.filter((p) => skipped.has(`${p.category}/${p.item}`))).toEqual([])
  })
})
