/**
 * 知网（CNKI）导出题录的解析：EndNote、NoteExpress、RefWorks 三种文本格式。
 *
 * 学生在知网勾选文献后"导出与分析 → 导出文献"，可选这几种格式。
 * 知网导出的特点：作者常写在一行里用分号隔开；期号带前导零（"03"）；
 * 学位论文的授予单位写在出版者字段，导师写在次要责任者字段。
 * 也能读万方、维普等导出的同类格式，只要字段标签相同。
 */

import { parseNameList, type CslName } from './names'
import { dateFrom, TYPE_CODE_TO_CSL, type CslItem, type CslType, type StructuredReference } from './types'

export type ExportFormat = 'endnote' | 'noteexpress' | 'refworks'

/** 题录里的文献类型名 → GB/T 7714 类型标识 */
const TYPE_NAME_TO_CODE: Record<string, string> = {
  'journal article': 'J',
  journal: 'J',
  book: 'M',
  'book section': 'M',
  'edited book': 'M',
  thesis: 'D',
  'dissertation/thesis': 'D',
  dissertation: 'D',
  'conference proceedings': 'C',
  'conference paper': 'C',
  'newspaper article': 'N',
  newspaper: 'N',
  report: 'R',
  standard: 'S',
  patent: 'P',
  'web page': 'EB',
  'electronic article': 'J',
  'electronic source': 'EB',
  dataset: 'DS',
  'generic': 'Z',
}

export function detectExportFormat(text: string): ExportFormat | null {
  const first = text.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? ''
  if (/^%0\s/.test(first)) return 'endnote'
  if (/^\{Reference Type\}\s*:/i.test(first)) return 'noteexpress'
  if (/^RT\s/.test(first)) return 'refworks'
  return null
}

type Fields = Map<string, string[]>

function push(f: Fields, key: string, value: string) {
  const v = value.trim()
  if (!v) return
  const list = f.get(key)
  if (list) list.push(v)
  else f.set(key, [v])
}

/** 按记录切分，每条记录转成"标签 → 值列表" */
function readRecords(text: string, format: ExportFormat): Fields[] {
  const lines = text.split(/\r?\n/)
  const records: Fields[] = []
  let cur: Fields | null = null
  let lastKey: string | null = null
  const start = { endnote: /^%0\s/, noteexpress: /^\{Reference Type\}\s*:/i, refworks: /^RT\s/ }[format]
  const tagRe = {
    endnote: /^(%[0-9A-Z@+#$&()*!~^>\[\]|?])\s?(.*)$/,
    noteexpress: /^\{([^}]+)\}\s*:\s?(.*)$/,
    refworks: /^([A-Za-z][A-Za-z0-9])\s(.*)$/,
  }[format]

  for (const line of lines) {
    if (!line.trim()) {
      lastKey = null
      continue
    }
    if (start.test(line.trim())) {
      cur = new Map()
      records.push(cur)
    }
    if (!cur) continue
    const m = line.trim().match(tagRe)
    if (m) {
      lastKey = format === 'refworks' ? m[1].toUpperCase() : m[1]
      push(cur, lastKey, m[2])
    } else if (lastKey) {
      // 续行（摘要换行等）
      const list = cur.get(lastKey)!
      list[list.length - 1] += line.trim()
    }
  }
  return records
}

/** 知网在一个字段里用分号列多个作者，也可能一人一行 */
function names(values: string[] | undefined): { list: CslName[]; etAl: boolean } {
  if (!values) return { list: [], etAl: false }
  const out: CslName[] = []
  let etAl = false
  for (const v of values) {
    // 西文"Smith, John"内部有逗号，只用分号分；全中文时逗号也当分隔符
    const sep = /[A-Za-z]/.test(v) ? /\s*[;；]\s*/ : /\s*[;；,，、]\s*/
    const r = parseNameList(v, sep)
    out.push(...r.names)
    etAl ||= r.etAl
  }
  return { list: out, etAl }
}

const first = (f: Fields, ...keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = f.get(k)?.[0]
    if (v) return v.replace(/[;；]\s*$/, '').trim()
  }
  return undefined
}

function normIssue(s: string | undefined): string | undefined {
  return s?.replace(/^0+(?=\d)/, '')
}

function pages(start?: string, end?: string): string | undefined {
  if (start && end && !start.includes('-')) return `${start}-${end}`
  return start ?? end
}

/** 统一的中间表示：各格式先映射到这些键 */
interface Common {
  typeName?: string
  title?: string
  authors?: string[]
  editors?: string[]
  translators?: string[]
  supervisors?: string[]
  container?: string
  year?: string
  date?: string
  volume?: string
  issue?: string
  startPage?: string
  endPage?: string
  pages?: string
  place?: string
  publisher?: string
  degree?: string
  edition?: string
  issn?: string
  isbn?: string
  doi?: string
  url?: string
  abstract?: string
  keywords?: string
  number?: string
  language?: string
}

function fromEndnote(f: Fields): Common {
  return {
    typeName: first(f, '%0'),
    title: first(f, '%T'),
    authors: f.get('%A'),
    editors: f.get('%E'),
    translators: f.get('%Y')?.length && /译/.test(f.get('%Y')!.join('')) ? f.get('%Y') : undefined,
    container: first(f, '%J', '%B'),
    year: first(f, '%D'),
    date: first(f, '%8'),
    volume: first(f, '%V'),
    issue: first(f, '%N'),
    pages: first(f, '%P'),
    place: first(f, '%C'),
    publisher: first(f, '%I'),
    degree: first(f, '%9'),
    edition: first(f, '%7'),
    issn: first(f, '%@'),
    doi: first(f, '%R'),
    url: first(f, '%U'),
    abstract: first(f, '%X'),
    keywords: f.get('%K')?.join(';'),
    language: first(f, '%G'),
  }
}

function fromNoteExpress(f: Fields): Common {
  return {
    typeName: first(f, 'Reference Type'),
    title: first(f, 'Title'),
    authors: f.get('Author'),
    editors: f.get('Editor'),
    translators: f.get('Translator'),
    supervisors: f.get('Secondary Author'),
    container: first(f, 'Journal', 'Secondary Title', 'Newspaper', 'Proceedings Title'),
    year: first(f, 'Year'),
    date: first(f, 'Date'),
    volume: first(f, 'Volume'),
    issue: first(f, 'Issue', 'Number'),
    pages: first(f, 'Pages'),
    place: first(f, 'Place Published'),
    publisher: first(f, 'Publisher', 'University'),
    degree: first(f, 'Type of Work', 'Thesis Type'),
    edition: first(f, 'Edition'),
    issn: first(f, 'ISBN/ISSN', 'ISSN'),
    doi: first(f, 'DOI'),
    url: first(f, 'URL'),
    abstract: first(f, 'Abstract'),
    keywords: first(f, 'Keywords'),
    language: first(f, 'Language'),
  }
}

function fromRefworks(f: Fields): Common {
  return {
    typeName: first(f, 'RT'),
    title: first(f, 'T1'),
    authors: f.get('A1'),
    editors: f.get('A2'),
    supervisors: f.get('A3'),
    container: first(f, 'JF', 'JO', 'T2'),
    year: first(f, 'YR'),
    date: first(f, 'FD'),
    volume: first(f, 'VO'),
    issue: first(f, 'IS'),
    startPage: first(f, 'SP'),
    // 知网 RefWorks 把整段页码写在 OP
    endPage: first(f, 'OP'),
    place: first(f, 'PP'),
    publisher: first(f, 'PB'),
    degree: first(f, 'NO') && /学位|硕士|博士/.test(first(f, 'NO')!) ? first(f, 'NO') : undefined,
    edition: first(f, 'ED'),
    issn: first(f, 'SN'),
    doi: first(f, 'DO'),
    url: first(f, 'LK', 'UL'),
    abstract: first(f, 'AB'),
    keywords: f.get('K1')?.join(';'),
    language: first(f, 'LA'),
  }
}

function toStructured(c: Common, source: ExportFormat, i: number): StructuredReference {
  const warnings: string[] = []
  const typeKey = (c.typeName ?? '').toLowerCase().trim()
  let typeCode = TYPE_NAME_TO_CODE[typeKey] ?? null
  if (!typeCode) {
    warnings.push(`未知的文献类型：${c.typeName ?? '（空）'}`)
  }
  let cslType: CslType = typeCode ? TYPE_CODE_TO_CSL[typeCode] : 'document'
  if (typeKey === 'book section') cslType = 'chapter'
  if (typeCode === 'C' && !c.container) typeCode = 'C'

  const auth = names(c.authors)
  const csl: CslItem = { id: String(i), type: cslType }
  if (c.title) csl.title = c.title.trim()
  else warnings.push('缺题名')
  if (auth.list.length) csl.author = auth.list
  else warnings.push('缺作者')
  const ed = names(c.editors)
  if (ed.list.length) csl.editor = ed.list
  const tr = names(c.translators)
  if (tr.list.length) csl.translator = tr.list
  if (c.container) csl['container-title'] = c.container
  const date = c.date && /^\d{4}[-/.]\d{1,2}/.test(c.date) ? c.date.replace(/[/.]/g, '-') : undefined
  if (date && (typeCode === 'N' || !c.year)) csl.issued = dateFrom(date)
  else if (c.year) csl.issued = dateFrom(c.year.match(/\d{4}/)?.[0] ?? c.year)
  else warnings.push('缺年份')
  if (c.volume) csl.volume = c.volume
  if (c.issue) csl.issue = normIssue(c.issue)
  const p = c.pages ?? pages(c.startPage, c.endPage)
  if (p) csl.page = p.replace(/[~～—–]/g, '-')
  if (c.place) csl['publisher-place'] = c.place
  if (c.publisher) csl.publisher = c.publisher
  if (typeCode === 'D') csl.genre = c.degree ? `${c.degree.replace(/学位论文$/, '')}学位论文` : '学位论文'
  if (c.edition) csl.edition = c.edition
  if (c.issn) {
    if (/^\d{4}-\d{3}[\dX]$/i.test(c.issn)) csl.ISSN = c.issn
    else if (/^[\d-]{10,17}X?$/i.test(c.issn)) csl.ISBN = c.issn
  }
  if (c.doi) csl.DOI = c.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
  if (c.url) csl.URL = c.url
  if (c.abstract) csl.abstract = c.abstract
  if (c.keywords) csl.keyword = c.keywords.replace(/[;；]+\s*$/, '').replace(/\s*[;；]\s*/g, '; ')
  if (c.language) csl.language = c.language.replace(/[;；]$/, '')
  if (typeCode === 'J' && !csl.page) warnings.push('期刊文献缺页码')
  if (typeCode === 'D' && !csl.publisher) warnings.push('学位论文缺授予单位')

  return { csl, source, typeCode, carrier: null, etAl: auth.etAl, index: null, raw: '', warnings }
}

/** 解析一段导出文本；格式不认识时返回空数组 */
export function parseCnkiExport(text: string, format = detectExportFormat(text)): StructuredReference[] {
  if (!format) return []
  const map = { endnote: fromEndnote, noteexpress: fromNoteExpress, refworks: fromRefworks }[format]
  return readRecords(text, format).map((f, i) => {
    const r = toStructured(map(f), format, i + 1)
    r.index = i + 1
    r.raw = [...f.entries()].map(([k, v]) => v.map((x) => `${k} ${x}`).join('\n')).join('\n')
    return r
  })
}
