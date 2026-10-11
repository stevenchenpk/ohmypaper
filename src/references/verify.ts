/**
 * 参考文献核验。
 *
 * 原则：只做确定性比对，不调用大模型。查不到不等于假，
 * 所以"查无此文"只在有足够把握时给出，其余情况一律标为"需人工核对"。
 */

import type { ParsedReference } from './parse'
import { titleSimilarity } from './similarity'
import {
  type CandidateWork,
  type SourceOptions,
  crossrefByDoi,
  crossrefSearch,
  manualSearchLinks,
  openAlexSearch,
} from './sources'

export type VerifyStatus =
  | 'verified' // 已核实：找到标题高度一致的记录
  | 'mismatch' // 信息不符：找到了记录，但标题、年份或 DOI 对不上
  | 'not_found' // 查无此文：国际库中检索不到任何相近记录
  | 'manual' // 需人工核对：中文文献或信息不足，开放接口无法判断
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

function yearConflict(ref: ParsedReference, w: CandidateWork): boolean {
  return ref.year !== null && w.year !== null && Math.abs(ref.year - w.year) > THRESHOLDS.yearTolerance
}

function best(ref: ParsedReference, candidates: CandidateWork[]): { work: CandidateWork; sim: number } | null {
  if (!ref.title) return null
  let top: { work: CandidateWork; sim: number } | null = null
  for (const w of candidates) {
    const sim = titleSimilarity(ref.title, w.title)
    if (!top || sim > top.sim) top = { work: w, sim }
  }
  return top
}

function linksFor(ref: ParsedReference, match: CandidateWork | null) {
  const links = manualSearchLinks(ref.title ?? ref.raw.slice(0, 80))
  if (match?.url) links.unshift({ label: match.source === 'crossref' ? 'Crossref 记录' : 'OpenAlex 记录', url: match.url })
  return links
}

function result(
  ref: ParsedReference,
  status: VerifyStatus,
  reason: string,
  match: CandidateWork | null = null,
  similarity: number | null = null,
): VerifyResult {
  return { ref, status, reason, match, similarity, links: linksFor(ref, match) }
}

function judge(ref: ParsedReference, top: { work: CandidateWork; sim: number }): VerifyResult {
  const { work, sim } = top
  if (sim >= THRESHOLDS.verified) {
    if (yearConflict(ref, work)) {
      return result(ref, 'mismatch', `找到同名文献，但年份不符：你写的是 ${ref.year}，记录是 ${work.year}。`, work, sim)
    }
    return result(ref, 'verified', '在开放学术库中找到标题一致的记录。', work, sim)
  }
  return result(ref, 'mismatch', '只找到标题相近、但不完全一致的记录，请核对标题是否写错。', work, sim)
}

async function verifyByDoi(ref: ParsedReference, opts: SourceOptions): Promise<VerifyResult> {
  const work = await crossrefByDoi(ref.doi!, opts)
  if (!work) {
    if (ref.isChinese) {
      return result(ref, 'manual', '这个 DOI 不在 Crossref 中。中文期刊的 DOI 常由其他机构注册，请到知网或万方核对。')
    }
    return result(ref, 'not_found', `Crossref 中不存在 DOI ${ref.doi}。这是虚构文献的常见特征，请务必核对。`)
  }
  if (!ref.title) return result(ref, 'verified', 'DOI 有效。没能解析出标题，未比对标题。', work, null)

  const sim = titleSimilarity(ref.title, work.title)
  if (sim < THRESHOLDS.related) {
    return result(ref, 'mismatch', `DOI 有效，但它指向的是另一篇文献《${work.title}》。DOI 与标题不匹配。`, work, sim)
  }
  return judge(ref, { work, sim })
}

async function verifyBySearch(ref: ParsedReference, opts: SourceOptions): Promise<VerifyResult> {
  const [cr, oa] = await Promise.allSettled([crossrefSearch(ref.raw, opts), openAlexSearch(ref.title!, opts)])
  const candidates = [
    ...(cr.status === 'fulfilled' ? cr.value : []),
    ...(oa.status === 'fulfilled' ? oa.value : []),
  ]
  if (cr.status === 'rejected' && oa.status === 'rejected') {
    return result(ref, 'error', '两个学术库都暂时无法访问，请稍后重试。')
  }

  const top = best(ref, candidates)
  if (!top || top.sim < THRESHOLDS.related) {
    return result(ref, 'not_found', '在 Crossref 和 OpenAlex 中都找不到相近的记录。请确认这篇文献真实存在。', top?.work ?? null, top?.sim ?? null)
  }
  return judge(ref, top)
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
