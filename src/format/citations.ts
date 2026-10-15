/**
 * 引用对账（顺序编码制）：从正文里抽出引用标号，和参考文献表逐条对上。
 *
 * 识别两种写法：
 * - 方括号：[1]、[2-5]、[1,3]、［6］、【7】，上标或不上标都算
 * - 不带括号的上标数字：……研究¹,³ 这种（国标要求带方括号，单独标出来）
 * 不当作引用的：[0,1] 这样含 0 的区间、10³ 这类跟在数字后面的上标（指数）。
 * 跟在拉丁字母后面的上标数字（learning¹，也可能是 x²）分不清，记为"无法判断"。
 * 倒序或跨度过大的区间（[5-3]、[1-90]）不展开，记为"写法有误"。
 *
 * 读不到的引用：脚注/尾注里的、文献管理软件（Zotero、EndNote、NoteExpress 等）的域显示成别的样子的。
 * 文档里有这些时，"每条都被引用""引用顺序"不能判为通过，见 CitationReconciliation.uncertain。
 */

import type { DocxModel, Paragraph } from './docx'
import { type Structure, shownText } from './structure'

export interface Citation {
  /** 展开后的文献编号，[2-4] → [2,3,4] */
  numbers: number[]
  /** 原文，如 "[2-4]" */
  raw: string
  /** 段落序号 */
  paragraph: number
  /** 在段落文字中的起始位置 */
  offset: number
  /** 整个标号都是上标 */
  superscript: boolean
  /** 没有方括号的上标数字 */
  bare: boolean
  /** 跟在拉丁字母后面的上标数字：可能是引用，也可能是指数，无法判断 */
  ambiguous: boolean
}

export interface CitedEntry {
  /** 文献表中的编号（手写 [1] 或自动编号）；读不出编号为 null */
  number: number | null
  paragraph: number
  /** 被引用的次数（一个 [1-3] 对其中每条各算一次） */
  timesCited: number
  /** 第一次被引用的那条 Citation 在 citations 里的下标 */
  firstCitation: number | null
}

export interface CitationReconciliation {
  citations: Citation[]
  entries: CitedEntry[]
  /** 正文引了、文献表里没有的编号 */
  missing: { number: number; citation: number }[]
  /** 文献表里有、正文没引的条目（entries 下标） */
  uncited: number[]
  /** 没按首次引用先后编号的：第一次出现时前面还有更小的编号没出现过 */
  outOfOrder: { number: number; citation: number }[]
  /** 写法有误、无法展开的标号 */
  malformed: Citation[]
  /** 可能有没读到的引用；任何一项非零，"每条都被引用""引用顺序"都不能算通过 */
  uncertain: {
    /** 有文献管理软件引用域、却没读出标号的段落数 */
    unreadFieldParagraphs: number
    /** 正文里的脚注、尾注引用标记个数 */
    noteRefs: number
    /** 跟在拉丁字母后面的上标数字 */
    ambiguous: Citation[]
  }
}

/** 文献管理软件插入引用时用的域：Zotero、EndNote、Mendeley、NoteExpress、Citavi、Word 自带引文 */
const CITATION_FIELD = /^(ADDIN\s+(ZOTERO_ITEM|EN\.CITE|CSL_CITATION|MENDELEY|NE\.REF|CITAVI|PAPERS2|RW\d?\.)|CITATION\b)/i
export const isCitationField = (code: string) => CITATION_FIELD.test(code.trim())

/** 参考文献表之后不算引用的部分：发表论文清单、作者简介等本身就是列表 */
const NOT_CITING_SECTION = /发表|成果|作者简介|个人简历|攻读/

/** 正文里"作者, 年份"写法的引用：（张三, 2020）、（Smith et al., 2019）、张三等（2021） */
const AUTHOR_YEAR_RE = /[（(][^（）()]{1,60}?[,，]\s*(?:19|20)\d{2}[a-z]?(?:[;；][^（）()]*)?[)）]|(?:等|et al\.?)\s*[（(](?:19|20)\d{2}[a-z]?[)）]/g

const MANUAL_NO = /^\s*[[［【]\s*(\d+)\s*[\]］】]\s*/
const BRACKET_RE = /[[［【]\s*(\d{1,3}(?:\s*[-–—~～,，、]\s*\d{1,3})*)\s*[\]］】]/g
const BARE_RE = /^\d{1,3}(?:\s*[-–—~～,，、]\s*\d{1,3})*$/
/** 上标数字前面是这些字符时才当引用：汉字、中文标点、右引号右括号 */
const BEFORE_BARE = /[㐀-鿿　-〿！-／：-＠"”’)）》]/
/** 拉丁字母（或紧跟其后的英文标点）后面的上标数字：learning¹、results.² */
const BEFORE_AMBIGUOUS = /[A-Za-z][.,;:]?$/
const MAX_SPAN = 50

/** 文献表中第 i 条的编号：手写 [n] 优先，其次自动编号；都没有为 null */
export function entryNumber(p: Paragraph, i: number): number | null {
  const m = shownText(p).match(MANUAL_NO)
  if (m) return Number(m[1])
  // 自动编号但编号格式认不出：至少有序号，按顺序算
  return p.numbered && p.listLabel === null ? i + 1 : null
}

/** "2-4,7" → [2,3,4,7]；写法有误返回 null */
export function expandCitation(s: string): number[] | null {
  const out: number[] = []
  for (const part of s.split(/[,，、]/)) {
    const t = part.trim()
    const m = t.match(/^(\d+)\s*[-–—~～]\s*(\d+)$/)
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])]
      if (b < a || b - a > MAX_SPAN) return null
      for (let i = a; i <= b; i++) out.push(i)
    } else if (/^\d+$/.test(t)) out.push(Number(t))
    else return null
  }
  return out
}

/** 每个字符是否上标：段落文字就是各 run 文字的拼接 */
function superscriptMask(p: Paragraph): boolean[] {
  const mask: boolean[] = []
  for (const r of p.runs) for (let i = 0; i < r.text.length; i++) mask.push(r.superscript)
  return mask
}

/** 抽出一段里的引用标号；出错的也返回（numbers 为空），由调用方决定怎么报 */
export function citationsIn(p: Paragraph): Citation[] {
  const out: Citation[] = []
  const text = p.text
  const sup = superscriptMask(p)
  const allSup = (from: number, to: number) => to > from && sup.slice(from, to).every(Boolean)
  const covered: [number, number][] = []

  for (const m of text.matchAll(BRACKET_RE)) {
    const offset = m.index!
    const numbers = expandCitation(m[1])
    // [0,1]、[0-1] 是数学区间，不是引用
    if (numbers?.includes(0)) continue
    covered.push([offset, offset + m[0].length])
    out.push({ numbers: numbers ?? [], raw: m[0], paragraph: p.index, offset, superscript: allSup(offset, offset + m[0].length), bare: false, ambiguous: false })
  }

  // 不带括号的上标数字：连续的上标字符为一段
  for (let i = 0; i < text.length; ) {
    if (!sup[i]) {
      i++
      continue
    }
    let j = i
    while (j < text.length && sup[j]) j++
    const raw = text.slice(i, j)
    const before = text[i - 1] ?? ''
    const ambiguous = BEFORE_AMBIGUOUS.test(text.slice(Math.max(0, i - 2), i))
    if (BARE_RE.test(raw.trim()) && before && (BEFORE_BARE.test(before) || ambiguous) && !covered.some(([a, b]) => i < b && j > a)) {
      const numbers = expandCitation(raw.trim())
      if (!numbers?.includes(0)) out.push({ numbers: numbers ?? [], raw: raw.trim(), paragraph: p.index, offset: i, superscript: true, bare: true, ambiguous })
    }
    i = j
  }
  return out.sort((a, b) => a.offset - b.offset)
}

/**
 * 会引用文献的段落，按文档顺序：参考文献标题之前的全部（不含目录），加上参考文献表之后的附录等部分
 * （发表论文清单、作者简介这类本身就是列表的部分不算，行首就是 [1] 的列表项也不算）。
 */
export function citingParagraphs(doc: DocxModel, s: Structure): Paragraph[] {
  const end = s.refHeading ?? s.bodyEnd
  const lastRef = s.refEntries.length ? s.refEntries[s.refEntries.length - 1].index : (s.refHeading ?? Infinity)
  const out: Paragraph[] = []
  let skipSection = false
  for (const p of doc.paragraphs) {
    if (p.inToc || !p.text) continue
    if (p.index < end) {
      out.push(p)
      continue
    }
    if (p.index <= lastRef) continue
    if (p.headingLevel !== null) skipSection = NOT_CITING_SECTION.test(p.text)
    if (skipSection || MANUAL_NO.test(shownText(p))) continue
    out.push(p)
  }
  return out
}

/** 正文和附录里的全部引用标号，按出现顺序 */
export function extractCitations(doc: DocxModel, s: Structure): Citation[] {
  return citingParagraphs(doc, s).flatMap(citationsIn)
}

/**
 * 档案没写体例时按文档判断：文献表全都没有序号、正文里"作者, 年份"式引用比方括号标号多，
 * 就当作著者-出版年制。
 */
export function inferCitationStyle(doc: DocxModel, s: Structure, declared: string | null | undefined): { style: 'numeric' | 'author-year'; inferred: boolean } {
  // 档案写明了才照办；either（两种都认）、unknown（查过没有依据）、null 都按文档实际判断
  if (declared === 'numeric' || declared === 'author-year') return { style: declared, inferred: false }
  const entries = s.refEntries
  if (entries.length === 0 || entries.some((p, i) => entryNumber(p, i) !== null)) return { style: 'numeric', inferred: false }
  const paras = citingParagraphs(doc, s)
  const authorYear = paras.reduce((n, p) => n + (p.text.match(AUTHOR_YEAR_RE)?.length ?? 0), 0)
  const numeric = paras.reduce((n, p) => n + citationsIn(p).filter((c) => !c.ambiguous && c.numbers.length).length, 0)
  return authorYear >= 2 && authorYear > numeric ? { style: 'author-year', inferred: true } : { style: 'numeric', inferred: false }
}

export function reconcileCitations(doc: DocxModel, s: Structure): CitationReconciliation {
  const paras = citingParagraphs(doc, s)
  const found = paras.map(citationsIn)
  const all = found.flat()
  const malformed = all.filter((c) => c.numbers.length === 0)
  const citations = all.filter((c) => c.numbers.length > 0 && !c.ambiguous)
  const uncertain = {
    unreadFieldParagraphs: paras.filter((p, i) => p.fieldCodes.some(isCitationField) && !found[i].some((c) => c.numbers.length && !c.ambiguous)).length,
    noteRefs: paras.reduce((n, p) => n + p.noteRefs, 0),
    ambiguous: all.filter((c) => c.ambiguous && c.numbers.length > 0),
  }

  const entries: CitedEntry[] = s.refEntries.map((p, i) => ({ number: entryNumber(p, i), paragraph: p.index, timesCited: 0, firstCitation: null }))
  const byNumber = new Map<number, CitedEntry>()
  // 读不出编号的条目按位置对应（第 i 条当作 [i]），"没有序号"另由文献表检查报
  entries.forEach((e, i) => {
    const key = e.number ?? i + 1
    if (!byNumber.has(key)) byNumber.set(key, e)
  })

  const missing: CitationReconciliation['missing'] = []
  const outOfOrder: CitationReconciliation['outOfOrder'] = []
  const seen = new Set<number>()
  let maxSoFar = 0
  citations.forEach((c, ci) => {
    for (const n of c.numbers) {
      const e = byNumber.get(n)
      if (e) {
        e.timesCited++
        if (e.firstCitation === null) e.firstCitation = ci
      } else if (!seen.has(n)) missing.push({ number: n, citation: ci })
      if (!seen.has(n)) {
        // 顺序编码制：第一次出现的编号应当正好是"已出现的最大编号 + 1"
        if (e && n !== maxSoFar + 1 && n > maxSoFar) outOfOrder.push({ number: n, citation: ci })
        if (e) maxSoFar = Math.max(maxSoFar, n)
        seen.add(n)
      }
    }
  })
  const uncited = entries.flatMap((e, i) => (e.number !== null && e.timesCited === 0 ? [i] : []))
  return { citations, entries, missing, uncited, outOfOrder, malformed, uncertain }
}
