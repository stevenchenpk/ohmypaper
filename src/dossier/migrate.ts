/**
 * 档案版本迁移。
 *
 * 不认识的字段一律原样保留，不丢数据。v0 是目前唯一的版本，
 * 以后升级时在 STEPS 里追加 “n → n+1” 的迁移函数。
 */

import { DOSSIER_FORMAT, DOSSIER_VERSION, type Dossier } from './schema'

type Raw = Record<string, unknown>

/** STEPS[n] 把版本 n 的档案升到 n+1。v0 暂无。 */
const STEPS: ((d: Raw) => Raw)[] = []

export function migrate(input: unknown): Dossier {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('这不是论文档案文件：内容不是一个对象。')
  }
  let d = input as Raw
  if (d.format !== DOSSIER_FORMAT) {
    throw new Error(`这不是论文档案文件：format 应为 "${DOSSIER_FORMAT}"。`)
  }
  const v = d.version
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new Error('档案的 version 缺失或不是有效的整数。')
  }
  if (v > DOSSIER_VERSION) {
    throw new Error(`这份档案来自更新的版本（version ${v}），当前页面只支持到 version ${DOSSIER_VERSION}。请刷新页面或使用最新版 ohmypaper 后再导入。`)
  }
  for (let n = v; n < DOSSIER_VERSION; n++) {
    d = { ...STEPS[n](d), version: n + 1 }
  }
  return d as unknown as Dossier
}
