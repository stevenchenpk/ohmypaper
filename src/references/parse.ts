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
}

const CJK = /[㐀-鿿豈-﫿]/g

/** 中文字符占非空白字符的比例超过 30% 视为中文文献 */
export function isMostlyChinese(text: string): boolean {
  const compact = text.replace(/\s+/g, '')
  if (compact.length === 0) return false
  const cjk = compact.match(CJK)?.length ?? 0
  return cjk / compact.length > 0.3
}

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>，。；]+)/i

export function extractDoi(text: string): string | null {
  const m = text.match(DOI_RE)
  if (!m) return null
  // 去掉常见的尾随标点
  return m[1].replace(/[.,;)\]】）]+$/, '').toLowerCase()
}

const TYPE_RE = /\[(J|M|D|C|N|R|S|P|G|A|Z|DB|CP|EB|DS|CM|AO)(?:\/(?:OL|MT|DK|CD))?\]/

function extractYear(text: string): number | null {
  // 取第一个看起来像出版年的四位数（1900–2099），
  // 但跳过 DOI 和 URL 里的数字
  const cleaned = text.replace(DOI_RE, ' ').replace(/https?:\/\/\S+/g, ' ')
  const years = [...cleaned.matchAll(/(?<!\d)(19\d{2}|20\d{2})(?!\d)/g)].map((m) => Number(m[1]))
  return years.length > 0 ? years[0] : null
}

/**
 * 按 GB/T 7714 的结构拆分：作者. 题名[类型]. 出处...
 * 作者段与题名段之间以 ". " 或 "." 分隔（中文文献常见全角句点）。
 */
function splitAuthorsAndTitle(text: string): { authors: string[]; title: string | null } {
  const typeMatch = text.match(TYPE_RE)
  // 题名在类型标识之前；没有类型标识时退化为第二段
  const head = typeMatch ? text.slice(0, typeMatch.index) : text
  // GB/T 7714 的作者缩写不带句点（如 LECUN Y），所以第一个句点就是作者与题名的分界
  const parts = head.split(/[.．。](?!\d)\s*/).filter((p) => p.trim().length > 0)

  if (parts.length === 0) return { authors: [], title: null }
  if (parts.length === 1) {
    return { authors: [], title: typeMatch ? parts[0].trim() : null }
  }

  const authorSeg = parts[0]
  const title = typeMatch ? parts.slice(1).join('. ').trim() : parts[1].trim()
  const authors = authorSeg
    .split(/[,，、;；]|\band\b/)
    .map((a) => a.trim())
    .filter((a) => a.length > 0 && !/^(et al|等)$/i.test(a))

  return { authors, title: title.length > 0 ? title : null }
}

const INDEX_RE = /^\s*(?:\[(\d+)\]|［(\d+)］|(\d+)[.．、)]\s)/

/** 把整段参考文献文本切成一条条记录 */
export function splitReferenceList(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  // 如果有序号，就以序号为界合并续行；否则一行一条
  const hasIndices = lines.filter((l) => INDEX_RE.test(l)).length >= Math.max(1, lines.length / 2)
  if (!hasIndices) return lines

  const entries: string[] = []
  for (const line of lines) {
    if (INDEX_RE.test(line) || entries.length === 0) entries.push(line)
    else entries[entries.length - 1] += ' ' + line
  }
  return entries
}

export function parseReference(entry: string, fallbackIndex: number): ParsedReference {
  const idx = entry.match(INDEX_RE)
  const index = idx ? Number(idx[1] ?? idx[2] ?? idx[3]) : fallbackIndex
  const raw = entry.replace(INDEX_RE, '').trim()
  const typeMatch = raw.match(TYPE_RE)
  const { authors, title } = splitAuthorsAndTitle(raw)

  return {
    index,
    raw,
    authors,
    title,
    year: extractYear(raw),
    doi: extractDoi(raw),
    docType: (typeMatch?.[1] as DocTypeCode | undefined) ?? null,
    // 只看作者和题名部分，避免英文的 DOI、网址拉低中文占比
    isChinese: isMostlyChinese([...authors, title ?? ''].join('') || raw),
  }
}

export function parseReferenceList(text: string): ParsedReference[] {
  return splitReferenceList(text).map((entry, i) => parseReference(entry, i + 1))
}
