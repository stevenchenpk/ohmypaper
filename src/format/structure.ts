/**
 * 论文结构识别：哪里是前置部分（封面、摘要、目录），哪里是正文，参考文献从哪到哪。
 * 全靠启发式规则，识别不出来时宁可少查，不乱报。
 */

import type { DocxModel, Paragraph } from './docx'
import type { Location } from './report'

export const norm = (s: string) => s.replace(/[\s　]+/g, '').toLowerCase()

const FRONT_RE = /^(摘要|中文摘要|英文摘要|abstract|目录|contents|tableofcontents|声明|原创性声明|独创性声明|承诺书|诚信承诺书|.*授权.*书|.*声明)$/
const BACK_RE = /^(参考文献|references|bibliography|致谢|谢辞|后记|附录.*|appendix.*|作者简介|个人简历.*|攻读.*成果.*|在读期间.*成果.*)$/
const REF_RE = /^(参考文献|references|bibliography|主要参考文献)$/

/** 不用标题样式、但看起来像标题的写法 */
export const CHAPTER_RE = /^(第[一二三四五六七八九十百\d]+章|[1-9]\d?[\s　]+\S|绪论$|引言$|前言$)/

export interface Structure {
  bodyStart: number | null
  /** 正文结束（不含），即参考文献标题或后置部分开头 */
  bodyEnd: number
  refHeading: number | null
  refEntries: Paragraph[]
  /** 前置部分标题段落（摘要、目录等） */
  frontHeadings: Paragraph[]
  /** 每个段落所在章节的标题 */
  contextOf: (index: number) => string | undefined
}

export function isFrontTitle(p: Paragraph): boolean {
  return FRONT_RE.test(norm(p.text))
}

export function isBackTitle(p: Paragraph): boolean {
  return BACK_RE.test(norm(p.text))
}

export function analyze(doc: DocxModel): Structure {
  const ps = doc.paragraphs
  const live = (p: Paragraph) => !p.inToc && !p.inTable && p.text.trim().length > 0

  // 正文起点：第一个不是摘要、目录、致谢的标题
  let bodyStart: number | null =
    ps.find((p) => live(p) && p.headingLevel !== null && !isFrontTitle(p) && !isBackTitle(p))?.index ?? null
  if (bodyStart === null) {
    // 没用标题样式：找"第一章""1 绪论"这类段落
    const lastToc = [...ps].reverse().find((p) => p.inToc)?.index ?? -1
    bodyStart = ps.find((p) => p.index > lastToc && live(p) && CHAPTER_RE.test(p.text.trim()) && p.text.trim().length <= 40)?.index ?? null
  }

  const from = bodyStart ?? 0
  const refHeading = ps.find((p) => p.index > from && live(p) && REF_RE.test(norm(p.text)))?.index ?? null
  const backStart = ps.find((p) => p.index > from && live(p) && (p.headingLevel !== null || p.text.trim().length <= 12) && isBackTitle(p))?.index ?? null
  const bodyEnd = refHeading ?? backStart ?? ps.length

  const refEntries: Paragraph[] = []
  if (refHeading !== null) {
    for (const p of ps.slice(refHeading + 1)) {
      if (p.inToc) continue
      if (p.headingLevel !== null || (isBackTitle(p) && p.text.trim().length <= 12)) break
      if (p.text.trim().length > 0 && !p.inTable) refEntries.push(p)
    }
  }

  const frontHeadings = ps.filter((p) => live(p) && p.index < (bodyStart ?? ps.length) && isFrontTitle(p))

  // 章节上下文：最近的一个标题
  const headingAt: (string | undefined)[] = []
  let current: string | undefined
  for (const p of ps) {
    if (p.headingLevel !== null && !p.inToc && p.text.trim()) current = p.text.trim().slice(0, 30)
    headingAt.push(current)
  }

  return { bodyStart, bodyEnd, refHeading, refEntries, frontHeadings, contextOf: (i) => headingAt[i] }
}

/** 段落显示出来的文字：自动编号的编号文字 + 段落文字，如"第1章 绪论" */
export function shownText(p: Paragraph): string {
  return p.listLabel ? `${p.listLabel} ${p.text.trimStart()}` : p.text
}

export function excerpt(text: string, n = 24): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

export function locate(p: Paragraph, s: Structure): Location {
  const context = s.contextOf(p.index)
  return { paragraph: p.index, excerpt: excerpt(p.text) || '（空段落）', context: context && context !== p.text.trim().slice(0, 30) ? context : undefined }
}
