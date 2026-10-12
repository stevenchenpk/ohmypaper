/**
 * 引用对账表的文字：把 Report.citationMap（和可选的引用核验结果）整理成界面要显示的几行字。
 * 不碰 DOM，方便测试；渲染在 ui.ts。
 *
 * 措辞三档：被引用 / 正文没有引用（检测到，请核对）/ 未检查。没有识别出任何引用标注时，
 * 每一条都记"未检查"，不说"没有引用"，更不说通过。
 */

import { STATUS_LABEL } from '../references/report'
import type { VerifyStatus } from '../references/verify'
import type { CitationMap, Location } from './report'

/** 一条文献的核验结果，按 Report.references 的下标对上 */
export interface VerifyLink {
  status: VerifyStatus
  reason: string
}

export type Tone = 'ok' | 'warn' | 'bad' | 'open'

export interface CitationRowView {
  /** "[3]"；文献表里读不出序号时为"第 3 条" */
  label: string
  /** "引用 2 次" / "正文没有引用" / "未检查" */
  cited: string
  citedTone: Tone
  /** 第一次被引用的位置 */
  where: string
  /** 核验结果；还没核验为 null */
  verify: { status: VerifyStatus; label: string; tone: Tone } | null
}

const VERIFY_TONE: Record<VerifyStatus, Tone> = { verified: 'ok', mismatch: 'bad', not_found: 'bad', manual: 'open', error: 'open' }

export function placeOf(l: Location): string {
  return l.context ? `「${l.context}」` : `"${l.excerpt}"`
}

const labelOf = (map: CitationMap, i: number) => {
  const n = map.references[i].number
  return n === null ? `第 ${i + 1} 条` : `[${n}]`
}

/** 一句话概况，显示在折叠标题上 */
export function citationSummary(map: CitationMap): string {
  const total = map.references.length
  if (map.citations.length === 0) return `正文没有识别出引用标注，${total} 条参考文献都未对账`
  const covered = map.references.filter((r) => r.timesCited > 0).length
  return `正文检测到 ${map.citations.length} 处引用标注，覆盖参考文献 ${covered} / ${total} 条`
}

/** 识别范围、没对上的编号：放在表格上面 */
export function citationNotes(map: CitationMap): string[] {
  const notes = [
    '识别范围：正文、附录和表格里的 [1]、[2-4]、［3］和上标数字。脚注、尾注和文本框里的引用没有读取；' +
      '用 Zotero、EndNote 等软件插入、显示成作者和年份的引文也识别不到。这些情况下"正文没有引用"可能是误报，请自己核对。',
  ]
  const u = map.uncertain
  const unsure: string[] = []
  if (u.unreadFieldParagraphs) unsure.push(`${u.unreadFieldParagraphs} 段里有文献管理软件插入的引用，没读出编号`)
  if (u.noteRefs) unsure.push(`有 ${u.noteRefs} 个脚注或尾注引用，内容没有读取`)
  if (u.ambiguous.length) unsure.push(`${u.ambiguous.length} 处上标数字分不清是引用还是指数（如 ${placeOf(u.ambiguous[0].location)}），没有计入`)
  if (unsure.length) notes.push(`未检查，需人工确认：${unsure.join('；')}。所以"正文没有引用"和引用顺序都只作参考，不算通过。`)
  if (map.citations.length === 0) notes.push('因为没有识别出任何引用标注，下表每一条都记为"未检查"，不代表没有引用，也不算通过。')
  if (map.missing.length) notes.push(`正文引了、参考文献表里没有的编号：${map.missing.slice(0, 8).map((n) => `[${n}]`).join('、')}${map.missing.length > 8 ? ' 等' : ''}。`)
  if (map.outOfOrder.length) notes.push(`没有按首次引用先后编号的：${map.outOfOrder.slice(0, 8).map((n) => `[${n}]`).join('、')}。`)
  if (map.malformed.length) notes.push(`写法有误、没有计入的标号：${map.malformed.slice(0, 5).map((s) => `"${s}"`).join('、')}。`)
  return notes
}

const hasUncertain = (map: CitationMap) =>
  map.uncertain.unreadFieldParagraphs > 0 || map.uncertain.noteRefs > 0 || map.uncertain.ambiguous.length > 0

export function citationRows(map: CitationMap, verify: (VerifyLink | undefined)[] = []): CitationRowView[] {
  const detected = map.citations.length > 0
  return map.references.map((r, i) => {
    const v = verify[i]
    let cited: string, citedTone: Tone
    if (!detected) [cited, citedTone] = ['未检查', 'open']
    else if (r.timesCited > 0) [cited, citedTone] = [`引用 ${r.timesCited} 次`, 'ok']
    else if (r.number === null) [cited, citedTone] = ['没有序号，未对账', 'open']
    else if (hasUncertain(map)) [cited, citedTone] = ['没识别到引用，需人工确认', 'open']
    else [cited, citedTone] = ['正文没有引用', 'warn']
    return {
      label: labelOf(map, i),
      cited,
      citedTone,
      where: r.firstCited ? `首次在 ${placeOf(r.firstCited)}` : '',
      verify: v ? { status: v.status, label: STATUS_LABEL[v.status], tone: VERIFY_TONE[v.status] } : null,
    }
  })
}

/**
 * 核验为查无此文、信息不符的条目，在正文哪里被引用：
 * "正文「1.1 研究背景」引用的 [3] 核验为查无此文"
 */
export function verifyCallouts(map: CitationMap, verify: (VerifyLink | undefined)[]): string[] {
  const out: string[] = []
  map.references.forEach((r, i) => {
    const v = verify[i]
    if (!v || (v.status !== 'not_found' && v.status !== 'mismatch')) return
    const label = labelOf(map, i)
    const verdict = `核验为${STATUS_LABEL[v.status]}`
    const places = r.number === null
      ? []
      : [...new Set(map.citations.filter((c) => c.numbers.includes(r.number!)).map((c) => placeOf(c.location)))]
    if (places.length === 0) {
      const why = map.citations.length === 0 || r.number === null ? '正文中的引用位置没有识别出来' : '正文中没有找到对它的引用'
      out.push(`${label} ${verdict}（${why}）`)
      return
    }
    const shown = places.slice(0, 3).join('、')
    out.push(`正文 ${shown}${places.length > 3 ? ` 等 ${places.length} 处` : ''}引用的 ${label} ${verdict}`)
  })
  return out
}
