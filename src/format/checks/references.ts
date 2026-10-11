/**
 * 参考文献：在 docx 里找到参考文献表，逐条跑 GB/T 7714 著录规则（规则本身在
 * src/references/style/gbt7714.ts，区分 2015 和 2025 两版），再检查序号、重复、
 * 条数，以及正文引用与文献表的对应关系。
 */

import type { Paragraph } from '../docx'
import { parseReference } from '../../references/parse'
import { type Edition, RULES, checkEntry } from '../../references/style/gbt7714'
import type { SchoolProfile } from '../profile'
import { locate, norm } from '../structure'
import type { CheckContext } from './context'
import { checkTextStyle } from './textStyle'

const MANUAL_NO = /^\s*[[［]\s*(\d+)\s*[\]］]\s*/
const DOTTED_NO = /^\s*(\d+)\s*[.．、]\s*/
/** 正文里的 [1]、[2-5]、[1,3]、［6］ */
const CITE_RE = /[[［]\s*(\d{1,3}(?:\s*[-–—~～,，、]\s*\d{1,3})*)\s*[\]］]/g

/**
 * 用哪一版国标：档案写明了就用档案的；没写时用现行的 2025 版
 * （2026-07-01 实施，2027 届起的论文基本都在实施之后提交）。
 */
export function editionFor(profile: SchoolProfile | null): Edition {
  return profile?.references?.standard === 'GB/T 7714-2015' ? '2015' : '2025'
}

function editionLabel(edition: Edition, profile: SchoolProfile | null): string {
  const explicit = profile?.references?.standard
  return `GB/T 7714—${edition}${explicit ? '' : '（学校档案未指定版本，按现行版检查）'}`
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
  const edition = editionFor(profile)
  const basis = editionLabel(edition, profile)
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

  // 逐条著录规则（GB/T 7714 两版规则表）
  const byRule = new Map<string, { paras: Paragraph[]; messages: string[]; severity: 'error' | 'warning' | 'info' }>()
  entries.forEach((p, i) => {
    for (const issue of checkEntry(referenceText(p), i + 1, { edition })) {
      const g = byRule.get(issue.ruleId) ?? { paras: [], messages: [], severity: issue.severity }
      g.paras.push(p)
      g.messages.push(issue.message)
      byRule.set(issue.ruleId, g)
    }
  })
  for (const rule of RULES) {
    if (!rule.severity[edition]) continue
    const g = byRule.get(rule.id)
    if (!g) {
      ctx.pass('references', rule.title)
      continue
    }
    const clause = rule.clause[edition]
    ctx.addForParagraphs(g.paras, {
      id: `refs-${rule.id}`, category: 'references', severity: g.severity,
      title: `${rule.title}（${g.paras.length} 条）`,
      detail: [...new Set(g.messages)].slice(0, 2).join(' ') + (rule.falsePositiveRisk !== 'low' && rule.falsePositiveNote ? ` 注意：${rule.falsePositiveNote}` : ''),
      basis: `${basis}${clause ? ` ${clause}` : ''}`,
    })
  }

  // 出版年、重复条目、外文条数
  const noYear: Paragraph[] = []
  const seen = new Map<string, Paragraph>()
  const dups: Paragraph[] = []
  let foreign = 0
  for (const p of entries) {
    const parsed = parseReference(referenceText(p), 0)
    if (!parsed.isChinese) foreign++
    if (parsed.year === null) noYear.push(p)
    if (parsed.title) {
      const key = norm(parsed.title)
      if (key.length >= 6 && seen.has(key)) dups.push(p)
      else seen.set(key, p)
    }
  }
  const report = (list: Paragraph[], id: string, title: string, detail: string, passName: string) => {
    if (list.length) ctx.addForParagraphs(list, { id, category: 'references', severity: 'warning', title: `${title}（${list.length} 条）`, detail, basis })
    else ctx.pass('references', passName)
  }
  report(noYear, 'refs-year', '没有找到出版年', '每条文献都应著录出版年（网页写发布或修改日期）。', '出版年')
  report(dups, 'refs-duplicate', '疑似重复的参考文献', '这些条目的题名与前面某一条相同。', '无重复条目')

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
