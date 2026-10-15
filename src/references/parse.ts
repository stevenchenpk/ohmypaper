/**
 * 参考文献列表解析。
 *
 * 目标是从学生粘贴的参考文献列表（通常是 GB/T 7714 著录格式）里，
 * 尽量稳定地抽出用于核验的字段：标题、作者、年份、DOI、文献类型标识。
 * 解析失败不报错，只是字段留空，交给核验阶段标为"需人工核对"。
 */

export type DocTypeCode =
  | 'J' // 期刊
  | 'M' // 专著
  | 'D' // 学位论文
  | 'C' // 会议录
  | 'N' // 报纸
  | 'R' // 报告
  | 'S' // 标准
  | 'P' // 专利
  | 'G' // 汇编
  | 'A' // 析出文献
  | 'Z' // 其他
  | 'DB'
  | 'CP'
  | 'EB'
  | 'DS'
  | 'CM'
  | 'AO'

export interface ParsedReference {
  /** 在列表中的序号（1 起），取自 [n] 或行号 */
  index: number
  /** 原始文本，去掉首尾空白和序号 */
  raw: string
  authors: string[]
  title: string | null
  year: number | null
  doi: string | null
  /** 方括号中的文献类型标识，如 J、M、D、EB/OL 取 EB */
  docType: DocTypeCode | null
  /** 是否以中文为主（决定能否用国际开放接口核验） */
  isChinese: boolean
  /** 识别出的著录风格；格式体检会用到 */
  style: 'gbt7714' | 'apa' | 'unknown'
  /** 卷号和起始页，用于发现"真 DOI 配假出处" */
  volume: string | null
  firstPage: string | null
}

const CJK = /[㐀-鿿豈-﫿]/g

/** 中文字符占非空白字符的比例超过 30% 视为中文文献 */
export function isMostlyChinese(text: string): boolean {
  const compact = text.replace(/\s+/g, '')
  if (compact.length === 0) return false
  const cjk = compact.match(CJK)?.length ?? 0
  return cjk / compact.length > 0.3
}

// 旧式 SICI DOI 里合法地含有 < > ; # 等字符，只在空白和中文标点处截断
const DOI_RE = /\b(10\.\d{4,9}\/[^\s"，。；]+)/i

export function extractDoi(text: string): string | null {
  const m = text.match(DOI_RE)
  if (!m) return null
  // 去掉常见的尾随标点
  return m[1].replace(/[.,;)\]】）]+$/, '').toLowerCase()
}

// 从知网复制的条目常用全角方括号：［J］
const TYPE_RE = /[\[［](J|M|D|C|N|R|S|P|G|A|Z|DB|CP|EB|DS|CM|AO)(?:\/(?:OL|MT|DK|CD))?[\]］]/

const YEAR_RE = /(?<!\d)((?:19|20)\d{2})(?!\d)/g
/** 出版项里的年份：前面是逗号或冒号、后面跟着分隔符，如 ", 2021, 65"、"出版社, 2015."、", 2020: 1-5" */
const PUB_YEAR_RE = /[,，:：]\s*((?:19|20)\d{2})[a-z]?\s*(?=[,，.．:：;；(（]|$)/g
/** 著者-出版年制：年份紧跟在作者后面，如 "张三, 2020. 题名"、"LECUN Y. 2015a. Deep learning" */
const AUTHOR_YEAR_HEAD_RE = /^([^[\]［］]{1,300}?)[,，.．]\s*((?:19|20)\d{2})([a-z])?[.．]\s*/

/** 不是出版年的数字：DOI、网址、arXiv 编号、引用日期 [2024-01-01]、年份区间 1949—1978 */
function stripNonPubNumbers(text: string): string {
  return text
    .replace(DOI_RE, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/arXiv\s*[:：]?\s*\d{4}\.\d{4,5}(?:v\d+)?/gi, ' ')
    .replace(/[[［]\d{4}-\d{1,2}-\d{1,2}[\]］]/g, ' ')
    // 年份区间；"2019-06-01" 这样的日期不算
    .replace(/(?<![\d-])(?:19|20)\d{2}\s*[-–—~～至]\s*(?:(?:19|20)\d{2}|\d{2})(?![\d-])/g, ' ')
}

/**
 * 出版年。按顺序找：
 * 1. 著者-出版年制，作者后面紧跟的年份
 * 2. 文献类型标识 [J]、[M] 之后的出版项里，前有逗号或冒号的年份；没有就取出版项里的第一个年份
 * 3. 没有类型标识：前有逗号或冒号的最后一个年份；没有就取最后一个年份
 * 题名里的年份（"2008 crisis"、"1949—1978年"）、arXiv 编号都不会被当成出版年。
 */
function extractYear(text: string): number | null {
  const head = text.match(AUTHOR_YEAR_HEAD_RE)
  if (head && !/\d/.test(head[1])) return Number(head[2])
  const type = text.match(TYPE_RE)
  if (type) {
    const pub = stripNonPubNumbers(text.slice(type.index! + type[0].length))
    const marked = [...pub.matchAll(PUB_YEAR_RE)]
    if (marked.length) return Number(marked[0][1])
    const any = [...pub.matchAll(YEAR_RE)]
    if (any.length) return Number(any[0][1])
  }
  const cleaned = stripNonPubNumbers(text)
  const marked = [...cleaned.matchAll(PUB_YEAR_RE)]
  if (marked.length) return Number(marked[marked.length - 1][1])
  const any = [...cleaned.matchAll(YEAR_RE)]
  return any.length ? Number(any[any.length - 1][1]) : null
}

/**
 * 按 GB/T 7714 的结构拆分：作者. 题名[类型]. 出处...
 * 作者段与题名段之间以 ". " 或 "." 分隔（中文文献常见全角句点）。
 */
// 题名里常见的英文缩写，句点不是字段分隔符（如 Mrs. Dalloway）
const ABBREV_RE = /\b(Mrs|Mr|Ms|Dr|St|Jr|Sr|vs|Vol|No|Ed|Eds|U\.S|e\.g|i\.e)\./g
const DOT_PLACEHOLDER = '\u2024'

function splitAuthorsAndTitle(text: string): { authors: string[]; title: string | null } {
  const typeMatch = text.match(TYPE_RE)
  // 题名在类型标识之前；没有类型标识时退化为第二段
  const head = (typeMatch ? text.slice(0, typeMatch.index) : text)
    .replace(ABBREV_RE, (m) => m.replaceAll('.', DOT_PLACEHOLDER))
    // 著者-出版年制 "et al., 2017. 题名"：这个句点后面是逗号，不是作者和题名的分界
    .replace(/\bet al\.(?=\s*[,，])/g, `et al${DOT_PLACEHOLDER}`)
  // GB/T 7714 的作者缩写不带句点（如 LECUN Y），所以第一个句点就是作者与题名的分界
  const parts = head.split(/[.．。](?!\d)\s*/).filter((p) => p.trim().length > 0)

  if (parts.length === 0) return { authors: [], title: null }
  if (parts.length === 1) {
    return { authors: [], title: typeMatch ? parts[0].replaceAll(DOT_PLACEHOLDER, '.').trim() : null }
  }

  const restore = (p: string) => p.replaceAll(DOT_PLACEHOLDER, '.')
  // 著者-出版年制："张三, 2020. 题名" 年份粘在作者段末尾；"张三. 2020a. 题名" 年份单独成段
  const authorSeg = restore(parts[0]).replace(/[,，]\s*(?:19|20)\d{2}[a-z]?\s*$/, '')
  if (parts.length > 2 && /^\s*(?:19|20)\d{2}[a-z]?\s*$/.test(parts[1])) parts.splice(1, 1)
  const title = restore(typeMatch ? parts.slice(1).join('. ').trim() : parts[1].trim())
  const authors = authorSeg
    .split(/[,，、;；]|\band\b/)
    .map((a) => a.trim())
    .filter((a) => a.length > 0 && !/^(et al\.?|等)$/i.test(a))

  return { authors, title: title.length > 0 ? title : null }
}

/**
 * APA 风格：Author, A. A., & Author, B. (2020). Title of work. Journal, 1(2), 3–4.
 * 年份放在作者后的括号里，题名紧跟其后。
 * 括号必须紧跟作者段（作者段里不含数字），年份在 1900–2099 之间：
 * 否则 "Nature, 2015, 521(7553): 436-444" 这类卷(期)会被当成 APA 年份。
 */
const APA_RE = /^([^\d]+?)\s*[(（]((?:19|20)\d{2})[a-z]?(?:,[^)）]*)?[)）]\.?\s*(.+?[.?!])(?:\s|$)/

function parseApa(text: string): { authors: string[]; title: string; year: number } | null {
  if (TYPE_RE.test(text)) return null
  const m = text.match(APA_RE)
  if (!m) return null
  // "Braun, V., & Clarke, V." → ["Braun, V.", "Clarke, V."]：在缩写首字母后的逗号处切分
  const authors = m[1]
    .replace(/,?\s*&\s*/g, ', ')
    .split(/(?<=[A-Z]\.)\s*,\s*|\s*;\s*/)
    .map((a) => a.replace(/,\s*$/, '').trim())
    .filter((a) => a.length > 0 && !/^et al\.?$/i.test(a))
  const title = m[3].replace(/[.]$/, '').trim()
  return { authors, title, year: Number(m[2]) }
}

const INDEX_RE = /^\s*(?:\[(\d+)\]|［(\d+)］|(\d+)[.．、)]\s)/

/** 上一行以被硬换行截断的 DOI 结尾（如 "DOI:10.1038/nature" + 换行 + "14539."） */
const DOI_TAIL_RE = /(?:doi[:：]?\s*|doi\.org\/)10\.\d{4,9}\/\S*[A-Za-z0-9_-]$/i
// 续行的第一个词含数字才认为是 DOI 的后半截，避免把下一条的作者名拼进 DOI
const DOI_CONT_RE = /^[A-Za-z0-9_().\/-]*\d[A-Za-z0-9_().\/-]*[.,]?(?:\s|$)/

/** 没有序号时，判断这一行是不是上一条的续行 */
function looksLikeContinuation(prev: string, line: string): boolean {
  if (/^[a-z0-9(（,，:：;；–—-]/.test(line)) return true
  if (/[,，:：;；–—-]$/.test(prev)) return true
  // "题名[J]." 之后换行，下一行是刊名
  if (/\][.．]?$/.test(prev) && !TYPE_RE.test(line)) return true
  return false
}

function join(prev: string, line: string): string {
  return DOI_TAIL_RE.test(prev) && DOI_CONT_RE.test(line) ? prev + line : prev + ' ' + line
}

/** 把整段参考文献文本切成一条条记录 */
export function splitReferenceList(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length === 0) return []

  // 第一行带序号，就以序号为界合并续行；否则按续行特征判断
  const hasIndices = INDEX_RE.test(lines[0])
  const entries: string[] = []
  for (const line of lines) {
    const prev = entries[entries.length - 1]
    const isNew =
      prev === undefined || (hasIndices ? INDEX_RE.test(line) : !looksLikeContinuation(prev, line) && !(DOI_TAIL_RE.test(prev) && DOI_CONT_RE.test(line)))
    if (isNew) entries.push(line)
    else entries[entries.length - 1] = join(prev, line)
  }
  return entries
}

/** GB/T："2015, 521(7553): 436-444"；APA："3(2), 77–101" */
const GBT_VOL_RE = /[,，]\s*(?:19|20)\d{2}[a-z]?\s*[,，]\s*(\d+)\s*(?:[(（][^)）]*[)）])?\s*[:：]\s*([A-Za-z]?\d+)/
const APA_VOL_RE = /[,，]\s*(\d+)\s*(?:\([^)]*\))?\s*,\s*([A-Za-z]?\d+)\s*(?:[-–—]|\.|$)/

function extractVolumePage(text: string, style: ParsedReference['style']): { volume: string | null; firstPage: string | null } {
  const cleaned = text.replace(DOI_RE, ' ').replace(/https?:\/\/\S+/g, ' ')
  const m = cleaned.match(style === 'apa' ? APA_VOL_RE : GBT_VOL_RE)
  return m ? { volume: m[1], firstPage: m[2] } : { volume: null, firstPage: null }
}

/** 取作者的姓：GB/T "LECUN Y" → LECUN，APA "Braun, V." → Braun，中文和机构名原样返回 */
export function surnameOf(author: string): string {
  const a = author.trim()
  if (a.includes(',')) return a.split(',')[0].trim()
  if (isMostlyChinese(a)) return a
  const tokens = a.split(/\s+/)
  // "Yann LeCun" 这种名在前的写法：最后一个词不是缩写时取最后一个词
  if (tokens.length > 1 && /^[A-Z][a-z]/.test(tokens[0]) && !/^[A-Z]{1,3}$/.test(tokens[tokens.length - 1])) {
    return tokens[tokens.length - 1]
  }
  return tokens[0]
}

export function parseReference(entry: string, fallbackIndex: number): ParsedReference {
  const idx = entry.match(INDEX_RE)
  const index = idx ? Number(idx[1] ?? idx[2] ?? idx[3]) : fallbackIndex
  const raw = entry.replace(INDEX_RE, '').trim()
  const typeMatch = raw.match(TYPE_RE)
  const apa = parseApa(raw)
  const { authors, title } = apa ?? splitAuthorsAndTitle(raw)
  const style = typeMatch ? 'gbt7714' : apa ? 'apa' : 'unknown'

  return {
    index,
    raw,
    authors,
    title,
    year: apa?.year ?? extractYear(raw),
    doi: extractDoi(raw),
    docType: (typeMatch?.[1] as DocTypeCode | undefined) ?? null,
    // 只看作者和题名部分，避免英文的 DOI、网址拉低中文占比
    isChinese: isMostlyChinese([...authors, title ?? ''].join('') || raw),
    style,
    ...extractVolumePage(raw, style),
  }
}

export function parseReferenceList(text: string): ParsedReference[] {
  return splitReferenceList(text).map((entry, i) => parseReference(entry, i + 1))
}
