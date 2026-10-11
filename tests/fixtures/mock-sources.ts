/**
 * 测试用的 Crossref / OpenAlex 假接口。
 * 响应结构按两家公开 API 的真实字段裁剪，只保留核验用到的部分。
 */
import type { Fetcher } from '../../src/references/sources'

export interface MockWork {
  doi: string | null
  title: string
  year: number
  family: string
  /** 全部作者姓氏；缺省时只有 family 一位 */
  authors?: string[]
  /** Crossref 的 type 字段，缺省为 journal-article */
  type?: string
  venue?: string
  volume?: string
  page?: string
}

/** arXiv 等 10.48550 开头的 DOI 在 DataCite 注册，Crossref 查不到 */
const isDatacite = (doi: string | null) => doi?.startsWith('10.48550/') ?? false

export const MOCK_DB: MockWork[] = [
  { doi: '10.1038/nature14539', title: 'Deep learning', year: 2015, family: 'LeCun' },
  { doi: '10.48550/arxiv.1706.03762', title: 'Attention Is All You Need', year: 2017, family: 'Vaswani' },
  { doi: '10.1038/s41586-021-03819-2', title: 'Highly accurate protein structure prediction with AlphaFold', year: 2021, family: 'Jumper' },
]

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** 简化检索：查询词中出现标题里两个以上长词（标题只有一个长词时出现这一个）就算命中 */
function search(db: MockWork[], q: string): MockWork[] {
  const qw = new Set(norm(q).split(' '))
  return db.filter((w) => {
    const long = norm(w.title).split(' ').filter((t) => t.length > 3)
    return long.length > 0 && long.filter((t) => qw.has(t)).length >= Math.min(2, long.length)
  })
}

const authorsOf = (w: MockWork) => w.authors ?? [w.family]

const crossrefItem = (w: MockWork) => ({
  ...(w.doi ? { DOI: w.doi, URL: `https://doi.org/${w.doi}` } : {}),
  title: [w.title],
  author: authorsOf(w).map((family) => ({ family, given: 'X' })),
  issued: { 'date-parts': [[w.year]] },
  type: w.type ?? 'journal-article',
  ...(w.venue ? { 'container-title': [w.venue] } : {}),
  ...(w.volume ? { volume: w.volume } : {}),
  ...(w.page ? { page: w.page } : {}),
})

const OPENALEX_TYPE: Record<string, string> = { 'journal-article': 'article', book: 'book', dissertation: 'dissertation' }

export const openAlexItem = (w: MockWork) => ({
  display_name: w.title,
  publication_year: w.year,
  doi: w.doi ? `https://doi.org/${w.doi}` : null,
  id: `https://openalex.org/W${w.year}`,
  authorships: authorsOf(w).map((a) => ({ author: { display_name: `X ${a}` } })),
  type: OPENALEX_TYPE[w.type ?? 'journal-article'] ?? 'other',
  primary_location: w.venue ? { source: { display_name: w.venue } } : null,
  biblio: { volume: w.volume ?? null, first_page: w.page?.split(/[-–]/)[0] ?? null },
})

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

export function mockFetcher(db: MockWork[]): Fetcher {
  return async (input) => {
    const url = new URL(input)
    if (url.hostname === 'api.crossref.org') {
      const m = url.pathname.match(/^\/works\/(.+)$/)
      if (m) {
        const doi = decodeURIComponent(m[1]).toLowerCase()
        const w = db.find((x) => x.doi === doi && !isDatacite(x.doi))
        return w ? json({ message: crossrefItem(w) }) : new Response('Resource not found.', { status: 404 })
      }
      const q = url.searchParams.get('query.bibliographic') ?? ''
      return json({ message: { items: search(db, q).map(crossrefItem) } })
    }
    if (url.hostname === 'api.datacite.org') {
      const doi = decodeURIComponent(url.pathname.replace(/^\/dois\//, '')).toLowerCase()
      const w = db.find((x) => x.doi === doi && isDatacite(x.doi))
      if (!w) return new Response('{"errors":[{"status":"404"}]}', { status: 404 })
      return json({
        data: {
          attributes: {
            doi: w.doi,
            titles: [{ title: w.title }],
            creators: authorsOf(w).map((familyName) => ({ familyName })),
            publicationYear: w.year,
            types: { resourceTypeGeneral: 'Preprint' },
          },
        },
      })
    }
    if (url.hostname === 'api.openalex.org') {
      const q = url.searchParams.get('search') ?? ''
      return json({ results: search(db, q).map(openAlexItem) })
    }
    return new Response('unexpected host', { status: 500 })
  }
}
