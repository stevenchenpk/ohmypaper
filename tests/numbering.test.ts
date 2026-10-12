import { readFileSync } from 'node:fs'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseDocx } from '../src/format/docx'
import { checkDocx } from '../src/format/engine'
import { formatNumber } from '../src/format/numbering'
import { parse } from 'yaml'
import type { SchoolProfile } from '../src/format/profile'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'

function docx(body: string, numbering: string, styles = ''): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`),
    'word/numbering.xml': strToU8(`<w:numbering xmlns:w="${W}" xmlns:mc="${MC}">${numbering}</w:numbering>`),
  }
  if (styles) files['word/styles.xml'] = strToU8(`<w:styles xmlns:w="${W}">${styles}</w:styles>`)
  return zipSync(files)
}

const lvl = (ilvl: number, fmt: string, text: string, extra = '') =>
  `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/>${extra}<w:lvlText w:val="${text}"/></w:lvl>`
const p = (text: string, pPr = '') => `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
const numPr = (numId: string | number, ilvl?: number) =>
  `<w:numPr>${ilvl === undefined ? '' : `<w:ilvl w:val="${ilvl}"/>`}<w:numId w:val="${numId}"/></w:numPr>`
const labels = (data: Uint8Array) => parseDocx(data).paragraphs.map((x) => x.listLabel)

describe('编号格式', () => {
  it.each([
    [1, 'chineseCounting', '一'], [10, 'chineseCounting', '十'], [11, 'chineseCounting', '十一'],
    [20, 'chineseCounting', '二十'], [21, 'chineseCountingThousand', '二十一'], [105, 'chineseCounting', '一百零五'],
    [3, 'chineseLegalSimplified', '叁'], [2, 'ideographTraditional', '乙'], [4, 'upperRoman', 'IV'], [9, 'lowerRoman', 'ix'],
    [27, 'upperLetter', 'AA'], [3, 'lowerLetter', 'c'], [2, 'decimalEnclosedCircle', '②'], [5, 'decimalZero', '05'],
    [12, 'decimalFullWidth', '１２'],
  ])('%i %s → %s', (n, fmt, out) => expect(formatNumber(n, fmt)).toBe(out))

  it('认不出的格式返回 null', () => expect(formatNumber(1, 'japaneseLegal')).toBeNull())
})

describe('自动编号渲染', () => {
  const multi = `<w:abstractNum w:abstractNumId="1">${lvl(0, 'chineseCounting', '第%1章')}${lvl(1, 'decimal', '%1.%2', '<w:isLgl/>')}${lvl(2, 'decimal', '%1.%2.%3', '<w:isLgl/>')}</w:abstractNum>` +
    `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>`

  it('多级列表：下级随上级重新开始，isLgl 时上级用阿拉伯数字', () => {
    expect(labels(docx(
      p('绪论', numPr(1, 0)) + p('背景', numPr(1, 1)) + p('意义', numPr(1, 1)) + p('细节', numPr(1, 2)) +
      p('方法', numPr(1, 0)) + p('步骤', numPr(1, 1)) + p('正文'),
      multi,
    ))).toEqual(['第一章', '1.1', '1.2', '1.2.1', '第二章', '2.1', null])
  })

  it('numId 为 0 取消样式带来的编号，且不占计数', () => {
    const styles = `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr>${numPr(1, 0)}<w:outlineLvl w:val="0"/></w:pPr></w:style>`
    const d = parseDocx(docx(
      p('摘要', '<w:pStyle w:val="Heading1"/>' + numPr(0)) + p('绪论', '<w:pStyle w:val="Heading1"/>') + p('方法', '<w:pStyle w:val="Heading1"/>'),
      multi, styles,
    ))
    expect(d.paragraphs.map((x) => [x.numbered, x.listLabel])).toEqual([[false, null], [true, '第一章'], [true, '第二章']])
  })

  it('LibreOffice 写法：样式里只有 numId，级别靠列表级别上的 pStyle 关联', () => {
    const num = `<w:abstractNum w:abstractNumId="7">${lvl(0, 'decimal', '%1', '<w:pStyle w:val="H1"/>')}${lvl(1, 'decimal', '%1.%2', '<w:pStyle w:val="H2"/>')}</w:abstractNum>` +
      `<w:num w:numId="3"><w:abstractNumId w:val="7"/></w:num>`
    const styles = `<w:style w:type="paragraph" w:styleId="H1"><w:name w:val="Heading 1"/><w:pPr>${numPr(3)}</w:pPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="H2"><w:name w:val="Heading 2"/><w:pPr>${numPr(3)}</w:pPr></w:style>`
    expect(labels(docx(
      p('绪论', '<w:pStyle w:val="H1"/>') + p('背景', '<w:pStyle w:val="H2"/>') + p('方法', '<w:pStyle w:val="H1"/>') + p('步骤', '<w:pStyle w:val="H2"/>'),
      num, styles,
    ))).toEqual(['1', '1.1', '2', '2.1'])
  })

  it('WPS 写法：自定义编号格式包在 mc:AlternateContent 里，取 Fallback', () => {
    const num = `<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="1"/>` +
      `<mc:AlternateContent><mc:Choice Requires="w14"><w:numFmt w:val="custom" w:format="一, 二, 三, ..."/></mc:Choice>` +
      `<mc:Fallback><w:numFmt w:val="chineseCounting"/></mc:Fallback></mc:AlternateContent>` +
      `<w:lvlText w:val="%1、"/></w:lvl></w:abstractNum><w:num w:numId="5"><w:abstractNumId w:val="2"/></w:num>`
    expect(labels(docx(p('引言', numPr(5, 0)) + p('方法', numPr(5, 0)), num))).toEqual(['一、', '二、'])
  })

  it('"重新开始编号"（startOverride）从指定值起；共用抽象编号的 num 接着数', () => {
    const num = `<w:abstractNum w:abstractNumId="4">${lvl(0, 'decimal', '[%1]')}</w:abstractNum>` +
      `<w:num w:numId="1"><w:abstractNumId w:val="4"/></w:num>` +
      `<w:num w:numId="2"><w:abstractNumId w:val="4"/></w:num>` +
      `<w:num w:numId="3"><w:abstractNumId w:val="4"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`
    expect(labels(docx(p('a', numPr(1, 0)) + p('b', numPr(1, 0)) + p('c', numPr(2, 0)) + p('d', numPr(3, 0)) + p('e', numPr(3, 0)), num)))
      .toEqual(['[1]', '[2]', '[3]', '[1]', '[2]'])
  })

  it('lvlRestart=0 时下级不随上级重新开始', () => {
    const num = `<w:abstractNum w:abstractNumId="1">${lvl(0, 'decimal', '第%1章')}${lvl(1, 'decimal', '图%2', '<w:lvlRestart w:val="0"/>')}</w:abstractNum>` +
      `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>`
    expect(labels(docx(p('a', numPr(1, 0)) + p('b', numPr(1, 1)) + p('c', numPr(1, 0)) + p('d', numPr(1, 1)), num)))
      .toEqual(['第1章', '图1', '第2章', '图2'])
  })

  it('认不出的编号格式不猜，编号文字为 null', () => {
    const num = `<w:abstractNum w:abstractNumId="1">${lvl(0, 'japaneseLegal', '%1')}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>`
    const d = parseDocx(docx(p('a', numPr(1, 0)), num))
    expect([d.paragraphs[0].numbered, d.paragraphs[0].listLabel]).toEqual([true, null])
  })

  it('项目符号和没有 numbering.xml 的情况', () => {
    const num = `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>`
    expect(labels(docx(p('a', numPr(1, 0)), num))).toEqual(['•'])
    expect(labels(docx(p('a', numPr(9, 0)), ''))).toEqual([null])
  })
})

describe('压测样例：标题和参考文献用自动编号', () => {
  const data = new Uint8Array(readFileSync(new URL('./fixtures/stress/mixed-numbering.docx', import.meta.url)))
  const profile = parse(readFileSync(new URL('./fixtures/test-profile.yaml', import.meta.url), 'utf8')) as SchoolProfile

  it('编号渲染与 Word 显示一致', () => {
    const d = parseDocx(data)
    const shown = d.paragraphs.filter((x) => x.listLabel !== null).map((x) => x.listLabel)
    expect(shown.slice(0, 5)).toEqual(['第一章', '1.1', '1.2', '1.3', '第二章'])
    expect(shown).toContain('2.2.1')
    expect(shown.slice(-5)).toEqual(['[1]', '[2]', '[3]', '[4]', '[5]'])
  })

  it('自动编号的标题也检查编号写法，不再记"未检查"', () => {
    const r = checkDocx(data, profile)
    expect(r.passed.map((x) => x.item)).toEqual(expect.arrayContaining(['一级标题编号写法', '二级标题编号写法', '三级标题编号写法', '标题编号连续', '参考文献序号']))
    expect(r.skipped.map((x) => x.item)).not.toContain('一级标题自动编号')
  })
})
