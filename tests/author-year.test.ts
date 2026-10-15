import { describe, expect, it } from 'vitest'
import { authorYearCitationsIn, reconcileAuthorYear } from '../src/format/authorYear'
import type { DocxModel, Paragraph } from '../src/format/docx'
import { checkModel } from '../src/format/engine'
import { analyze } from '../src/format/structure'

function para(index: number, text: string, extra: Partial<Paragraph> = {}): Paragraph {
  return {
    index, text, styleId: null, styleName: null, headingLevel: null, inTable: false, inToc: false,
    numbered: false, listLabel: null, fieldCodes: [], noteRefs: 0, sectionIndex: 0, hasMath: false, align: 'justify',
    lineSpacing: { kind: 'multiple', value: 1.5 }, firstLineChars: 2, firstLinePt: null,
    spaceBefore: { lines: null, pt: 0 }, spaceAfter: { lines: null, pt: 0 },
    runs: [{ text, fontEn: null, fontCn: null, sizePt: null, bold: false, superscript: false }], ...extra,
  }
}

const H1 = { headingLevel: 1 }

/** 正文若干段 + 参考文献表 */
function model(body: (string | [string, Partial<Paragraph>])[], refs: string[]): DocxModel {
  const specs: [string, Partial<Paragraph>?][] = [
    ['第一章 绪论', H1],
    ...body.map((b): [string, Partial<Paragraph>?] => (typeof b === 'string' ? [b] : b)),
    ['参考文献', H1],
    ...refs.map((r): [string] => [r]),
  ]
  const paragraphs = specs.map(([t, e], i) => para(i, t, e))
  return {
    paragraphs,
    sections: [{ index: 0, lastParagraph: paragraphs.length - 1, pageWidthCm: 21, pageHeightCm: 29.7, margins: null, pageNumberFormat: 'arabic', pageNumberStart: null, titlePage: false, mirrorMargins: false, header: null, footer: null, evenHeader: null, evenFooter: null }],
    trackedChanges: 0, comments: 0, highlights: 0, authors: [], evenAndOddHeaders: false, footnotes: 0, endnotes: 0,
  }
}

const AY = {
  school: { name: '测试大学', code: 'test' }, degree: 'bachelor', cohort: 2026, status: 'draft',
  sources: [{ title: '规范', url: 'https://example.edu.cn' }], maintainers: [], last_verified: '2026-10-11',
  references: { standard: 'GB/T 7714-2015', style: 'author-year' },
} as never

const found = (text: string, known: string[] = []) => {
  const r = authorYearCitationsIn(para(0, text), known)
  return { cites: r.citations.map((c) => `${c.author}|${c.year}${c.suffix ?? ''}`), unresolved: r.unresolved }
}

describe('抽取"作者, 年份"式引用', () => {
  it('括号式：多项、等、et al.、&、同一著者几年、a/b 后缀、页码、"见"', () => {
    expect(found('已有研究（张三等, 2020; 李四，2021a）表明').cites).toEqual(['张三|2020', '李四|2021a'])
    expect(found('as shown (Smith et al., 2019; Lee & Park, 2018: 15).').cites).toEqual(['Smith|2019', 'Lee|2018'])
    expect(found('(see Smith, 2019, 2020b)').cites).toEqual(['Smith|2019', 'Smith|2020b'])
    expect(found('（张三, 2019a, b）').cites).toEqual(['张三|2019a', '张三|2019b'])
    expect(found('(van der Berg, 2018, p. 5)').cites).toEqual(['van der Berg|2018'])
  })

  it('叙述式：中文著者只认文献表里有的，西文取括号前的姓', () => {
    expect(found('根据张三等（2020a）的研究', ['张三']).cites).toEqual(['张三|2020a'])
    expect(found('欧阳明（2019）提出', ['欧阳明', '明']).cites).toEqual(['欧阳明|2019'])
    expect(found('Smith and Jones (2019) argued').cites).toEqual(['Smith|2019'])
    expect(found('LeCun et al. (2015) showed').cites).toEqual(['LeCun|2015'])
  })

  it('认不出著者的记为无法判断；不是引用的括号不理会', () => {
    expect(found('有研究（2020）指出', ['张三'])).toEqual({ cites: [], unresolved: ['有研究（2020）'] })
    expect(found('样本量（N = 120, 2019）').unresolved).toEqual(['N = 120, 2019'])
    expect(found('2020 年（2020）发布；于（2020 年）实施；日期（2020-01-01）')).toEqual({ cites: [], unresolved: [] })
  })
})

describe('著者-出版年制对账', () => {
  const refs = [
    '张三. 2020a. 甲[J]. 某学报(1): 1-2.',
    '张三. 2020b. 乙[J]. 某学报(2): 3-4.',
    '李四, 王五. 2021. 丙[M]. 北京: 某出版社.',
    'LECUN Y, BENGIO Y, HINTON G. 2015. Deep learning[J]. Nature, 521: 436-444.',
    'van der Berg K. 2018. A study[J]. Journal, 1: 1-9.',
  ]

  it('全部对上：后缀、西文姓大小写、多词姓', () => {
    const doc = model(['已有研究（张三, 2020a）和张三（2020b）、李四等（2021）、LeCun et al. (2015) 与 (van der Berg, 2018) 都讨论过。'], refs)
    const r = reconcileAuthorYear(doc, analyze(doc))
    expect(r.entries.map((e) => e.timesCited)).toEqual([1, 1, 1, 1, 1])
    expect([r.missing, r.yearMismatch, r.needSuffix, r.uncited, r.unresolved]).toEqual([[], [], [], [], []])
    const report = checkModel(doc, AY)
    expect(report.passed.map((p) => p.item)).toEqual(expect.arrayContaining(['引用与文献表对应', '每条文献都被引用']))
    expect(report.authorYearMap?.references[3].firstCited?.excerpt).toContain('已有研究')
  })

  it('找不到著者、年份对不上、同年多篇没写后缀、没被引用', () => {
    const doc = model(['研究（赵六, 2020）、（李四, 2019）和（张三, 2020）。'], refs)
    const r = reconcileAuthorYear(doc, analyze(doc))
    expect(r.missing.map((i) => r.citations[i].raw)).toEqual(['赵六, 2020'])
    expect(r.yearMismatch.map((m) => m.listed)).toEqual([['2021']])
    expect(r.needSuffix.map((i) => r.citations[i].raw)).toEqual(['张三, 2020'])
    // 张三 2020a/2020b 都可能被引，不算"没被引用"
    expect(r.uncited).toEqual([3, 4])
    const ids = checkModel(doc, AY).issues.map((i) => i.id)
    expect(ids).toEqual(expect.arrayContaining(['cite-ay-missing', 'cite-ay-year', 'cite-ay-suffix', 'cite-uncited']))
  })

  it('文献表同一著者同年多篇没加 a、b 时检出', () => {
    const doc = model(['研究（张三, 2020）。'], ['张三. 2020. 甲[J]. 某学报(1): 1-2.', '张三. 2020. 乙[J]. 某学报(2): 3-4.'])
    const report = checkModel(doc, AY)
    expect(report.issues.map((i) => i.id)).toEqual(expect.arrayContaining(['refs-ay-suffix', 'cite-ay-suffix']))
  })

  it('拿不准时不判通过：认不出的引用、读不出的文献条目、脚注', () => {
    const items = (d: DocxModel) => {
      const r = checkModel(d, AY)
      return { passed: r.passed.map((p) => p.item), skipped: r.skipped.map((p) => p.item), uncited: r.issues.find((i) => i.id === 'cite-uncited') }
    }
    const unresolved = items(model(['研究（张三, 2020a）、（张三, 2020b）、（李四, 2021）、(LeCun, 2015)、(van der Berg, 2018)，另有研究（2019）指出。'], refs))
    expect(unresolved.passed).not.toContain('引用与文献表对应')
    expect(unresolved.skipped).toEqual(expect.arrayContaining(['引用与文献表对应', '每条文献都被引用']))

    const unread = items(model(['研究（张三, 2020a）。'], ['张三. 2020a. 甲[J]. 某学报(1): 1-2.', '某某手册[Z].']))
    expect(unread.passed).not.toContain('每条文献都被引用')

    const notes = items(model([['研究（张三, 2020a）。', { noteRefs: 2 }]], refs))
    expect(notes.uncited?.severity).toBe('info')
    expect(notes.uncited?.detail).toContain('脚注')
  })

  it('西文叙述式找不到著者时记无法判断，不报"文献表里没有"', () => {
    const doc = model(['In China (2020), the policy changed; 研究（张三, 2020a）。'], refs)
    const r = reconcileAuthorYear(doc, analyze(doc))
    expect(r.missing).toEqual([])
    expect(r.unresolved.map((u) => u.raw)).toEqual(['China (2020)'])
  })

  it('著者-出版年制下没有找到任何引用时：有脚注记"未检查"，否则提示', () => {
    expect(checkModel(model([['正文。', { noteRefs: 1 }]], refs), AY).skipped.map((p) => p.item)).toContain('正文引用与文献表对账')
    expect(checkModel(model(['正文。'], refs), AY).issues.map((i) => i.id)).toContain('cite-none')
  })
})

describe('著者-出版年制对账表的文字', () => {
  const refs = [
    '张三. 2020a. 甲[J]. 某学报(1): 1-2.',
    '张三. 2020b. 乙[J]. 某学报(2): 3-4.',
    '李四, 王五. 2021. 丙[M]. 北京: 某出版社.',
    'LECUN Y, BENGIO Y, HINTON G. 2015. Deep learning[J]. Nature, 521: 436-444.',
  ]

  it('每条一行：著者 + 年份作标签，被引次数，没引的和区分不出的分开写', async () => {
    const { authorYearView } = await import('../src/format/citationView')
    const map = checkModel(model(['研究（张三, 2020a）和（李四, 2019）。'], refs), AY).authorYearMap!
    const v = authorYearView(map)
    expect(v.summary).toBe('正文检测到 2 处"作者, 年份"式引用，对上参考文献 1 / 4 条')
    expect(v.rows.map((r) => [r.label, r.cited])).toEqual([
      ['张三 2020a', '引用 1 次'],
      ['张三 2020b', '正文没有引用'],
      ['李四 2021', '可能被引用，年份或 a、b 对不上，需人工确认'],
      ['LECUN Y 2015', '正文没有引用'],
    ])
    expect(v.notes.join('')).toContain('"李四, 2019"（文献表是 2021）')
  })

  it('没识别出引用时每条都记"未检查"；核验有问题的列出正文引用位置', async () => {
    const { authorYearView } = await import('../src/format/citationView')
    const none = authorYearView(checkModel(model(['正文。'], refs), AY).authorYearMap!)
    expect(none.rows.every((r) => r.cited === '未检查')).toBe(true)

    const map = checkModel(model(['研究（张三, 2020a）。'], refs), AY).authorYearMap!
    const v = authorYearView(map, [{ status: 'not_found', reason: '' }, { status: 'mismatch', reason: '' }])
    expect(v.callouts[0]).toMatch(/^正文 「第一章 绪论」引用的 张三 2020a 核验为/)
    expect(v.callouts[1]).toContain('正文中没有确定对上它的引用')
  })
})
