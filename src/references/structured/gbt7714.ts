/**
 * 把一条 GB/T 7714（2015 或 2025 版）著录文本拆成结构化字段。
 *
 * 面向学生手写或从知网"引文格式"复制来的中文条目，也兼容西文条目。
 * 拆不开的字段留空并写进 warnings，不抛错。
 */

import { normalizePunctuation } from '../style/gbt7714'
import { parseNameList, type CslName } from './names'
import { dateFrom, TYPE_CODE_TO_CSL, type CslItem, type StructuredReference } from './types'

const INDEX_RE = /^\s*(?:[[［](\d+)[\]］]|(\d+)[.．、)）]\s*)\s*/
const TYPE_TAG_RE = /\[([A-Z]{1,2})(?:\/([A-Z]{2}))?\]/
const URL_RE = /https?:\/\/[^\s]+/g
const DOI_RE = /(?:DOI\s*:\s*)?(10\.\d{4,9}\/[^\s]+)/i
const CITED_DATE_RE = /\[(\d{4}-\d{1,2}(?:-\d{1,2})?)\]/
/**
 * 标准编号：发布机构代号 + 编号 + 年份，如 GB/T 3792—2021、NB/T 10386—2020、ISO 21378:2019、
 * IEC/IEEE 61636-1:2021、IEEE P802.11ba/D8.0-2020、AIAA G-136-2022、ISO/IEC 80079-20-2:2016(en)。
 * 第 2 组是年份。
 */
const STANDARD_NO_RE = /^((?:GB|GJB|[A-Z]{2,6})(?:\/[A-Z]{1,6})*\s?[^\s]*?\d[^\s]*?\s?[—–\-:]\s?(\d{4})(?:\([a-z]{2}\))?)(?=\s|$)\s*/
/** 标准号出现在题名后的其他题名信息里（2015 版写法） */
const STANDARD_NO_ANY_RE =
  /((?:GB\/[TZ]|GB|GJB|[A-Z]{2}\/T|ISO(?:\/IEC)?|IEC|IEEE|ASTM)\s?[A-Z]?\s?\d+(?:\.\d+)*(?:-\d+)?\s?[—–\-]\s?(\d{4}))/
const EDITION_RE = /^(\d+\s*版|[一二三四五六七八九十]+版|修订版|\d+(?:st|nd|rd|th)\s*ed|Rev\.?\s*ed|[A-Za-z]+\s*ed)$/i
const OTHER_RESP_RE = /^(.+?)\s*,?\s*(译|编译|译注|校注|注|校|编|主编|改编|整理|等译|trans|tr|ed|eds)$/i
/** 出版项：地:出版者,年[:页码]；年也可以是完整日期 */
const PUBLICATION_RE = /^(.+?)\s*:\s*(.+?)\s*,\s*(\d{4}(?:-\d{1,2}(?:-\d{1,2})?)?)(?:\s*:\s*(.+))?$/
/** 只有出版者和年（缺出版地）或只有年 */
const PUBLISHER_YEAR_RE = /^(.+?)\s*,\s*(\d{4})(?:\s*:\s*(.+))?$/

/** 按句点切分，但不切小数点和保护起来的 [S.l.]、[s.n.]、ed. 等缩写 */
function splitSegments(s: string): string[] {
  const protectedText = s
    .replace(/\[S\.l\.\]/gi, '[S_l_]')
    .replace(/\[s\.n\.\]/gi, '[s_n_]')
    .replace(/\b(Rev|Vol|No|pp|Jr|St|Inc|Co|Ltd)\./g, '$1§')
  return protectedText
    .split(/(?<!\d)\.\s*|\.(?!\d)\s*/)
    .map((p) => p.replace(/\[S_l_\]/g, '[S.l.]').replace(/\[s_n_\]/g, '[s.n.]').replace(/§/g, '.').trim())
    .filter((p) => p.length > 0)
}

function stripEndPunct(s: string): string {
  return s.replace(/^[.\s]+|[.\s]+$/g, '')
}

interface Online {
  rest: string
  urls: string[]
  doi?: string
  accessed?: string
  /** 网页、数据集等写在 (日期) 里的发布或修改日期 */
  parenDate?: string
}

/** 取出访问路径、DOI、引用日期，剩下的是出处部分 */
function takeOnline(tail: string): Online {
  let rest = tail
  let doi: string | undefined
  const doiTag = rest.match(/\.?\s*DOI\s*:\s*(10\.\d{4,9}\/[^\s]+?)\.?\s*$/i)
  if (doiTag) {
    doi = doiTag[1]
    rest = rest.slice(0, doiTag.index)
  }
  const urls: string[] = []
  rest = rest.replace(URL_RE, (u) => {
    urls.push(u.replace(/[.,;]+$/, ''))
    return ' '
  })
  if (!doi) {
    for (const u of urls) {
      const m = u.match(/doi\.org\/(10\.\d{4,9}\/\S+)/i)
      if (m) doi = m[1]
    }
  }
  if (!doi) {
    const bare = rest.match(DOI_RE)
    if (bare) {
      doi = bare[1].replace(/\.$/, '')
      rest = rest.replace(bare[0], ' ')
    }
  }
  let accessed: string | undefined
  const cited = rest.match(CITED_DATE_RE)
  if (cited) {
    accessed = cited[1]
    rest = rest.replace(cited[0], ' ')
  }
  let parenDate: string | undefined
  const paren = rest.match(/\((\d{4}(?:-\d{1,2}(?:-\d{1,2})?)?)\)/)
  if (paren) {
    parenDate = paren[1]
    rest = rest.slice(0, paren.index) + rest.slice((paren.index ?? 0) + paren[0].length)
  }
  return { rest: stripEndPunct(rest.replace(/\s+\./g, '.').replace(/\.{2,}/g, '.').replace(/\s{2,}/g, ' ')), urls, doi, accessed, parenDate }
}

/** 拆"作者.题名"；没有句点时整段是题名（无责任者，或标准文献以编号开头） */
function splitHead(head: string, typeCode: string | null): { authors: string | null; title: string } {
  const h = stripEndPunct(head)
  if (typeCode === 'S' && STANDARD_NO_RE.test(h)) return { authors: null, title: h }
  // U.S.、U.K. 这类缩写里的句点不是作者与题名的分界
  const abbr = h.match(/^(?:[A-Z]\.){2,}\s*/)
  if (abbr) {
    const rest = splitHead(h.slice(abbr[0].length), typeCode)
    return rest.authors !== null ? { authors: abbr[0] + rest.authors, title: rest.title } : { authors: null, title: h }
  }
  // 第一个句点：前面不是数字或后面不是数字（避开 2.0、3.1 这类）
  const m = h.match(/^(.+?)(?:(?<!\d)\.|\.(?!\d))\s*(.+)$/)
  if (!m) return { authors: null, title: h }
  return { authors: m[1].trim(), title: m[2].trim() }
}

function names(seg: string | null): { list: CslName[]; etAl: boolean } {
  if (!seg) return { list: [], etAl: false }
  const { names, etAl } = parseNameList(seg)
  return { list: names, etAl }
}

/** 解析出版项一段（如 "北京:中华书局,2000:29"） */
function applyPublication(seg: string, item: CslItem, warnings: string[]): boolean {
  const pub = seg.match(PUBLICATION_RE)
  if (pub) {
    item['publisher-place'] = pub[1].trim()
    item.publisher = pub[2].trim()
    item.issued = dateFrom(pub[3])
    if (pub[4]) item.page = pub[4].trim()
    return true
  }
  const py = seg.match(PUBLISHER_YEAR_RE)
  if (py) {
    item.publisher = py[1].trim()
    item.issued = dateFrom(py[2])
    if (py[3]) item.page = py[3].trim()
    warnings.push('出版项缺出版地')
    return true
  }
  // 报告、档案等联机资源只写完整日期：".2012-01-16."
  const dateOnly = seg.match(/^(\d{4}-\d{1,2}-\d{1,2})$/)
  if (dateOnly) {
    item.issued = dateFrom(dateOnly[1])
    return true
  }
  const yearOnly = seg.match(/^(\d{4})(?:\s*:\s*(.+))?$/)
  if (yearOnly) {
    item.issued = dateFrom(yearOnly[1])
    if (yearOnly[2]) item.page = yearOnly[2].trim()
    warnings.push('出版项只有年份')
    return true
  }
  return false
}

/** 专著、学位论文、报告、汇编、旧版标准等"[类型].其他责任者.版本.出版项"结构 */
function parseBookTail(rest: string, item: CslItem, warnings: string[]) {
  const segs = splitSegments(rest)
  let pubFound = false
  for (const seg of segs) {
    const resp = seg.match(OTHER_RESP_RE)
    if (EDITION_RE.test(seg)) {
      item.edition = seg.replace(/\s*版$/, '').replace(/\s*ed$/i, '')
    } else if (!pubFound && applyPublication(seg, item, warnings)) {
      pubFound = true
    } else if (resp && !pubFound) {
      const list = parseNameList(resp[1]).names
      if (/译|trans|tr/i.test(resp[2])) item.translator = list
      else item.editor = list
    } else if (/^V\d|^版本|^v\d/i.test(seg)) {
      item.version = seg
    } else {
      warnings.push(`未识别的著录项：${seg}`)
    }
  }
  if (!pubFound) warnings.push('未找到出版项')
}

/** 期刊析出："刊名,年,卷(期):页码"；在线优先出版："刊名,2024-05-09" */
function parseJournalTail(rest: string, item: CslItem, warnings: string[]) {
  let r = rest
  // 析出文献的译者："顾幼静,译.东方博物,2009(1):85-92"
  const tr = r.match(/^(.+?)\s*,\s*(译|编译)\s*\.\s*(.+)$/)
  if (tr) {
    item.translator = parseNameList(tr[1]).names
    r = tr[3]
  }
  const online = r.match(/^(.+?)\s*,\s*(\d{4}-\d{1,2}-\d{1,2})$/)
  if (online) {
    item['container-title'] = online[1].trim()
    item.issued = dateFrom(online[2])
    return
  }
  const m = r.match(/^(.+?)\s*,\s*(\d{4})(?:\s*,\s*([^(:]+?))?\s*(?:\(([^)]+)\))?\s*(?::\s*(.+?))?$/)
  if (!m) {
    warnings.push('期刊出处没拆开（应为"刊名,年,卷(期):页码"）')
    item['container-title'] = r
    return
  }
  item['container-title'] = m[1].trim()
  item.issued = dateFrom(m[2])
  if (m[3]) item.volume = m[3].trim()
  if (m[4]) item.issue = m[4].trim().replace(/^0+(?=\d)/, '')
  if (m[5]) item.page = m[5].trim()
  if (!m[5]) warnings.push('期刊文献缺页码')
}

/** 连续出版物整体："[J].1984,1(1)-.武汉:……,1984" 或 "[J].1957(1)-1990(4).北京:……" */
const SERIAL_RE = /^\d{4}\s*(?:,\s*[^(.]*?)?\(\d+\)\s*-\s*(?:\d{4}\s*(?:,\s*[^(.]*?)?\(\d+\))?\s*(?:\.|$)/

function parseSerialTail(rest: string, item: CslItem, warnings: string[]) {
  item.type = 'periodical'
  const m = rest.match(SERIAL_RE)!
  item.issued = dateFrom(m[0].slice(0, 4))
  const pub = rest.slice(m[0].length).trim()
  if (pub) {
    const p = pub.match(/^(.+?)\s*:\s*(.+?)\s*,\s*\d{4}/)
    if (p) {
      item['publisher-place'] = p[1].trim()
      item.publisher = p[2].trim()
    } else warnings.push(`未识别的著录项：${pub}`)
  }
}

/** 析出文献 "//" 之后的部分：专著主要责任者.专著题名.出版项，或会议名称,年份:页码 */
function parseParent(parent: string, item: CslItem, warnings: string[]) {
  const segs = splitSegments(parent)
  // 2025 版会议论文："会议名称,会议年份:页码"
  if (segs.length === 1) {
    const ev = segs[0].match(/^(.+?)\s*,\s*(\d{4})(?:\s*:\s*(.+))?$/)
    if (ev) {
      item['event-title'] = ev[1].trim()
      item['container-title'] = ev[1].trim()
      item.issued = dateFrom(ev[2])
      if (ev[3]) item.page = ev[3].trim()
      return
    }
    item['container-title'] = segs[0]
    warnings.push('析出来源只有题名')
    return
  }
  const last = segs[segs.length - 1]
  const hasPub = PUBLICATION_RE.test(last) || PUBLISHER_YEAR_RE.test(last)
  const body = hasPub ? segs.slice(0, -1) : segs
  if (body.length >= 2) {
    item.editor = parseNameList(body[0]).names
    item['container-title'] = body.slice(1).join('.')
  } else if (body.length === 1) {
    item['container-title'] = body[0]
  }
  if (hasPub) applyPublication(last, item, warnings)
  else warnings.push('析出来源未找到出版项')
}

export function parseGbt7714(entry: string, fallbackIndex: number | null = null): StructuredReference {
  const warnings: string[] = []
  const idx = entry.match(INDEX_RE)
  const raw = entry.replace(INDEX_RE, '').trim()
  const text = normalizePunctuation(raw).replace(/\s+/g, ' ')
  const tag = text.match(TYPE_TAG_RE)
  const typeCode = tag?.[1] ?? null
  const carrier = tag?.[2] ?? null

  const head = tag ? text.slice(0, tag.index) : text
  let tail = tag ? text.slice((tag.index ?? 0) + tag[0].length) : ''
  if (!tag) warnings.push('没有文献类型标识，按"作者.题名.其余"粗拆')

  // 析出文献
  let parent: string | null = null
  // 析出文献；"//"前可能有析出部分的译者："[M].姜海伦,译//《环球科学》杂志社.……"
  let chapterTranslator: string | null = null
  const slash = tail.match(/^\s*(?:\.\s*(.+?)\s*,\s*(?:译|编译)\s*)?\/\/\s*(.*)$/)
  if (slash) {
    chapterTranslator = slash[1] ?? null
    parent = slash[2]
    tail = ''
  }

  const online = takeOnline(parent ?? tail)
  const { authors: authorSeg, title: titleRaw } = splitHead(head, typeCode)
  const auth = names(authorSeg)
  let title = titleRaw

  const csl: CslItem = { id: String(idx ? Number(idx[1] ?? idx[2]) : (fallbackIndex ?? '')), type: typeCode ? (TYPE_CODE_TO_CSL[typeCode] ?? 'document') : 'document' }
  if (auth.list.length) csl.author = auth.list

  if (parent !== null) {
    csl.type = typeCode === 'C' ? 'paper-conference' : 'chapter'
    if (chapterTranslator) csl.translator = parseNameList(chapterTranslator).names
    parseParent(online.rest, csl, warnings)
  } else if (!tag) {
    const segs = splitSegments(online.rest)
    if (segs.length) warnings.push(`其余部分未拆分：${segs.join('.')}`)
  } else {
    switch (typeCode) {
      case 'J':
        if (SERIAL_RE.test(online.rest)) parseSerialTail(online.rest, csl, warnings)
        else parseJournalTail(online.rest, csl, warnings)
        break
      case 'N': {
        const n = online.rest.match(/^(.+?)\s*,\s*(\d{4}-\d{1,2}-\d{1,2})\s*(?:\(([^)]+)\))?$/)
        if (n) {
          csl['container-title'] = n[1].trim()
          csl.issued = dateFrom(n[2])
          if (n[3]) csl.page = n[3].trim()
        } else {
          // 版次括号可能被 takeOnline 当成日期以外的内容保留，这里再试一次 "报纸名,日期"
          warnings.push('报纸出处没拆开（应为"报纸名,出版日期(版次)"）')
          csl['container-title'] = online.rest
        }
        break
      }
      case 'P': {
        const pn = title.match(/^(.+?)\s*:\s*([A-Z]{0,2}\s?[\dX.]{6,}[A-Z]?\d?)$/)
        if (pn) {
          title = pn[1].trim()
          csl.number = pn[2].trim()
        } else warnings.push('专利题名后未找到专利号')
        const d = online.rest.match(/(\d{4}-\d{1,2}-\d{1,2})/)
        if (d) csl.issued = dateFrom(d[1])
        break
      }
      case 'EB':
      case 'DS':
      case 'PP':
        parseOnlineResourceTail(online, csl, warnings)
        break
      case 'S': {
        const lead = title.match(STANDARD_NO_RE)
        if (lead) {
          csl.number = lead[1].trim()
          csl.issued = dateFrom(lead[2])
          title = title.slice(lead[0].length).trim()
        } else {
          const any = title.match(STANDARD_NO_ANY_RE)
          if (any) {
            csl.number = any[1].trim()
            if (!csl.issued) csl.issued = dateFrom(any[2])
            title = stripEndPunct(title.replace(any[0], '').replace(/:\s*$/, '').replace(/:\s*:/, ':'))
          } else warnings.push('未找到标准编号')
        }
        // 2015 版带出版项，2025 版没有
        if (online.rest) parseBookTail(online.rest, csl, warnings)
        break
      }
      default: {
        // 报告编号、档案号写在题名后："……最终报告:7178999X-2006BAK04A10/10.2013[R]"
        if (typeCode === 'R' || typeCode === 'A') {
          const no = title.match(/^(.+?)\s*:\s*([A-Za-z0-9][A-Za-z0-9\-\/. ]*\d[A-Za-z0-9\-\/.]*)$/)
          if (no) {
            title = no[1].trim()
            csl.number = no[2].trim()
          }
        }
        parseBookTail(online.rest, csl, warnings)
        if (typeCode === 'D') csl.genre = '学位论文'
        if (typeCode === 'D' && csl.publisher === undefined) warnings.push('学位论文缺授予单位')
      }
    }
    // 网页、数据集等的 (日期) 已在 takeOnline 中取出；其他类型若有，作为出版日期的补充
    if (online.parenDate && !csl.issued) csl.issued = dateFrom(online.parenDate)
  }

  if (title) csl.title = title
  else warnings.push('未识别出题名')
  if (online.urls.length) csl.URL = online.urls[0]
  if (online.doi) csl.DOI = online.doi.replace(/[.,;]+$/, '')
  if (online.accessed) csl.accessed = dateFrom(online.accessed)
  if (carrier === 'OL' && !online.urls.length) warnings.push('标了 /OL 但没有访问路径')

  return {
    csl,
    source: 'gbt7714',
    typeCode,
    carrier,
    etAl: auth.etAl,
    index: idx ? Number(idx[1] ?? idx[2]) : fallbackIndex,
    raw,
    warnings,
  }
}

/** 网页、数据集、预印本："[EB/OL].(发布日期)[引用日期].URL" 或 "[PP/OL].版本.平台(日期)[引用日期].URL" */
function parseOnlineResourceTail(online: Online, item: CslItem, warnings: string[]) {
  if (online.parenDate) item.issued = dateFrom(online.parenDate)
  for (const seg of splitSegments(online.rest)) {
    if (/^V?\d+(\.\d+)*$/i.test(seg) || /^版本/.test(seg) || /^v\d/i.test(seg)) item.version = seg
    else if (!item.publisher) item.publisher = seg
    else warnings.push(`未识别的著录项：${seg}`)
  }
}
