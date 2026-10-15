/**
 * 参考文献：在 docx 里找到参考文献表，逐条跑 GB/T 7714 著录规则（规则本身在
 * src/references/style/gbt7714.ts，区分 2015 和 2025 两版），再检查序号、重复、
 * 条数，以及正文引用与文献表的对应关系。
 */

import type { Paragraph } from '../docx'
import { parseReference } from '../../references/parse'
import { parseGbt7714 } from '../../references/structured'
import { yearOf } from '../../references/structured/types'
import { type Edition, RULES, analyzeEntry, checkEntry } from '../../references/style/gbt7714'
import type { SchoolProfile } from '../profile'
import { type CitationReconciliation, entryNumber, inferCitationStyle, reconcileCitations } from '../citations'
import { locate, norm, shownText } from '../structure'
import { type CheckContext, unknownNote } from './context'
import { checkTextStyle } from './textStyle'

/** 依赖作者段的规则：作者段拆不出来时无法判断 */
const AUTHOR_RULES = new Set(['surname-case', 'author-limit', 'etal-language'])
const MANUAL_NO = /^\s*[[［]\s*(\d+)\s*[\]］]\s*/
const DOTTED_NO = /^\s*(\d+)\s*[.．、]\s*/

/**
 * 用哪一版国标：档案写明了就用档案的。没写明时（或没选学校）按过渡期处理，两版都认：
 * GB/T 7714—2025 于 2026-07-01 实施，但有学校明确答复过渡期内两版都可以用
 * （北京理工大学研究生院 2026-03 答复，见 bit-thesis 模板记录），
 * 所以不能把 2015 版的写法判为"与规则不符"。
 */
export type EditionMode = Edition | 'either'

export function editionFor(profile: SchoolProfile | null): EditionMode {
  const standard = profile?.references?.standard
  if (standard === 'GB/T 7714-2015') return '2015'
  if (standard === 'GB/T 7714-2025') return '2025'
  return 'either'
}

function editionLabel(mode: EditionMode): string {
  if (mode === 'either') return 'GB/T 7714—2015 或 2025（学校没有写明版本，过渡期两版都认）'
  return `GB/T 7714—${mode}`
}

/**
 * 只看档案和文献表序号时的体例判断（schema v2 的 either / unknown 也走这里）。
 * 引擎实际用的是 citations.ts 的 inferCitationStyle，它还会看正文引用写法。
 */
export function citationStyleFor(
  declared: NonNullable<SchoolProfile['references']>['style'] | undefined,
  entriesNumbered: boolean,
): { value: 'numeric' | 'author-year'; inferred: boolean } {
  if (declared === 'numeric' || declared === 'author-year') return { value: declared, inferred: false }
  return { value: entriesNumbered ? 'numeric' : 'author-year', inferred: true }
}

export function referenceText(p: Paragraph): string {
  return p.text.replace(MANUAL_NO, '').replace(DOTTED_NO, '').trim()
}

export function checkReferences(ctx: CheckContext) {
  const { s, profile } = ctx
  const refRule = profile?.references
  const mode = editionFor(profile)
  // 两版都认时，以 2025 版逐条检查，再用 2015 版复核：只有 2015 版也不接受的才算不符
  const edition: Edition = mode === 'either' ? '2025' : mode
  const basis = editionLabel(mode)
  // 档案没写体例时按文档判断；判断为著者-出版年制的，不按顺序编码制查序号和对账
  const { style, inferred } = inferCitationStyle(ctx.doc, s, refRule?.style)
  const AUTHOR_YEAR_NOTE = inferred
    ? '学校档案没写引用体例；文献表没有序号、正文是"作者, 年份"的写法，按著者-出版年制处理，顺序编码制对账不适用'
    : '著者-出版年制不检查引用顺序'

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
  const numbers = entries.map(entryNumber)
  if (style !== 'numeric') ctx.skip('references', '参考文献序号', AUTHOR_YEAR_NOTE)
  else {
    const dotted = entries.filter((p) => !MANUAL_NO.test(shownText(p)) && DOTTED_NO.test(shownText(p)))
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
    const seqBad = entries.filter((p, i) => MANUAL_NO.test(shownText(p)) && numbers[i] !== i + 1)
    if (seqBad.length) {
      ctx.addForParagraphs(seqBad, {
        id: 'refs-number-sequence', category: 'references', severity: 'error', title: '参考文献序号不连续或重复',
        detail: `第 ${entries.indexOf(seqBad[0]) + 1} 条的序号是 [${numbers[entries.indexOf(seqBad[0])]}]。`, basis,
      })
    }
    if (!dotted.length && !missing.length && !seqBad.length) ctx.pass('references', '参考文献序号')
  }

  // 逐条著录规则（GB/T 7714 两版规则表）
  // 识别不出文献类型的条目，只适用于某几类文献的规则无法判断；作者段拆不出来的，作者规则无法判断。
  // 这两种都记"无法判断"，不能算通过。
  const views = entries.map((p) => analyzeEntry(referenceText(p)))
  const issuesOf = entries.map((p, i) => checkEntry(referenceText(p), i + 1, { edition }))
  const issues2015 = mode === 'either' ? entries.map((p, i) => checkEntry(referenceText(p), i + 1, { edition: '2015' })) : null
  /** 这条按 2025 版不符，但按 2015 版是允许的写法 */
  const acceptedBy2015 = (ruleId: string, i: number): boolean =>
    issues2015 !== null && !issues2015[i].some((x) => x.ruleId === ruleId)
  for (const rule of RULES) {
    if (!rule.severity[edition]) continue
    const bad: Paragraph[] = []
    const oldStyle: Paragraph[] = []
    const messages: string[] = []
    let ok = 0, unknown = 0
    let severity: 'error' | 'warning' | 'info' = rule.severity[edition]!
    entries.forEach((p, i) => {
      const v = views[i]
      if (rule.appliesTo !== 'all') {
        if (v.type === null) return void unknown++
        if (!rule.appliesTo.includes(v.type)) return // 不适用
      }
      if (AUTHOR_RULES.has(rule.id) && v.authorSegment === null) return void unknown++
      const hit = issuesOf[i].find((x) => x.ruleId === rule.id)
      if (hit && acceptedBy2015(rule.id, i)) {
        oldStyle.push(p)
        ok++
      } else if (hit) {
        bad.push(p)
        messages.push(hit.message)
        severity = hit.severity
      } else ok++
    })
    if (oldStyle.length) {
      ctx.addForParagraphs(oldStyle, {
        id: `refs-${rule.id}-2015`, category: 'references', severity: 'info',
        title: `${rule.title}：按 2015 版写法（${oldStyle.length} 条）`,
        detail: '这几条符合 GB/T 7714—2015，但不符合 2025 版。学校没有写明版本，过渡期两版都可以用；如果学院通知要求 2025 版，请按 2025 版改。',
        basis,
      })
    }
    if (bad.length === 0) {
      if (ok + unknown > 0) ctx.settle('references', rule.title, ok, unknown, '条')
      continue
    }
    const clause = rule.clause[edition]
    ctx.addForParagraphs(bad, {
      id: `refs-${rule.id}`, category: 'references', severity,
      title: `${rule.title}（${bad.length} 条）`,
      detail: [
        [...new Set(messages)].slice(0, 2).join(' '),
        rule.falsePositiveRisk !== 'low' && rule.falsePositiveNote ? `注意：${rule.falsePositiveNote}` : '',
        unknownNote(unknown, '条'),
      ].filter(Boolean).join(' '),
      basis: `${basis}${clause ? ` ${clause}` : ''}`,
    })
  }

  // 出版年、外文条数
  const noYear: Paragraph[] = []
  let foreign = 0
  for (const p of entries) {
    const parsed = parseReference(referenceText(p), 0)
    if (!parsed.isChinese) foreign++
    if (parsed.year === null) noYear.push(p)
  }
  if (noYear.length) ctx.addForParagraphs(noYear, { id: 'refs-year', category: 'references', severity: 'warning', title: `没有找到出版年（${noYear.length} 条）`, detail: '每条文献都应著录出版年（网页写发布或修改日期）。', basis })
  else ctx.pass('references', '出版年')

  checkDuplicates(ctx, entries, numbers, basis)

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

  if (style === 'numeric') checkCitations(ctx, basis)
  else ctx.skip('references', '正文引用与文献表对账', AUTHOR_YEAR_NOTE)
}

/** 可能漏读引用的原因；空串表示没有 */
function uncertainReason(r: CitationReconciliation): string {
  const u = r.uncertain
  const parts: string[] = []
  if (u.unreadFieldParagraphs) parts.push(`${u.unreadFieldParagraphs} 段用文献管理软件（Zotero、EndNote、NoteExpress 等）插入的引用没有显示成 [1] 这样的标号`)
  if (u.noteRefs) parts.push(`正文里有 ${u.noteRefs} 个脚注或尾注，脚注里的引用读不到`)
  if (u.ambiguous.length) parts.push(`${u.ambiguous.length} 处跟在英文字母后面的上标数字（如"${u.ambiguous[0].raw}"）分不清是引用还是指数`)
  return parts.join('；')
}

function checkCitations(ctx: CheckContext, basis: string) {
  const { doc, s } = ctx
  const r = reconcileCitations(doc, s)
  const at = (ci: number) => doc.paragraphs[r.citations[ci].paragraph]
  const unsure = uncertainReason(r)

  if (r.malformed.length) {
    ctx.add({
      id: 'cite-malformed', category: 'references', severity: 'warning', title: `${r.malformed.length} 处引用标号写法有误`,
      detail: `如 ${r.malformed.slice(0, 3).map((c) => `"${c.raw}"`).join('、')}：区间应从小到大，如 [3-5]。`,
      locations: r.malformed.map((c) => locate(doc.paragraphs[c.paragraph], s)), basis,
    })
  }
  if (r.citations.length === 0) {
    if (unsure) ctx.skip('references', '正文引用与文献表对账', `没有读到 [1] 这样的引用标号，${unsure}，需人工核对`)
    else if (!r.malformed.length) {
      ctx.add({
        id: 'cite-none', category: 'references', severity: 'info', title: '正文中没有找到 [1] 这样的引用标注',
        detail: '如果你用的是交叉引用或上标数字，检查可能识别不到；如果用的是著者-出版年制，可以忽略这一条。', basis,
      })
    }
    return
  }

  const bare = r.citations.filter((c) => c.bare)
  if (bare.length) {
    ctx.add({
      id: 'cite-no-brackets', category: 'references', severity: 'warning', title: `${bare.length} 处引用标号没有方括号`,
      detail: `如上标的"${bare[0].raw}"。顺序编码制的引用标号写作上标的 [1]、[2-4]。`,
      locations: bare.map((c) => locate(doc.paragraphs[c.paragraph], s)), basis,
    })
  }

  if (r.missing.length) {
    ctx.add({
      id: 'cite-out-of-range', category: 'references', severity: 'error',
      title: `正文引用了不存在的文献编号`,
      detail: `正文中出现了 ${r.missing.slice(0, 5).map((m) => `[${m.number}]`).join('、')}，参考文献表里没有对应的条目（共 ${r.entries.length} 条）。`,
      locations: r.missing.map((m) => locate(at(m.citation), s)), basis,
    })
  }

  // 有没读到的引用时：没被引用的条目可能在脚注或软件域里引了，只提示核对；两项都不能算通过
  if (r.uncited.length) {
    ctx.addForParagraphs(r.uncited.map((i) => s.refEntries[i]), {
      id: 'cite-uncited', category: 'references', severity: unsure ? 'info' : 'warning', title: `${r.uncited.length} 条参考文献在正文中没有找到引用`,
      detail: unsure
        ? `可能有引用没读到：${unsure}。请核对这几条是否确实被引用。`
        : '列入参考文献的每一条都应在正文中引用。如果正文用的是交叉引用（自动更新的编号），这里可能误报。',
      basis,
    })
  } else if (unsure) ctx.skip('references', '每条文献都被引用', `${unsure}，需人工确认`)
  else ctx.pass('references', '每条文献都被引用')

  if (r.outOfOrder.length) {
    const first = r.outOfOrder[0].number
    ctx.add({
      id: 'cite-order', category: 'references', severity: 'warning', title: '参考文献编号没有按正文中首次引用的先后排列',
      detail: `顺序编码制要求按文献在正文中第一次出现的顺序编号。例如 [${first}] 在 [${first - 1}] 之前就出现了。`,
      locations: r.outOfOrder.map((o) => locate(at(o.citation), s)), basis,
    })
  } else if (unsure) ctx.skip('references', '引用顺序', `${unsure}，需人工确认`)
  else ctx.pass('references', '引用顺序')
}

/** 题名比较用：去掉空白、标点和大小写差别 */
const titleKey = (t: string) => norm(t).replace(/[^\p{L}\p{N}]/gu, '')

/**
 * 重复条目：同一篇文献用两个编号各列了一次。
 * 按结构化解析出的题名比较，第一作者和出版年都解析出来时也要一致（同名的再版、译本不算重复）。
 * 题名没拆出来（或没有文献类型标识、只能粗拆）的条目无法判断，记"未检查"，不算通过。
 */
function checkDuplicates(ctx: CheckContext, entries: Paragraph[], numbers: (number | null)[], basis: string) {
  const label = (i: number) => (numbers[i] !== null ? `[${numbers[i]}]` : `第 ${i + 1} 条`)
  const seen: { i: number; title: string; author: string; year: number | null }[] = []
  const dups: Paragraph[] = []
  const pairs: string[] = []
  let unknown = 0
  entries.forEach((p, i) => {
    const { csl, typeCode } = parseGbt7714(referenceText(p))
    // 没有文献类型标识时题名是粗拆出来的，不可靠，不比较
    const title = csl.title && typeCode ? titleKey(csl.title) : ''
    if (title.length < 6) return void unknown++
    const a = csl.author?.[0]
    const author = a ? norm(a.family ?? a.literal ?? '') : ''
    const year = yearOf(csl)
    const prior = seen.find((x) => x.title === title && (!author || !x.author || x.author === author) && (year === null || x.year === null || x.year === year))
    if (prior) {
      dups.push(p)
      pairs.push(`${label(prior.i)} 和 ${label(i)}`)
    } else seen.push({ i, title, author, year })
  })
  if (dups.length) {
    ctx.addForParagraphs(dups, {
      id: 'refs-duplicate', category: 'references', severity: 'warning', title: `疑似重复的参考文献（${dups.length} 条）`,
      detail: `${pairs.slice(0, 3).join('，')}${pairs.length > 3 ? ' 等' : ''}的题名、第一作者和出版年相同，像是同一篇文献列了两次。如果确实是两篇，可以忽略。${unknown ? `另有 ${unknown} 条没拆出题名，没有比较。` : ''}`,
      basis,
    })
  } else if (seen.length) ctx.pass('references', '无重复条目')
  if (unknown) ctx.skip('references', '无重复条目', `${unknown} 条参考文献没拆出题名，无法判断是否和别的条目重复，需人工确认`)
}
