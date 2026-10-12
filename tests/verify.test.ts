import { describe, expect, it } from 'vitest'
import { parseReference } from '../src/references/parse'
import { titleSimilarity } from '../src/references/similarity'
import type { Fetcher } from '../src/references/sources'
import { verifyAll, verifyReference } from '../src/references/verify'
import { MOCK_DB, mockFetcher } from './fixtures/mock-sources'

const opts = { fetcher: mockFetcher(MOCK_DB) }
const v = (text: string) => verifyReference(parseReference(text, 1), opts)

describe('titleSimilarity', () => {
  it('忽略大小写、标点和 HTML 标签', () => {
    expect(titleSimilarity('Deep Learning', 'deep learning.')).toBe(1)
    expect(titleSimilarity('<i>Deep</i> learning', 'Deep learning')).toBe(1)
  })
  it('不同标题得分低', () => {
    expect(titleSimilarity('Deep learning', 'Protein structure prediction')).toBeLessThan(0.3)
  })
})

describe('verifyReference', () => {
  it('DOI 有效且标题一致：已核实', async () => {
    const r = await v('LECUN Y, BENGIO Y, HINTON G. Deep learning[J]. Nature, 2015, 521(7553): 436-444. DOI:10.1038/nature14539.')
    expect(r.status).toBe('verified')
  })

  it('DOI 不存在：查无此文', async () => {
    const r = await v('SMITH J. Fabricated study of things[J]. Nature, 2021. DOI:10.1038/fake-0000.')
    expect(r.status).toBe('not_found')
    expect(r.reason).toContain('10.1038/fake-0000')
  })

  it('DOI 存在但指向另一篇：信息不符（典型 AI 幻觉）', async () => {
    const r = await v('WANG L. Large language models in thesis writing[J]. Nature, 2015. DOI:10.1038/nature14539.')
    expect(r.status).toBe('mismatch')
    expect(r.reason).toContain('Deep learning')
  })

  it('无 DOI，检索到同名文献：已核实', async () => {
    const r = await v('VASWANI A, SHAZEER N, PARMAR N, et al. Attention is all you need[C]. NeurIPS, 2017.')
    expect(r.status).toBe('verified')
    expect(r.match?.doi).toBe('10.48550/arxiv.1706.03762')
  })

  it('同名但年份差太多：信息不符', async () => {
    const r = await v('VASWANI A. Attention is all you need[C]. NeurIPS, 2010.')
    expect(r.status).toBe('mismatch')
    expect(r.reason).toContain('年份')
  })

  it('标题近似但不一致：信息不符', async () => {
    const r = await v('VASWANI A. Attention is what you need[C]. NeurIPS, 2017.')
    expect(r.status).toBe('mismatch')
  })

  it('检索不到任何相近记录：查无此文', async () => {
    const r = await v('DOE J. Quantum hermeneutics of medieval tax ledgers[J]. Imaginary Review, 2022, 4(2): 1-9.')
    expect(r.status).toBe('not_found')
  })

  it('中文无 DOI：需人工核对，并给出知网链接', async () => {
    const r = await v('张三. 生成式人工智能对高等教育的影响研究[J]. 中国高教研究, 2024(3): 12-19.')
    expect(r.status).toBe('manual')
    expect(r.links.map((l) => l.label)).toContain('知网')
  })

  it('中文带 DOI 但 Crossref 没有：需人工核对，而不是判假', async () => {
    const r = await v('李四. 某研究[J]. 某学报, 2023. DOI:10.13718/j.cnki.xxxx.2023.01.001.')
    expect(r.status).toBe('manual')
  })

  it('英文论文的 DOI 由知网注册：需人工核对，不说是虚构', async () => {
    const r = await v('ZHANG W, LI Q. Partial discharge detection in high voltage cables[J]. High Voltage Engineering, 2016, 42(3): 1-8. DOI:10.13336/j.1003-6520.hve.20160308001.')
    expect(r.status).toBe('manual')
    expect(r.reason).toContain('知网')
    expect(r.reason).not.toContain('虚构')
    expect(r.links[0].url).toBe('https://doi.org/10.13336/j.1003-6520.hve.20160308001')
  })

  it('日本 JaLC 注册的 DOI：需人工核对', async () => {
    const r = await v('YAMADA T. A study of rice genome evolution[J]. Proc Jpn Acad Ser B, 2020, 96: 1-10. DOI:10.2183/pjab.96.001.')
    expect(r.status).toBe('manual')
    expect(r.reason).toContain('JaLC')
  })

  it('注册机构查询失败：不下"不存在"的结论', async () => {
    const base = mockFetcher(MOCK_DB)
    const fetcher: Fetcher = async (url) => (url.startsWith('https://doi.org/ra/') ? Promise.reject(new TypeError('Failed to fetch')) : base(url))
    const r = await verifyReference(parseReference('SMITH J. Fabricated study of things[J]. Nature, 2021. DOI:10.1038/fake-0000.', 1), { fetcher })
    expect(r.status).toBe('manual')
    expect(r.reason).not.toContain('不存在')
    expect(r.reason).not.toContain('虚构')
  })

  it('中文条目的 DOI 在 doi.org 也不存在：信息不符', async () => {
    const r = await v('王五. 某研究[J]. 某学报, 2023. DOI:10.99999/j.cnki.fake.2023.01.001.')
    expect(r.status).toBe('mismatch')
    expect(r.reason).toContain('不存在')
  })

  it('标题检索先查 Crossref，命中就不再消耗 OpenAlex 额度', async () => {
    const seen: string[] = []
    const base = mockFetcher(MOCK_DB)
    const fetcher: Fetcher = async (url) => {
      seen.push(new URL(url).hostname)
      return base(url)
    }
    const r = await verifyReference(parseReference('VASWANI A, SHAZEER N, PARMAR N, et al. Attention is all you need[C]. NeurIPS, 2017.', 1), { fetcher })
    expect(r.status).toBe('verified')
    expect(seen).not.toContain('api.openalex.org')
  })

  it('解析不出标题：需人工核对', async () => {
    const r = await v('Some unstructured note without structure')
    expect(r.status).toBe('manual')
  })

  it('接口全部出错：error，不误判', async () => {
    const failing: Fetcher = async () => new Response('', { status: 503 })
    const r = await verifyReference(parseReference('A B. Some title[J]. J, 2020.', 1), { fetcher: failing })
    expect(r.status).toBe('error')
  })
})

describe('verifyAll', () => {
  it('保持原有顺序并报告进度', async () => {
    const refs = [
      'LECUN Y. Deep learning[J]. Nature, 2015. DOI:10.1038/nature14539.',
      '张三. 中文文献[J]. 期刊, 2020.',
      'SMITH J. Fake[J]. Nature, 2021. DOI:10.1038/fake-0000.',
    ].map((t, i) => parseReference(t, i + 1))
    const seen: number[] = []
    const out = await verifyAll(refs, { ...opts, concurrency: 2, onProgress: (n) => seen.push(n) })
    expect(out.map((r) => r.status)).toEqual(['verified', 'manual', 'not_found'])
    expect(seen).toEqual([1, 2, 3])
  })
})
