import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportDossier, importDossier, libraryFromResults } from '../src/dossier/io'
import { migrate } from '../src/dossier/migrate'
import { DOSSIER_VERSION, emptyDossier, validate } from '../src/dossier/schema'
import { STORAGE_KEY, createStore } from '../src/dossier/store'
import { citationCountsText, citationResume, formatCountsText, formatResume, formatTime, hasResume, importConfirmText, previousSessionLabel, withResume } from '../src/dossier/resume'
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

const stubStorage = (impl: Partial<Storage> | null) => {
  if (impl === null) return void vi.stubGlobal('localStorage', undefined)
  vi.stubGlobal('localStorage', impl)
}
const memStorage = (): Storage => {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  } as unknown as Storage
}

describe('store（localStorage）', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('存了再读回来，清除后没有', async () => {
    stubStorage(memStorage())
    const s = createStore()
    const d = withResume(emptyDossier(NOW), { format: formatResume({ filename: 'a.docx', schoolPath: null, schoolLabel: null, counts: { error: 1, warning: 0, info: 0, passed: 2, skipped: 3 } }, NOW) }, NOW)
    await s.save(d)
    expect(s.persistent).toBe(true)
    expect(await createStore().load()).toEqual(d)
    await s.clear()
    expect(await createStore().load()).toBeNull()
  })

  it('localStorage 不存在：退回内存，persistent=false', async () => {
    stubStorage(null)
    const s = createStore()
    expect(s.persistent).toBe(false)
    expect(await s.load()).toBeNull()
    const d = sample()
    await s.save(d)
    expect(await s.load()).toEqual(d)
    await s.clear()
    expect(await s.load()).toBeNull()
  })

  it('读写全部抛错（隐私模式/存储已满）：不抛出，退回内存', async () => {
    const boom = () => {
      throw new Error('denied')
    }
    stubStorage({ getItem: boom, setItem: boom, removeItem: boom })
    const s = createStore()
    const d = sample()
    await expect(s.save(d)).resolves.toBeUndefined()
    expect(s.persistent).toBe(false)
    expect(await s.load()).toEqual(d)
    await expect(s.clear()).resolves.toBeUndefined()
  })

  it('访问 localStorage 本身就抛错', async () => {
    vi.stubGlobal('localStorage', undefined)
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('SecurityError') } })
    const s = createStore()
    expect(s.persistent).toBe(false)
    await expect(s.save(sample())).resolves.toBeUndefined()
    delete (globalThis as Record<string, unknown>).localStorage
  })

  it('存储里是损坏的内容：当作没有', async () => {
    const m = memStorage()
    m.setItem(STORAGE_KEY, '{不是json')
    stubStorage(m)
    expect(await createStore().load()).toBeNull()
    m.setItem(STORAGE_KEY, JSON.stringify({ format: 'other' }))
    expect(await createStore().load()).toBeNull()
  })
})

describe('继续上次检查', () => {
  const opts = { fetcher: mockFetcher(MOCK_DB) }
  const text = 'LeCun Y, Bengio Y, Hinton G. Deep learning[J]. Nature, 2015, 521: 436-444. DOI:10.1038/nature14539\n张三. 某中文研究[J]. 某学报, 2020, 1(2): 3-4.'
  const run = () => Promise.all(text.split('\n').map((t, i) => verifyReference(parseReference(t, i + 1), opts)))

  it('核验摘要：计数、逐条状态，不含库中记录', async () => {
    const c = citationResume(text, await run(), NOW)
    expect(c.refsText).toBe(text)
    expect(c.total).toBe(2)
    expect(c.counts).toEqual({ verified: 1, manual: 1 })
    expect(c.items.map((i) => i.status)).toEqual(['verified', 'manual'])
    expect(JSON.stringify(c)).not.toContain('match')
    expect(citationCountsText(c)).toBe('共 2 条：需人工核对 1 · 已核实 1')
  })

  it('格式体检只存文件名、学校和统计数字', () => {
    const f = formatResume({ filename: '毕业论文.docx', schoolPath: 'schools/fudan/bachelor-2027.yaml', schoolLabel: '复旦大学', counts: { error: 2, warning: 1, info: 0, passed: 10, skipped: 4 } }, NOW)
    expect(Object.keys(f).sort()).toEqual(['at', 'counts', 'filename', 'schoolLabel', 'schoolPath'])
    const t = formatCountsText(f)
    expect(t).toContain('未检查，需人工确认 4')
    expect(t).toContain('当时通过 10')
  })

  it('检测到的两档合并计数，和结果区口径一致', () => {
    const t = formatCountsText(formatResume({ filename: 'a.docx', schoolPath: null, schoolLabel: null, counts: { error: 0, warning: 7, info: 2, passed: 5, skipped: 3 } }, NOW))
    expect(t).toContain('检测到，请核对 9')
    expect(t).not.toMatch(/建议确认|提示/)
  })

  it('有未检查项时，摘要里一定写出未检查数量', () => {
    const t = formatCountsText(formatResume({ filename: 'a.docx', schoolPath: null, schoolLabel: null, counts: { error: 0, warning: 0, info: 0, passed: 5, skipped: 7 } }, NOW))
    expect(t).toContain('未检查，需人工确认 7')
  })

  it('恢复标签写明是上次会话、带时间、不是本次核验', () => {
    const l = previousSessionLabel(NOW.toISOString())
    expect(l).toMatch(/上次会话/)
    expect(l).toMatch(/不是本次核验/)
    expect(l).toContain(formatTime(NOW.toISOString()))
  })

  it('withResume 不改原对象，且合并另一半', async () => {
    const d0 = emptyDossier(NOW)
    expect(hasResume(d0)).toBe(false)
    const d1 = withResume(d0, { citation: citationResume(text, await run(), NOW) }, NOW)
    const d2 = withResume(d1, { format: formatResume({ filename: 'a.docx', schoolPath: null, schoolLabel: null, counts: { error: 0, warning: 0, info: 0, passed: 0, skipped: 0 } }, NOW) }, NOW)
    expect(d0.resume).toBeUndefined()
    expect(d2.resume?.citation).toBeDefined()
    expect(d2.resume?.format).toBeDefined()
    expect(hasResume(d2)).toBe(true)
    expect(validate(d2)).toEqual([])
  })

  it('导出再导入，resume 完整保留；旧文件没有 resume 也合法', async () => {
    const d = withResume(emptyDossier(NOW), { citation: citationResume(text, await run(), NOW) }, NOW)
    expect(importDossier(exportDossier(d))).toEqual(d)
    expect(importDossier(exportDossier(emptyDossier(NOW))).resume).toBeUndefined()
  })

  it('导入时校验 resume', async () => {
    const d = withResume(emptyDossier(NOW), { citation: citationResume(text, await run(), NOW) }, NOW)
    ;(d.resume!.citation!.items[0] as { status: string }).status = '通过'
    expect(() => importDossier(JSON.stringify(d))).toThrow(/resume/)
    const e = withResume(emptyDossier(NOW), {}, NOW) as Record<string, unknown>
    e.resume = { format: { filename: 1, at: 'x', counts: {} } }
    expect(validate(e)).not.toEqual([])
  })

  it('不含任何"通过"字样来描述未核实的状态', async () => {
    const c = citationResume(text, await run(), NOW)
    expect(citationCountsText(c)).not.toContain('通过')
  })
})

describe('导入前确认', () => {
  const at = new Date('2026-10-01T08:00:00Z')
  const withCitation = () => withResume(emptyDossier(at), { citation: citationResume('[1] X', [], at) }, at)

  it('当前是空档案时不需要确认', () => {
    expect(importConfirmText(emptyDossier(at), withCitation())).toBeNull()
  })

  it('当前有记录时要确认，写明会替换什么；导入文件没有 resume 时说明', () => {
    const t = importConfirmText(withCitation(), emptyDossier(at))!
    expect(t).toContain('整份替换')
    expect(t).toContain('参考文献核验记录')
    expect(t).toContain('没有可恢复的检查记录')
  })

  it('导入文件有 resume 时不提示"没有记录"', () => {
    expect(importConfirmText(withCitation(), withCitation())).not.toContain('没有可恢复')
  })
})
