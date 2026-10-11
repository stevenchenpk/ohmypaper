/**
 * 开放学术元数据源：Crossref 与 OpenAlex。
 * 两者都支持浏览器跨域请求，不需要服务器中转，论文正文不会离开浏览器；
 * 发出去的只有单条参考文献的标题或 DOI。
 */

export interface CandidateWork {
  source: 'crossref' | 'openalex'
  title: string
  year: number | null
  doi: string | null
  /** 第一作者姓氏或全名，用于辅助比对 */
  firstAuthor: string | null
  url: string | null
}

export type Fetcher = (url: string) => Promise<Response>

export interface SourceOptions {
  fetcher?: Fetcher
  /** Crossref polite pool 要求附带联系邮箱 */
  mailto?: string
}

const DEFAULT_MAILTO = 'ohmypaper@users.noreply.github.com'

function fetcherOf(opts: SourceOptions): Fetcher {
  return opts.fetcher ?? ((url) => fetch(url))
}

/* ---------- Crossref ---------- */

interface CrossrefItem {
  DOI?: string
  title?: string[]
  author?: { family?: string; given?: string; name?: string }[]
  issued?: { 'date-parts'?: (number | null)[][] }
  URL?: string
}

function fromCrossref(item: CrossrefItem): CandidateWork | null {
  const title = item.title?.[0]
  if (!title) return null
  const a = item.author?.[0]
  return {
    source: 'crossref',
    title,
    year: item.issued?.['date-parts']?.[0]?.[0] ?? null,
    doi: item.DOI?.toLowerCase() ?? null,
    firstAuthor: a ? (a.family ?? a.name ?? null) : null,
    url: item.URL ?? (item.DOI ? `https://doi.org/${item.DOI}` : null),
  }
}

/** 按 DOI 精确查询。返回 null 表示 Crossref 没有这个 DOI。 */
export async function crossrefByDoi(doi: string, opts: SourceOptions = {}): Promise<CandidateWork | null> {
  const mailto = encodeURIComponent(opts.mailto ?? DEFAULT_MAILTO)
  const res = await fetcherOf(opts)(`https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=${mailto}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Crossref ${res.status}`)
  const body = (await res.json()) as { message: CrossrefItem }
  return fromCrossref(body.message)
}

/** 按整条参考文献做书目检索，取前几条候选。 */
export async function crossrefSearch(query: string, opts: SourceOptions = {}, rows = 3): Promise<CandidateWork[]> {
  const mailto = encodeURIComponent(opts.mailto ?? DEFAULT_MAILTO)
  const q = encodeURIComponent(query.slice(0, 500))
  const res = await fetcherOf(opts)(
    `https://api.crossref.org/works?query.bibliographic=${q}&rows=${rows}&select=DOI,title,author,issued,URL&mailto=${mailto}`,
  )
  if (!res.ok) throw new Error(`Crossref ${res.status}`)
  const body = (await res.json()) as { message: { items: CrossrefItem[] } }
  return body.message.items.map(fromCrossref).filter((w): w is CandidateWork => w !== null)
}

/* ---------- OpenAlex ---------- */

interface OpenAlexWork {
  display_name?: string
  title?: string
  publication_year?: number
  doi?: string | null
  id?: string
  authorships?: { author?: { display_name?: string } }[]
}

function fromOpenAlex(w: OpenAlexWork): CandidateWork | null {
  const title = w.display_name ?? w.title
  if (!title) return null
  return {
    source: 'openalex',
    title,
    year: w.publication_year ?? null,
    doi: w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() : null,
    firstAuthor: w.authorships?.[0]?.author?.display_name ?? null,
    url: w.doi ?? w.id ?? null,
  }
}

export async function openAlexSearch(title: string, opts: SourceOptions = {}, perPage = 3): Promise<CandidateWork[]> {
  const mailto = encodeURIComponent(opts.mailto ?? DEFAULT_MAILTO)
  // OpenAlex 的 search 参数对逗号等符号敏感，先清理
  const q = encodeURIComponent(title.replace(/[,:;|]/g, ' ').slice(0, 300))
  const res = await fetcherOf(opts)(`https://api.openalex.org/works?search=${q}&per-page=${perPage}&mailto=${mailto}`)
  if (!res.ok) throw new Error(`OpenAlex ${res.status}`)
  const body = (await res.json()) as { results: OpenAlexWork[] }
  return body.results.map(fromOpenAlex).filter((w): w is CandidateWork => w !== null)
}

/* ---------- 中文文献人工核对链接 ---------- */

export function manualSearchLinks(query: string): { label: string; url: string }[] {
  const q = encodeURIComponent(query)
  return [
    { label: '知网', url: `https://kns.cnki.net/kns8s/defaultresult/index?kw=${q}` },
    { label: '百度学术', url: `https://xueshu.baidu.com/s?wd=${q}` },
    { label: '万方', url: `https://s.wanfangdata.com.cn/paper?q=${q}` },
  ]
}
