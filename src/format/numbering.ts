/**
 * Word 自动编号（numbering.xml）的渲染：按文档顺序数出每个编号段落显示的编号文字，
 * 如"第1章""1.2""[3]"。只覆盖论文里常见的写法；遇到认不出的编号格式返回 null（按"无法判断"处理）。
 *
 * 按 ECMA-376 §17.9 的规则：
 * - 计数按抽象编号（abstractNum）共享；指向同一抽象编号的 num 共用计数，num 里的 startOverride 会把该级重新起头
 * - 某一级计数时，比它低的级别重新开始（lvlRestart 可以改成"某级之后才重新开始"或"从不"）
 * - lvlText 里的 %N 换成第 N 级的当前编号；isLgl 时上级编号一律用阿拉伯数字
 * - 还没出现过的上级按"起始值 − 1"显示（Word 里常见的"0.1"就是这么来的）
 */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'

type El = Element

interface Level {
  start: number
  fmt: string
  text: string | null
  isLgl: boolean
  /** 在第几级（1 起）之后重新开始；0 = 从不；undefined = 任何上级出现都重新开始 */
  restart: number | undefined
  pStyle: string | null
  suff: 'tab' | 'space' | 'nothing'
}

interface AbstractNum {
  levels: (Level | undefined)[]
  numStyleLink: string | null
}

interface NumDef {
  abstractId: string
  /** lvlOverride：整级替换和/或重新起头 */
  levels: Map<number, Level>
  startOverride: Map<number, number>
}

function child(el: El | null | undefined, local: string, ns = W): El | null {
  if (!el) return null
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as El).localName === local && (n as El).namespaceURI === ns) return n as El
  }
  return null
}

function children(el: El, local: string, ns = W): El[] {
  const out: El[] = []
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as El).localName === local && (n as El).namespaceURI === ns) out.push(n as El)
  }
  return out
}

function attr(el: El | null | undefined, local: string): string | null {
  if (!el) return null
  const v = el.getAttributeNS(W, local)
  if (v !== null && v !== '') return v
  return el.getAttribute(`w:${local}`) || null
}

function int(v: string | null): number | undefined {
  if (v === null) return undefined
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : undefined
}

/** 直接子元素里找；找不到时看 mc:AlternateContent 的 Fallback（Word/WPS 写自定义编号格式时这样包一层） */
function childOrFallback(el: El, local: string): El | null {
  const direct = child(el, local)
  if (direct) return direct
  for (const ac of children(el, 'AlternateContent', MC)) {
    const fb = child(child(ac, 'Fallback', MC), local)
    if (fb) return fb
  }
  return null
}

function readLevel(lvl: El): Level {
  const restart = int(attr(child(lvl, 'lvlRestart'), 'val'))
  const suff = attr(child(lvl, 'suff'), 'val')
  const lgl = child(lvl, 'isLgl')
  return {
    start: int(attr(child(lvl, 'start'), 'val')) ?? 0,
    fmt: attr(childOrFallback(lvl, 'numFmt'), 'val') ?? 'decimal',
    text: child(lvl, 'lvlText') ? (attr(child(lvl, 'lvlText'), 'val') ?? '') : null,
    isLgl: lgl !== null && !/^(0|false|off)$/i.test(attr(lgl, 'val') ?? ''),
    restart,
    pStyle: attr(child(lvl, 'pStyle'), 'val'),
    suff: suff === 'space' || suff === 'nothing' ? suff : 'tab',
  }
}

// ---------- 编号格式 ----------

const CN_DIGITS = '〇一二三四五六七八九'
const CN_LEGAL = '零壹贰叁肆伍陆柒捌玖'
const TIANGAN = '甲乙丙丁戊己庚辛壬癸'
const DIZHI = '子丑寅卯辰巳午未申酉戌亥'

/** 小写中文数字：1 → 一，10 → 十，21 → 二十一，105 → 一百零五 */
function chineseCounting(n: number, digits = CN_DIGITS, units = ['', '十', '百', '千']): string {
  if (n === 0) return digits[0]
  if (n >= 10000) return String(n)
  const ds = String(n).split('').map(Number)
  let out = ''
  let zero = false
  ds.forEach((d, i) => {
    const unit = units[ds.length - 1 - i]
    if (d === 0) {
      zero = out !== ''
      return
    }
    if (zero) out += digits === CN_DIGITS ? '零' : digits[0]
    zero = false
    out += digits[d] + unit
  })
  // 10–19 读作"十、十一"，不是"一十"
  if (digits === CN_DIGITS && n >= 10 && n < 20) out = out.slice(1)
  return out
}

function roman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n)
  const table: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let out = ''
  for (const [v, s] of table) while (n >= v) (out += s), (n -= v)
  return out
}

/** Word 的字母编号：A…Z，然后 AA…ZZ，AAA… */
function letter(n: number): string {
  if (n <= 0) return String(n)
  const ch = String.fromCharCode(65 + ((n - 1) % 26))
  return ch.repeat(Math.floor((n - 1) / 26) + 1)
}

/** 编号格式 → 文字；认不出的格式返回 null */
export function formatNumber(n: number, fmt: string): string | null {
  switch (fmt) {
    case 'decimal':
      return String(n)
    case 'decimalZero':
      return n < 10 ? `0${n}` : String(n)
    case 'decimalFullWidth':
    case 'decimalFullWidth2':
      return String(n).replace(/\d/g, (d) => String.fromCharCode(0xff10 + Number(d)))
    case 'decimalEnclosedCircle':
    case 'decimalEnclosedCircleChinese':
      return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n)
    case 'decimalEnclosedParen':
      return n >= 1 && n <= 20 ? String.fromCharCode(0x2474 + n - 1) : `(${n})`
    case 'decimalEnclosedFullstop':
      return n >= 1 && n <= 20 ? String.fromCharCode(0x2488 + n - 1) : `${n}.`
    case 'upperRoman':
      return roman(n)
    case 'lowerRoman':
      return roman(n).toLowerCase()
    case 'upperLetter':
      return letter(n)
    case 'lowerLetter':
      return letter(n).toLowerCase()
    case 'chineseCounting':
    case 'chineseCountingThousand':
    case 'ideographDigital':
      return fmt === 'ideographDigital' ? String(n).split('').map((d) => CN_DIGITS[Number(d)]).join('') : chineseCounting(n)
    case 'chineseLegalSimplified':
      return chineseCounting(n, CN_LEGAL, ['', '拾', '佰', '仟'])
    case 'ideographTraditional':
      return n >= 1 && n <= 10 ? TIANGAN[n - 1] : String(n)
    case 'ideographZodiac':
      return n >= 1 && n <= 12 ? DIZHI[n - 1] : String(n)
    case 'none':
      return ''
    default:
      return null
  }
}

// ---------- 编号定义与计数 ----------

export interface ListLabel {
  /** 显示的编号文字，如"第1章""1.2""[3]"；项目符号是符号本身 */
  text: string
  /** 编号后面跟的分隔：制表符、空格或什么都没有 */
  suffix: '\t' | ' ' | ''
  bullet: boolean
}

/** 段落样式查询：样式 id → 该样式（沿 basedOn 链）上写的 numId / ilvl */
export type StyleNumLookup = (styleId: string) => { numId?: string; ilvl?: number } | null

export class Numbering {
  private abstracts = new Map<string, AbstractNum>()
  private nums = new Map<string, NumDef>()
  /** 抽象编号 id → 各级当前计数（undefined 表示这一级还没出现） */
  private counters = new Map<string, (number | undefined)[]>()
  /** 已经用过的 num，startOverride 只在第一次用到时起作用 */
  private seenNums = new Set<string>()

  constructor(doc: Document | null, private styleNum: StyleNumLookup = () => null) {
    if (!doc) return
    const root = doc.documentElement
    for (const a of children(root, 'abstractNum')) {
      const id = attr(a, 'abstractNumId')
      if (id === null) continue
      const levels: (Level | undefined)[] = []
      for (const lvl of children(a, 'lvl')) {
        const i = int(attr(lvl, 'ilvl'))
        if (i !== undefined && i >= 0 && i < 9) levels[i] = readLevel(lvl)
      }
      this.abstracts.set(id, { levels, numStyleLink: attr(child(a, 'numStyleLink'), 'val') })
    }
    for (const n of children(root, 'num')) {
      const id = attr(n, 'numId')
      const abstractId = attr(child(n, 'abstractNumId'), 'val')
      if (id === null || abstractId === null) continue
      const levels = new Map<number, Level>()
      const startOverride = new Map<number, number>()
      for (const o of children(n, 'lvlOverride')) {
        const i = int(attr(o, 'ilvl'))
        if (i === undefined) continue
        const lvl = child(o, 'lvl')
        if (lvl) levels.set(i, readLevel(lvl))
        const so = int(attr(child(o, 'startOverride'), 'val'))
        if (so !== undefined) startOverride.set(i, so)
      }
      this.nums.set(id, { abstractId, levels, startOverride })
    }
  }

  get empty(): boolean {
    return this.nums.size === 0
  }

  /** num → 实际使用的抽象编号 id（处理 numStyleLink 跳转到编号样式） */
  private resolveAbstract(numId: string): string | null {
    let abstractId = this.nums.get(numId)?.abstractId ?? null
    for (let guard = 0; abstractId && guard < 5; guard++) {
      const link = this.abstracts.get(abstractId)?.numStyleLink
      if (!link) return abstractId
      const linkedNum = this.styleNum(link)?.numId
      const next = linkedNum ? this.nums.get(linkedNum)?.abstractId ?? null : null
      if (!next || next === abstractId) return abstractId
      abstractId = next
    }
    return abstractId
  }

  private level(numId: string, abstractId: string, ilvl: number): Level | undefined {
    return this.nums.get(numId)?.levels.get(ilvl) ?? this.abstracts.get(abstractId)?.levels[ilvl]
  }

  /** 没写 ilvl 时：找抽象编号里关联了这个段落样式的级别（多级列表链接到标题样式的常见写法），否则第 1 级 */
  levelForStyle(numId: string, styleId: string | null): number {
    const abstractId = this.resolveAbstract(numId)
    if (!abstractId || !styleId) return 0
    const i = this.abstracts.get(abstractId)?.levels.findIndex((l) => l?.pStyle === styleId) ?? -1
    return i >= 0 ? i : 0
  }

  /**
   * 数到下一个编号段落，返回它显示的编号；numId 不存在、级别没定义或格式认不出时返回 null。
   * 必须按文档顺序对每个编号段落调用一次。
   */
  next(numId: string, ilvl: number): ListLabel | null {
    const def = this.nums.get(numId)
    const abstractId = this.resolveAbstract(numId)
    if (!def || !abstractId) return null
    const lvl = this.level(numId, abstractId, ilvl)
    if (!lvl) return null

    let counts = this.counters.get(abstractId)
    if (!counts) this.counters.set(abstractId, (counts = []))
    // 这个 num 第一次出现：startOverride 让对应级别从指定值重新开始（Word 的"重新开始编号"）
    if (!this.seenNums.has(numId)) {
      this.seenNums.add(numId)
      for (const [i, v] of def.startOverride) counts[i] = v - 1
    }

    counts[ilvl] = counts[ilvl] === undefined ? lvl.start : counts[ilvl]! + 1
    // 下级重新开始
    for (let k = ilvl + 1; k < 9; k++) {
      const sub = this.level(numId, abstractId, k)
      const restartAfter = sub?.restart
      if (restartAfter === 0) continue
      if (restartAfter === undefined || ilvl + 1 <= restartAfter) counts[k] = undefined
    }

    if (lvl.fmt === 'bullet') return { text: lvl.text ?? '', suffix: suffixOf(lvl), bullet: true }
    if (lvl.text === null) return null
    let unknown = false
    const text = lvl.text.replace(/%([1-9])/g, (_, d: string) => {
      const k = Number(d) - 1
      const kl = this.level(numId, abstractId, k)
      if (!kl) {
        unknown = true
        return ''
      }
      const value = counts![k] ?? kl.start - 1
      // isLgl：本级编号文字里的各级都用阿拉伯数字（"第一章"下面的"1.1"）
      const fmt = lvl.isLgl ? 'decimal' : k === ilvl ? lvl.fmt : kl.fmt
      const s = formatNumber(value, fmt)
      if (s === null) unknown = true
      return s ?? ''
    })
    return unknown ? null : { text, suffix: suffixOf(lvl), bullet: false }
  }
}

function suffixOf(l: Level): '\t' | ' ' | '' {
  return l.suff === 'space' ? ' ' : l.suff === 'nothing' ? '' : '\t'
}
