/**
 * 图表题注编号：按章编号（图 2-3）时章号要和所在章一致、章内从 1 连续；
 * 全文编号（图 5）时从 1 连续。图和表分别计数。
 */

import type { Paragraph } from '../docx'
import { isBackTitle, isFrontTitle, locate } from '../structure'
import type { CheckContext } from './context'
import { headingNumber } from './headings'

const CAPTION_RE = /^(图|表|Figure|Fig\.|Table)\s*(\d+)(?:\s*[-.．—–]\s*(\d+))?(?!\d)/i

interface Caption {
  p: Paragraph
  kind: '图' | '表'
  chapter: number | null
  n: number
  /** 所在章（正文第几个一级标题，或标题里的章号） */
  inChapter: number
}

export function findCaptions(ctx: CheckContext): Caption[] {
  const { doc, s } = ctx
  const out: Caption[] = []
  let chapterOrdinal = 0
  let chapter = 0
  for (const p of doc.paragraphs) {
    if (p.inToc) continue
    if (p.headingLevel === 1 && s.bodyStart !== null && p.index >= s.bodyStart && !isFrontTitle(p) && !isBackTitle(p)) {
      chapterOrdinal++
      chapter = (!p.numbered && headingNumber(p.text)?.[0]) || chapterOrdinal
      continue
    }
    if (p.headingLevel !== null) continue
    const t = p.text.trim()
    const m = t.match(CAPTION_RE)
    if (!m) continue
    const isCaptionStyle = /caption|题注/i.test(p.styleName ?? '')
    // 正文里"图 1 显示了……"这种句子不算题注
    if (!isCaptionStyle && (t.length > 60 || /[。；]$/.test(t))) continue
    out.push({
      p,
      kind: /^(表|table)/i.test(m[1]) ? '表' : '图',
      chapter: m[3] !== undefined ? Number(m[2]) : null,
      n: Number(m[3] ?? m[2]),
      inChapter: chapter,
    })
  }
  return out
}

export function checkCaptions(ctx: CheckContext) {
  const caps = findCaptions(ctx)
  if (caps.length === 0) {
    ctx.skip('figures', '图表题注编号', '没有找到"图 1-1""表 2"这样的题注')
    return
  }
  let anyIssue = false
  for (const kind of ['图', '表'] as const) {
    const list = caps.filter((c) => c.kind === kind)
    if (list.length === 0) continue
    const chaptered = list.filter((c) => c.chapter !== null).length
    if (chaptered > 0 && chaptered < list.length) {
      anyIssue = true
      ctx.add({
        id: 'captions-mixed', category: 'figures', severity: 'warning', title: `${kind}的编号方式不统一`,
        detail: `有的按章编号（如"${kind} 2-1"），有的全文连续编号（如"${kind} 3"），全文应统一一种。`,
        locations: list.filter((c) => c.chapter === null).map((c) => locate(c.p, ctx.s)),
        basis: '通用排版惯例',
      })
      continue
    }
    const bad: { c: Caption; why: string }[] = []
    if (chaptered) {
      const last = new Map<number, number>()
      for (const c of list) {
        if (c.inChapter && c.chapter !== c.inChapter) bad.push({ c, why: `位于第 ${c.inChapter} 章，章号却是 ${c.chapter}` })
        const prev = last.get(c.chapter!) ?? 0
        if (c.n !== prev + 1) bad.push({ c, why: `应为 ${kind} ${c.chapter}-${prev + 1}` })
        last.set(c.chapter!, c.n)
      }
    } else {
      let prev = 0
      for (const c of list) {
        if (c.n !== prev + 1) bad.push({ c, why: `应为 ${kind} ${prev + 1}` })
        prev = c.n
      }
    }
    if (bad.length) {
      anyIssue = true
      ctx.add({
        id: `captions-sequence-${kind === '图' ? 'figure' : 'table'}`, category: 'figures', severity: 'warning',
        title: `${kind}的编号不连续或与章节不符（${bad.length} 处）`,
        detail: bad.slice(0, 3).map((b) => `"${b.c.p.text.trim().slice(0, 16)}"${b.why}`).join('；') + '。用 Word 的"插入题注"自动编号可以避免这类问题。',
        locations: bad.map((b) => locate(b.c.p, ctx.s)),
        basis: '通用排版惯例',
      })
    }
  }
  if (!anyIssue) ctx.pass('figures', '图表题注编号')
}
