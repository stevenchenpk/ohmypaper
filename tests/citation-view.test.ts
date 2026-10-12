import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { citationNotes, citationRows, citationSummary, verifyCallouts } from '../src/format/citationView'
import type { DocxModel, Paragraph } from '../src/format/docx'
import { checkDocx, checkModel } from '../src/format/engine'
import type { SchoolProfile } from '../src/format/profile'
import type { CitationMap } from '../src/format/report'

const fixtures = join(__dirname, 'fixtures')
const load = (name: string) => new Uint8Array(readFileSync(join(fixtures, name)))
const profile = parse(readFileSync(join(fixtures, 'test-profile.yaml'), 'utf8')) as SchoolProfile

describe('引用对账表的文字', () => {
  const good = checkDocx(load('good.docx'), profile).citationMap!
  const bad = checkDocx(load('bad.docx'), profile).citationMap!

  it('概况写明检测到几处、覆盖几条', () => {
    expect(citationSummary(good)).toBe('正文检测到 4 处引用标注，覆盖参考文献 4 / 4 条')
    expect(citationSummary(bad)).toMatch(/覆盖参考文献 4 \/ 5 条/)
  })

  it('说明识别范围；对不上的编号单独列出', () => {
    expect(citationNotes(good)[0]).toMatch(/脚注、尾注/)
    expect(citationNotes(bad).join('')).toContain('[6]')
  })

  it('每条一行：被引次数、首次位置、没引用的标出来；没核验时不显示结果', () => {
    const rows = citationRows(bad)
    expect(rows[0]).toMatchObject({ label: '[1]', cited: '引用 1 次', citedTone: 'ok', verify: null })
    expect(rows[0].where).toContain('1.1 研究背景')
    expect(rows[4]).toMatchObject({ label: '[5]', cited: '正文没有引用', citedTone: 'warn' })
  })

  it('核验结果按下标回填；查无此文的列出正文引用位置', () => {
    const verify = [
      { status: 'verified' as const, reason: '' },
      undefined,
      { status: 'not_found' as const, reason: '' },
      { status: 'manual' as const, reason: '' },
      { status: 'mismatch' as const, reason: '' },
    ]
    const rows = citationRows(bad, verify)
    expect(rows.map((r) => r.verify?.label ?? null)).toEqual(['已核实', null, '查无此文', '需人工核对', '信息不符'])
    expect(rows[3].verify!.tone).toBe('open') // 需人工核对不算通过
    const lines = verifyCallouts(bad, verify)
    expect(lines[0]).toBe('正文 「1.2 研究意义」引用的 [3] 核验为查无此文')
    expect(lines[1]).toBe('[5] 核验为信息不符（正文中没有找到对它的引用）')
  })

  it('一处引用都没识别出来时，每条都是"未检查"，不说没引用', () => {
    const map: CitationMap = {
      citations: [], missing: [], uncited: [0], outOfOrder: [], malformed: [],
      references: [{ number: 1, text: 'x', timesCited: 0, firstCited: null }],
      uncertain: { unreadFieldParagraphs: 0, noteRefs: 0, ambiguous: [] },
    }
    expect(citationSummary(map)).toMatch(/没有识别出引用标注/)
    expect(citationRows(map)[0]).toMatchObject({ cited: '未检查', citedTone: 'open' })
    expect(verifyCallouts(map, [{ status: 'not_found', reason: '' }])[0]).toMatch(/引用位置没有识别出来/)
  })
})

function para(index: number, text: string, extra: Partial<Paragraph> = {}): Paragraph {
  return {
    index, text, styleId: null, styleName: null, headingLevel: null, inTable: false, inToc: false, numbered: false, listLabel: null,
    sectionIndex: 0, hasMath: false, align: 'justify', lineSpacing: { kind: 'multiple', value: 1.5 }, firstLineChars: 2, firstLinePt: null,
    spaceBefore: { lines: null, pt: 0 }, spaceAfter: { lines: null, pt: 0 },
    runs: [{ text, fontEn: null, fontCn: null, sizePt: null, bold: false, superscript: false }], fieldCodes: [], noteRefs: 0, ...extra,
  }
}
function model(refs: string[]): DocxModel {
  const texts: [string, Partial<Paragraph>?][] = [
    ['第一章 绪论', { headingLevel: 1 }], [`正文${refs.map((_, i) => `[${i + 1}]`).join('')}。`], ['参考文献', { headingLevel: 1 }],
    ...refs.map((r, i): [string] => [`[${i + 1}] ${r}`]),
  ]
  const paragraphs = texts.map(([t, e], i) => para(i, t, e))
  return {
    paragraphs,
    sections: [{ index: 0, lastParagraph: paragraphs.length - 1, pageWidthCm: 21, pageHeightCm: 29.7, margins: null, pageNumberFormat: 'arabic', pageNumberStart: null, titlePage: false, mirrorMargins: false, header: null, footer: null, evenHeader: null, evenFooter: null }],
    trackedChanges: 0, comments: 0, highlights: 0, authors: [], evenAndOddHeaders: false, footnotes: 0, endnotes: 0,
  }
}

describe('重复的参考文献', () => {
  const A = '张三, 李四. 生成式人工智能对高等教育的影响研究[J]. 中国高教研究, 2024(3): 12-19.'
  it('同一篇列了两次：报出两个编号', () => {
    const r = checkModel(model([A, '王五. 某某问题研究[D]. 北京: 北京大学, 2020.', A.replace('12-19', '12-20')]), null)
    const dup = r.issues.find((i) => i.id === 'refs-duplicate')!
    expect(dup).toBeDefined()
    expect(dup.detail).toContain('[1] 和 [3]')
  })

  it('题名相同但第一作者或年份不同，不算重复', () => {
    const r = checkModel(model([A, A.replace('张三', '赵六'), A.replace('2024', '2019')]), null)
    expect(r.issues.map((i) => i.id)).not.toContain('refs-duplicate')
    expect(r.passed.map((p) => p.item)).toContain('无重复条目')
  })

  it('题名拆不出来的条目不比较，记未检查而不是通过', () => {
    const r = checkModel(model(['随便写的一行', '随便写的一行']), null)
    expect(r.issues.map((i) => i.id)).not.toContain('refs-duplicate')
    expect(r.passed.map((p) => p.item)).not.toContain('无重复条目')
    expect(r.skipped.find((s) => s.item === '无重复条目')?.reason).toMatch(/没拆出题名/)
  })
})

describe('对账表里的未检查项', () => {
  it('有脚注或读不出的域引用时，没识别到的条目不说"没有引用"', () => {
    const map: CitationMap = {
      citations: [{ numbers: [1] } as never], missing: [], uncited: [1], outOfOrder: [], malformed: [],
      references: [
        { number: 1, text: 'a', timesCited: 1, firstCited: null },
        { number: 2, text: 'b', timesCited: 0, firstCited: null },
      ],
      uncertain: { unreadFieldParagraphs: 2, noteRefs: 3, ambiguous: [] },
    }
    expect(citationRows(map)[1]).toMatchObject({ cited: '没识别到引用，需人工确认', citedTone: 'open' })
    const note = citationNotes(map).find((n) => n.startsWith('未检查，需人工确认'))!
    expect(note).toContain('2 段')
    expect(note).toContain('3 个脚注或尾注')
    expect(note).toContain('不算通过')
  })
})
