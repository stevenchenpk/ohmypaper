/**
 * 中文参考文献结构化解析的入口：自动区分知网导出题录和手写的 GB/T 7714 列表。
 *
 * 输出字段沿用 CSL-JSON 的命名，只是数据格式，不依赖 citeproc-js（其许可为 CPAL/AGPL）。
 * 现有中文 CSL 样式多停在 GB/T 7714—2015，按 2025 版排版时不要直接套用。
 */

import { splitReferenceList } from '../parse'
import { detectExportFormat, parseCnkiExport } from './cnki'
import { parseGbt7714 } from './gbt7714'
import type { StructuredReference } from './types'

export { detectExportFormat, parseCnkiExport } from './cnki'
export { parseGbt7714 } from './gbt7714'
export type { CslItem, StructuredReference } from './types'

export function parseReferencesStructured(text: string): StructuredReference[] {
  const format = detectExportFormat(text)
  if (format) return parseCnkiExport(text, format)
  return splitReferenceList(text).map((entry, i) => parseGbt7714(entry, i + 1))
}
