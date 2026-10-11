/**
 * 档案存储：IndexedDB 为主，不可用时退回内存。
 *
 * 隐私模式、file:// 限制或清除站点数据时 IndexedDB 可能不可用或抛错。
 * 此时页面照常使用，只是刷新后档案会丢，所以要暴露 persistent 让页面提示。
 */

import { hasContent, type Dossier } from './schema'

const DB_NAME = 'ohmypaper'
const STORE = 'dossier'
const KEY = 'current'
const EXPORT_KEY = 'ohmypaper.dossier.lastExportAt'
const BACKUP_AFTER_DAYS = 14

export interface DossierStore {
  /** 是否真的存进了浏览器；false 表示只在当前页面内存里 */
  readonly persistent: boolean
  load(): Promise<Dossier | null>
  save(d: Dossier): Promise<void>
  clear(): Promise<void>
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('blocked'))
  })
}

async function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = f(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export function createStore(): DossierStore {
  let memory: Dossier | null = null
  let persistent = typeof indexedDB !== 'undefined' && indexedDB !== null

  // 内存里始终留一份，IndexedDB 中途失败时不丢当前会话的数据
  return {
    get persistent() {
      return persistent
    },
    async load() {
      if (persistent) {
        try {
          const v = await run('readonly', (s) => s.get(KEY))
          if (v) memory = v as Dossier
          return memory
        } catch {
          persistent = false
        }
      }
      return memory
    },
    async save(d) {
      memory = d
      if (!persistent) return
      try {
        await run('readwrite', (s) => s.put(d, KEY))
      } catch {
        persistent = false
      }
    },
    async clear() {
      memory = null
      if (!persistent) return
      try {
        await run('readwrite', (s) => s.delete(KEY))
      } catch {
        persistent = false
      }
    },
  }
}

export function getLastExportAt(): Date | null {
  try {
    const v = localStorage.getItem(EXPORT_KEY)
    if (!v) return null
    const t = new Date(v)
    return Number.isNaN(t.getTime()) ? null : t
  } catch {
    return null
  }
}

export function setLastExportAt(at: Date = new Date()): void {
  try {
    localStorage.setItem(EXPORT_KEY, at.toISOString())
  } catch {
    // 隐私模式下写不进去，忽略
  }
}

/** 档案里有内容、且从没导出过或超过 14 天没导出时，给一个温和的备份提醒 */
export function needsBackupReminder(d: Dossier | null, lastExportAt: Date | null, now: Date = new Date()): boolean {
  if (!d || !hasContent(d)) return false
  if (!lastExportAt) return true
  return now.getTime() - lastExportAt.getTime() > BACKUP_AFTER_DAYS * 86400_000
}
