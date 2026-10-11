/**
 * 开放学术元数据源：Crossref 与 OpenAlex。
 * 两者都支持浏览器跨域请求，不需要服务器中转，论文正文不会离开浏览器；
 * 发出去的只有单条参考文献的标题或 DOI。
 */

export interface CandidateWork {
  source: 'crossref' | 'openalex' | 'datacite'
  title: string
  year: number | null
  doi: string | null
  /** 第一作者姓氏或全名，用于辅助比对 */
  firstAuthor: string | null
  /** 全部作者的姓氏（机构作者为全名），用于核对作者是否被调包 */
  authors: string[]
  /** 期刊或会议名 */
  venue: string | null
  /** 归一后的文献类型，比对 [J]、[M]、[D] 等标识 */
  kind: WorkKind | null
  volume: string | null
  firstPage: string | null
  url: string | null
}

export type WorkKind = 'article' | 'book' | 'chapter' | 'thesis' | 'proceedings' | 'preprint' | 'report' | 'other'

const CROSSREF_KIND: Record<string, WorkKind> = {
  'journal-article': 'article',
  book: 'book',
  monograph: 'book',
  'edited-book': 'book',
  'reference-book': 'book',
  'book-chapter': 'chapter',
  'book-part': 'chapter',
  'book-section': 'chapter',
  dissertation: 'thesis',
  'proceedings-article': 'proceedings',
  proceedings: 'proceedings',
  'posted-content': 'preprint',
  report: 'report',
}

const OPENALEX_KIND: Record<string, WorkKind> = {
  article: 'article',
  book: 'book',
  'book-chapter': 'chapter',
  dissertation: 'thesis',
  preprint: 'preprint',
  report: 'report',
}

const DATACITE_KIND: Record<string, WorkKind> = {
  JournalArticle: 'article',
  Book: 'book',
  BookChapter: 'chapter',
  Dissertation: 'thesis',
  ConferencePaper: 'proceedings',
  Preprint: 'preprint',
  Report: 'report',
}

const firstPageOf = (page: string | undefined | null) => page?.split(/[-–—]/)[0]?.trim() || null

export type Fetcher = (url: string) => Promise<Response>

/** 接口返回非 2xx。429 表示额度用完（OpenAlex 不带 key 时有每日额度），要和"查不到"区分开 */
export class SourceError extends Error {
  constructor(
    readonly source: 'crossref' | 'openalex' | 'datacite',
    readonly status: number,
  ) {
    super(`${source} ${status}`)
  }
  get rateLimited() {
    return this.status === 429
  }
}

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
  type?: string
  'container-title'?: string[]
  volume?: string
  page?: string
}

const CROSSREF_SELECT = 'DOI,title,author,issued,URL,type,container-title,volume,page'

function fromCrossref(item: CrossrefItem): CandidateWork | null {
  const title = item.title?.[0]
  if (!title) return null
  const authors = (item.author ?? []).map((a) => a.family ?? a.name ?? '').filter((a) => a.length > 0)
  return {
    source: 'crossref',
    title,
    year: item.issued?.['date-parts']?.[0]?.[0] ?? null,
    doi: item.DOI?.toLowerCase() ?? null,
    firstAuthor: authors[0] ?? null,
    authors,
    venue: item['container-title']?.[0] ?? null,
    kind: item.type ? (CROSSREF_KIND[item.type] ?? 'other') : null,
    volume: item.volume ?? null,
    firstPage: firstPageOf(item.page),
    url: item.URL ?? (item.DOI ? `https://doi.org/${item.DOI}` : null),
  }
}

/** 按 DOI 精确查询。返回 null 表示 Crossref 没有这个 DOI。 */
export async function crossrefByDoi(doi: string, opts: SourceOptions = {}): Promise<CandidateWork | null> {
  const mailto = encodeURIComponent(opts.mailto ?? DEFAULT_MAILTO)
  const res = await fetcherOf(opts)(`https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=${mailto}`)
  if (res.status === 404) return null
  if (!res.ok) throw new SourceError('crossref', res.status)
  const body = (await res.json()) as { message: CrossrefItem }
  return fromCrossref(body.message)
}

/** 按整条参考文献做书目检索，取前几条候选。 */
export async function crossrefSearch(query: string, opts: SourceOptions = {}, rows = 3): Promise<CandidateWork[]> {
  const mailto = encodeURIComponent(opts.mailto ?? DEFAULT_MAILTO)
  const q = encodeURIComponent(query.slice(0, 500))
  const res = await fetcherOf(opts)(
    `https://api.crossref.org/works?query.bibliographic=${q}&rows=${rows}&select=${CROSSREF_SELECT}&mailto=${mailto}`,
  )
  if (!res.ok) throw new SourceError('crossref', res.status)
  const body = (await res.json()) as { message: { items: CrossrefItem[] } }
  return body.message.items.map(fromCrossref).filter((w): w is CandidateWork => w !== null)
}

/* ---------- DataCite ---------- */

interface DataciteAttributes {
  doi?: string
  titles?: { title?: string }[]
  creators?: { name?: string; familyName?: string }[]
  publicationYear?: number | string
  types?: { resourceTypeGeneral?: string }
  container?: { title?: string; volume?: string; firstPage?: string }
  url?: string
}

/**
 * arXiv（10.48550）、Zenodo 等的 DOI 由 DataCite 注册，Crossref 查不到。
 * DataCite 公开接口同样支持浏览器跨域请求。返回 null 表示 DataCite 也没有这个 DOI。
 */
export async function dataciteByDoi(doi: string, opts: SourceOptions = {}): Promise<CandidateWork | null> {
  const res = await fetcherOf(opts)(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new SourceError('datacite', res.status)
  const a = ((await res.json()) as { data?: { attributes?: DataciteAttributes } }).data?.attributes
  const title = a?.titles?.[0]?.title
  if (!a || !title) return null
  const authors = (a.creators ?? [])
    .map((c) => c.familyName ?? c.name?.split(',')[0] ?? '')
    .filter((c) => c.length > 0)
  const general = a.types?.resourceTypeGeneral
  return {
    source: 'datacite',
    title,
    year: a.publicationYear ? Number(a.publicationYear) : null,
    doi: (a.doi ?? doi).toLowerCase(),
    firstAuthor: authors[0] ?? null,
    authors,
    venue: a.container?.title ?? null,
    kind: general ? (DATACITE_KIND[general] ?? 'other') : null,
    volume: a.container?.volume ?? null,
    firstPage: a.container?.firstPage ?? null,
    url: `https://doi.org/${a.doi ?? doi}`,
  }
}

/** 先查 Crossref，没有再查 DataCite。两家都没有才返回 null。 */
export async function resolveDoi(doi: string, opts: SourceOptions = {}): Promise<CandidateWork | null> {
  return (await crossrefByDoi(doi, opts)) ?? (await dataciteByDoi(doi, opts))
}

/* ---------- OpenAlex ---------- */

interface OpenAlexWork {
  display_name?: string
  title?: string
  publication_year?: number
  doi?: string | null
  id?: string
  authorships?: { author?: { display_name?: string } }[]
  type?: string
  primary_location?: { source?: { display_name?: string } | null } | null
  biblio?: { volume?: string | null; first_page?: string | null }
}

/** OpenAlex 只给全名，取最后一个词当姓（"Yann LeCun" → LeCun） */
const surnameOf = (fullName: string) => fullName.trim().split(/\s+/).pop() ?? fullName

function fromOpenAlex(w: OpenAlexWork): CandidateWork | null {
  const title = w.display_name ?? w.title
  if (!title) return null
  const authors = (w.authorships ?? [])
    .map((a) => a.author?.display_name ?? '')
    .filter((a) => a.length > 0)
    .map(surnameOf)
  return {
    source: 'openalex',
    title,
    year: w.publication_year ?? null,
    doi: w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() : null,
    firstAuthor: w.authorships?.[0]?.author?.display_name ?? null,
    authors,
    venue: w.primary_location?.source?.display_name ?? null,
    kind: w.type ? (OPENALEX_KIND[w.type] ?? 'other') : null,
    volume: w.biblio?.volume ?? null,
    firstPage: w.biblio?.first_page ?? null,
    url: w.doi ?? w.id ?? null,
  }
}

export async function openAlexSearch(title: string, opts: SourceOptions = {}, perPage = 3): Promise<CandidateWork[]> {
  const mailto = encodeURIComponent(opts.mailto ?? DEFAULT_MAILTO)
  // OpenAlex 的 search 参数对逗号等符号敏感，先清理
  const q = encodeURIComponent(title.replace(/[,:;|]/g, ' ').slice(0, 300))
  const res = await fetcherOf(opts)(`https://api.openalex.org/works?search=${q}&per-page=${perPage}&mailto=${mailto}`)
  if (!res.ok) throw new SourceError('openalex', res.status)
  const body = (await res.json()) as { results: OpenAlexWork[] }
  return body.results.map(fromOpenAlex).filter((w): w is CandidateWork => w !== null)
}

/* ---------- 中文文献人工核对链接 ---------- */

/** 图书、报告等外文文献的人工核对入口 */
export function bookSearchLinks(query: string): { label: string; url: string }[] {
  const q = encodeURIComponent(query)
  return [
    { label: 'WorldCat', url: `https://search.worldcat.org/search?q=${q}` },
    { label: '国家图书馆', url: `http://find.nlc.cn/search/doSearch?query=${q}` },
    { label: '百度学术', url: `https://xueshu.baidu.com/s?wd=${q}` },
  ]
}

export function manualSearchLinks(query: string): { label: string; url: string }[] {
  const q = encodeURIComponent(query)
  return [
    { label: '知网', url: `https://kns.cnki.net/kns8s/defaultresult/index?kw=${q}` },
    { label: '百度学术', url: `https://xueshu.baidu.com/s?wd=${q}` },
    { label: '万方', url: `https://s.wanfangdata.com.cn/paper?q=${q}` },
  ]
}
