import { describe, expect, it } from 'vitest'
import { parseReference } from '../src/references/parse'
import { verifyAll } from '../src/references/verify'
import { REAL_WORKS, buildBenchmark } from './fixtures/benchmark'
import { mockFetcher } from './fixtures/mock-sources'

describe('M1 验收：50 条混合参考文献', () => {
  const cases = buildBenchmark()

  it('共 50 条', () => {
    expect(cases).toHaveLength(50)
  })

  it('每一条都分类正确', async () => {
    const refs = cases.map((c, i) => parseReference(c.text, i + 1))
    const results = await verifyAll(refs, { fetcher: mockFetcher(REAL_WORKS), concurrency: 4 })
    const wrong = results
      .map((r, i) => ({ kind: cases[i].kind, text: cases[i].text, expected: cases[i].expected, got: r.status, reason: r.reason }))
      .filter((x) => x.expected !== x.got)
    expect(wrong).toEqual([])
  })
})
