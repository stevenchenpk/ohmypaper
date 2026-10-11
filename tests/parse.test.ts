import { describe, expect, it } from 'vitest'
import { extractDoi, isMostlyChinese, parseReference, parseReferenceList, splitReferenceList } from '../src/references/parse'

describe('parseReference', () => {
  it('解析英文期刊文献（GB/T 7714 格式，带 DOI）', () => {
    const r = parseReference(
      '[1] LECUN Y, BENGIO Y, HINTON G. Deep learning[J]. Nature, 2015, 521(7553): 436-444. DOI:10.1038/nature14539.',
      0,
    )
    expect(r.index).toBe(1)
    expect(r.authors).toEqual(['LECUN Y', 'BENGIO Y', 'HINTON G'])
    expect(r.title).toBe('Deep learning')
    expect(r.year).toBe(2015)
    expect(r.doi).toBe('10.1038/nature14539')
    expect(r.docType).toBe('J')
    expect(r.isChinese).toBe(false)
  })

  it('解析中文期刊文献', () => {
    const r = parseReference('[2] 张三, 李四. 生成式人工智能对高等教育的影响研究[J]. 中国高教研究, 2024(3): 12-19.', 0)
    expect(r.authors).toEqual(['张三', '李四'])
    expect(r.title).toBe('生成式人工智能对高等教育的影响研究')
    expect(r.year).toBe(2024)
    expect(r.doi).toBeNull()
    expect(r.isChinese).toBe(true)
  })

  it('解析中文学位论文和电子资源类型', () => {
    expect(parseReference('[3] 王五. 某某问题研究[D]. 北京: 北京大学, 2020.', 0).docType).toBe('D')
    expect(parseReference('[4] 教育部. 某通知[EB/OL]. (2025-03-01)[2026-10-01]. http://www.moe.gov.cn/x.html.', 0).docType).toBe('EB')
  })

  it('年份不会误取 DOI 或网址里的数字', () => {
    const r = parseReference('SMITH J. A title[J]. Journal, 2019, 3(1): 1-2. DOI:10.2021/abcd.2020.1.', 0)
    expect(r.year).toBe(2019)
  })

  it('没有类型标识时退化为"作者. 题名. 其余"', () => {
    const r = parseReference('Vaswani A, Shazeer N. Attention is all you need. NeurIPS, 2017.', 7)
    expect(r.index).toBe(7)
    expect(r.title).toBe('Attention is all you need')
  })
})

describe('extractDoi / isMostlyChinese', () => {
  it('去掉 DOI 尾随标点并转小写', () => {
    expect(extractDoi('doi: 10.1145/3442188.3445922.')).toBe('10.1145/3442188.3445922')
    expect(extractDoi('https://doi.org/10.1038/NATURE14539')).toBe('10.1038/nature14539')
    expect(extractDoi('没有 DOI')).toBeNull()
  })

  it('按中文字符占比判断', () => {
    expect(isMostlyChinese('张三. 研究[J]. 期刊, 2020.')).toBe(true)
    expect(isMostlyChinese('Smith J. Study[J]. Journal, 2020.')).toBe(false)
  })
})

describe('splitReferenceList', () => {
  it('按序号切分，并把续行并入上一条', () => {
    const text = `[1] 张三. 第一篇[J]. 期刊, 2020.
[2] SMITH J. A very long title that
continues on the next line[J]. Journal, 2021.

[3] 王五. 第三篇[M]. 北京: 出版社, 2019.`
    const entries = splitReferenceList(text)
    expect(entries).toHaveLength(3)
    expect(entries[1]).toContain('continues on the next line')
  })

  it('没有序号时一行一条', () => {
    expect(splitReferenceList('A. One[J]. J, 2020.\nB. Two[J]. J, 2021.')).toHaveLength(2)
  })

  it('parseReferenceList 端到端', () => {
    const refs = parseReferenceList('1. 张三. 题目一[J]. 期刊, 2020.\n2. 李四. 题目二[J]. 期刊, 2021.')
    expect(refs.map((r) => r.index)).toEqual([1, 2])
    expect(refs[1].title).toBe('题目二')
  })
})
