/**
 * AI 使用声明生成器。
 *
 * 红线：只根据学生自己记录的 ai_log 整理，不替学生编写任何“做了什么”的句子。
 * 警告只是提示，从不阻止生成。
 */

import { PURPOSES, PURPOSE_LABELS, STAGES, STAGE_LABELS } from '../dossier/schema'
import type { AiLogEntry, Dossier, Purpose, Stage } from '../dossier/schema'

/** 学校 ai_policy（对应 schools/schema.json） */
export interface AiPolicy {
  aigc_threshold_percent?: number | null
  detector?: string | null
  allowed?: string[]
  forbidden?: string[]
  disclosure?: string | null
  penalty?: string | null
}

export interface Warning {
  kind: 'forbidden' | 'consent'
  /** 对应的 ai_log 条目 id */
  entryId: string
  /** 命中的政策原文条目 */
  policyItem: string
  message: string
}

export interface DeclarationOptions {
  /** 学生确认“确实没用过 AI”时才生成无使用版本 */
  confirmNone?: boolean
}

export interface Declaration {
  text: string
  markdown: string
  warnings: Warning[]
  missing: string[]
}

export const NONE_SENTENCE = '本人在论文写作过程中未使用生成式人工智能工具。'
export const FOOTER = '本声明根据作者本人记录整理，内容由作者负责。'
const NOT_VERIFIED = 'ohmypaper 没有核实你是否符合学校规定，请以学校原文和导师意见为准。'
const BLANK = '（待补充）'

/** 用途关键词：用途命中则按关键词去匹配政策条目 */
const PURPOSE_KEYWORDS: Partial<Record<Purpose, string[]>> = {
  polish: ['润色'],
  translate: ['翻译'],
  code: ['代码'],
  search: ['检索'],
}
/** 环节关键词（仅用于“禁止项”，且不含检索/解释类用途） */
const STAGE_KEYWORDS: Partial<Record<Stage, string[]>> = {
  writing: ['正文'],
  data: ['数据'],
}
/** 检索、解释本身不产出论文内容，不按环节匹配禁止项 */
const STAGE_EXEMPT: Purpose[] = ['search', 'explain']
/** 允许项里的“需导师同意”提示：用途/环节对应的关键词 */
const ALLOWED_STAGE_KEYWORDS: Partial<Record<Stage, string[]>> = { format: ['格式'] }

const blank = (v: string | null | undefined) => v === undefined || v === null || v.trim() === ''
const val = (v: string | null | undefined) => (blank(v) ? '' : v!.trim())

/** 工具及版本，如 “DeepSeek V3”；版本为空时只写工具名 */
const toolVer = (e: AiLogEntry) => (blank(e.version) ? e.tool.trim() : `${e.tool.trim()} ${val(e.version)}`)
const where = (e: AiLogEntry) => [STAGE_LABELS[e.stage], val(e.section)].filter(Boolean).join(' / ')
const who = (e: AiLogEntry) => `${e.date} ${e.tool.trim()}`

/** 按用途、环节、日期排序（稳定） */
function sorted(log: AiLogEntry[]): AiLogEntry[] {
  const key = (e: AiLogEntry) => PURPOSES.indexOf(e.purpose) * 100 + STAGES.indexOf(e.stage)
  return log.map((e, i) => ({ e, i })).sort((a, b) => key(a.e) - key(b.e) || a.e.date.localeCompare(b.e.date) || a.i - b.i).map((x) => x.e)
}

function keywordsFor(e: AiLogEntry, forbidden: boolean): string[] {
  const ks = [...(PURPOSE_KEYWORDS[e.purpose] ?? [])]
  if (forbidden && !STAGE_EXEMPT.includes(e.purpose)) ks.push(...(STAGE_KEYWORDS[e.stage] ?? []))
  if (!forbidden) ks.push(...(ALLOWED_STAGE_KEYWORDS[e.stage] ?? []))
  return ks
}

function findMissing(log: AiLogEntry[], policy: AiPolicy | null): string[] {
  const out: string[] = []
  // 指南第七条：工具、版本、用途、环节、核实；学校披露要求“位置”时另查章节
  const wantsPlace = !!policy?.disclosure && /位置|章节/.test(policy.disclosure)
  for (const e of sorted(log)) {
    if (blank(e.version)) out.push(`${who(e)}：还没填工具版本。`)
    if (blank(e.verification)) out.push(`${who(e)}：还没填你是怎么核实 AI 输出的。`)
    if (wantsPlace && blank(e.section)) out.push(`${who(e)}：本校披露要求写明输出内容在论文中的位置，还没填章节。`)
  }
  return out
}

function findWarnings(log: AiLogEntry[], policy: AiPolicy | null): Warning[] {
  if (!policy) return []
  const out: Warning[] = []
  for (const e of sorted(log)) {
    const act = PURPOSE_LABELS[e.purpose]
    for (const item of policy.forbidden ?? []) {
      if (!keywordsFor(e, true).some((k) => item.includes(k))) continue
      out.push({
        kind: 'forbidden',
        entryId: e.id,
        policyItem: item,
        message: `你在 ${e.date} 用 ${e.tool.trim()} 做了${act}，本校规定将『${item}』列为禁止项，请先和导师确认。`,
      })
    }
    for (const item of policy.allowed ?? []) {
      if (!/导师|指导教师/.test(item) || !/同意|批准|许可/.test(item)) continue
      if (!keywordsFor(e, false).some((k) => item.includes(k))) continue
      out.push({
        kind: 'consent',
        entryId: e.id,
        policyItem: item,
        message: `你在 ${e.date} 用 ${e.tool.trim()} 做了${act}，本校允许项『${item}』提到需要导师同意，请确认已取得。`,
      })
    }
  }
  return out
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')

function buildText(log: AiLogEntry[]): string {
  const lines = ['AI 使用声明', '', '本人在论文写作过程中使用生成式人工智能工具的情况如下：', '']
  let n = 0
  for (const p of PURPOSES) {
    const rows = sorted(log).filter((e) => e.purpose === p)
    if (!rows.length) continue
    lines.push(`【${PURPOSE_LABELS[p]}】`)
    for (const e of rows) {
      n++
      lines.push(`${n}. ${e.date}，${toolVer(e)}；环节/章节：${where(e)}；本人如何核实：${val(e.verification) || BLANK}。`)
      if (!blank(e.note)) lines.push(`   备注：${val(e.note)}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

function buildMarkdown(log: AiLogEntry[]): string {
  const lines = ['## AI 使用声明', '', '本人在论文写作过程中使用生成式人工智能工具的情况如下：', '']
  lines.push('| 日期 | 工具及版本 | 用途 | 环节/章节 | 本人如何核实 |', '| --- | --- | --- | --- | --- |')
  for (const e of sorted(log)) {
    lines.push(`| ${e.date} | ${cell(toolVer(e))} | ${PURPOSE_LABELS[e.purpose]} | ${cell(where(e))} | ${cell(val(e.verification) || BLANK)} |`)
  }
  lines.push('')
  return lines.join('\n')
}

export function generateDeclaration(dossier: Dossier, policy: AiPolicy | null, opts: DeclarationOptions = {}): Declaration {
  const log = dossier.ai_log
  if (log.length === 0 && opts.confirmNone !== true) {
    return { text: '', markdown: '', warnings: [], missing: ['还没有 AI 使用记录'] }
  }

  let text: string
  let md: string
  if (log.length === 0) {
    text = `AI 使用声明\n\n${NONE_SENTENCE}\n`
    md = `## AI 使用声明\n\n${NONE_SENTENCE}\n`
  } else {
    text = buildText(log)
    md = buildMarkdown(log)
  }

  text += `\n${FOOTER}\n`
  md += `\n${FOOTER}\n`

  // 学校原文：放在声明正文之外，粘贴前应删除
  if (policy?.disclosure) {
    text += `\n----（以下为提示，不属于声明正文，粘贴前请删除）----\n本校披露要求（原文）：\n${policy.disclosure}\n${NOT_VERIFIED}\n`
    md += `\n---\n\n### 本校披露要求（原文）\n\n> ${policy.disclosure.replace(/\n/g, '\n> ')}\n\n${NOT_VERIFIED}\n`
  }

  return { text, markdown: md, warnings: findWarnings(log, policy), missing: findMissing(log, policy) }
}
