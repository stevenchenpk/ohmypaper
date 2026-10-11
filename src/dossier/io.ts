/**
 * 档案的导入导出，以及把引用核验结果写进文献库。
 */

import { surnameOf } from '../references/parse'
import type { VerifyResult } from '../references/verify'
import { migrate } from './migrate'
import { type Dossier, type LibraryEntry, validate } from './schema'

export const EXPORT_FILENAME = '我的论文档案.ohmypaper.json'

export function exportDossier(d: Dossier): string {
  return JSON.stringify(d, null, 2)
}

export function importDossier(text: string): Dossier {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('文件不是有效的 JSON，无法导入。请确认选的是导出的 .ohmypaper.json 文件。')
  }
  const d = migrate(raw)
  const errs = validate(d)
  if (errs.length > 0) {
    const shown = errs.slice(0, 5).join('\n')
    throw new Error(`档案内容有问题，没有导入：\n${shown}${errs.length > 5 ? `\n……另有 ${errs.length - 5} 处` : ''}`)
  }
  return d
}

/** GB/T 7714 文献类型标识 → CSL 类型 */
const CSL_TYPE: Record<string, string> = {
  J: 'article-journal',
  M: 'book',
  D: 'thesis',
  C: 'paper-conference',
  N: 'article-newspaper',
  R: 'report',
  S: 'standard',
  P: 'patent',
  A: 'chapter',
  EB: 'webpage',
  DB: 'dataset',
}

const normRaw = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')

function toEntry(r: VerifyResult, id: string, at: string): LibraryEntry {
  const { ref, match } = r
  // 只有"已核实"时才用库里的记录补全字段；信息不符的记录可能是别的文献，不能写成学生的条目
  const trusted = r.status === 'verified' ? match : null
  const csl: Record<string, unknown> = { type: (ref.docType && CSL_TYPE[ref.docType]) || 'document' }
  const title = ref.title ?? trusted?.title
  if (title) csl.title = title
  if (ref.authors.length > 0) csl.author = ref.authors.map((a) => (ref.isChinese ? { literal: a } : { family: surnameOf(a) }))
  const year = ref.year ?? trusted?.year
  if (year) csl.issued = { 'date-parts': [[year]] }
  const doi = ref.doi ?? trusted?.doi
  if (doi) csl.DOI = doi
  return {
    id,
    csl,
    raw: ref.raw,
    check: { status: r.status, at, source: match?.source ?? null },
  }
}

/**
 * 把核验结果转成文献库条目，并并入已有的库（不改动传入的数组）。
 * 按 DOI 或归一化后的原文匹配：重复核验时更新原条目，不新增。
 */
export function libraryFromResults(results: VerifyResult[], existing: LibraryEntry[] = [], now: Date = new Date()): LibraryEntry[] {
  const lib = existing.map((e) => ({ ...e }))
  const at = now.toISOString()
  let n = lib.reduce((m, e) => Math.max(m, Number(/^r(\d+)$/.exec(e.id)?.[1] ?? 0)), 0)
  const keyOf = (e: LibraryEntry) => ({
    doi: typeof e.csl?.DOI === 'string' ? e.csl.DOI.toLowerCase() : null,
    raw: e.raw ? normRaw(e.raw) : null,
  })

  for (const r of results) {
    const fresh = toEntry(r, '', at)
    const doi = typeof fresh.csl.DOI === 'string' ? fresh.csl.DOI.toLowerCase() : null
    const raw = fresh.raw ? normRaw(fresh.raw) : null
    const i = lib.findIndex((e) => {
      const k = keyOf(e)
      return (doi !== null && k.doi === doi) || (raw !== null && k.raw === raw)
    })
    if (i >= 0) {
      // 保留原 ID 和不认识的字段，只刷新内容与核验结果
      lib[i] = { ...lib[i], csl: { ...lib[i].csl, ...fresh.csl }, raw: fresh.raw, check: fresh.check }
    } else {
      lib.push({ ...fresh, id: `r${++n}` })
    }
  }
  return lib
}
