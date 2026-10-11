/**
 * 测试用的 Crossref / OpenAlex 假接口。
 * 响应结构按两家公开 API 的真实字段裁剪，只保留核验用到的部分。
 */
import type { Fetcher } from '../../src/references/sources'

export interface MockWork {
  doi: string
  title: string
  year: number
  family: string
}

export const MOCK_DB: MockWork[] = [
  { doi: '10.1038/nature14539', title: 'Deep learning', year: 2015, family: 'LeCun' },
  { doi: '10.48550/arxiv.1706.03762', title: 'Attention Is All You Need', year: 2017, family: 'Vaswani' },
  { doi: '10.1038/s41586-021-03819-2', title: 'Highly accurate protein structure prediction with AlphaFold', year: 2021, family: 'Jumper' },
]

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** 简化检索：查询词中出现标题里任意两个以上单词就算命中 */
function search(db: MockWork[], q: string): MockWork[] {
  const qw = new Set(norm(q).split(' '))
  return db.filter((w) => norm(w.title).split(' ').filter((t) => t.length > 3 && qw.has(t)).length >= 2)
}

const crossrefItem = (w: MockWork) => ({
  DOI: w.doi,
  title: [w.title],
  author: [{ family: w.family, given: 'X' }],
  issued: { 'date-parts': [[w.year]] },
  URL: `https://doi.org/${w.doi}`,
})

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

export function mockFetcher(db: MockWork[]): Fetcher {
  return async (input) => {
    const url = new URL(input)
    if (url.hostname === 'api.crossref.org') {
      const m = url.pathname.match(/^\/works\/(.+)$/)
      if (m) {
        const doi = decodeURIComponent(m[1]).toLowerCase()
        const w = db.find((x) => x.doi === doi)
        return w ? json({ message: crossrefItem(w) }) : new Response('Resource not found.', { status: 404 })
      }
      const q = url.searchParams.get('query.bibliographic') ?? ''
      return json({ message: { items: search(db, q).map(crossrefItem) } })
    }
    if (url.hostname === 'api.openalex.org') {
      const q = url.searchParams.get('search') ?? ''
      return json({
        results: search(db, q).map((w) => ({
          display_name: w.title,
          publication_year: w.year,
          doi: `https://doi.org/${w.doi}`,
          id: `https://openalex.org/W${w.year}`,
          authorships: [{ author: { display_name: w.family } }],
        })),
      })
    }
    return new Response('unexpected host', { status: 500 })
  }
}
