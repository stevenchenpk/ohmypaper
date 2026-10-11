/**
 * GPT Pro 红队审查（2026-10-11，基线 1b8ffac）构造的 15 条对抗用例。
 * 原件：/mnt/project-files/research/07-g2-adversarial/。
 *
 * 前 8 条是真实文献，旧版误判为"查无此文"；后 7 条是借用真 DOI 或真标题的伪造条目，
 * 旧版误判为"已核实"。接口响应是模拟的，验证的是判定逻辑，不代表线上准确率。
 * 伪造条目仅供测试，不影射真实作者。
 */
import { describe, expect, it } from 'vitest'
import { parseReferenceList } from '../src/references/parse'
import { type VerifyStatus, verifyReference } from '../src/references/verify'
import type { Fetcher } from '../src/references/sources'
import { type MockWork, mockFetcher } from './fixtures/mock-sources'

const DB: MockWork[] = [
  { doi: '10.48550/arxiv.1706.03762', title: 'Attention Is All You Need', year: 2017, family: 'Vaswani', authors: ['Vaswani', 'Shazeer', 'Parmar'], type: 'posted-content' },
  { doi: '10.1191/1478088706qp063oa', title: 'Using thematic analysis in psychology', year: 2006, family: 'Braun', authors: ['Braun', 'Clarke'], venue: 'Qualitative Research in Psychology', volume: '3', page: '77-101' },
  { doi: null, title: 'Mrs. Dalloway', year: 1925, family: 'Woolf', type: 'book' },
  { doi: '10.1002/(sici)1097-4571(199106)42:5<361::aid-asi6>3.0.co;2-#', title: "Inside the search process: Information seeking from the user's perspective", year: 1991, family: 'Kuhlthau', venue: 'Journal of the American Society for Information Science', volume: '42', page: '361-371' },
  { doi: '10.1038/nature14539', title: 'Deep learning', year: 2015, family: 'LeCun', authors: ['LeCun', 'Bengio', 'Hinton'], venue: 'Nature', volume: '521', page: '436-444' },
  { doi: null, title: '乡土中国', year: 1985, family: '费孝通', type: 'book' },
  { doi: '10.1073/pnas.1804840115', title: 'Exposure to opposing views on social media can increase political polarization', year: 2018, family: 'Bail', authors: ['Bail', 'Argyle', 'Brown'], venue: 'Proceedings of the National Academy of Sciences', volume: '115', page: '9216-9221' },
  { doi: '10.1016/0749-5978(91)90020-t', title: 'The theory of planned behavior', year: 1991, family: 'Ajzen', venue: 'Organizational Behavior and Human Decision Processes', volume: '50', page: '179-211' },
]

/** 第 6 条的故障注入：Crossref 没有候选，OpenAlex 返回 401 */
const partialOutage: Fetcher = async (input) => {
  const url = new URL(input)
  if (url.hostname === 'api.openalex.org') return new Response('Unauthorized', { status: 401 })
  return new Response(JSON.stringify({ message: { items: [] } }), { status: 200 })
}

interface Case {
  id: number
  text: string
  expected: VerifyStatus
  /** 理由里必须出现的关键词，确认是因为对的原因被拦下 */
  because?: string
  fetcher?: Fetcher
}

const REAL: Case[] = [
  { id: 1, text: '[1] VASWANI A, SHAZEER N, PARMAR N, et al. Attention Is All You Need[EB/OL]. arXiv, 2017. DOI:10.48550/arXiv.1706.03762.', expected: 'verified' },
  { id: 2, text: '[2] Braun, V., & Clarke, V. (2006). Using thematic analysis in psychology. Qualitative Research in Psychology, 3(2), 77–101.', expected: 'verified' },
  { id: 3, text: '[3] WOOLF V. Mrs. Dalloway. London: Hogarth Press, 1925.', expected: 'verified' },
  { id: 4, text: "[4] KUHLTHAU C C. Inside the search process: Information seeking from the user's perspective[J]. Journal of the American Society for Information Science, 1991, 42(5): 361–371. DOI:10.1002/(SICI)1097-4571(199106)42:5<361::AID-ASI6>3.0.CO;2-#.", expected: 'verified' },
  { id: 5, text: '[5] BRAUN V, CLARKE V. Using thematic analysis in psychology[J]. Qualitative Research in Psychology, 2006, 3(2): 77–101. DOI:10.1191/1478088706qp0630a.', expected: 'mismatch', because: '10.1191/1478088706qp063oa' },
  { id: 6, text: '[6] UNESCO. Guidance for generative AI in education and research[R]. Paris: UNESCO, 2023.', expected: 'error', fetcher: partialOutage },
  { id: 7, text: '[7] LECUN Y, BENGIO Y, HINTON G. Deep learning[J]. Nature, 2015, 521(7553): 436–444. DOI:10.1038/nature\n14539.', expected: 'verified' },
  { id: 8, text: '[8] FEI X T. Xiangtu Zhongguo[M]. Beijing: Sanlian Shudian, 1985.', expected: 'manual' },
]

const FORGED: Case[] = [
  { id: 9, text: '[9] WANG X. Using thematic analysis in psychology[J]. Qualitative Research in Psychology, 2006, 3(2): 77–101. DOI:10.1191/1478088706qp063oa.', expected: 'mismatch', because: '作者不符' },
  { id: 10, text: '[10] BRAUN V, CLARKE V. Using thematic analysis in psychology[J]. Journal of Fabricated Evidence, 2006, 99(9): 900–999. DOI:10.1191/1478088706qp063oa.', expected: 'mismatch', because: '卷号不符' },
  { id: 11, text: '[11] LECUN Y, BENGIO Y, HINTON G. Deep learning[M]. London: Fabricated Academic Press, 2016. DOI:10.1038/nature14539.', expected: 'mismatch', because: '文献类型不符' },
  { id: 12, text: '[12] BAIL C A, ARGYLE L P, BROWN T W, et al. Exposure to opposing views on social media cannot increase political polarization[J]. Proceedings of the National Academy of Sciences, 2018, 115(37): 9216–9221. DOI:10.1073/pnas.1804840115.', expected: 'mismatch', because: '意思相反' },
  { id: 13, text: '[13] WANG X — Invisible libraries in the age of AI — Journal of Fabricated Evidence — 2015 — DOI:10.1038/nature14539', expected: 'mismatch', because: '借用' },
  { id: 14, text: '[14] AJZEN I. The theory of planned behavior[D]. Oxford: University of Oxford, 1991. DOI:10.1016/0749-5978(91)90020-T.', expected: 'mismatch', because: '文献类型不符' },
  { id: 15, text: '[15] LI M. Deep learning[J]. Journal of Fabricated Evidence, 2015, 8(2): 1–9.', expected: 'mismatch', because: '作者不符' },
]

async function run(c: Case) {
  const refs = parseReferenceList(c.text)
  expect(refs).toHaveLength(1)
  return verifyReference(refs[0], { fetcher: c.fetcher ?? mockFetcher(DB) })
}

describe('红队用例：真实文献不能被判为"查无此文"', () => {
  for (const c of REAL) {
    it(`第 ${c.id} 条 → ${c.expected}`, async () => {
      const r = await run(c)
      expect(r.status, r.reason).toBe(c.expected)
      if (c.because) expect(r.reason).toContain(c.because)
    })
  }
})

describe('红队用例：借用真 DOI 或真标题的伪造条目不能被判为"已核实"', () => {
  for (const c of FORGED) {
    it(`第 ${c.id} 条 → ${c.expected}`, async () => {
      const r = await run(c)
      expect(r.status, r.reason).toBe(c.expected)
      if (c.because) expect(r.reason).toContain(c.because)
    })
  }
})

describe('切分', () => {
  it('同一条文献断成三行（只有第一行带序号）时仍是一条', () => {
    const refs = parseReferenceList(
      '[1] AJZEN I. The theory of planned behavior[J].\nOrganizational Behavior and Human Decision Processes,\n1991, 50(2): 179–211.',
    )
    expect(refs).toHaveLength(1)
    expect(refs[0].volume).toBe('50')
    expect(refs[0].firstPage).toBe('179')
  })

  it('没有序号时，断行的续行也并回上一条', () => {
    const refs = parseReferenceList(
      'AJZEN I. The theory of planned behavior[J].\nOrganizational Behavior and Human Decision Processes,\n1991, 50(2): 179–211.\nLECUN Y. Deep learning[J]. Nature, 2015, 521: 436-444.',
    )
    expect(refs).toHaveLength(2)
  })

  it('DOI 在行尾结束时，下一条作者名不会被拼进 DOI', () => {
    const refs = parseReferenceList('LECUN Y. Deep learning[J]. Nature, 2015. DOI:10.1038/nature14539\nSMITH J. Another[J]. Journal, 2020.')
    expect(refs).toHaveLength(2)
    expect(refs[0].doi).toBe('10.1038/nature14539')
  })
})

describe('没比对上的项不算通过', () => {
  it('无 DOI、只有标题撞上、记录里没有作者：需人工核对，不判已核实', async () => {
    const db: MockWork[] = [{ doi: null, title: 'Guidance for generative AI in education and research', year: 2023, family: 'X', authors: [], type: 'report' }]
    const [ref] = parseReferenceList('[1] UNESCO. Guidance for generative AI in education and research[R]. Paris: UNESCO, 2023.')
    const r = await verifyReference(ref, { fetcher: mockFetcher(db) })
    expect(r.status).toBe('manual')
    expect(r.reason).toContain('没法比对作者')
  })

  it('已核实的说明如实列出核对过的项', async () => {
    const [ref] = parseReferenceList('[1] LECUN Y, BENGIO Y, HINTON G. Deep learning[J]. Nature, 2015, 521(7553): 436–444. DOI:10.1038/nature14539.')
    const r = await verifyReference(ref, { fetcher: mockFetcher(DB) })
    expect(r.status).toBe('verified')
    expect(r.reason).toContain('DOI、标题、作者、年份、卷期页码')
  })
})

describe('接口额度', () => {
  it('OpenAlex 返回 429 时说明是额度用完，不判查无此文', async () => {
    const limited: Fetcher = async (input) => {
      const url = new URL(input)
      if (url.hostname === 'api.openalex.org') return new Response('Too Many Requests', { status: 429 })
      return new Response(JSON.stringify({ message: { items: [] } }), { status: 200 })
    }
    const [ref] = parseReferenceList('[1] DOE J. A study that may not exist[J]. Journal, 2020, 1(1): 1-2.')
    const r = await verifyReference(ref, { fetcher: limited })
    expect(r.status).toBe('error')
    expect(r.reason).toContain('额度')
  })
})
