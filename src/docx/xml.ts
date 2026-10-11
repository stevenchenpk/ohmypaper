/**
 * 极简 XML 解析器。
 *
 * docx 里的 XML 都是机器生成、结构规整的，用不着完整的 DOM。
 * 自己解析有两个好处：浏览器和 Node（测试）行为一致，也不必引入 jsdom。
 *
 * 命名空间前缀按 URI 归一：不管文档里写的是 w: 还是别的前缀，
 * 只要指向 WordprocessingML 命名空间，解析后一律是 w:。
 */

export interface XmlElement {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
}

export type XmlNode = XmlElement | string

/** 常见命名空间 URI → 规范前缀 */
const CANONICAL: Record<string, string> = {
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main': 'w',
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships': 'r',
  'http://schemas.openxmlformats.org/drawingml/2006/main': 'a',
  'http://schemas.openxmlformats.org/package/2006/relationships': 'pr',
  'http://schemas.openxmlformats.org/markup-compatibility/2006': 'mc',
  'http://purl.oclc.org/ooxml/wordprocessingml/main': 'w', // Strict OOXML
  'http://purl.oclc.org/ooxml/officeDocument/relationships': 'r',
  'http://purl.oclc.org/ooxml/drawingml/main': 'a',
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

function decode(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e] ?? m
  })
}

const ATTR_RE = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

type Scope = Record<string, string> // 原前缀 → 规范前缀（'' 表示默认命名空间）

function rename(qname: string, scope: Scope, isAttr: boolean): string {
  const i = qname.indexOf(':')
  if (i < 0) {
    // 属性不继承默认命名空间
    if (isAttr) return qname
    const p = scope['']
    return p ? `${p}:${qname}` : qname
  }
  const prefix = qname.slice(0, i)
  if (prefix === 'xml' || prefix === 'xmlns') return qname
  const canon = scope[prefix]
  return canon ? `${canon}:${qname.slice(i + 1)}` : qname
}

export function parseXml(src: string): XmlElement {
  const root: XmlElement = { name: '#root', attrs: {}, children: [] }
  const stack: { el: XmlElement; scope: Scope }[] = [{ el: root, scope: {} }]
  let i = 0
  const n = src.length

  while (i < n) {
    const lt = src.indexOf('<', i)
    const textEnd = lt < 0 ? n : lt
    if (textEnd > i && stack.length > 1) {
      stack[stack.length - 1].el.children.push(decode(src.slice(i, textEnd)))
    }
    if (lt < 0) break
    i = lt

    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i)
      i = end < 0 ? n : end + 3
      continue
    }
    if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i)
      const text = src.slice(i + 9, end < 0 ? n : end)
      if (stack.length > 1) stack[stack.length - 1].el.children.push(text)
      i = end < 0 ? n : end + 3
      continue
    }
    if (src.startsWith('<?', i) || src.startsWith('<!', i)) {
      const end = src.indexOf('>', i)
      i = end < 0 ? n : end + 1
      continue
    }

    // 找标签结尾，跳过引号里的 >
    let j = i + 1
    let quote = ''
    for (; j < n; j++) {
      const c = src[j]
      if (quote) {
        if (c === quote) quote = ''
      } else if (c === '"' || c === "'") quote = c
      else if (c === '>') break
    }
    const body = src.slice(i + 1, j)
    i = j + 1

    if (body[0] === '/') {
      if (stack.length > 1) stack.pop()
      continue
    }

    const selfClose = body.endsWith('/')
    const inner = selfClose ? body.slice(0, -1) : body
    const nameEnd = inner.search(/\s|$/)
    const rawName = inner.slice(0, nameEnd)

    const rawAttrs: [string, string][] = []
    for (const m of inner.slice(nameEnd).matchAll(ATTR_RE)) rawAttrs.push([m[1], decode(m[2] ?? m[3] ?? '')])

    // 先处理命名空间声明，再改名
    const parent = stack[stack.length - 1]
    let scope = parent.scope
    for (const [k, v] of rawAttrs) {
      if (k === 'xmlns' || k.startsWith('xmlns:')) {
        if (scope === parent.scope) scope = { ...scope }
        const prefix = k === 'xmlns' ? '' : k.slice(6)
        scope[prefix] = CANONICAL[v] ?? prefix
      }
    }

    const attrs: Record<string, string> = {}
    for (const [k, v] of rawAttrs) {
      if (k === 'xmlns' || k.startsWith('xmlns:')) continue
      attrs[rename(k, scope, true)] = v
    }

    const el: XmlElement = { name: rename(rawName, scope, false), attrs, children: [] }
    parent.el.children.push(el)
    if (!selfClose) stack.push({ el, scope })
  }

  const first = root.children.find((c): c is XmlElement => typeof c !== 'string')
  return first ?? root
}

// ---------- 查询工具 ----------

export function isEl(n: XmlNode): n is XmlElement {
  return typeof n !== 'string'
}

export function kids(el: XmlElement | null | undefined, name?: string): XmlElement[] {
  if (!el) return []
  return el.children.filter((c): c is XmlElement => isEl(c) && (name === undefined || c.name === name))
}

export function kid(el: XmlElement | null | undefined, name: string): XmlElement | null {
  if (!el) return null
  for (const c of el.children) if (isEl(c) && c.name === name) return c
  return null
}

/** 按路径逐级取第一个子元素，如 path(styles, 'w:docDefaults', 'w:rPrDefault', 'w:rPr') */
export function path(el: XmlElement | null | undefined, ...names: string[]): XmlElement | null {
  let cur: XmlElement | null = el ?? null
  for (const nm of names) cur = kid(cur, nm)
  return cur
}

export function attr(el: XmlElement | null | undefined, name: string): string | null {
  return el?.attrs[name] ?? null
}

/** 深度优先查找所有同名后代 */
export function descendants(el: XmlElement, name: string, out: XmlElement[] = []): XmlElement[] {
  for (const c of el.children) {
    if (!isEl(c)) continue
    if (c.name === name) out.push(c)
    descendants(c, name, out)
  }
  return out
}

export function textOf(el: XmlElement): string {
  return el.children.map((c) => (isEl(c) ? textOf(c) : c)).join('')
}
