/**
 * 参考文献核验。
 *
 * 原则：只做确定性比对，不调用大模型。查不到不等于假，
 * 所以"查无此文"只在有足够把握时给出，其余情况一律标为"需人工核对"。
 */

import { type ParsedReference, surnameOf } from './parse'
import { normalizeTitle, titleSimilarity } from './similarity'
import {
  type CandidateWork,
  type SourceOptions,
  type WorkKind,
  bookSearchLinks,
  crossrefSearch,
  manualSearchLinks,
  openAlexSearch,
  resolveDoi,
} from './sources'

export type VerifyStatus =
  | 'verified' // 已核实：找到标题、作者、出处都一致的记录
  | 'mismatch' // 信息不符：找到了记录，但标题、作者、年份、出处或 DOI 对不上
  | 'not_found' // 查无此文：国际库中检索不到任何相近记录
  | 'manual' // 需人工核对：中文文献、图书报告或信息不足，开放接口无法判断
  | 'error' // 网络或接口错误

export interface VerifyResult {
  ref: ParsedReference
  status: VerifyStatus
  /** 给学生看的一句话解释 */
  reason: string
  match: CandidateWork | null
  similarity: number | null
  links: { label: string; url: string }[]
}

/** 标题相似度阈值。来自对测试集的经验值，后续用真实样本校准。 */
export const THRESHOLDS = {
  verified: 0.85,
  /** 低于此值视为没找到相近记录 */
  related: 0.6,
  /** 年份允许的误差（在线首发与正式出版年常差一年） */
  yearTolerance: 1,
} as const

/** 图书、报告、学位论文等在 Crossref / OpenAlex 中收录不全，查不到时不下"查无此文"的结论 */
const POORLY_INDEXED = new Set(['M', 'R', 'D', 'S', 'P', 'N', 'G', 'A'])

/** 学生标注的类型和记录类型明显矛盾的组合。会议、预印本、章节归属本身就乱，不判。 */
const KIND_CONFLICTS: Record<string, { label: string; conflicts: WorkKind[] }> = {
  J: { label: '期刊论文', conflicts: ['book', 'thesis'] },
  M: { label: '专著', conflicts: ['article', 'thesis', 'proceedings'] },
  D: { label: '学位论文', conflicts: ['article', 'book', 'proceedings', 'chapter'] },
}

const KIND_LABEL: Record<WorkKind, string> = {
  article: '期刊论文',
  book: '图书',
  chapter: '图书章节',
  thesis: '学位论文',
  proceedings: '会议论文',
  preprint: '预印本',
  report: '报告',
  other: '其他类型',
}

const NEGATIONS = new Set(['not', 'no', 'cannot', 'never', 'without', 'non', 'nor', "can't", "don't", "doesn't", "isn't", "aren't", "won't"])

/** 去掉变音符号和非字母字符，用于比对姓氏（Müller ≈ MULLER） */
const fold = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}]/gu, '')

const sameNumber = (a: string, b: string) => a.toLowerCase().replace(/^0+/, '') === b.toLowerCase().replace(/^0+/, '')

function negationCount(title: string): number {
  return title
    .toLowerCase()
    .split(/[^a-z']+/)
    .filter((w) => NEGATIONS.has(w)).length
}

/**
 * 标题得分：解析出的题名与记录题名的相似度。
 * 解析失败（缩写、非常规分隔符）时，退而看记录题名是否完整出现在原文里。
 */
function titleScore(ref: ParsedReference, workTitle: string): number {
  const sim = ref.title ? titleSimilarity(ref.title, workTitle) : 0
  const nw = normalizeTitle(workTitle)
  const nt = normalizeTitle(ref.title ?? '')
  if (nw.length >= 6 && nw.length >= 0.6 * nt.length && normalizeTitle(ref.raw).includes(nw)) return Math.max(sim, 1)
  return sim
}

interface Comparison {
  /** 给学生看的冲突说明 */
  conflicts: string[]
  /** 实际比对过且一致的项，用来如实说明"核实了什么" */
  confirmed: string[]
}

/** 标题对上之后，逐项核对其余书目信息。没法比对的项不算一致。 */
function compare(ref: ParsedReference, work: CandidateWork): Comparison {
  const out: string[] = []
  const confirmed: string[] = []

  if (ref.title && negationCount(ref.title) !== negationCount(work.title)) {
    out.push(`标题的意思相反：你写的是"${ref.title}"，记录是"${work.title}"`)
  }

  if (ref.authors.length > 0 && work.authors.length > 0 && !ref.isChinese) {
    const mine = fold(surnameOf(ref.authors[0]))
    const theirs = work.authors.map(fold)
    const ok =
      mine.length === 0 ||
      theirs.some((t) => t === mine || (t.length >= 3 && mine.includes(t)) || (mine.length >= 3 && t.includes(mine)))
    if (ok && mine.length > 0) confirmed.push('作者')
    if (!ok) {
      const shown = work.authors.slice(0, 3).join('、') + (work.authors.length > 3 ? ' 等' : '')
      out.push(`作者不符：你写的第一作者是 ${ref.authors[0]}，记录中的作者是 ${shown}`)
    }
  }

  if (ref.year !== null && work.year !== null) {
    if (Math.abs(ref.year - work.year) > THRESHOLDS.yearTolerance) out.push(`年份不符：你写的是 ${ref.year}，记录是 ${work.year}`)
    else confirmed.push('年份')
  }

  const kindRule = ref.docType ? KIND_CONFLICTS[ref.docType] : undefined
  if (kindRule && work.kind && kindRule.conflicts.includes(work.kind)) {
    out.push(`文献类型不符：你标注的是 [${ref.docType}]（${kindRule.label}），记录是${KIND_LABEL[work.kind]}`)
  }

  const where = work.venue ? `（记录中发表在 ${work.venue}）` : ''
  if (ref.volume && work.volume && !sameNumber(ref.volume, work.volume)) {
    out.push(`卷号不符：你写的是第 ${ref.volume} 卷，记录是第 ${work.volume} 卷${where}`)
  } else if (ref.firstPage && work.firstPage && !sameNumber(ref.firstPage, work.firstPage)) {
    out.push(`页码不符：你写的起始页是 ${ref.firstPage}，记录是 ${work.firstPage}${where}`)
  } else if (ref.volume && work.volume) {
    confirmed.push('卷期页码')
  }

  return { conflicts: out, confirmed }
}

const conflictsOf = (ref: ParsedReference, work: CandidateWork) => compare(ref, work).conflicts

function best(ref: ParsedReference, candidates: CandidateWork[]): { work: CandidateWork; sim: number } | null {
  let top: { work: CandidateWork; sim: number; conflicts: number } | null = null
  for (const w of candidates) {
    const sim = titleScore(ref, w.title)
    const conflicts = conflictsOf(ref, w).length
    // 标题同分时，优先选书目信息更吻合的那条（短标题常有同名文献）
    if (!top || sim > top.sim || (sim === top.sim && conflicts < top.conflicts)) top = { work: w, sim, conflicts }
  }
  return top
}

type Links = { label: string; url: string }[]

function linksFor(ref: ParsedReference, match: CandidateWork | null, base?: Links) {
  const links = [...(base ?? manualSearchLinks(ref.title ?? ref.raw.slice(0, 80)))]
  if (match?.url) {
    const label = { crossref: 'Crossref 记录', openalex: 'OpenAlex 记录', datacite: 'DataCite 记录' }[match.source]
    links.unshift({ label, url: match.url })
  }
  return links
}

function result(
  ref: ParsedReference,
  status: VerifyStatus,
  reason: string,
  match: CandidateWork | null = null,
  similarity: number | null = null,
  base?: Links,
): VerifyResult {
  return { ref, status, reason, match, similarity, links: linksFor(ref, match, base) }
}

/**
 * 判定。原则：没比对上的项不算通过。
 * "已核实"要求标题一致，并且 DOI 指向这条记录，或者作者确实比对一致；
 * 只有标题撞上、其余信息都没法比对时，交给人工核对。
 */
function judge(ref: ParsedReference, top: { work: CandidateWork; sim: number }, viaDoi = false): VerifyResult {
  const { work, sim } = top
  const { conflicts, confirmed } = compare(ref, work)
  if (sim >= THRESHOLDS.verified) {
    if (conflicts.length > 0) {
      return result(ref, 'mismatch', `找到了标题一致的记录，但${conflicts.join('；')}。`, work, sim)
    }
    const checked = [...(viaDoi ? ['DOI'] : []), '标题', ...confirmed]
    if (!viaDoi && !confirmed.includes('作者')) {
      return result(
        ref,
        'manual',
        `找到了标题一致的记录，但没法比对作者（${ref.authors.length === 0 ? '条目里没解析出作者' : '记录里没有作者信息'}），不能确认是同一篇。请点开记录核对。`,
        work,
        sim,
      )
    }
    return result(ref, 'verified', `在开放学术库中找到一致的记录，核对了：${checked.join('、')}。`, work, sim)
  }
  const extra = conflicts.length > 0 ? `另外，${conflicts.join('；')}。` : ''
  return result(ref, 'mismatch', `只找到标题相近、但不完全一致的记录，请核对标题是否写错。${extra}`, work, sim)
}

interface SearchOutcome {
  top: { work: CandidateWork; sim: number } | null
  /** 两个库都失败 */
  allFailed: boolean
  /** 有一个库失败，结果不完整 */
  partial: boolean
}

async function search(ref: ParsedReference, opts: SourceOptions): Promise<SearchOutcome> {
  const [cr, oa] = await Promise.allSettled([crossrefSearch(ref.raw, opts), openAlexSearch(ref.title ?? ref.raw, opts)])
  const candidates = [
    ...(cr.status === 'fulfilled' ? cr.value : []),
    ...(oa.status === 'fulfilled' ? oa.value : []),
  ]
  return {
    top: best(ref, candidates),
    allFailed: cr.status === 'rejected' && oa.status === 'rejected',
    partial: cr.status === 'rejected' || oa.status === 'rejected',
  }
}

/** 检索不到时的结论：网络不完整不下结论，图书报告类转人工，其余才是"查无此文" */
function notFound(ref: ParsedReference, s: SearchOutcome, reason: string): VerifyResult {
  const near = s.top?.work ?? null
  const sim = s.top?.sim ?? null
  if (s.partial) {
    return result(ref, 'error', '有一个学术库这次没有响应，检索结果不完整，暂时不能下结论。请稍后重试。', near, sim)
  }
  if (ref.docType && POORLY_INDEXED.has(ref.docType)) {
    return result(
      ref,
      'manual',
      'Crossref 和 OpenAlex 里没有找到。这两个库对图书、报告、学位论文收录不全，查不到不说明是假的，请用下面的链接核对。',
      near,
      sim,
      bookSearchLinks(ref.title ?? ref.raw.slice(0, 80)),
    )
  }
  return result(ref, 'not_found', reason, near, sim)
}

async function verifyByDoi(ref: ParsedReference, opts: SourceOptions): Promise<VerifyResult> {
  const work = await resolveDoi(ref.doi!, opts)
  if (!work) {
    if (ref.isChinese) {
      return result(ref, 'manual', '这个 DOI 不在 Crossref 和 DataCite 中。中文期刊的 DOI 常由其他机构注册，请到知网或万方核对。')
    }
    if (!ref.title) {
      return result(ref, 'not_found', `DOI ${ref.doi} 不存在，也没能解析出标题。这是虚构文献的常见特征，请务必核对。`)
    }
    // DOI 不存在时按标题再找一次：抄错 DOI 的真文献很常见，不能直接判假
    const s = await search(ref, opts)
    if (s.allFailed) return result(ref, 'error', '两个学术库都暂时无法访问，请稍后重试。')
    if (s.top && s.top.sim >= THRESHOLDS.related) {
      const fix = s.top.work.doi ? `正确的 DOI 应该是 ${s.top.work.doi}。` : ''
      const verdict = judge(ref, s.top)
      const rest = verdict.status === 'verified' ? '' : verdict.reason
      return result(ref, 'mismatch', `DOI ${ref.doi} 不存在，但按标题找到了这篇文献，可能是 DOI 抄错了。${fix}${rest}`, s.top.work, s.top.sim)
    }
    return notFound(ref, s, `DOI ${ref.doi} 不存在，按标题在 Crossref 和 OpenAlex 中也找不到。这是虚构文献的常见特征，请务必核对。`)
  }

  const sim = titleScore(ref, work.title)
  if (!ref.title && sim < THRESHOLDS.verified) {
    return result(ref, 'mismatch', `DOI 有效，但它指向的是《${work.title}》，条目里找不到这个标题。可能借用了别的文献的 DOI，请核对。`, work, sim)
  }
  if (sim < THRESHOLDS.related) {
    return result(ref, 'mismatch', `DOI 有效，但它指向的是另一篇文献《${work.title}》。DOI 与标题不匹配。`, work, sim)
  }
  return judge(ref, { work, sim }, true)
}

async function verifyBySearch(ref: ParsedReference, opts: SourceOptions): Promise<VerifyResult> {
  const s = await search(ref, opts)
  if (s.allFailed) return result(ref, 'error', '两个学术库都暂时无法访问，请稍后重试。')
  if (!s.top || s.top.sim < THRESHOLDS.related) {
    return notFound(ref, s, '在 Crossref 和 OpenAlex 中都找不到相近的记录。请确认这篇文献真实存在。')
  }
  return judge(ref, s.top)
}

export async function verifyReference(ref: ParsedReference, opts: SourceOptions = {}): Promise<VerifyResult> {
  try {
    if (ref.doi) return await verifyByDoi(ref, opts)
    if (ref.isChinese) {
      return result(ref, 'manual', '中文文献没有开放的核验接口，请点击链接到知网、百度学术或万方核对。')
    }
    if (!ref.title) {
      return result(ref, 'manual', '没能从这条文献中解析出标题，请检查著录格式，或手动核对。')
    }
    return await verifyBySearch(ref, opts)
  } catch {
    return result(ref, 'error', '查询时出现网络错误，请稍后重试。')
  }
}

/** 逐条核验，限制并发，对公共接口保持礼貌。 */
export async function verifyAll(
  refs: ParsedReference[],
  opts: SourceOptions & { concurrency?: number; onProgress?: (done: number, r: VerifyResult) => void } = {},
): Promise<VerifyResult[]> {
  const results: VerifyResult[] = new Array(refs.length)
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < refs.length) {
      const i = next++
      results[i] = await verifyReference(refs[i], opts)
      opts.onProgress?.(++done, results[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 2, refs.length) }, worker))
  return results
}
