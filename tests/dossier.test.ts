import { describe, expect, it } from 'vitest'
import { exportDossier, importDossier, libraryFromResults } from '../src/dossier/io'
import { migrate } from '../src/dossier/migrate'
import { DOSSIER_VERSION, emptyDossier, validate } from '../src/dossier/schema'
import { createStore, needsBackupReminder } from '../src/dossier/store'
import { parseReference } from '../src/references/parse'
import { verifyReference } from '../src/references/verify'
import { MOCK_DB, mockFetcher } from './fixtures/mock-sources'

const NOW = new Date('2026-11-01T00:00:00Z')

function sample() {
  const d = emptyDossier(NOW)
  d.profile.school = 'fudan'
  d.profile.cohort = 2027
  d.ai_log.push({ id: 'a1', date: '2026-11-03', tool: 'DeepSeek', version: 'V3.2', purpose: 'polish', stage: 'writing', section: '第二章 2.1', verification: '逐句对照', note: null })
  d.checklists['topic-feasibility'] = { spec: 'topic-feasibility@0', answers: { q1: true }, updated: NOW.toISOString() }
  return d
}

describe('导入导出', () => {
  it('导出再导入，内容一致', () => {
    const d = sample()
    expect(importDossier(exportDossier(d))).toEqual(d)
  })

  it('空档案通过校验', () => {
    expect(validate(emptyDossier())).toEqual([])
  })

  it('保留不认识的字段', () => {
    const d = { ...sample(), advisor: { notes: [1] }, future: 'x' } as Record<string, unknown>
    ;(d.profile as Record<string, unknown>).extra = 42
    const back = importDossier(JSON.stringify(d)) as unknown as Record<string, unknown>
    expect(back.advisor).toEqual({ notes: [1] })
    expect(back.future).toBe('x')
    expect((back.profile as Record<string, unknown>).extra).toBe(42)
    expect(JSON.parse(exportDossier(back as never))).toEqual(d)
  })

  it('拒绝错误的 format', () => {
    expect(() => migrate({ format: 'other', version: 0 })).toThrow(/不是论文档案/)
    expect(() => importDossier('[]')).toThrow(/不是论文档案/)
  })

  it('拒绝更高的版本', () => {
    expect(() => migrate({ ...sample(), version: DOSSIER_VERSION + 1 })).toThrow(/更新的版本/)
  })

  it('拒绝不是 JSON 的文件', () => {
    expect(() => importDossier('hello')).toThrow(/JSON/)
  })

  it('导入时校验内容', () => {
    const d = sample()
    ;(d.ai_log[0] as { purpose: string }).purpose = 'cheat'
    expect(() => importDossier(JSON.stringify(d))).toThrow(/purpose/)
  })
})

describe('validate', () => {
  it('发现非法枚举', () => {
    const d = sample()
    ;(d.ai_log[0] as { purpose: string }).purpose = 'x'
    ;(d.ai_log[0] as { stage: string }).stage = 'y'
    d.library.push({ id: 'r1', csl: {}, check: { status: 'bogus' as never, at: 'bad', source: 'google' as never } })
    const errs = validate(d)
    expect(errs.some((e) => e.includes('ai_log[0].purpose'))).toBe(true)
    expect(errs.some((e) => e.includes('ai_log[0].stage'))).toBe(true)
    expect(errs.some((e) => e.includes('check.status'))).toBe(true)
    expect(errs.some((e) => e.includes('check.source'))).toBe(true)
  })

  it('发现重复 ID 和缺失日期', () => {
    const d = sample()
    d.ai_log.push({ ...d.ai_log[0], date: '昨天' })
    const errs = validate(d)
    expect(errs.some((e) => e.includes('重复'))).toBe(true)
    expect(errs.some((e) => e.includes('date'))).toBe(true)
  })
})

describe('libraryFromResults', () => {
  const opts = { fetcher: mockFetcher(MOCK_DB) }
  const texts = [
    'LeCun Y, Bengio Y, Hinton G. Deep learning[J]. Nature, 2015, 521: 436-444. DOI:10.1038/nature14539',
    '张三. 某中文研究[J]. 某学报, 2020, 1(2): 3-4.',
  ]
  const run = () => Promise.all(texts.map((t, i) => verifyReference(parseReference(t, i + 1), opts)))

  it('转成 CSL 条目并保留原文和核验状态', async () => {
    const lib = libraryFromResults(await run(), [], NOW)
    expect(lib).toHaveLength(2)
    expect(lib[0].csl.type).toBe('article-journal')
    expect(lib[0].csl.DOI).toBe('10.1038/nature14539')
    expect(lib[0].csl.issued).toEqual({ 'date-parts': [[2015]] })
    expect(lib[0].raw).toContain('Deep learning')
    expect(lib[0].check?.at).toBe(NOW.toISOString())
    expect(lib[1].check?.status).toBe('manual')
    expect(lib.map((e) => e.id)).toEqual(['r1', 'r2'])
  })

  it('重复核验不产生重复条目，并保留原 ID 和额外字段', async () => {
    const results = await run()
    const first = libraryFromResults(results, [], NOW)
    ;(first[0] as Record<string, unknown>).tag = 'keep'
    const later = new Date('2026-12-01T00:00:00Z')
    const again = libraryFromResults(results, first, later)
    expect(again).toHaveLength(2)
    expect(again[0].id).toBe('r1')
    expect((again[0] as Record<string, unknown>).tag).toBe('keep')
    expect(again[0].check?.at).toBe(later.toISOString())
    expect(first[0].check?.at).toBe(NOW.toISOString())
  })

  it('信息不符时不拿库里的记录冒充学生的条目', async () => {
    // DOI 借自 Deep learning，条目里没有这个标题
    const r = await verifyReference(parseReference('WANG X — Invisible libraries — 2015 — DOI:10.1038/nature14539', 1), opts)
    expect(r.status).toBe('mismatch')
    const [e] = libraryFromResults([r], [], NOW)
    expect(e.csl.title).toBeUndefined()
    expect(e.check?.status).toBe('mismatch')
  })

  it('没有 DOI 时按归一化原文匹配', async () => {
    const results = await run()
    const lib = libraryFromResults(results, [], NOW)
    const spaced = results.map((r) => ({ ...r, ref: { ...r.ref, raw: r.ref.raw.toUpperCase().replace(/ /g, '  ') } }))
    expect(libraryFromResults(spaced, lib, NOW)).toHaveLength(2)
  })
})

describe('store', () => {
  it('没有 indexedDB 时退回内存', async () => {
    expect(typeof indexedDB).toBe('undefined')
    const s = createStore()
    expect(s.persistent).toBe(false)
    expect(await s.load()).toBeNull()
    const d = sample()
    await s.save(d)
    expect(await s.load()).toEqual(d)
    await s.clear()
    expect(await s.load()).toBeNull()
  })
})

describe('needsBackupReminder', () => {
  const day = 86400_000
  it('空档案不提醒', () => {
    expect(needsBackupReminder(emptyDossier(NOW), null, NOW)).toBe(false)
    expect(needsBackupReminder(null, null, NOW)).toBe(false)
  })
  it('有内容且从没导出过：提醒', () => {
    expect(needsBackupReminder(sample(), null, NOW)).toBe(true)
  })
  it('14 天内不提醒，超过提醒', () => {
    expect(needsBackupReminder(sample(), new Date(NOW.getTime() - 14 * day), NOW)).toBe(false)
    expect(needsBackupReminder(sample(), new Date(NOW.getTime() - 15 * day), NOW)).toBe(true)
  })
})
