import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { citationsIn, expandCitation, reconcileCitations } from '../src/format/citations'
import type { DocxModel, Paragraph, Run } from '../src/format/docx'
import { checkDocx, checkModel } from '../src/format/engine'
import { analyze } from '../src/format/structure'

const run = (text: string, superscript = false): Run => ({ text, fontEn: null, fontCn: null, sizePt: null, bold: false, superscript })

/** 段落由若干 run 组成：字符串是普通文字，[文字] 元组是上标 */
function para(index: number, parts: (string | [string])[], extra: Partial<Paragraph> = {}): Paragraph {
  const runs = parts.map((x) => (typeof x === 'string' ? run(x) : run(x[0], true)))
  return {
    index, text: runs.map((r) => r.text).join(''), styleId: null, styleName: null, headingLevel: null, inTable: false, inToc: false,
    numbered: false, listLabel: null, sectionIndex: 0, hasMath: false, align: 'justify', lineSpacing: { kind: 'multiple', value: 1.5 },
    firstLineChars: 2, firstLinePt: null, spaceBefore: { lines: null, pt: 0 }, spaceAfter: { lines: null, pt: 0 }, runs, ...extra,
  }
}

function model(specs: [(string | [string])[], Partial<Paragraph>?][]): DocxModel {
  const paragraphs = specs.map(([parts, e], i) => para(i, parts, e))
  return {
    paragraphs,
    sections: [{ index: 0, lastParagraph: paragraphs.length - 1, pageWidthCm: 21, pageHeightCm: 29.7, margins: null, pageNumberFormat: 'arabic', pageNumberStart: null, titlePage: false, mirrorMargins: false, header: null, footer: null, evenHeader: null, evenFooter: null }],
    trackedChanges: 0, comments: 0, highlights: 0, authors: [], evenAndOddHeaders: false,
  }
}

const H1 = { headingLevel: 1 }
const cites = (...parts: (string | [string])[]) => citationsIn(para(0, parts)).map((c) => [c.raw, c.numbers, c.superscript, c.bare])

describe('抽取引用标号', () => {
  it('方括号的各种写法', () => {
    expect(cites('前人研究[1]，见［6］和【7】，另见[2-4]与[1,3]。')).toEqual([
      ['[1]', [1], false, false], ['［6］', [6], false, false], ['【7】', [7], false, false],
      ['[2-4]', [2, 3, 4], false, false], ['[1,3]', [1, 3], false, false],
    ])
  })

  it('上标方括号拆在几个 run 里也算一处，记为上标', () => {
    expect(cites('前人研究', ['['], ['1'], [',3]'], '表明')).toEqual([['[1,3]', [1, 3], true, false]])
  })

  it('没有方括号的上标数字：跟在汉字后面算引用，跟在字母或数字后面是指数', () => {
    expect(cites('前人研究', ['1,2'], '表明')).toEqual([['1,2', [1, 2], true, true]])
    expect(cites('面积 x', ['2'], '，约 10', ['3'], ' 平方米')).toEqual([])
  })

  it('[0,1] 这样的区间不是引用；倒序区间记为写法有误', () => {
    expect(cites('取值范围为 [0,1]。')).toEqual([])
    expect(cites('见[5-3]。')).toEqual([['[5-3]', [], false, false]])
    expect(expandCitation('1-90')).toBeNull()
  })
})

describe('引用对账', () => {
  const doc = model([
    [['第一章 绪论'], H1],
    [['已有研究', ['[1]'], '提出了方法，后续工作', ['[3]'], '和', ['[2,9]'], '做了改进', ['[1]'], '。']],
    [['参考文献'], H1],
    [['[1] 张三. 甲[J]. 某学报, 2024(1): 1-2.']],
    [['[2] 李四. 乙[J]. 某学报, 2024(1): 1-2.']],
    [['[3] 王五. 丙[J]. 某学报, 2024(1): 1-2.']],
    [['[4] 赵六. 丁[J]. 某学报, 2024(1): 1-2.']],
  ])

  it('逐条对上：引用次数、没有的编号、没被引用的条目、顺序', () => {
    const r = reconcileCitations(doc, analyze(doc))
    expect(r.entries.map((e) => [e.number, e.timesCited])).toEqual([[1, 2], [2, 1], [3, 1], [4, 0]])
    expect(r.missing.map((m) => m.number)).toEqual([9])
    expect(r.uncited).toEqual([3])
    expect(r.outOfOrder.map((o) => o.number)).toEqual([3])
  })

  it('报告里带对账表，检查结果与对账一致', () => {
    const report = checkModel(doc, null)
    expect(report.citationMap?.references.map((x) => x.timesCited)).toEqual([2, 1, 1, 0])
    expect(report.citationMap?.missing).toEqual([9])
    expect(report.citationMap?.references[0].firstCited?.excerpt).toContain('已有研究')
    expect(report.issues.map((i) => i.id)).toEqual(expect.arrayContaining(['cite-out-of-range', 'cite-uncited', 'cite-order']))
  })

  it('参考文献用自动编号 [%1] 时按渲染出的编号对账', () => {
    const auto = model([
      [['第一章 绪论'], H1], [['研究', ['[1]'], '和', ['[2]'], '。']], [['参考文献'], H1],
      [['张三. 甲[J]. 某学报, 2024(1): 1-2.'], { numbered: true, listLabel: '[1]' }],
      [['李四. 乙[J]. 某学报, 2024(1): 1-2.'], { numbered: true, listLabel: '[2]' }],
    ])
    const r = reconcileCitations(auto, analyze(auto))
    expect([r.missing, r.uncited, r.outOfOrder]).toEqual([[], [], []])
  })

  it('真实样例：good.docx 全部对上', () => {
    const report = checkDocx(new Uint8Array(readFileSync(new URL('./fixtures/good.docx', import.meta.url))), null)
    const map = report.citationMap!
    expect(map.references.length).toBe(report.references.length)
    expect(map.missing).toEqual([])
    expect(map.uncited).toEqual([])
    expect(map.references.every((x) => x.firstCited !== null)).toBe(true)
  })
})
