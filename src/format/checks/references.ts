/**
 * 参考文献格式（GB/T 7714）和正文引用的对应关系。
 *
 * 目前按 GB/T 7714—2015 的条款实现，这些条款在 2025 版里是否有变化，
 * 等"规则与标准数据"整理出两版差异后再逐条核对；在那之前，依据里会写明"按 2015 版条款"。
 */

import type { Paragraph } from '../docx'
import { parseReference } from '../../references/parse'
import { locate, norm } from '../structure'
import type { CheckContext } from './context'
import { checkTextStyle } from './textStyle'

const TYPE_RE = /[[［]\s*(J|M|D|C|N|R|S|P|G|A|Z|DB|CP|EB|DS|CM|AO)\s*(\/\s*(OL|MT|DK|CD))?\s*[\]］]/
const MANUAL_NO = /^\s*[[［]\s*(\d+)\s*[\]］]\s*/
const DOTTED_NO = /^\s*(\d+)\s*[.．、]\s*/
const URL_RE = /(https?:\/\/|www\.)\S+/i
const ACCESS_DATE = /[[［]\s*\d{4}\s*-\s*\d{1,2}\s*-\s*\d{1,2}\s*[\]］]/
const FULLWIDTH = /[，。：；（）]/
/** 正文里的 [1]、[2-5]、[1,3]、［6］ */
const CITE_RE = /[[［]\s*(\d{1,3}(?:\s*[-–—~～,，、]\s*\d{1,3})*)\s*[\]］]/g

export function gbBasis(standard: string | null | undefined): string {
  if (standard === 'GB/T 7714-2015') return 'GB/T 7714—2015'
  return 'GB/T 7714—2025（目前按 2015 版条款检查，两版差异待核对）'
}

function expandCitation(s: string): number[] {
  const out: number[] = []
  for (const part of s.split(/[,，、]/)) {
    const m = part.trim().match(/^(\d+)\s*[-–—~～]\s*(\d+)$/)
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])]
      if (b >= a && b - a <= 50) for (let i = a; i <= b; i++) out.push(i)
    } else if (/^\d+$/.test(part.trim())) out.push(Number(part.trim()))
  }
  return out
}

export function referenceText(p: Paragraph): string {
  return p.text.replace(MANUAL_NO, '').replace(DOTTED_NO, '').trim()
}

export function checkReferences(ctx: CheckContext) {
  const { s, profile } = ctx
  const refRule = profile?.references
  const basis = gbBasis(refRule?.standard)
  const style = refRule?.style ?? 'numeric'

  if (refRule?.standard === 'APA-7' || refRule?.standard === 'other') {
    ctx.skip('references', '参考文献格式', `学校要求 ${refRule.standard}，目前只支持 GB/T 7714`)
    return
  }
  if (s.refHeading === null) {
    ctx.add({
      id: 'refs-missing', category: 'references', severity: 'warning', title: '没有找到"参考文献"部分',
      detail: '没有找到单独一行写着"参考文献"的标题，所以没有检查参考文献格式。如果你的标题写法不同，请改成"参考文献"。',
      basis,
    })
    return
  }
  const entries = s.refEntries
  if (entries.length === 0) {
    ctx.add({ id: 'refs-empty', category: 'references', severity: 'warning', title: '"参考文献"标题下面没有内容', basis })
    return
  }

  // 序号
  const numbers: (number | null)[] = entries.map((p, i) => {
    const m = p.text.match(MANUAL_NO)
    if (m) return Number(m[1])
    return p.numbered ? i + 1 : null
  })
  if (style === 'numeric') {
    const dotted = entries.filter((p) => !MANUAL_NO.test(p.text) && DOTTED_NO.test(p.text))
    const missing = entries.filter((p, i) => numbers[i] === null && !dotted.includes(p))
    if (dotted.length) {
      ctx.addForParagraphs(dotted, {
        id: 'refs-number-style', category: 'references', severity: 'warning', title: `参考文献序号写成了"1."（${dotted.length} 条）`,
        expected: '顺序编码制的序号用方括号，如 [1]', basis,
      })
    }
    if (missing.length) {
      ctx.addForParagraphs(missing, {
        id: 'refs-unnumbered', category: 'references', severity: 'error', title: `${missing.length} 条参考文献没有序号`,
        expected: '顺序编码制下每条参考文献前都要有 [1]、[2] 这样的序号', basis,
      })
    }
    const seqBad = entries.filter((p, i) => MANUAL_NO.test(p.text) && numbers[i] !== i + 1)
    if (seqBad.length) {
      ctx.addForParagraphs(seqBad, {
        id: 'refs-number-sequence', category: 'references', severity: 'error', title: '参考文献序号不连续或重复',
        detail: `第 ${entries.indexOf(seqBad[0]) + 1} 条的序号是 [${numbers[entries.indexOf(seqBad[0])]}]。`, basis,
      })
    }
    if (!dotted.length && !missing.length && !seqBad.length) ctx.pass('references', '参考文献序号')
  }

  // 逐条著录项目
  const noType: Paragraph[] = [], noCarrier: Paragraph[] = [], noAccess: Paragraph[] = []
  const noYear: Paragraph[] = [], fullwidth: Paragraph[] = [], tooManyAuthors: Paragraph[] = []
  const seen = new Map<string, Paragraph>()
  const dups: Paragraph[] = []
  let foreign = 0
  for (const p of entries) {
    const text = referenceText(p)
    const parsed = parseReference(text, 0)
    if (!parsed.isChinese) foreign++
    const type = text.match(TYPE_RE)
    if (!type) noType.push(p)
    if (URL_RE.test(text)) {
      if (type && !type[3]) noCarrier.push(p)
      if (!ACCESS_DATE.test(text)) noAccess.push(p)
    }
    if (parsed.year === null) noYear.push(p)
    if (FULLWIDTH.test(text)) fullwidth.push(p)
    if (parsed.authors.length > 3 && !/(等|et\s*al)/i.test(text.split(/[.．]/)[0])) tooManyAuthors.push(p)
    if (parsed.title) {
      const key = norm(parsed.title)
      if (key.length >= 6 && seen.has(key)) dups.push(p)
      else seen.set(key, p)
    }
  }

  const report = (list: Paragraph[], id: string, severity: 'error' | 'warning' | 'info', title: string, detail: string, passName: string) => {
    if (list.length) ctx.addForParagraphs(list, { id, category: 'references', severity, title: `${title}（${list.length} 条）`, detail, basis })
    else ctx.pass('references', passName)
  }
  report(noType, 'refs-type-code', 'warning', '缺少文献类型标识',
    '题名后面应标注 [J]（期刊）、[M]（专著）、[D]（学位论文）、[C]（会议录）等。国标中这一项为"任选"，但绝大多数学校的撰写规范要求标注。', '文献类型标识')
  report(noCarrier, 'refs-online-carrier', 'warning', '网络文献缺少载体标识 /OL',
    '在线获取的文献，类型标识应写成 [EB/OL]、[J/OL] 这样，带上 /OL。', '电子资源载体标识')
  report(noAccess, 'refs-access-date', 'warning', '网络文献缺少引用日期',
    '带网址的文献应在网址前写明引用日期，如 [2026-03-01]。', '电子资源引用日期')
  report(noYear, 'refs-year', 'warning', '没有找到出版年', '每条文献都应著录出版年。', '出版年')
  report(dups, 'refs-duplicate', 'warning', '疑似重复的参考文献', '这些条目的题名与前面某一条相同。', '无重复条目')
  report(tooManyAuthors, 'refs-et-al', 'info', '作者超过 3 人但全部列出',
    '国标规定超过 3 个责任者时可只著录前 3 个，其后加"，等"或", et al."。请看本校规范是否要求这样写。', '作者数量著录')
  report(fullwidth, 'refs-fullwidth', 'info', '参考文献里用了全角标点',
    '国标的著录符号是半角的英文标点（". " ", " ": "）。有的学校允许中文文献用全角标点，请对照本校规范。', '著录用标点')

  // 条数要求
  if (refRule?.min_count) {
    if (entries.length < refRule.min_count) {
      ctx.add({ id: 'refs-min-count', category: 'references', severity: 'error', title: '参考文献条数不够', expected: `至少 ${refRule.min_count} 条`, actual: `${entries.length} 条`, basis: ctx.schoolBasis })
    } else ctx.pass('references', '参考文献条数')
  }
  if (refRule?.min_foreign) {
    if (foreign < refRule.min_foreign) {
      ctx.add({ id: 'refs-min-foreign', category: 'references', severity: 'error', title: '外文文献条数不够', expected: `至少 ${refRule.min_foreign} 条`, actual: `约 ${foreign} 条（按文字自动判断）`, basis: ctx.schoolBasis })
    } else ctx.pass('references', '外文文献条数')
  }

  const entryRule = profile?.format?.reference_entries
  if (entryRule) checkTextStyle(ctx, { category: 'references', label: '参考文献条目', id: 'refs-style', paragraphs: entries, rule: entryRule })

  if (style === 'numeric') checkCitations(ctx, entries, numbers, basis)
  else ctx.skip('references', '正文引用顺序', '著者-出版年制不检查引用顺序')
}

function checkCitations(ctx: CheckContext, entries: Paragraph[], numbers: (number | null)[], basis: string) {
  const { doc, s } = ctx
  const firstSeen = new Map<number, Paragraph>()
  const order: number[] = []
  for (const p of doc.paragraphs) {
    if (p.index >= s.refHeading! || p.inToc) continue
    for (const m of p.text.matchAll(CITE_RE)) {
      for (const n of expandCitation(m[1])) {
        if (!firstSeen.has(n)) {
          firstSeen.set(n, p)
          order.push(n)
        }
      }
    }
  }
  if (order.length === 0) {
    ctx.add({
      id: 'cite-none', category: 'references', severity: 'info', title: '正文中没有找到 [1] 这样的引用标注',
      detail: '如果你用的是交叉引用或上标数字，检查可能识别不到；如果用的是著者-出版年制，可以忽略这一条。', basis,
    })
    return
  }
  const listed = new Set(numbers.filter((n): n is number => n !== null))
  const max = Math.max(entries.length, ...listed)

  const outOfRange = order.filter((n) => n < 1 || n > max)
  if (outOfRange.length) {
    ctx.add({
      id: 'cite-out-of-range', category: 'references', severity: 'error',
      title: `正文引用了不存在的文献编号`,
      detail: `正文中出现了 ${outOfRange.slice(0, 5).map((n) => `[${n}]`).join('、')}，但参考文献只有 ${max} 条。`,
      locations: outOfRange.map((n) => locate(firstSeen.get(n)!, s)), basis,
    })
  }

  const uncited = entries.filter((_, i) => numbers[i] !== null && !firstSeen.has(numbers[i]!))
  if (uncited.length) {
    ctx.addForParagraphs(uncited, {
      id: 'cite-uncited', category: 'references', severity: 'warning', title: `${uncited.length} 条参考文献在正文中没有被引用`,
      detail: '列入参考文献的每一条都应在正文中引用。如果正文用的是交叉引用（自动更新的编号），这里可能误报。', basis,
    })
  } else ctx.pass('references', '每条文献都被引用')

  // 顺序编码制：按在正文中第一次出现的先后编号
  const outOfOrder: number[] = []
  let maxSoFar = 0
  for (const n of order) {
    if (n > max) continue
    if (n !== maxSoFar + 1 && n > maxSoFar) outOfOrder.push(n)
    maxSoFar = Math.max(maxSoFar, n)
  }
  if (outOfOrder.length) {
    ctx.add({
      id: 'cite-order', category: 'references', severity: 'warning', title: '参考文献编号没有按正文中首次引用的先后排列',
      detail: `顺序编码制要求按文献在正文中第一次出现的顺序编号。例如 [${outOfOrder[0]}] 在 [${outOfOrder[0] - 1}] 之前就出现了。`,
      locations: outOfOrder.map((n) => locate(firstSeen.get(n)!, s)), basis,
    })
  } else ctx.pass('references', '引用顺序')
}
