/**
 * 档案存储：localStorage。
 *
 * 隐私模式、file:// 限制、禁用站点数据或存储已满时 localStorage 的读写都可能抛错，
 * 此时页面照常使用，数据只留在当前页面内存里，并通过 persistent 让页面提示"刷新后不会保留"。
 */

import type { Dossier } from './schema'

export const STORAGE_KEY = 'ohmypaper.dossier.v0'

export interface DossierStore {
  /** 是否真的存进了浏览器；false 表示只在当前页面内存里 */
  readonly persistent: boolean
  load(): Promise<Dossier | null>
  save(d: Dossier): Promise<void>
  clear(): Promise<void>
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function createStore(): DossierStore {
  let memory: Dossier | null = null
  let persistent = storage() !== null

  return {
    get persistent() {
      return persistent
    },
    async load() {
      const s = storage()
      if (!s) {
        persistent = false
        return memory
      }
      try {
        const text = s.getItem(STORAGE_KEY)
        if (text) {
          const v = JSON.parse(text) as Dossier
          // 只认格式正确的记录；损坏的内容当作没有，不报错
          if (v && typeof v === 'object' && v.format === 'ohmypaper-dossier') memory = v
        }
      } catch {
        persistent = false
      }
      return memory
    },
    async save(d) {
      memory = d
      const s = storage()
      if (!s) {
        persistent = false
        return
      }
      try {
        s.setItem(STORAGE_KEY, JSON.stringify(d))
        persistent = true
      } catch {
        persistent = false
      }
    },
    async clear() {
      memory = null
      const s = storage()
      if (!s) return
      try {
        s.removeItem(STORAGE_KEY)
      } catch {
        persistent = false
      }
    },
  }
}
