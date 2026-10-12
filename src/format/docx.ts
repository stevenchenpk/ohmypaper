/**
 * docx 解析：在浏览器里把 Word 文件解成检查引擎要用的结构。
 *
 * 只读不写，也不追求完整还原 Word 的排版，只取格式体检需要的信息：
 * 每个段落的文字、样式、生效的字体字号行距，每个分节的页面设置和页眉页脚。
 * "生效"指按 Word 的继承顺序合并：文档默认 → 段落样式链 → 字符样式链 → 直接格式。
 */

import { unzipSync, strFromU8 } from 'fflate'
import { DOMParser } from '@xmldom/xmldom'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const DC = 'http://purl.org/dc/elements/1.1/'
const CP = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties'

// ---------- 对外的数据结构 ----------

export type LineSpacing =
  | { kind: 'multiple'; value: number } // 倍数，1 = 单倍
  | { kind: 'exact'; pt: number } // 固定值
  | { kind: 'atLeast'; pt: number } // 最小值

export type Align = 'left' | 'center' | 'right' | 'justify'

export interface Run {
  text: string
  /** 西文字体（w:ascii），已解析主题字体 */
  fontEn: string | null
  /** 中文字体（w:eastAsia），已解析主题字体 */
  fontCn: string | null
  sizePt: number | null
  bold: boolean
  superscript: boolean
}

export interface Paragraph {
  /** 在全文中的序号，0 起，只数段落 */
  index: number
  text: string
  styleId: string | null
  styleName: string | null
  /** 标题级别，1 起；不是标题为 null */
  headingLevel: number | null
  inTable: boolean
  /** 位于目录域或目录样式中 */
  inToc: boolean
  /** 使用了自动编号（列表） */
  numbered: boolean
  sectionIndex: number
  align: Align
  lineSpacing: LineSpacing
  /** 首行缩进：字符数（firstLineChars）优先，否则磅值 */
  firstLineChars: number | null
  firstLinePt: number | null
  spaceBefore: { lines: number | null; pt: number }
  spaceAfter: { lines: number | null; pt: number }
  runs: Run[]
  /** 含 Office 公式（m:oMath）；公式里的字不在 text 里 */
  hasMath: boolean
}

export interface HeaderFooter {
  text: string
  hasPageField: boolean
  /** 含页码域的那一段的对齐方式 */
  pageFieldAlign: Align | null
}

export type PageNumberFormat = 'arabic' | 'lower_roman' | 'upper_roman' | 'other'

export interface Section {
  index: number
  /** 本节最后一个段落的序号 */
  lastParagraph: number
  pageWidthCm: number | null
  pageHeightCm: number | null
  /** 单位厘米；文件里没写的边距为 null（装订线没写按 0） */
  margins: { top: number | null; bottom: number | null; left: number | null; right: number | null; gutter: number } | null
  pageNumberFormat: PageNumberFormat
  pageNumberStart: number | null
  titlePage: boolean
  mirrorMargins: boolean
  /** 已处理"与上一节相同"的继承；null 表示没有 */
  header: HeaderFooter | null
  footer: HeaderFooter | null
  evenHeader: HeaderFooter | null
  evenFooter: HeaderFooter | null
}

export interface DocxModel {
  paragraphs: Paragraph[]
  sections: Section[]
  trackedChanges: number
  comments: number
  highlights: number
  /** 文档属性里的作者、最后修改者 */
  authors: string[]
  evenAndOddHeaders: boolean
}

export class DocxError extends Error {}

// ---------- XML 小工具 ----------

type El = Element

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'text/xml') as unknown as Document
}

function children(el: El, local: string, ns = W): El[] {
  const out: El[] = []
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as El).localName === local && (n as El).namespaceURI === ns) out.push(n as El)
  }
  return out
}

function child(el: El | null | undefined, local: string, ns = W): El | null {
  if (!el) return null
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as El).localName === local && (n as El).namespaceURI === ns) return n as El
  }
  return null
}

function descendants(el: El | Document, local: string, ns = W): El[] {
  return Array.from(el.getElementsByTagNameNS(ns, local) as unknown as ArrayLike<El>)
}

function attr(el: El | null | undefined, local: string): string | null {
  if (!el) return null
  const v = el.getAttributeNS(W, local)
  if (v !== null && v !== '') return v
  return el.getAttribute(`w:${local}`) || null
}

function num(v: string | null): number | null {
  if (v === null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** w:b 这类开关属性：没写 val 或 val 为 true/1/on 都是开 */
function toggle(el: El | null): boolean | null {
  if (!el) return null
  const v = attr(el, 'val')
  return v === null || !/^(0|false|off|none)$/i.test(v)
}

const MAX_ENTRIES = 5000
const MAX_XML_BYTES = 150 * 1024 * 1024

const TWIP_PER_CM = 1440 / 2.54

// ---------- 格式属性（可部分定义，按层合并） ----------

interface FontSlot {
  name: string | null
  theme: string | null
}

interface RunProps {
  ascii?: FontSlot
  eastAsia?: FontSlot
  sizeHalfPt?: number
  bold?: boolean
  vertAlign?: string
  highlight?: boolean
}

interface ParaProps {
  jc?: string
  line?: number
  lineRule?: string
  before?: number
  beforeLines?: number
  after?: number
  afterLines?: number
  firstLine?: number
  firstLineChars?: number
  hanging?: number
  outlineLvl?: number
  numbered?: boolean
}

function readRunProps(rPr: El | null): RunProps {
  const p: RunProps = {}
  if (!rPr) return p
  const fonts = child(rPr, 'rFonts')
  if (fonts) {
    const ascii = attr(fonts, 'ascii'), asciiTheme = attr(fonts, 'asciiTheme')
    const ea = attr(fonts, 'eastAsia'), eaTheme = attr(fonts, 'eastAsiaTheme')
    if (ascii || asciiTheme) p.ascii = { name: ascii, theme: asciiTheme }
    if (ea || eaTheme) p.eastAsia = { name: ea, theme: eaTheme }
  }
  const sz = num(attr(child(rPr, 'sz'), 'val'))
  if (sz !== null) p.sizeHalfPt = sz
  const b = toggle(child(rPr, 'b'))
  if (b !== null) p.bold = b
  const va = attr(child(rPr, 'vertAlign'), 'val')
  if (va) p.vertAlign = va
  const hl = attr(child(rPr, 'highlight'), 'val')
  if (hl && hl !== 'none') p.highlight = true
  return p
}

function readParaProps(pPr: El | null): ParaProps {
  const p: ParaProps = {}
  if (!pPr) return p
  const jc = attr(child(pPr, 'jc'), 'val')
  if (jc) p.jc = jc
  const sp = child(pPr, 'spacing')
  if (sp) {
    const set = <K extends keyof ParaProps>(k: K, v: ParaProps[K] | null) => {
      if (v !== null && v !== undefined) p[k] = v
    }
    set('line', num(attr(sp, 'line')))
    set('lineRule', attr(sp, 'lineRule'))
    set('before', num(attr(sp, 'before')))
    set('beforeLines', num(attr(sp, 'beforeLines')))
    set('after', num(attr(sp, 'after')))
    set('afterLines', num(attr(sp, 'afterLines')))
  }
  const ind = child(pPr, 'ind')
  if (ind) {
    const fl = num(attr(ind, 'firstLine')), flc = num(attr(ind, 'firstLineChars'))
    const h = num(attr(ind, 'hanging'))
    if (fl !== null) p.firstLine = fl
    if (flc !== null) p.firstLineChars = flc
    if (h !== null) p.hanging = h
  }
  const ol = num(attr(child(pPr, 'outlineLvl'), 'val'))
  if (ol !== null) p.outlineLvl = ol
  const numPr = child(pPr, 'numPr')
  if (numPr) p.numbered = attr(child(numPr, 'numId'), 'val') !== '0'
  return p
}

function mergeRun(base: RunProps, over: RunProps): RunProps {
  return { ...base, ...over }
}

function mergePara(base: ParaProps, over: ParaProps): ParaProps {
  const out = { ...base, ...over }
  // 行数单位优先于磅值；下层只写了磅值时要清掉上层的行数
  if (over.before !== undefined && over.beforeLines === undefined) delete out.beforeLines
  if (over.after !== undefined && over.afterLines === undefined) delete out.afterLines
  if (over.firstLine !== undefined && over.firstLineChars === undefined) delete out.firstLineChars
  if (over.hanging !== undefined) {
    delete out.firstLine
    delete out.firstLineChars
  }
  return out
}

// ---------- 样式表 ----------

interface StyleDef {
  id: string
  name: string | null
  type: string
  basedOn: string | null
  rPr: RunProps
  pPr: ParaProps
}

class Styles {
  readonly byId = new Map<string, StyleDef>()
  defaultRun: RunProps = {}
  defaultPara: ParaProps = {}
  defaultParaStyle: string | null = null
  private cacheP = new Map<string, { rPr: RunProps; pPr: ParaProps }>()
  private cacheR = new Map<string, RunProps>()

  constructor(doc: Document | null) {
    if (!doc) return
    const root = doc.documentElement
    const defaults = child(root, 'docDefaults')
    this.defaultRun = readRunProps(child(child(defaults, 'rPrDefault'), 'rPr'))
    this.defaultPara = readParaProps(child(child(defaults, 'pPrDefault'), 'pPr'))
    for (const s of children(root, 'style')) {
      const id = attr(s, 'styleId')
      if (!id) continue
      const def: StyleDef = {
        id,
        name: attr(child(s, 'name'), 'val'),
        type: attr(s, 'type') ?? 'paragraph',
        basedOn: attr(child(s, 'basedOn'), 'val'),
        rPr: readRunProps(child(s, 'rPr')),
        pPr: readParaProps(child(s, 'pPr')),
      }
      this.byId.set(id, def)
      if (def.type === 'paragraph' && /^(1|true|on)$/.test(attr(s, 'default') ?? '')) this.defaultParaStyle = id
    }
  }

  /** 段落样式链合并后的属性（不含文档默认） */
  paragraph(id: string | null): { rPr: RunProps; pPr: ParaProps } {
    if (!id || !this.byId.has(id)) return { rPr: {}, pPr: {} }
    const hit = this.cacheP.get(id)
    if (hit) return hit
    this.cacheP.set(id, { rPr: {}, pPr: {} }) // 防循环
    const s = this.byId.get(id)!
    const base = this.paragraph(s.basedOn)
    const out = { rPr: mergeRun(base.rPr, s.rPr), pPr: mergePara(base.pPr, s.pPr) }
    this.cacheP.set(id, out)
    return out
  }

  character(id: string | null): RunProps {
    if (!id || !this.byId.has(id)) return {}
    const hit = this.cacheR.get(id)
    if (hit) return hit
    this.cacheR.set(id, {})
    const s = this.byId.get(id)!
    const out = mergeRun(this.character(s.basedOn), s.rPr)
    this.cacheR.set(id, out)
    return out
  }

  /** 沿样式链找标题级别：样式名 heading N / 标题 N，或大纲级别 */
  headingLevel(id: string | null): number | null {
    let cur = id ? this.byId.get(id) : undefined
    for (let guard = 0; cur && guard < 20; guard++) {
      const m = cur.name?.match(/^(?:heading|标题)\s*(\d)$/i)
      if (m) return Number(m[1])
      if (cur.pPr.outlineLvl !== undefined && cur.pPr.outlineLvl < 9) return cur.pPr.outlineLvl + 1
      cur = cur.basedOn ? this.byId.get(cur.basedOn) : undefined
    }
    return null
  }
}

// ---------- 主题字体 ----------

interface ThemeFonts {
  majorLatin: string | null
  minorLatin: string | null
  majorEa: string | null
  minorEa: string | null
}

function readTheme(doc: Document | null): ThemeFonts {
  const pick = (tag: string) => {
    const el = doc ? descendants(doc, tag, A)[0] : undefined
    if (!el) return { latin: null, ea: null }
    const latin = child(el, 'latin', A)?.getAttribute('typeface') || null
    let ea = child(el, 'ea', A)?.getAttribute('typeface') || null
    if (!ea) {
      const hans = children(el, 'font', A).find((f) => f.getAttribute('script') === 'Hans')
      ea = hans?.getAttribute('typeface') || null
    }
    return { latin, ea }
  }
  const major = pick('majorFont'), minor = pick('minorFont')
  return { majorLatin: major.latin, minorLatin: minor.latin, majorEa: major.ea, minorEa: minor.ea }
}

function resolveFont(slot: FontSlot | undefined, theme: ThemeFonts): string | null {
  if (!slot) return null
  if (slot.theme) {
    const t = slot.theme
    if (/^majorEastAsia$/i.test(t)) return theme.majorEa
    if (/^minorEastAsia$/i.test(t)) return theme.minorEa
    if (/^major/i.test(t)) return theme.majorLatin
    if (/^minor/i.test(t)) return theme.minorLatin
  }
  return slot.name
}

// ---------- 页眉页脚 ----------

function readHeaderFooter(doc: Document): HeaderFooter {
  const paras = descendants(doc, 'p')
  let hasPageField = false
  let pageFieldAlign: Align | null = null
  const texts: string[] = []
  for (const p of paras) {
    // 只算直属于这一段的文字和域：文本框的锚点段落里嵌着另一个段落，不能把里面的页码算到外层
    const own = (el: El) => closestParagraph(el) === p
    texts.push(descendants(p, 't').filter(own).map((t) => t.textContent ?? '').join(''))
    const instr = [
      ...descendants(p, 'instrText').filter(own).map((t) => t.textContent ?? ''),
      ...descendants(p, 'fldSimple').filter(own).map((f) => attr(f, 'instr') ?? ''),
    ].join(' ')
    if (/\bPAGE\b/.test(instr) && !hasPageField) {
      hasPageField = true
      pageFieldAlign = normalizeAlign(attr(child(child(p, 'pPr'), 'jc'), 'val'))
    }
  }
  // 页码放在文本框里的情况
  if (!hasPageField && /\bPAGE\b/.test(descendants(doc, 'instrText').map((t) => t.textContent).join(' '))) hasPageField = true
  return { text: texts.join('\n').trim(), hasPageField, pageFieldAlign }
}

function closestParagraph(el: El): El | null {
  for (let n = el.parentNode as El | null; n; n = n.parentNode as El | null) {
    if (n.localName === 'p' && n.namespaceURI === W) return n
  }
  return null
}

function normalizeAlign(jc: string | null | undefined): Align {
  switch (jc) {
    case 'center':
      return 'center'
    case 'right':
    case 'end':
      return 'right'
    case 'both':
    case 'distribute':
      return 'justify'
    default:
      return 'left'
  }
}

// ---------- 主流程 ----------

export function parseDocx(data: Uint8Array): DocxModel {
  let files: Record<string, Uint8Array>
  let entries = 0
  let xmlBytes = 0
  try {
    // 只解压 XML 和关系表，图片等媒体文件用不到；顺带限制成员数和解压总量，避免异常文件把页面卡死
    files = unzipSync(data, {
      filter: (f) => {
        entries++
        const wanted = /\.(xml|rels)$/.test(f.name)
        if (wanted) xmlBytes += f.originalSize
        return wanted && entries <= MAX_ENTRIES && xmlBytes <= MAX_XML_BYTES
      },
    })
  } catch {
    throw new DocxError('文件无法解压。请确认是 .docx 格式（不是 .doc 或 WPS 的 .wps），可以在 Word 或 WPS 里"另存为 docx"后再试。')
  }
  if (entries > MAX_ENTRIES || xmlBytes > MAX_XML_BYTES) {
    throw new DocxError('这个文件的内部结构异常庞大（成员超过 5000 个或文字部分解压后超过 150 MB），不像普通论文，没有继续检查。')
  }
  const read = (path: string) => (files[path] ? parseXml(strFromU8(files[path])) : null)
  const document = read('word/document.xml')
  if (!document) throw new DocxError('这个文件里没有 Word 正文（word/document.xml），可能不是 docx 文件。')
  if (document.documentElement.namespaceURI?.startsWith('http://purl.oclc.org/ooxml/')) {
    throw new DocxError('这是"Strict Open XML"格式的 docx，暂不支持。请在 Word 里"另存为 → Word 文档 (*.docx)"后再试。')
  }

  const styles = new Styles(read('word/styles.xml'))
  const theme = readTheme(read('word/theme/theme1.xml'))
  const settings = read('word/settings.xml')
  const evenAndOddHeaders = settings ? toggle(child(settings.documentElement, 'evenAndOddHeaders')) === true : false

  // 关系表：页眉页脚 id → 文件
  const rels = new Map<string, string>()
  const relDoc = read('word/_rels/document.xml.rels')
  if (relDoc) {
    for (const r of Array.from(relDoc.getElementsByTagName('Relationship') as unknown as ArrayLike<El>)) {
      const target = r.getAttribute('Target') ?? ''
      rels.set(r.getAttribute('Id') ?? '', target.startsWith('/') ? target.slice(1) : `word/${target}`)
    }
  }
  const hfCache = new Map<string, HeaderFooter | null>()
  const loadHf = (rid: string): HeaderFooter | null => {
    if (!hfCache.has(rid)) {
      const path = rels.get(rid)
      const d = path ? read(path) : null
      hfCache.set(rid, d ? readHeaderFooter(d) : null)
    }
    return hfCache.get(rid)!
  }

  const body = child(document.documentElement, 'body')
  if (!body) throw new DocxError('Word 正文为空。')

  const paragraphs: Paragraph[] = []
  const sections: Section[] = []
  let highlights = 0
  const prevHf: Record<string, HeaderFooter | null> = { hdefault: null, fdefault: null, heven: null, feven: null }

  const closeSection = (sectPr: El | null) => {
    const index = sections.length
    const pgSz = child(sectPr, 'pgSz'), pgMar = child(sectPr, 'pgMar'), pgNum = child(sectPr, 'pgNumType')
    const mar = (k: string) => {
      const v = num(attr(pgMar, k))
      return v === null ? null : v / TWIP_PER_CM
    }
    const fmt = attr(pgNum, 'fmt')
    // 页眉页脚没写就沿用上一节（Word 的"链接到前一节"）
    const refs: Record<string, string> = {}
    for (const ref of [...children(sectPr ?? ({} as El), 'headerReference'), ...children(sectPr ?? ({} as El), 'footerReference')]) {
      const kind = ref.localName === 'headerReference' ? 'h' : 'f'
      refs[kind + (attr(ref, 'type') ?? 'default')] = ref.getAttributeNS(R, 'id') || ref.getAttribute('r:id') || ''
    }
    for (const key of Object.keys(prevHf)) if (refs[key] !== undefined) prevHf[key] = loadHf(refs[key])
    sections.push({
      index,
      lastParagraph: paragraphs.length - 1,
      pageWidthCm: pgSz ? (num(attr(pgSz, 'w')) ?? 0) / TWIP_PER_CM : null,
      pageHeightCm: pgSz ? (num(attr(pgSz, 'h')) ?? 0) / TWIP_PER_CM : null,
      margins: pgMar ? { top: mar('top'), bottom: mar('bottom'), left: mar('left'), right: mar('right'), gutter: mar('gutter') ?? 0 } : null,
      pageNumberFormat: !fmt || fmt === 'decimal' ? 'arabic' : fmt === 'lowerRoman' ? 'lower_roman' : fmt === 'upperRoman' ? 'upper_roman' : 'other',
      pageNumberStart: num(attr(pgNum, 'start')),
      titlePage: toggle(child(sectPr, 'titlePg')) === true,
      mirrorMargins: settings ? toggle(child(settings.documentElement, 'mirrorMargins')) === true : false,
      header: prevHf.hdefault,
      footer: prevHf.fdefault,
      evenHeader: prevHf.heven,
      evenFooter: prevHf.feven,
    })
  }

  const readParagraph = (p: El, ctx: { inTable: boolean; inToc: boolean }) => {
    const pPr = child(p, 'pPr')
    const styleId = attr(child(pPr, 'pStyle'), 'val') ?? styles.defaultParaStyle
    const style = styles.paragraph(styleId)
    const direct = readParaProps(pPr)
    const pp = mergePara(mergePara(styles.defaultPara, style.pPr), direct)
    const baseRun = mergeRun(styles.defaultRun, style.rPr)
    const styleName = styleId ? styles.byId.get(styleId)?.name ?? null : null

    const runs: Run[] = []
    for (const r of descendants(p, 'r')) {
      // 删除的修订不算正文；文本框里的字不属于这一段
      // 删除和移动前（moveFrom）位置的文字都不在最终稿里
      if (insideAny(r, p, DROPPED)) continue
      if (isInsideTextbox(r)) continue
      let text = ''
      for (let n = r.firstChild; n; n = n.nextSibling) {
        if (n.nodeType !== 1) continue
        const ln = (n as El).localName
        if (ln === 't') text += n.textContent ?? ''
        else if (ln === 'tab') text += '\t'
      }
      if (!text) continue
      const rPr = child(r, 'rPr')
      const charStyle = styles.character(attr(child(rPr, 'rStyle'), 'val'))
      const direct = readRunProps(rPr)
      const rp = mergeRun(mergeRun(baseRun, charStyle), direct)
      // 加粗是切换属性（ECMA-376 §17.7.3）：段落样式和字符样式两层相互异或，直接格式是绝对值
      rp.bold = direct.bold ?? (baseRun.bold === true) !== (charStyle.bold === true)
      if (rp.highlight) highlights++
      runs.push({
        text,
        fontEn: resolveFont(rp.ascii, theme),
        fontCn: resolveFont(rp.eastAsia, theme),
        sizePt: rp.sizeHalfPt !== undefined ? rp.sizeHalfPt / 2 : null, // 各层都没写字号时无法确定
        bold: rp.bold === true,
        superscript: rp.vertAlign === 'superscript',
      })
    }

    let headingLevel: number | null = null
    if (direct.outlineLvl !== undefined) headingLevel = direct.outlineLvl < 9 ? direct.outlineLvl + 1 : null
    else headingLevel = styles.headingLevel(styleId)

    const isToc = ctx.inToc || /^(toc|目录)\s*\d*$/i.test(styleName ?? '') || /^toc\s*heading$/i.test(styleName ?? '')
    if (isToc) headingLevel = null

    const lineRule = pp.lineRule ?? 'auto'
    const line = pp.line ?? 240
    const lineSpacing: LineSpacing =
      lineRule === 'exact' ? { kind: 'exact', pt: line / 20 } : lineRule === 'atLeast' ? { kind: 'atLeast', pt: line / 20 } : { kind: 'multiple', value: line / 240 }

    paragraphs.push({
      index: paragraphs.length,
      text: runs.map((r) => r.text).join(''),
      styleId,
      styleName,
      headingLevel,
      inTable: ctx.inTable,
      inToc: isToc,
      numbered: pp.numbered === true,
      sectionIndex: sections.length,
      align: normalizeAlign(pp.jc),
      lineSpacing,
      firstLineChars: pp.firstLineChars !== undefined ? pp.firstLineChars / 100 : null,
      firstLinePt: pp.firstLine !== undefined ? pp.firstLine / 20 : pp.hanging !== undefined ? -pp.hanging / 20 : null,
      spaceBefore: { lines: pp.beforeLines !== undefined ? pp.beforeLines / 100 : null, pt: (pp.before ?? 0) / 20 },
      spaceAfter: { lines: pp.afterLines !== undefined ? pp.afterLines / 100 : null, pt: (pp.after ?? 0) / 20 },
      runs,
      hasMath: descendants(p, 'oMath', M).length > 0 || descendants(p, 'oMathPara', M).length > 0,
    })

    const sectPr = child(pPr, 'sectPr')
    if (sectPr) closeSection(sectPr)
  }

  const walk = (container: El, ctx: { inTable: boolean; inToc: boolean }) => {
    for (let n = container.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 1 || (n as El).namespaceURI !== W) continue
      const el = n as El
      switch (el.localName) {
        case 'p':
          readParagraph(el, ctx)
          break
        case 'tbl':
          for (const tr of children(el, 'tr')) for (const tc of children(tr, 'tc')) walk(tc, { ...ctx, inTable: true })
          break
        case 'sdt': {
          const gallery = attr(child(child(child(el, 'sdtPr'), 'docPartObj'), 'docPartGallery'), 'val') ?? ''
          const content = child(el, 'sdtContent')
          if (content) walk(content, { ...ctx, inToc: ctx.inToc || /table of contents/i.test(gallery) })
          break
        }
        case 'customXml':
        case 'ins':
        case 'moveTo':
          walk(el, ctx)
          break
      }
    }
  }
  walk(body, { inTable: false, inToc: false })
  closeSection(child(body, 'sectPr'))

  // 目录域（不在内容控件里时）：TOC 域开始到结束之间的段落
  markTocField(document, paragraphs)

  const core = read('docProps/core.xml')
  const authors = core
    ? [...descendants(core, 'creator', DC), ...descendants(core, 'lastModifiedBy', CP)].map((e) => (e.textContent ?? '').trim()).filter(Boolean)
    : []
  const commentsDoc = read('word/comments.xml')

  return {
    paragraphs,
    sections,
    // 内容修订（插入、删除、移动）和格式修订都算"未处理的修订"
    trackedChanges: REVISION_TAGS.reduce((n, tag) => n + descendants(body, tag).length, 0),
    comments: commentsDoc ? descendants(commentsDoc, 'comment').length : 0,
    highlights,
    authors: [...new Set(authors)],
    evenAndOddHeaders,
  }
}

function markTocField(document: Document, paragraphs: Paragraph[]) {
  const ps = descendants(document, 'p')
  // descendants 的顺序与 walk 一致（都是文档顺序），但 walk 跳过了文本框里的段落，这里只处理正文层
  if (ps.length < paragraphs.length) return
  let depth = 0
  let inToc = false
  let pi = 0
  for (const p of ps) {
    if (isInsideTextbox(p)) continue
    const para = paragraphs[pi++]
    if (!para) break
    const startedHere = descendants(p, 'instrText').some((t) => /^\s*TOC\b/.test(t.textContent ?? ''))
    if (startedHere) {
      inToc = true
      depth = 0
    }
    if (inToc) {
      para.inToc = true
      para.headingLevel = null
      for (const fc of descendants(p, 'fldChar')) {
        const t = attr(fc, 'fldCharType')
        if (t === 'begin') depth++
        else if (t === 'end') depth--
      }
      if (depth <= 0) inToc = false
    }
  }
}

const DROPPED = new Set(['del', 'moveFrom'])
const REVISION_TAGS = ['ins', 'del', 'moveFrom', 'moveTo', 'rPrChange', 'pPrChange', 'sectPrChange', 'tblPrChange', 'trPrChange', 'tcPrChange']

/** el 在到达 stop 之前是否位于这些 W 元素之内 */
function insideAny(el: El, stop: El, tags: Set<string>): boolean {
  for (let n = el.parentNode as El | null; n && n !== stop; n = n.parentNode as El | null) {
    if (n.namespaceURI === W && tags.has(n.localName)) return true
  }
  return false
}

function isInsideTextbox(p: El): boolean {
  for (let n = p.parentNode as El | null; n; n = n.parentNode as El | null) {
    if (n.localName === 'txbxContent') return true
  }
  return false
}
