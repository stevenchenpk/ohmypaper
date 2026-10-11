/**
 * 核验结果导出：纯文本报告（可直接贴给导师或附在论文材料里）和 CSV。
 */
import type { VerifyResult, VerifyStatus } from './verify'

export const STATUS_LABEL: Record<VerifyStatus, string> = {
  verified: '已核实',
  mismatch: '信息不符',
  not_found: '查无此文',
  manual: '需人工核对',
  error: '查询失败',
}

/** 最需要学生处理的排在前面 */
export const STATUS_ORDER: VerifyStatus[] = ['not_found', 'mismatch', 'error', 'manual', 'verified']

export function countByStatus(results: VerifyResult[]): Map<VerifyStatus, number> {
  const counts = new Map<VerifyStatus, number>()
  for (const r of results) counts.set(r.status, (counts.get(r.status) ?? 0) + 1)
  return counts
}

export function toTextReport(results: VerifyResult[], checkedAt: Date): string {
  const counts = countByStatus(results)
  const summary = STATUS_ORDER.filter((s) => counts.get(s))
    .map((s) => `${STATUS_LABEL[s]} ${counts.get(s)}`)
    .join('，')
  const lines = [
    'ohmypaper 参考文献核验报告',
    `核验时间：${checkedAt.toLocaleString('zh-CN', { hour12: false })}`,
    `共 ${results.length} 条：${summary}`,
    '数据来源：Crossref、OpenAlex。中文文献需人工到知网等平台核对。',
    '',
  ]
  for (const r of [...results].sort((a, b) => a.ref.index - b.ref.index)) {
    lines.push(`[${r.ref.index}] ${STATUS_LABEL[r.status]}：${r.reason}`)
    lines.push(`    ${r.ref.raw}`)
    if (r.match && r.status !== 'verified') lines.push(`    最接近的记录：${r.match.title}（${r.match.year ?? '年份未知'}）`)
  }
  lines.push('', '本报告仅供自查参考，最终以本人核对原文为准。')
  return lines.join('\n')
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(results: VerifyResult[]): string {
  const header = ['序号', '结果', '说明', '原文', '解析标题', '解析年份', 'DOI', '匹配标题', '匹配年份', '匹配来源', '相似度']
  const rows = [...results]
    .sort((a, b) => a.ref.index - b.ref.index)
    .map((r) => [
      r.ref.index,
      STATUS_LABEL[r.status],
      r.reason,
      r.ref.raw,
      r.ref.title,
      r.ref.year,
      r.ref.doi,
      r.match?.title,
      r.match?.year,
      r.match?.source,
      r.similarity === null ? '' : r.similarity.toFixed(2),
    ])
  // 加 BOM，Excel 打开中文不乱码
  return '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
}
