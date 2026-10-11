/**
 * 段落版式检查：字体、字号、加粗、对齐、行距、首行缩进、段前段后。
 * 正文、各级标题、参考文献条目共用这一套，只是规则和段落集合不同。
 */

import type { Paragraph, Run } from '../docx'
import {
  ALIGN_LABEL,
  type TextStyleRule,
  canonicalFont,
  describeLineSpacing,
  describeSize,
  parseLineSpacing,
  parseSpacing,
  round,
  sameFont,
  sameLineSpacing,
} from '../profile'
import type { Category } from '../report'
import { type CheckContext, topValues } from './context'

const CJK = /[㐀-鿿豈-﫿]/g
const LATIN = /[A-Za-z0-9]/g

const count = (text: string, re: RegExp) => text.match(re)?.length ?? 0

/** 段落中占比最大的字号 */
function dominantSize(p: Paragraph): number | null {
  const by = new Map<number, number>()
  for (const r of p.runs) if (!r.superscript && r.sizePt) by.set(r.sizePt, (by.get(r.sizePt) ?? 0) + r.text.length)
  let best: number | null = null, n = 0
  for (const [k, v] of by) if (v > n) [best, n] = [k, v]
  return best
}

interface Target {
  category: Category
  /** 用在标题里，如 "正文" "二级标题" */
  label: string
  /** 稳定编号前缀，如 body / h2 / refs */
  id: string
  paragraphs: Paragraph[]
  rule: TextStyleRule
}

/** 某个属性的逐段比较：返回实际值描述，符合要求时返回 null */
type Probe = (p: Paragraph) => string | null

export function checkTextStyle(ctx: CheckContext, t: Target) {
  const { rule, paragraphs } = t
  const basis = ctx.schoolBasis
  if (paragraphs.length === 0) return

  const runProbe = (pick: (r: Run) => boolean, test: (r: Run) => string | null): Probe => (p) => {
    for (const r of p.runs) {
      if (r.superscript || !pick(r)) continue
      const bad = test(r)
      if (bad) return bad
    }
    return null
  }

  const items: { key: string; name: string; expected: string; probe: Probe }[] = []

  if (rule.font_cn) {
    const want = rule.font_cn
    items.push({
      key: 'font-cn', name: '中文字体', expected: want,
      probe: runProbe((r) => count(r.text, CJK) >= 1, (r) => (r.fontCn && !sameFont(r.fontCn, want) ? canonicalFont(r.fontCn) : null)),
    })
  }
  if (rule.font_en) {
    const want = rule.font_en
    items.push({
      key: 'font-en', name: '西文字体', expected: want,
      probe: runProbe((r) => count(r.text, LATIN) >= 2, (r) => (r.fontEn && !sameFont(r.fontEn, want) ? canonicalFont(r.fontEn) : null)),
    })
  }
  if (rule.size_pt) {
    const want = rule.size_pt
    items.push({
      key: 'size', name: '字号', expected: describeSize(want),
      probe: runProbe((r) => r.text.trim().length >= 2, (r) => (r.sizePt !== null && Math.abs(r.sizePt - want) > 0.25 ? describeSize(r.sizePt) : null)),
    })
  }
  if (rule.bold != null) {
    const want = rule.bold
    items.push({
      key: 'bold', name: '加粗', expected: want ? '加粗' : '不加粗',
      probe: (p) => {
        const total = p.runs.reduce((n, r) => n + r.text.trim().length, 0)
        const bold = p.runs.filter((r) => r.bold).reduce((n, r) => n + r.text.trim().length, 0)
        const isBold = total > 0 && bold / total > 0.5
        return isBold === want ? null : isBold ? '加粗' : '不加粗'
      },
    })
  }
  if (rule.align) {
    const want = rule.align
    // 左对齐和两端对齐在单行段落里看起来一样，正文要求两端对齐时不把左对齐的短段落算错
    items.push({
      key: 'align', name: '对齐方式', expected: ALIGN_LABEL[want],
      probe: (p) => (p.align === want || (want === 'justify' && p.align === 'left' && p.text.length < 40) ? null : ALIGN_LABEL[p.align]),
    })
  }
  if (rule.line_spacing) {
    const want = parseLineSpacing(rule.line_spacing)
    if (want) {
      items.push({
        key: 'line-spacing', name: '行距', expected: describeLineSpacing(want),
        probe: (p) => (sameLineSpacing(p.lineSpacing, want) ? null : describeLineSpacing(p.lineSpacing)),
      })
    } else ctx.skip(t.category, `${t.label}行距`, `档案里的行距"${rule.line_spacing}"无法识别`)
  }
  if (rule.first_line_indent_chars != null) {
    const want = rule.first_line_indent_chars
    items.push({
      key: 'indent', name: '首行缩进', expected: want === 0 ? '无缩进' : `${want} 字符`,
      probe: (p) => {
        if (p.numbered) return null // 列表项的缩进由编号决定
        let chars: number
        if (p.firstLineChars !== null) chars = p.firstLineChars
        else if (p.firstLinePt !== null) chars = p.firstLinePt / (dominantSize(p) ?? 12)
        else chars = 0
        // 用空格代替缩进
        if (chars < 0.2 && /^[\s　]{2,}/.test(p.text)) return '用空格缩进'
        return Math.abs(chars - want) <= 0.25 ? null : chars === 0 ? '无缩进' : `${round(chars)} 字符`
      },
    })
  }
  for (const [key, name, value, get] of [
    ['space-before', '段前间距', rule.space_before, (p: Paragraph) => p.spaceBefore],
    ['space-after', '段后间距', rule.space_after, (p: Paragraph) => p.spaceAfter],
  ] as const) {
    if (value == null) continue
    const want = parseSpacing(value)
    if (!want) {
      ctx.skip(t.category, `${t.label}${name}`, `档案里的"${value}"无法识别`)
      continue
    }
    items.push({
      key, name, expected: value,
      probe: (p) => {
        const sp = get(p)
        // 1 行按 12 磅换算，和 Word 的网格行高近似
        const actualPt = sp.lines !== null ? sp.lines * 12 : sp.pt
        const wantPt = 'lines' in want ? want.lines * 12 : want.pt
        if (Math.abs(actualPt - wantPt) <= 1) return null
        return sp.lines !== null ? `${round(sp.lines)} 行` : `${round(sp.pt)} 磅`
      },
    })
  }

  for (const item of items) {
    const bad: Paragraph[] = []
    const actual: string[] = []
    for (const p of paragraphs) {
      const v = item.probe(p)
      if (v) {
        bad.push(p)
        actual.push(v)
      }
    }
    const what = `${t.label}${item.name}`
    if (bad.length === 0) {
      ctx.pass(t.category, what)
      continue
    }
    ctx.addForParagraphs(bad, {
      id: `${t.id}-${item.key}`,
      category: t.category,
      severity: 'error',
      title: `${what}不符合要求（${bad.length} / ${paragraphs.length} 段）`,
      expected: item.expected,
      actual: topValues(actual),
      basis,
    })
  }
}
