/**
 * 第二轮 GPT 红队 R1 的 40 条刁钻写法（review/round2/R1-gpt-adversarial-40.jsonl，交叉核对见 R1-crosscheck.md）。
 * 10.9999 开头的 DOI 和对应记录是虚构的，接口响应用 mock 模拟，验证的是解析和判定逻辑。
 *
 * 还没修的条目用 it.fails 标成已知缺陷：修好后这条测试会变红，提醒把它移出清单。不跳过，也不删除。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseReferenceList, surnameOf } from '../src/references/parse'
import { verifyReference } from '../src/references/verify'
import { type MockWork, mockFetcher } from './fixtures/mock-sources'

interface Case {
  id: string
  text: string
  category: string
  expected: { title: string; year: number | null; authors: string[]; docType: string | null; doi: string | null }
}

const CASES: Case[] = readFileSync(new URL('./fixtures/r2-adversarial-40.jsonl', import.meta.url), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l))

/** 伪造出处：真 DOI 配上改过的题名或卷期页码，不能判"已核实" */
const FORGED = new Set(['R2-21', 'R2-33', 'R2-34'])

/** 解析结果和预期还不一致的条目（作者和题名边界，交叉核对"修复顺序"第 4 步，排在 v0.1 之后） */
const PARSE_DEFECTS = new Set([
  'R2-01', // 句点后紧跟数字的题名
  'R2-03', // 中文类型标签 [博士学位论文]
  'R2-04', // IEEE 格式
  'R2-05', // 析出文献的 //
  'R2-06', // [美]……著，……译
  'R2-07', // [清] 朝代
  'R2-08', // 中文数字年份
  'R2-10', // 文号里的年份
  'R2-12', // (Version 2.1) [Data set]
  'R2-13', // 两个 DOI，该取"本预印本"那个
  'R2-14', // 带句点的西文缩写名
  'R2-15', // 机构名里的 and
  'R2-19', // Jr.
  'R2-22', // 机构名以数字开头
  'R2-23', // 题名里的 E[M]
  'R2-24', // Jr 不带逗号
])

/** 核验结论还不对的条目：真实文献被判"信息不符" */
const VERIFY_DEFECTS = new Set(['R2-05', 'R2-13', 'R2-15', 'R2-23'])

const NATURE: MockWork = { doi: '10.1038/nature14539', title: 'Deep learning', year: 2015, family: 'LeCun', authors: ['LeCun', 'Bengio', 'Hinton'], venue: 'Nature', volume: '521', page: '436-444' }
const BRAUN: MockWork = { doi: '10.1191/1478088706qp063oa', title: 'Using thematic analysis in psychology', year: 2006, family: 'Braun', authors: ['Braun', 'Clarke'], venue: 'Qualitative Research in Psychology', volume: '3', page: '77-101' }
const PAGES: Record<string, Pick<MockWork, 'volume' | 'page'>> = { 'R2-04': { page: '15-29' }, 'R2-25': { volume: '12', page: '2021-2030' } }

/** 每条 10.9999 DOI 都在库里有一条真记录 */
const DB: MockWork[] = [
  NATURE,
  BRAUN,
  ...CASES.filter((c) => c.expected.doi?.startsWith('10.9999/')).map((c) => ({
    doi: c.expected.doi!,
    title: c.expected.title,
    year: c.expected.year ?? 2020,
    family: surnameOf(c.expected.authors[0]).replace(/[.,]/g, ''),
    volume: '12',
    page: '15-29',
    ...PAGES[c.id],
  })),
]

const parse = (c: Case) => parseReferenceList(c.text)

describe('R1 第二轮：解析', () => {
  for (const c of CASES) {
    const test = PARSE_DEFECTS.has(c.id) ? it.fails : it
    test(`${c.id} ${c.category}`, () => {
      const refs = parse(c)
      // 第 40 条是两条文献，看第一条
      expect(refs).toHaveLength(c.id === 'R2-40' ? 2 : 1)
      const r = refs[0]
      expect({ title: r.title, year: r.year, authors: r.authors, docType: r.docType, doi: r.doi }).toEqual(c.expected)
    })
  }
})

describe('R1 第二轮：核验结论', () => {
  for (const c of CASES) {
    const test = VERIFY_DEFECTS.has(c.id) ? it.fails : it
    const want = FORGED.has(c.id) ? '不判已核实' : '不判信息不符或查无此文'
    test(`${c.id} ${want}`, async () => {
      const v = await verifyReference(parse(c)[0], { fetcher: mockFetcher(DB) })
      if (FORGED.has(c.id)) expect(v.status, v.reason).not.toBe('verified')
      else expect(['verified', 'manual'], v.reason).toContain(v.status)
    })
  }

  it('写了卷期页码但没读懂时，最多判"需人工核对"', async () => {
    const [ref] = parseReferenceList('[1] LECUN Y, BENGIO Y, HINTON G. Deep learning[J]. Nature, 2015, vol. 99, no. 9. DOI:10.1038/nature14539.')
    expect(ref.doubts).toEqual(['volumePage'])
    const v = await verifyReference(ref, { fetcher: mockFetcher(DB) })
    expect(v.status).toBe('manual')
    expect(v.reason).toContain('卷、期、页码的写法没读懂')
  })

  it('原文没写卷期页码时照常核实', async () => {
    const [ref] = parseReferenceList('[1] LECUN Y, BENGIO Y, HINTON G. Deep learning[J]. Nature, 2015. DOI:10.1038/nature14539.')
    expect(ref.doubts).toBeUndefined()
    expect((await verifyReference(ref, { fetcher: mockFetcher(DB) })).status).toBe('verified')
  })

  it('APA 题名句点后还有一段、又找不到刊名时，最多判"需人工核对"', async () => {
    const [ref] = parseReferenceList('[1] LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Evidence that neural networks never learn. Some Publisher. https://doi.org/10.1038/nature14539.')
    expect(ref.doubts).toEqual(['titleEnd'])
    expect((await verifyReference(ref, { fetcher: mockFetcher(DB) })).status).not.toBe('verified')
  })
})
