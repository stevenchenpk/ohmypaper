/**
 * docx 读取：在浏览器里解压 docx，抽出格式体检需要的版式信息。
 *
 * 有效格式按 Word 的层叠顺序合并：
 *   docDefaults → 段落样式（沿 basedOn 链从根到叶）→ 字符样式 → 直接格式
 * 一个段落里各个 run 的格式可能不同，取段内多数字符的值。
 *
 * 只读不改，论文内容不离开浏览器。
 */

import JSZip from 'jszip'
import { type XmlElement, attr, isEl, kid, kids, parseXml, path, textOf } from './xml'

// ---------- 对外类型 ----------

export interface Margins {
  top: number
  bottom: number
  left: number
  right: number
  gutter: number
  header: number
  footer: number
}

export interface HeaderFooterRef {
  /** default 奇数页/通用、first 首页、even 偶数页 */
  type: 'default' | 'first' | 'even'
  /** 部件路径，如 word/footer1.xml */
  part: string
  /** 是否在本节直接定义（false 表示沿用前一节） */
  inherited: boolean
}

export interface Section {
  index: number
  /** 纸张宽高，cm */
  pageWidthCm: number | null
  pageHeightCm: number | null
  landscape: boolean
  marginsCm: Margins | null
  /** 页码格式，如 decimal、lowerRoman、upperRoman；未设置为 null（Word 视为 decimal） */
  pageNumFormat: string | null
  /** 起始页码；未设置为 null（续前一节） */
  pageNumStart: number | null
  /** 首页不同 */
  titlePage: boolean
  /** 分节类型：nextPage、continuous、evenPage、oddPage */
  breakType: string
  headers: HeaderFooterRef[]
  footers: HeaderFooterRef[]
  /** 本节包含的段落序号范围（闭区间） */
  firstParagraph: number
  lastParagraph: number
}

export type LineSpacing =
  | { rule: 'auto'; multiple: number } // 多倍行距，1 = 单倍
  | { rule: 'exact' | 'atLeast'; pt: number }

export type Align = 'left' | 'center' | 'right' | 'justify'

export interface Paragraph {
  /** 段落序号，0 起，按正文中出现顺序（含表格内段落） */
  index: number
  text: string
  styleId: string | null
  styleName: string | null
  /** 大纲级别 0–8；正文或未设置为 null */
  outlineLevel: number | null
  /** 标题级别 1–9，由大纲级别或标题样式名推出 */
  headingLevel: number | null
  fontEastAsia: string | null
  fontAscii: string | null
  sizePt: number | null
  bold: boolean
  align: Align
  lineSpacing: LineSpacing
  inTable: boolean
  /** 位于目录域或目录内容控件中 */
  inToc: boolean
  /** 含 SEQ 域（题注编号） */
  hasSeqField: boolean
  sectionIndex: number
}

export interface HeaderFooterPart {
  part: string
  text: string
  /** 含 PAGE 域 */
  hasPageField: boolean
  /** PAGE 域里的格式开关，如 \* roman */
  pageFieldFormat: string | null
}

export interface DocxModel {
  sections: Section[]
  paragraphs: Paragraph[]
  headerFooters: Record<string, HeaderFooterPart>
  settings: { evenAndOddHeaders: boolean; mirrorMargins: boolean }
}

// ---------- 单位换算 ----------

const twipToCm = (v: number) => Math.round((v / 1440) * 2.54 * 100) / 100

function num(v: string | null): number | null {
  if (v === null) return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

// ---------- 格式属性 ----------

type FontRef = { name: string } | { theme: string }

interface RunProps {
  ascii?: FontRef
  eastAsia?: FontRef
  sizeHalfPt?: number
  bold?: boolean
  vanish?: boolean
}

interface ParaProps {
  outlineLvl?: number
  jc?: string
  line?: number
  lineRule?: string
}

function onOff(el: XmlElement | null): boolean | undefined {
  if (!el) return undefined
  const v = attr(el, 'w:val')
  return v === null || !['0', 'false', 'off', 'none'].includes(v.toLowerCase())
}

function readRunProps(rPr: XmlElement | null): RunProps {
  const out: RunProps = {}
  if (!rPr) return out
  const fonts = kid(rPr, 'w:rFonts')
  if (fonts) {
    // 同一层里主题字体优先于显式字体名
    for (const slot of ['ascii', 'eastAsia'] as const) {
      const theme = attr(fonts, `w:${slot}Theme`)
      const name = attr(fonts, `w:${slot}`)
      if (theme) out[slot] = { theme }
      else if (name) out[slot] = { name }
    }
  }
  const sz = num(attr(kid(rPr, 'w:sz'), 'w:val'))
  if (sz !== null) out.sizeHalfPt = sz
  const b = onOff(kid(rPr, 'w:b'))
  if (b !== undefined) out.bold = b
  const v = onOff(kid(rPr, 'w:vanish'))
  if (v !== undefined) out.vanish = v
  return out
}

function readParaProps(pPr: XmlElement | null): ParaProps {
  const out: ParaProps = {}
  if (!pPr) return out
  const lvl = num(attr(kid(pPr, 'w:outlineLvl'), 'w:val'))
  if (lvl !== null) out.outlineLvl = lvl
  const jc = attr(kid(pPr, 'w:jc'), 'w:val')
  if (jc) out.jc = jc
  const sp = kid(pPr, 'w:spacing')
  const line = num(attr(sp, 'w:line'))
  if (line !== null) out.line = line
  const rule = attr(sp, 'w:lineRule')
  if (rule) out.lineRule = rule
  return out
}

/** 后者覆盖前者中已定义的字段 */
function merge<T extends object>(...layers: T[]): T {
  const out = {} as T
  for (const l of layers) for (const [k, v] of Object.entries(l)) if (v !== undefined) (out as Record<string, unknown>)[k] = v
  return out
}

// ---------- 样式表 ----------

interface Style {
  id: string
  name: string | null
  type: string
  basedOn: string | null
  isDefault: boolean
  pPr: ParaProps
  rPr: RunProps
}

interface StyleSheet {
  styles: Map<string, Style>
  defaultParagraph: string | null
  docRPr: RunProps
  docPPr: ParaProps
}

function readStyles(root: XmlElement | null): StyleSheet {
  const styles = new Map<string, Style>()
  let defaultParagraph: string | null = null
  for (const s of kids(root, 'w:style')) {
    const id = attr(s, 'w:styleId')
    if (!id) continue
    const type = attr(s, 'w:type') ?? 'paragraph'
    const isDefault = ['1', 'true', 'on'].includes(attr(s, 'w:default') ?? '')
    styles.set(id, {
      id,
      name: attr(kid(s, 'w:name'), 'w:val'),
      type,
      basedOn: attr(kid(s, 'w:basedOn'), 'w:val'),
      isDefault,
      pPr: readParaProps(kid(s, 'w:pPr')),
      rPr: readRunProps(kid(s, 'w:rPr')),
    })
    if (type === 'paragraph' && isDefault) defaultParagraph = id
  }
  return {
    styles,
    defaultParagraph,
    docRPr: readRunProps(path(root, 'w:docDefaults', 'w:rPrDefault', 'w:rPr')),
    docPPr: readParaProps(path(root, 'w:docDefaults', 'w:pPrDefault', 'w:pPr')),
  }
}

/** 从根到叶的 basedOn 链；防环 */
function styleChain(sheet: StyleSheet, id: string | null): Style[] {
  const chain: Style[] = []
  const seen = new Set<string>()
  let cur = id
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const s = sheet.styles.get(cur)
    if (!s) break
    chain.unshift(s)
    cur = s.basedOn
  }
  return chain
}

// ---------- 主题字体 ----------

interface ThemeFonts {
  major: { latin: string | null; ea: string | null }
  minor: { latin: string | null; ea: string | null }
}

function readTheme(root: XmlElement | null): ThemeFonts {
  const pick = (f: XmlElement | null) => {
    const latin = attr(kid(f, 'a:latin'), 'typeface') || null
    let ea = attr(kid(f, 'a:ea'), 'typeface') || null
    if (!ea) ea = kids(f, 'a:font').find((x) => attr(x, 'script') === 'Hans')?.attrs.typeface || null
    return { latin, ea }
  }
  const scheme = root ? path(root, 'a:themeElements', 'a:fontScheme') : null
  return { major: pick(kid(scheme, 'a:majorFont')), minor: pick(kid(scheme, 'a:minorFont')) }
}

function fontName(ref: FontRef | undefined, theme: ThemeFonts): string | null {
  if (!ref) return null
  if ('name' in ref) return ref.name
  const t = ref.theme
  const group = t.startsWith('major') ? theme.major : theme.minor
  return /EastAsia$/.test(t) ? group.ea : group.latin
}

// ---------- 页眉页脚与关系 ----------

function readRels(root: XmlElement | null): Map<string, string> {
  const rels = new Map<string, string>()
  for (const r of kids(root, 'pr:Relationship')) {
    const id = attr(r, 'Id')
    const target = attr(r, 'Target')
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : `word/${target}`)
  }
  return rels
}

/** 收集一个部件里所有域指令（简单域与复杂域） */
function fieldInstructions(el: XmlElement, out: string[] = []): string[] {
  for (const c of el.children) {
    if (!isEl(c)) continue
    if (c.name === 'w:fldSimple') out.push(attr(c, 'w:instr') ?? '')
    if (c.name === 'w:instrText') out.push(textOf(c))
    fieldInstructions(c, out)
  }
  return out
}

function readHeaderFooter(part: string, root: XmlElement): HeaderFooterPart {
  // 复杂域的指令可能被拆在多个 instrText 里，拼起来再找
  const instr = fieldInstructions(root).join(' ')
  const m = instr.match(/\bPAGE\b(?:\s*\\\*\s*(\w+))?/)
  const fmt = m?.[1] ?? null
  return {
    part,
    text: collectText(root).trim(),
    hasPageField: m !== null,
    pageFieldFormat: fmt,
  }
}

function collectText(el: XmlElement): string {
  let s = ''
  for (const c of el.children) {
    if (!isEl(c)) continue
    if (c.name === 'w:t') s += textOf(c)
    else if (c.name === 'w:tab') s += '\t'
    else if (c.name === 'w:p') s += collectText(c) + '\n'
    else if (c.name !== 'w:instrText' && c.name !== 'w:delText') s += collectText(c)
  }
  return s
}

// ---------- 段落遍历 ----------

/** 中日韩文字及全角标点，用东亚字体排版 */
const EAST_ASIAN = /[⺀-鿿豈-﫿︰-﹏＀-￯　-〿\u{20000}-\u{2FFFF}]/u

class Tally<K> {
  private m = new Map<K, number>()
  add(k: K, w: number) {
    if (w > 0) this.m.set(k, (this.m.get(k) ?? 0) + w)
  }
  get size() {
    return this.m.size
  }
  top(): K | undefined {
    let best: K | undefined
    let bw = -1
    for (const [k, w] of this.m) if (w > bw) [best, bw] = [k, w]
    return best
  }
}

interface FieldState {
  /** 跨段落的复杂域栈：每层是已读到的指令 */
  stack: { instr: string }[]
}

interface Ctx {
  sheet: StyleSheet
  theme: ThemeFonts
  fields: FieldState
}

interface RunInfo {
  text: string
  props: RunProps
}

/** 不进入的元素：已删除内容、图形与文本框（文本框内段落单独处理过于复杂，见已知局限） */
const SKIP = new Set(['w:del', 'w:moveFrom', 'w:drawing', 'w:pict', 'mc:AlternateContent', 'w:object', 'w:pPr', 'w:rPr'])

function collectRuns(el: XmlElement, ctx: Ctx, base: RunProps, out: RunInfo[], flags: { toc: boolean; seq: boolean }) {
  for (const c of el.children) {
    if (!isEl(c) || SKIP.has(c.name)) continue
    if (c.name === 'w:r') {
      readRun(c, ctx, base, out, flags)
    } else if (c.name === 'w:fldSimple') {
      const instr = attr(c, 'w:instr') ?? ''
      if (/^\s*SEQ\b/i.test(instr)) flags.seq = true
      if (/^\s*TOC\b/i.test(instr)) flags.toc = true
      collectRuns(c, ctx, base, out, flags)
    } else {
      // hyperlink、ins、smartTag、sdt/sdtContent、customXml、moveTo 等容器
      collectRuns(c, ctx, base, out, flags)
    }
  }
}

function readRun(r: XmlElement, ctx: Ctx, base: RunProps, out: RunInfo[], flags: { toc: boolean; seq: boolean }) {
  const rPr = kid(r, 'w:rPr')
  const rStyle = attr(kid(rPr, 'w:rStyle'), 'w:val')
  const charLayers = styleChain(ctx.sheet, rStyle).map((s) => s.rPr)
  const props = merge(base, ...charLayers, readRunProps(rPr))
  let text = ''
  for (const c of r.children) {
    if (!isEl(c)) continue
    switch (c.name) {
      case 'w:t':
        text += textOf(c)
        break
      case 'w:tab':
        text += '\t'
        break
      case 'w:br':
      case 'w:cr':
        text += '\n'
        break
      case 'w:noBreakHyphen':
        text += '-'
        break
      case 'w:fldChar': {
        const t = attr(c, 'w:fldCharType')
        if (t === 'begin') ctx.fields.stack.push({ instr: '' })
        else if (t === 'end') ctx.fields.stack.pop()
        break
      }
      case 'w:instrText': {
        const top = ctx.fields.stack[ctx.fields.stack.length - 1]
        if (top) top.instr += textOf(c)
        const instr = top?.instr ?? textOf(c)
        if (/^\s*SEQ\b/i.test(instr)) flags.seq = true
        if (/^\s*TOC\b/i.test(instr)) flags.toc = true
        break
      }
    }
  }
  if (text && !props.vanish) out.push({ text, props })
}

const ALIGN: Record<string, Align> = {
  left: 'left',
  start: 'left',
  center: 'center',
  right: 'right',
  end: 'right',
  both: 'justify',
  distribute: 'justify',
  thaiDistribute: 'justify',
  lowKashida: 'justify',
  mediumKashida: 'justify',
  highKashida: 'justify',
}

function headingFromName(name: string | null): number | null {
  if (!name) return null
  const m = name.trim().match(/^(?:heading|标题)\s*(\d)$/i)
  return m ? Number(m[1]) : null
}

function readParagraph(p: XmlElement, index: number, ctx: Ctx, inTable: boolean, inTocSdt: boolean, sectionIndex: number): Paragraph {
  const pPr = kid(p, 'w:pPr')
  const styleId = attr(kid(pPr, 'w:pStyle'), 'w:val') ?? ctx.sheet.defaultParagraph
  const chain = styleChain(ctx.sheet, styleId)
  const style = chain[chain.length - 1] ?? null

  const para = merge(ctx.sheet.docPPr, ...chain.map((s) => s.pPr), readParaProps(pPr))
  const base = merge(ctx.sheet.docRPr, ...chain.map((s) => s.rPr))

  // 段落开始时仍处于目录域内
  const flags = { toc: ctx.fields.stack.some((f) => /^\s*TOC\b/i.test(f.instr)), seq: false }
  const runs: RunInfo[] = []
  collectRuns(p, ctx, base, runs, flags)

  const ea = new Tally<string | null>()
  const ascii = new Tally<string | null>()
  const anyEa = new Tally<string | null>()
  const anyAscii = new Tally<string | null>()
  const size = new Tally<number | null>()
  const bold = new Tally<boolean>()
  for (const r of runs) {
    const eaName = fontName(r.props.eastAsia, ctx.theme)
    const asciiName = fontName(r.props.ascii, ctx.theme)
    let nEa = 0
    let nOther = 0
    for (const ch of r.text) {
      if (/\s/.test(ch)) continue
      if (EAST_ASIAN.test(ch)) nEa++
      else nOther++
    }
    ea.add(eaName, nEa)
    ascii.add(asciiName, nOther)
    anyEa.add(eaName, nEa + nOther)
    anyAscii.add(asciiName, nEa + nOther)
    const sz = r.props.sizeHalfPt !== undefined ? r.props.sizeHalfPt / 2 : null
    size.add(sz, nEa + nOther)
    bold.add(r.props.bold ?? false, nEa + nOther)
  }

  // 没有文字的段落（空行、只有图片）退回到样式层面的格式
  const fallbackSize = base.sizeHalfPt !== undefined ? base.sizeHalfPt / 2 : null
  const text = runs.map((r) => r.text).join('')

  const outlineLevel = para.outlineLvl !== undefined && para.outlineLvl >= 0 && para.outlineLvl <= 8 ? para.outlineLvl : null
  const headingLevel = outlineLevel !== null ? outlineLevel + 1 : headingFromName(style?.name ?? null)

  let lineSpacing: LineSpacing
  const rule = para.lineRule ?? 'auto'
  if (rule === 'exact' || rule === 'atLeast') lineSpacing = { rule, pt: (para.line ?? 240) / 20 }
  else lineSpacing = { rule: 'auto', multiple: Math.round(((para.line ?? 240) / 240) * 100) / 100 }

  const styleName = style?.name ?? null
  return {
    index,
    text,
    styleId,
    styleName,
    outlineLevel,
    headingLevel,
    fontEastAsia: (ea.size ? ea.top() : anyEa.top()) ?? fontName(base.eastAsia, ctx.theme),
    fontAscii: (ascii.size ? ascii.top() : anyAscii.top()) ?? fontName(base.ascii, ctx.theme),
    sizePt: size.size ? (size.top() ?? 10) : (fallbackSize ?? 10), // Word 缺省 10 磅
    bold: bold.size ? (bold.top() ?? false) : (base.bold ?? false),
    align: ALIGN[para.jc ?? 'left'] ?? 'left',
    lineSpacing,
    inTable,
    inToc: flags.toc || inTocSdt || /^toc\s*\d|^目录\s*\d/i.test(styleName ?? ''),
    hasSeqField: flags.seq,
    sectionIndex,
  }
}

// ---------- 节 ----------

function readSection(
  sectPr: XmlElement | null,
  index: number,
  first: number,
  last: number,
  rels: Map<string, string>,
  prev: Section | null,
): Section {
  const pgSz = kid(sectPr, 'w:pgSz')
  const w = num(attr(pgSz, 'w:w'))
  const h = num(attr(pgSz, 'w:h'))
  const mar = kid(sectPr, 'w:pgMar')
  const m = (k: string) => twipToCm(Math.abs(num(attr(mar, `w:${k}`)) ?? 0))
  const pgNum = kid(sectPr, 'w:pgNumType')

  const refs = (tag: string, inheritFrom: HeaderFooterRef[]): HeaderFooterRef[] => {
    const own: HeaderFooterRef[] = []
    for (const r of kids(sectPr, tag)) {
      const part = rels.get(attr(r, 'r:id') ?? '')
      const type = (attr(r, 'w:type') ?? 'default') as HeaderFooterRef['type']
      if (part) own.push({ type, part, inherited: false })
    }
    // 本节没定义的类型沿用前一节
    for (const r of inheritFrom) if (!own.some((o) => o.type === r.type)) own.push({ ...r, inherited: true })
    return own
  }

  return {
    index,
    pageWidthCm: w !== null ? twipToCm(w) : null,
    pageHeightCm: h !== null ? twipToCm(h) : null,
    landscape: attr(pgSz, 'w:orient') === 'landscape' || (w !== null && h !== null && w > h),
    marginsCm: mar
      ? { top: m('top'), bottom: m('bottom'), left: m('left'), right: m('right'), gutter: m('gutter'), header: m('header'), footer: m('footer') }
      : null,
    pageNumFormat: attr(pgNum, 'w:fmt'),
    pageNumStart: num(attr(pgNum, 'w:start')),
    titlePage: onOff(kid(sectPr, 'w:titlePg')) ?? false,
    breakType: attr(kid(sectPr, 'w:type'), 'w:val') ?? 'nextPage',
    headers: refs('w:headerReference', prev?.headers ?? []),
    footers: refs('w:footerReference', prev?.footers ?? []),
    firstParagraph: first,
    lastParagraph: last,
  }
}

// ---------- 入口 ----------

export interface DocxParts {
  document: string
  styles?: string | null
  settings?: string | null
  theme?: string | null
  rels?: string | null
  /** 部件路径 → XML，如 word/footer1.xml */
  headerFooters?: Record<string, string>
}

function isTocSdt(sdt: XmlElement): boolean {
  const gallery = attr(path(sdt, 'w:sdtPr', 'w:docPartObj', 'w:docPartGallery'), 'w:val') ?? ''
  return /table of contents/i.test(gallery)
}

/** 解析已解压的各部件（纯函数，便于测试） */
export function parseDocxParts(parts: DocxParts): DocxModel {
  const doc = parseXml(parts.document)
  const body = kid(doc, 'w:body')
  const sheet = readStyles(parts.styles ? parseXml(parts.styles) : null)
  const theme = readTheme(parts.theme ? parseXml(parts.theme) : null)
  const rels = readRels(parts.rels ? parseXml(parts.rels) : null)
  const ctx: Ctx = { sheet, theme, fields: { stack: [] } }

  const paragraphs: Paragraph[] = []
  const sections: Section[] = []
  let sectionStart = 0

  const closeSection = (sectPr: XmlElement | null) => {
    const prev = sections[sections.length - 1] ?? null
    sections.push(readSection(sectPr, sections.length, sectionStart, paragraphs.length - 1, rels, prev))
    sectionStart = paragraphs.length
  }

  const walk = (el: XmlElement, inTable: boolean, inToc: boolean) => {
    for (const c of el.children) {
      if (!isEl(c)) continue
      if (c.name === 'w:p') {
        paragraphs.push(readParagraph(c, paragraphs.length, ctx, inTable, inToc, sections.length))
        const sp = path(c, 'w:pPr', 'w:sectPr')
        if (sp && !inTable) closeSection(sp)
      } else if (c.name === 'w:tbl') {
        for (const tr of kids(c, 'w:tr')) for (const tc of kids(tr, 'w:tc')) walk(tc, true, inToc)
      } else if (c.name === 'w:sdt') {
        walk(kid(c, 'w:sdtContent') ?? c, inTable, inToc || isTocSdt(c))
      } else if (c.name === 'w:customXml' || c.name === 'w:ins' || c.name === 'w:moveTo') {
        walk(c, inTable, inToc)
      }
    }
  }
  if (body) walk(body, false, false)
  closeSection(kid(body, 'w:sectPr'))

  const headerFooters: Record<string, HeaderFooterPart> = {}
  for (const [part, xml] of Object.entries(parts.headerFooters ?? {})) headerFooters[part] = readHeaderFooter(part, parseXml(xml))

  const settings = parts.settings ? parseXml(parts.settings) : null
  return {
    sections,
    paragraphs,
    headerFooters,
    settings: {
      evenAndOddHeaders: onOff(kid(settings, 'w:evenAndOddHeaders')) ?? false,
      mirrorMargins: onOff(kid(settings, 'w:mirrorMargins')) ?? false,
    },
  }
}

/** 读取 docx 文件（浏览器里传 File/Blob，测试里传 Uint8Array） */
export async function readDocx(data: ArrayBuffer | Uint8Array | Blob): Promise<DocxModel> {
  const zip = await JSZip.loadAsync(data)
  const read = (p: string) => zip.file(p)?.async('string') ?? Promise.resolve(null)
  const document = await read('word/document.xml')
  if (!document) throw new Error('不是有效的 docx 文件：缺少 word/document.xml')

  const headerFooters: Record<string, string> = {}
  for (const name of Object.keys(zip.files)) {
    if (/^word\/(header|footer)\d*\.xml$/.test(name)) headerFooters[name] = (await read(name)) ?? ''
  }
  return parseDocxParts({
    document,
    styles: await read('word/styles.xml'),
    settings: await read('word/settings.xml'),
    theme: await read('word/theme/theme1.xml'),
    rels: await read('word/_rels/document.xml.rels'),
    headerFooters,
  })
}
