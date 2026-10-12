/**
 * 引用对账（顺序编码制）：从正文里抽出引用标号，和参考文献表逐条对上。
 *
 * 识别两种写法：
 * - 方括号：[1]、[2-5]、[1,3]、［6］、【7】，上标或不上标都算
 * - 不带括号的上标数字：……研究¹,³ 这种（国标要求带方括号，单独标出来）
 * 不当作引用的：[0,1] 这样含 0 的区间、x² 这类跟在字母或数字后面的上标（多是指数）。
 * 倒序或跨度过大的区间（[5-3]、[1-90]）不展开，记为"写法有误"。
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
}

const MANUAL_NO = /^\s*[[［【]\s*(\d+)\s*[\]］】]\s*/
const BRACKET_RE = /[[［【]\s*(\d{1,3}(?:\s*[-–—~～,，、]\s*\d{1,3})*)\s*[\]］】]/g
const BARE_RE = /^\d{1,3}(?:\s*[-–—~～,，、]\s*\d{1,3})*$/
/** 上标数字前面是这些字符时才当引用：汉字、中文标点、右引号右括号 */
const BEFORE_BARE = /[㐀-鿿　-〿！-／：-＠"”’)）》]/
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
    out.push({ numbers: numbers ?? [], raw: m[0], paragraph: p.index, offset, superscript: allSup(offset, offset + m[0].length), bare: false })
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
    if (BARE_RE.test(raw.trim()) && before && BEFORE_BARE.test(before) && !covered.some(([a, b]) => i < b && j > a)) {
      const numbers = expandCitation(raw.trim())
      if (!numbers?.includes(0)) out.push({ numbers: numbers ?? [], raw: raw.trim(), paragraph: p.index, offset: i, superscript: true, bare: true })
    }
    i = j
  }
  return out.sort((a, b) => a.offset - b.offset)
}

/** 正文（参考文献标题之前，不含目录）里的全部引用标号，按出现顺序 */
export function extractCitations(doc: DocxModel, s: Structure): Citation[] {
  const end = s.refHeading ?? s.bodyEnd
  return doc.paragraphs.filter((p) => p.index < end && !p.inToc && p.text).flatMap(citationsIn)
}

export function reconcileCitations(doc: DocxModel, s: Structure): CitationReconciliation {
  const all = extractCitations(doc, s)
  const malformed = all.filter((c) => c.numbers.length === 0)
  const citations = all.filter((c) => c.numbers.length > 0)

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
  return { citations, entries, missing, uncited, outOfOrder, malformed }
}
