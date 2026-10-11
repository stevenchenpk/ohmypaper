/**
 * 「继续上次检查」：把一次检查的结果整理成可保存的摘要，以及恢复时显示的文字。
 * 纯函数，不碰 DOM 和存储。
 *
 * 红线：恢复出来的结果只是"上次会话的记录"，不是本次核验；
 * 带着时间显示，不用"通过"这类字样，也不把任何没核实的东西写成通过。
 */

import type { VerifyResult, VerifyStatus } from '../references/verify'
import type { CitationResume, Dossier, FormatResume, Resume } from './schema'

export const STATUS_LABEL: Record<VerifyStatus, string> = {
  verified: '已核实',
  mismatch: '信息不符',
  not_found: '查无此文',
  manual: '需人工核对',
  error: '查询失败',
}

export function citationResume(refsText: string, results: VerifyResult[], now: Date = new Date()): CitationResume {
  const counts: CitationResume['counts'] = {}
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1
  return {
    refsText,
    at: now.toISOString(),
    total: results.length,
    counts,
    items: results.map((r) => ({ index: r.ref.index, status: r.status, reason: r.reason })),
  }
}

export function formatResume(
  info: { filename: string; schoolPath: string | null; schoolLabel: string | null; counts: FormatResume['counts'] },
  now: Date = new Date(),
): FormatResume {
  return { filename: info.filename, at: now.toISOString(), schoolPath: info.schoolPath, schoolLabel: info.schoolLabel, counts: { ...info.counts } }
}

export function withResume(d: Dossier, patch: Partial<Resume>, now: Date = new Date()): Dossier {
  return { ...d, updated: now.toISOString(), resume: { ...d.resume, ...patch } }
}

export function hasResume(d: Dossier | null): boolean {
  return !!(d?.resume?.citation || d?.resume?.format)
}

export function formatTime(iso: string): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`
}

const CITATION_ORDER: VerifyStatus[] = ['not_found', 'mismatch', 'error', 'manual', 'verified']

/** 例如"上次记录：查无此文 1 · 已核实 3"。 */
export function citationCountsText(c: CitationResume): string {
  const parts = CITATION_ORDER.filter((s) => c.counts[s]).map((s) => `${STATUS_LABEL[s]} ${c.counts[s]}`)
  return `共 ${c.total} 条${parts.length ? '：' + parts.join(' · ') : ''}`
}

/** 格式体检摘要。"通过"之外必须同时写明未检查的项。 */
export function formatCountsText(f: FormatResume): string {
  const n = f.counts
  const parts: string[] = []
  if (n.error) parts.push(`需修改 ${n.error}`)
  if (n.warning) parts.push(`建议确认 ${n.warning}`)
  if (n.info) parts.push(`提示 ${n.info}`)
  parts.push(`未检查，需人工确认 ${n.skipped}`)
  parts.push(`当时通过 ${n.passed}`)
  return parts.join(' · ')
}

/** 恢复区的标题，明确这不是本次的核验 */
export function previousSessionLabel(iso: string): string {
  return `上次会话的记录（${formatTime(iso)}），不是本次核验`
}
