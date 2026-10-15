import { describe, expect, it } from 'vitest'
import { parseReference } from '../src/references/parse'
import { toCsv, toTextReport } from '../src/references/report'
import { verifyAll } from '../src/references/verify'
import { MOCK_DB, mockFetcher } from './fixtures/mock-sources'

async function sample() {
  const refs = [
    'SMITH J. Fake, "quoted" title[J]. Nature, 2021. DOI:10.1038/fake-0000.',
    'LECUN Y. Deep learning[J]. Nature, 2015. DOI:10.1038/nature14539.',
  ].map((t, i) => parseReference(t, i + 1))
  return verifyAll(refs, { fetcher: mockFetcher(MOCK_DB) })
}

describe('导出报告', () => {
  it('文本报告含汇总和逐条结果，按序号排列', async () => {
    const text = toTextReport(await sample(), new Date('2026-10-11T08:00:00Z'))
    expect(text).toContain('共 2 条：查无此文 1，已核实 1')
    expect(text.indexOf('[1]')).toBeLessThan(text.indexOf('[2]'))
    expect(text).toContain('需人工核对')
    expect(text).toContain('查询失败')
    expect(text).toContain('都不算通过')
  })

  it('CSV 带 BOM，正确转义逗号和引号', async () => {
    const csv = toCsv(await sample())
    const lines = csv.split('\r\n')
    expect(lines[0].startsWith('﻿说明：')).toBe(true)
    expect(lines[0]).toContain('需人工核对')
    expect(lines[0]).toContain('查询失败')
    expect(lines[0]).toContain('不算通过')
    expect(lines[1].startsWith('序号,结果')).toBe(true)
    expect(csv).toContain('"SMITH J. Fake, ""quoted"" title[J]. Nature, 2021. DOI:10.1038/fake-0000."')
    expect(csv.split('\r\n')).toHaveLength(4)
  })
})
