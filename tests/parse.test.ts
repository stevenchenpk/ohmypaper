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

describe('APA 风格', () => {
  it('解析作者、年份和题名', () => {
    const r = parseReference(
      'Braun, V., & Clarke, V. (2006). Using thematic analysis in psychology. Qualitative Research in Psychology, 3(2), 77–101. https://doi.org/10.1191/1478088706qp063oa',
      1,
    )
    expect(r.style).toBe('apa')
    expect(r.title).toBe('Using thematic analysis in psychology')
    expect(r.year).toBe(2006)
    expect(r.doi).toBe('10.1191/1478088706qp063oa')
    expect(r.authors[0]).toContain('Braun')
  })

  it('题名以问号结尾', () => {
    const r = parseReference('Smith, J. (2021). Is attention all we need? Journal of X, 1, 1–2.', 1)
    expect(r.title).toBe('Is attention all we need?')
  })

  it('漏了 [J] 的 GB/T 条目：四位数期号不当成 APA 年份', () => {
    const r = parseReference('LeCun Y, Bengio Y, Hinton G. Deep learning. Nature, 2015, 521(7553): 436-444.', 1)
    expect(r.style).not.toBe('apa')
    expect(r.year).toBe(2015)
    expect(r.title).toBe('Deep learning')
    const s = parseReference('Smith J. Some title. Science, 2019, 365(6449): 1-2.', 1)
    expect(s.year).toBe(2019)
    expect(s.style).not.toBe('apa')
  })

  it('括号里不是合理年份时不当成 APA', () => {
    expect(parseReference('Wang L. Title. Journal, 2020, 12(1234): 5-6.', 1).year).toBe(2020)
  })

  it('GB/T 7714 条目不会被当成 APA', () => {
    const r = parseReference('LECUN Y. Deep learning[J]. Nature, 2015 (521): 1-2.', 1)
    expect(r.style).toBe('gbt7714')
  })
})
