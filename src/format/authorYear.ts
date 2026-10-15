/**
 * 引用对账（著者-出版年制）：抽出正文里"作者, 年份"式的引用，按第一著者加出版年（含 a、b 后缀）
 * 和参考文献表逐条对上。
 *
 * 识别的写法：
 * - 括号式：（张三, 2020）、(Smith & Jones, 2019a)、（张三等, 2020; 李四, 2021）、(Smith, 2019, 2020b)、(Lee, 2018: 15)
 * - 叙述式：张三（2020）、张三等（2020a）、Smith et al. (2019)、Smith and Jones (2019)
 * 叙述式的中文著者没有边界（"根据张三（2020）"），只在括号前面正好是文献表里某位第一著者时才算；
 * 认不出著者的引用记"无法判断"，不会当成"文献表里没有"。
 */

import type { DocxModel, Paragraph } from './docx'
import { parseReference, surnameOf } from '../references/parse'
import { referenceText } from './checks/references'
import { citingParagraphs } from './citations'
import type { Structure } from './structure'

export interface AuthorYearCitation {
  /** 原文，如 "（张三等, 2020a）" 或 "Smith (2019)" 里对应的一项 */
  raw: string
  /** 著者写法原样，如 "张三"、"Smith"；认不出时为 null */
  author: string | null
  year: number
  /** 同一著者同年多篇时的 a、b 后缀 */
  suffix: string | null
  paragraph: number
  narrative: boolean
}

export interface AuthorYearEntry {
  /** 第一著者（原样）和出版年；读不出为 null */
  author: string | null
  year: number | null
  suffix: string | null
  paragraph: number
  timesCited: number
  /** 第一次被引用的那条在 citations 里的下标 */
  firstCitation: number | null
}

export interface AuthorYearReconciliation {
  citations: AuthorYearCitation[]
  entries: AuthorYearEntry[]
  /** 文献表里找不到这位著者的引用（citations 下标） */
  missing: number[]
  /** 著者对得上、年份对不上（citations 下标 + 文献表里这位著者的年份） */
  yearMismatch: { citation: number; listed: string[] }[]
  /** 同一著者同年有几篇、正文没写 a/b 区分不出是哪篇（citations 下标） */
  needSuffix: number[]
  /** 文献表中同一著者同年多篇却没加 a、b 的组（entries 下标） */
  listSuffixMissing: number[][]
  /** 文献表里有、正文没引的条目（entries 下标；只算读得出著者和年份的） */
  uncited: number[]
  /** 读不出著者或年份的文献表条目（entries 下标） */
  unreadEntries: number[]
  /** 像引用却认不出著者的写法 */
  unresolved: { raw: string; paragraph: number }[]
  /** 正文里的脚注、尾注引用标记个数（脚注里的引用读不到） */
  noteRefs: number
}

const YEAR = String.raw`(?:19|20)\d{2}`
/** 一项里的年份列表：2019、2019a、2019, 2020b、2019a,b */
const YEARS_RE = new RegExp(String.raw`(${YEAR})([a-z])?(?:\s*[,，、]\s*([a-z])(?![a-z]))?`, 'g')
const PAREN_RE = /[（(]([^（）()]{2,200})[)）]/g
/** 括号里一项："著者, 年份[, 年份…][: 页码 / , p. 页码]" */
const ITEM_RE = new RegExp(String.raw`^(.*?)[,，]?\s*(${YEAR}[a-z]?(?:\s*[,，、]\s*(?:${YEAR}[a-z]?|[a-z](?![a-z])))*)\s*(?:[:：]\s*\S+|[,，]\s*pp?\.\s*\S+)?$`)
/** 叙述式年份括号：（2020）、(2019a)、（2019a, 2020） */
const NARRATIVE_PAREN = new RegExp(String.raw`^\s*${YEAR}[a-z]?(?:\s*[,，、]\s*${YEAR}[a-z]?)*\s*(?:[:：]\s*\S+)?\s*$`)
const LEADING_WORDS = /^(?:见|参见|参看|如|例如|转引自|e\.g\.,?|see(?: also)?|cf\.)\s*/i
const CN_AUTHOR = /^[㐀-鿿·]{2,20}?(?:等|等人)?$/
const WESTERN_AUTHOR = /^((?:(?:van|von|de|der|den|du|la|le|da|di)\s+)*[A-Z][A-Za-z'’\-]+)(?:\s*(?:,\s*[A-Z][A-Za-z'’\-]+)*\s*(?:,?\s*(?:&|and)\s*[A-Z][A-Za-z'’\-]+)|\s+et\s+al\.?)?$/
const WESTERN_BEFORE = /((?:(?:van|von|de|der|den|du|la|le|da|di)\s+)*[A-Z][A-Za-z'’\-]+)(?:\s+(?:et\s+al\.?|(?:&|and)\s+[A-Z][A-Za-z'’\-]+))?\s*$/

function norm(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s·'’\-]/g, '').toLowerCase()
}

/** 中文著者去掉"等""和某某""、某某"，西文著者取第一个姓 */
function firstAuthor(part: string): string | null {
  const t = part.replace(LEADING_WORDS, '').trim().replace(/[,，]$/, '').trim()
  if (!t) return null
  const cn = t.split(/[和与及、,，]/)[0].replace(/等人?$/, '').trim()
  if (CN_AUTHOR.test(cn) && /[㐀-鿿]/.test(cn)) return cn
  const w = t.match(WESTERN_AUTHOR)
  return w ? w[1] : null
}

/** 文献表一条的第一著者姓（可能有几种写法）和出版年 */
function entryKey(text: string): { author: string | null; names: string[]; year: number | null; suffix: string | null } {
  const parsed = parseReference(text, 0)
  const a = parsed.authors[0]?.trim() ?? null
  const names = new Set<string>()
  if (a) {
    // "LECUN Y" → LECUN；"van der Berg K" → van der Berg；"Braun, V." → Braun；"Yann LeCun" → 两种都留
    const stripped = a.split(',')[0].replace(/(\s+[A-Z]{1,3}\.?)+$/, '').replace(/\s+[A-Z]\.(\s*[A-Z]\.)*$/, '').trim()
    names.add(norm(stripped))
    names.add(norm(surnameOf(a)))
  }
  // 著者-出版年制把年份放在著者后面："张三. 2020a. 题名"；找第一个独立的年份，后缀紧跟在年份后
  const m = text.match(new RegExp(String.raw`(?:^|[.,，．\s(（])(${YEAR})([a-z])?(?=[.,，．\s)）]|$)`))
  const year = m ? Number(m[1]) : parsed.year
  return { author: a, names: [...names].filter(Boolean), year, suffix: m?.[2] ?? null }
}

function parseYears(s: string): { year: number; suffix: string | null }[] {
  const out: { year: number; suffix: string | null }[] = []
  for (const m of s.matchAll(YEARS_RE)) {
    out.push({ year: Number(m[1]), suffix: m[2] ?? null })
    if (m[3]) out.push({ year: Number(m[1]), suffix: m[3] }) // 2019a,b
  }
  return out
}

/** 一段里的著者-出版年引用；认不出著者的放进 unresolved。knownCn：文献表里的中文第一著者，用来切叙述式里的中文名 */
export function authorYearCitationsIn(p: Paragraph, knownCn: string[]): { citations: AuthorYearCitation[]; unresolved: string[] } {
  const citations: AuthorYearCitation[] = []
  const unresolved: string[] = []
  const text = p.text
  for (const m of text.matchAll(PAREN_RE)) {
    const inner = m[1]
    if (!new RegExp(YEAR).test(inner)) continue
    const before = text.slice(Math.max(0, m.index! - 40), m.index!)

    if (NARRATIVE_PAREN.test(inner)) {
      // 叙述式：括号里只有年份，著者在括号前面
      if (/[\d年]\s*$/.test(before)) continue // "2020 年（2020）"这类不是引用
      let author: string | null = null
      const cnBefore = before.trimEnd().replace(/等人?$/, '')
      if (/[㐀-鿿]$/.test(cnBefore)) {
        // 中文名没有边界：只认文献表里有的著者（取最长的那个）；"张三和李四（2020）"取张三
        const pick = (t: string) => knownCn.filter((n) => t.endsWith(n)).sort((a, b) => b.length - a.length)[0] ?? null
        author = pick(cnBefore) ?? pick(cnBefore.replace(/[和与及][㐀-鿿·]{2,6}$/, ''))
      } else author = before.match(WESTERN_BEFORE)?.[1] ?? null
      const years = parseYears(inner)
      if (!author) {
        unresolved.push(`${before.slice(-8).trim()}${m[0]}`)
        continue
      }
      const raw = `${before.slice(before.lastIndexOf(author))}${m[0]}`
      for (const y of years) citations.push({ raw, author, ...y, paragraph: p.index, narrative: true })
      continue
    }

    // 括号式：可能有好几项，用分号隔开
    for (const item of inner.split(/[;；]/)) {
      const t = item.trim()
      if (!new RegExp(YEAR).test(t)) continue
      const im = t.match(ITEM_RE)
      const author = im ? firstAuthor(im[1]) : null
      if (!im || !im[1].trim()) continue // 只有年份、没有著者：不是这种引用（如"（2020 年）"）
      if (!author) {
        unresolved.push(t)
        continue
      }
      for (const y of parseYears(im[2])) citations.push({ raw: t, author, ...y, paragraph: p.index, narrative: false })
    }
  }
  return { citations, unresolved }
}

export function reconcileAuthorYear(doc: DocxModel, s: Structure): AuthorYearReconciliation {
  const keys = s.refEntries.map((p) => entryKey(referenceText(p)))
  const entries: AuthorYearEntry[] = keys.map((k, i) => ({
    author: k.author, year: k.year, suffix: k.suffix, paragraph: s.refEntries[i].index, timesCited: 0, firstCitation: null,
  }))
  const readable = (i: number) => keys[i].names.length > 0 && keys[i].year !== null
  const unreadEntries = keys.flatMap((_, i) => (readable(i) ? [] : [i]))
  const knownCn = [...new Set(keys.map((k) => k.author).filter((a): a is string => !!a && /^[㐀-鿿·]{2,20}$/.test(a)))]

  const paras = citingParagraphs(doc, s)
  const citations: AuthorYearCitation[] = []
  const unresolved: AuthorYearReconciliation['unresolved'] = []
  for (const p of paras) {
    const r = authorYearCitationsIn(p, knownCn)
    citations.push(...r.citations)
    unresolved.push(...r.unresolved.map((raw) => ({ raw, paragraph: p.index })))
  }

  const missing: number[] = []
  const yearMismatch: AuthorYearReconciliation['yearMismatch'] = []
  const needSuffix: number[] = []
  /** 可能被引用（区分不出是哪篇）的条目，不算"没被引用" */
  const maybeCited = new Set<number>()
  const cite = (i: number, ci: number) => {
    entries[i].timesCited++
    if (entries[i].firstCitation === null) entries[i].firstCitation = ci
  }

  citations.forEach((c, ci) => {
    const name = norm(c.author!)
    const sameAuthor = keys.flatMap((k, i) => (k.names.includes(name) ? [i] : []))
    if (sameAuthor.length === 0) {
      // 叙述式的西文"著者"可能只是个大写开头的词（In China (2020)）；文献表里有读不出著者的条目时，
      // 也可能就是它。这两种都记"无法判断"，不当成"文献表里没有"
      if (c.narrative || unreadEntries.length) unresolved.push({ raw: c.raw, paragraph: c.paragraph })
      else missing.push(ci)
      return
    }
    const sameYear = sameAuthor.filter((i) => keys[i].year === c.year)
    if (sameYear.length === 0) {
      yearMismatch.push({ citation: ci, listed: [...new Set(sameAuthor.map((i) => `${keys[i].year ?? '?'}${keys[i].suffix ?? ''}`))] })
      // 多半就是引的这位著者的某篇，只是年份写错：这些条目不再算"没被引用"，免得同一问题报两次
      sameAuthor.forEach((i) => maybeCited.add(i))
      return
    }
    if (sameYear.length === 1) return void cite(sameYear[0], ci)
    const exact = sameYear.filter((i) => keys[i].suffix === c.suffix)
    if (c.suffix && exact.length === 1) return void cite(exact[0], ci)
    // 同年多篇：正文没写后缀或后缀对不上，区分不出是哪篇
    needSuffix.push(ci)
    sameYear.forEach((i) => maybeCited.add(i))
  })

  // 文献表：同一著者同年多篇却没加 a、b
  const groups = new Map<string, number[]>()
  keys.forEach((k, i) => {
    if (!readable(i)) return
    const g = `${k.names[0]}|${k.year}`
    groups.set(g, [...(groups.get(g) ?? []), i])
  })
  const listSuffixMissing = [...groups.values()].filter((g) => g.length > 1 && g.some((i) => !keys[i].suffix))

  const uncited = entries.flatMap((e, i) => (readable(i) && e.timesCited === 0 && !maybeCited.has(i) ? [i] : []))
  return {
    citations, entries, missing, yearMismatch, needSuffix, listSuffixMissing, uncited, unreadEntries, unresolved,
    noteRefs: paras.reduce((n, p) => n + p.noteRefs, 0),
  }
}
