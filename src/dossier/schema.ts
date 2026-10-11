/**
 * 论文档案的数据格式（v0）。规格见 ecosystem/specs/dossier-v0.md 第 3 节。
 *
 * 档案不存论文正文，只存元数据和学生自己填写的内容。
 */

import type { VerifyStatus } from '../references/verify'

export const DOSSIER_FORMAT = 'ohmypaper-dossier'
export const DOSSIER_VERSION = 0

export const PURPOSES = ['polish', 'translate', 'search', 'explain', 'code', 'other'] as const
export const STAGES = ['topic', 'proposal', 'literature', 'writing', 'data', 'format', 'defense'] as const
export const CHECK_STATUSES = ['verified', 'mismatch', 'not_found', 'manual', 'error'] as const
export const CHECK_SOURCES = ['crossref', 'openalex', 'datacite'] as const

export type Purpose = (typeof PURPOSES)[number]
export type Stage = (typeof STAGES)[number]

export const PURPOSE_LABELS: Record<Purpose, string> = {
  polish: '润色',
  translate: '翻译',
  search: '检索',
  explain: '解释',
  code: '代码',
  other: '其他',
}

export const STAGE_LABELS: Record<Stage, string> = {
  topic: '选题',
  proposal: '开题',
  literature: '文献',
  writing: '写作',
  data: '数据',
  format: '格式',
  defense: '答辩',
}

/** 档案里各对象允许带有不认识的字段（来自更新的版本），原样保留 */
type Open = { [key: string]: unknown }

export interface Profile extends Open {
  school: string | null
  degree: string | null
  cohort: number | null
  department: string | null
  major: string | null
  title: string | null
}

export interface LibraryEntry extends Open {
  id: string
  /** CSL-JSON 条目 */
  csl: Record<string, unknown>
  raw?: string | null
  check: {
    status: VerifyStatus
    at: string
    source: (typeof CHECK_SOURCES)[number] | null
  } | null
}

export interface AiLogEntry extends Open {
  id: string
  /** YYYY-MM-DD */
  date: string
  tool: string
  version?: string | null
  purpose: Purpose
  stage: Stage
  section?: string | null
  verification?: string | null
  note?: string | null
}

export interface ChecklistRecord extends Open {
  /** 如 topic-feasibility@0 */
  spec: string
  answers: Record<string, unknown>
  updated: string
}

/** 「继续上次检查」要记住的内容。不含论文正文、不含 docx 内容 */
export interface CitationResume extends Open {
  /** 学生粘贴的参考文献文本 */
  refsText: string
  at: string
  total: number
  counts: Partial<Record<VerifyStatus, number>>
  /** 每条的状态摘要（序号 + 状态 + 原因），不含检索到的库中记录 */
  items: { index: number; status: VerifyStatus; reason: string }[]
}

export interface FormatResume extends Open {
  /** 只记文件名，不记 docx 内容 */
  filename: string
  at: string
  /** 所选学校档案路径，如 schools/fudan/bachelor-2027.yaml；未选学校为 null */
  schoolPath: string | null
  schoolLabel: string | null
  counts: { error: number; warning: number; info: number; passed: number; skipped: number }
}

export interface Resume extends Open {
  citation?: CitationResume | null
  format?: FormatResume | null
}

export interface Dossier extends Open {
  format: typeof DOSSIER_FORMAT
  version: number
  created: string
  updated: string
  profile: Profile
  library: LibraryEntry[]
  ai_log: AiLogEntry[]
  checklists: Record<string, ChecklistRecord>
  /** 可选；v0 内新增的附加字段，旧文件没有也合法 */
  resume?: Resume
}

export function emptyDossier(now: Date = new Date()): Dossier {
  const t = now.toISOString()
  return {
    format: DOSSIER_FORMAT,
    version: DOSSIER_VERSION,
    created: t,
    updated: t,
    profile: { school: null, degree: null, cohort: null, department: null, major: null, title: null },
    library: [],
    ai_log: [],
    checklists: {},
  }
}

/** 档案里是否有学生填写过的内容（用于决定要不要提醒备份） */
export function hasContent(d: Dossier): boolean {
  const p = d.profile
  const filled = [p.school, p.degree, p.cohort, p.department, p.major, p.title].some((v) => v !== null && v !== undefined && v !== '')
  return filled || !!d.resume?.citation || !!d.resume?.format || d.library.length > 0 || d.ai_log.length > 0 || Object.keys(d.checklists).length > 0
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown) => typeof v === 'string'
const isOptStr = (v: unknown) => v === undefined || v === null || typeof v === 'string'
const isTime = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v))

/** 校验档案，返回中文错误列表；空数组表示通过 */
export function validate(d: unknown): string[] {
  const errs: string[] = []
  if (!isObj(d)) return ['档案不是一个对象。']
  if (d.format !== DOSSIER_FORMAT) errs.push(`format 应为 "${DOSSIER_FORMAT}"。`)
  if (!Number.isInteger(d.version) || (d.version as number) < 0) errs.push('version 应为非负整数。')
  if (!isTime(d.created)) errs.push('created 应为 ISO 时间。')
  if (!isTime(d.updated)) errs.push('updated 应为 ISO 时间。')

  if (!isObj(d.profile)) {
    errs.push('profile 缺失或格式不对。')
  } else {
    const p = d.profile
    for (const k of ['school', 'degree', 'department', 'major', 'title']) {
      if (!isOptStr(p[k])) errs.push(`profile.${k} 应为文字或空。`)
    }
    if (p.cohort !== undefined && p.cohort !== null && !Number.isInteger(p.cohort)) errs.push('profile.cohort 应为整数年份或空。')
  }

  if (!Array.isArray(d.library)) {
    errs.push('library 应为列表。')
  } else {
    const seen = new Set<string>()
    d.library.forEach((e, i) => {
      const at = `library[${i}]`
      if (!isObj(e)) return void errs.push(`${at} 不是对象。`)
      if (!isStr(e.id) || e.id === '') errs.push(`${at}.id 缺失。`)
      else if (seen.has(e.id)) errs.push(`${at}.id "${e.id}" 重复。`)
      else seen.add(e.id)
      if (!isObj(e.csl)) errs.push(`${at}.csl 应为对象。`)
      if (!isOptStr(e.raw)) errs.push(`${at}.raw 应为文字或空。`)
      if (e.check !== undefined && e.check !== null) {
        const c = e.check
        if (!isObj(c)) return void errs.push(`${at}.check 格式不对。`)
        if (!(CHECK_STATUSES as readonly unknown[]).includes(c.status)) errs.push(`${at}.check.status 不是有效的核验状态：${String(c.status)}。`)
        if (!isTime(c.at)) errs.push(`${at}.check.at 应为 ISO 时间。`)
        if (c.source !== null && !(CHECK_SOURCES as readonly unknown[]).includes(c.source)) errs.push(`${at}.check.source 不是有效的来源：${String(c.source)}。`)
      }
    })
  }

  if (!Array.isArray(d.ai_log)) {
    errs.push('ai_log 应为列表。')
  } else {
    const seen = new Set<string>()
    d.ai_log.forEach((e, i) => {
      const at = `ai_log[${i}]`
      if (!isObj(e)) return void errs.push(`${at} 不是对象。`)
      if (!isStr(e.id) || e.id === '') errs.push(`${at}.id 缺失。`)
      else if (seen.has(e.id)) errs.push(`${at}.id "${e.id}" 重复。`)
      else seen.add(e.id)
      if (!isStr(e.date) || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) errs.push(`${at}.date 应为 YYYY-MM-DD。`)
      if (!isStr(e.tool) || e.tool === '') errs.push(`${at}.tool（工具名）不能为空。`)
      if (!(PURPOSES as readonly unknown[]).includes(e.purpose)) errs.push(`${at}.purpose 不是有效的用途：${String(e.purpose)}。`)
      if (!(STAGES as readonly unknown[]).includes(e.stage)) errs.push(`${at}.stage 不是有效的环节：${String(e.stage)}。`)
      for (const k of ['version', 'section', 'verification', 'note']) {
        if (!isOptStr(e[k])) errs.push(`${at}.${k} 应为文字或空。`)
      }
    })
  }

  if (!isObj(d.checklists)) {
    errs.push('checklists 应为对象。')
  } else {
    for (const [k, c] of Object.entries(d.checklists)) {
      if (!isObj(c)) errs.push(`checklists.${k} 不是对象。`)
      else {
        if (!isStr(c.spec)) errs.push(`checklists.${k}.spec 缺失。`)
        if (!isObj(c.answers)) errs.push(`checklists.${k}.answers 应为对象。`)
        if (!isTime(c.updated)) errs.push(`checklists.${k}.updated 应为 ISO 时间。`)
      }
    }
  }
  if (d.resume !== undefined && d.resume !== null) errs.push(...validateResume(d.resume))
  return errs
}

const isCount = (v: unknown) => Number.isInteger(v) && (v as number) >= 0

function validateResume(r: unknown): string[] {
  const errs: string[] = []
  if (!isObj(r)) return ['resume 格式不对。']
  const c = r.citation
  if (c !== undefined && c !== null) {
    if (!isObj(c)) errs.push('resume.citation 格式不对。')
    else {
      if (!isStr(c.refsText)) errs.push('resume.citation.refsText 应为文字。')
      if (!isTime(c.at)) errs.push('resume.citation.at 应为 ISO 时间。')
      if (!isCount(c.total)) errs.push('resume.citation.total 应为非负整数。')
      if (!isObj(c.counts)) errs.push('resume.citation.counts 应为对象。')
      else {
        for (const [k, v] of Object.entries(c.counts)) {
          if (!(CHECK_STATUSES as readonly unknown[]).includes(k) || !isCount(v)) errs.push(`resume.citation.counts.${k} 无效。`)
        }
      }
      if (!Array.isArray(c.items)) errs.push('resume.citation.items 应为列表。')
      else {
        c.items.forEach((it, i) => {
          if (!isObj(it) || !isCount(it.index) || !(CHECK_STATUSES as readonly unknown[]).includes(it.status) || !isStr(it.reason)) errs.push(`resume.citation.items[${i}] 格式不对。`)
        })
      }
    }
  }
  const f = r.format
  if (f !== undefined && f !== null) {
    if (!isObj(f)) errs.push('resume.format 格式不对。')
    else {
      if (!isStr(f.filename)) errs.push('resume.format.filename 应为文字。')
      if (!isTime(f.at)) errs.push('resume.format.at 应为 ISO 时间。')
      if (!isOptStr(f.schoolPath) || !isOptStr(f.schoolLabel)) errs.push('resume.format.school 应为文字或空。')
      const n = f.counts
      if (!isObj(n) || !['error', 'warning', 'info', 'passed', 'skipped'].every((k) => isCount(n[k]))) errs.push('resume.format.counts 格式不对。')
    }
  }
  return errs
}
