/** 标题层级：有没有用标题样式、层级跳级、编号写法与连续性、各级版式。 */

import type { Paragraph } from '../docx'
import type { HeadingRule } from '../profile'
import { CHAPTER_RE, isBackTitle, isFrontTitle, locate, shownText } from '../structure'
import type { CheckContext } from './context'
import { checkTextStyle } from './textStyle'

const LEVEL_NAME = ['一级', '二级', '三级', '四级', '五级', '六级']

const CN = '一二三四五六七八九十百'
const NUMBERING: Record<string, RegExp> = {
  第一章: new RegExp(`^第[${CN}]+章`),
  第1章: /^第\d+章/,
  '一、': new RegExp(`^[${CN}]+、`),
  '（一）': new RegExp(`^[（(][${CN}]+[）)]`),
  '1': /^\d+(?![.．\d])/,
  '1.1': /^\d+[.．]\d+(?![.．\d])/,
  '1.1.1': /^\d+[.．]\d+[.．]\d+(?![.．\d])/,
  '1.1.1.1': /^\d+[.．]\d+[.．]\d+[.．]\d+(?![.．\d])/,
}

export function cnToInt(s: string): number | null {
  const d = '零一二三四五六七八九'
  if (/^\d+$/.test(s)) return Number(s)
  if (s === '十') return 10
  const m = s.match(/^([一二三四五六七八九])?十([一二三四五六七八九])?$/)
  if (m) return (m[1] ? d.indexOf(m[1]) : 1) * 10 + (m[2] ? d.indexOf(m[2]) : 0)
  if (s.length === 1 && d.includes(s)) return d.indexOf(s)
  return null
}

/** 从标题文字里取出编号，如 "第三章" → [3]，"2.1.4" → [2,1,4] */
export function headingNumber(text: string): number[] | null {
  const t = text.trim()
  let m = t.match(new RegExp(`^第([${CN}\\d]+)章`))
  if (m) {
    const n = cnToInt(m[1])
    return n === null ? null : [n]
  }
  m = t.match(/^(\d+(?:[.．]\d+)*)(?![.．]?\d)/)
  if (m && /^\d+([.．]\d+)*$/.test(m[1])) {
    const parts = m[1].split(/[.．]/).map(Number)
    return parts.every((x) => x < 100) ? parts : null // 2023 年这类不是编号
  }
  return null
}

export function looksLikeHeading(p: Paragraph): boolean {
  const t = p.text.trim()
  if (t.length === 0 || t.length > 40 || /[。；;，,：:]$/.test(t)) return false
  if (CHAPTER_RE.test(t) || /^\d+[.．]\d+([.．]\d+)*[\s　]*\S/.test(t)) {
    // 纯数字开头的长句不算；要求加粗、居中或者比较短
    return p.runs.some((r) => r.bold) || p.align === 'center' || t.length <= 20
  }
  return false
}

export function checkHeadings(ctx: CheckContext) {
  const { doc, s } = ctx
  const start = s.bodyStart ?? 0
  const all = doc.paragraphs.filter((p) => p.headingLevel !== null && !p.inToc && !p.inTable && p.text.trim())
  const body = all.filter((p) => p.index >= start && p.index < s.bodyEnd && !isFrontTitle(p) && !isBackTitle(p))

  if (all.length === 0) {
    ctx.add({
      id: 'headings-none', category: 'headings', severity: 'warning', title: '全文没有使用标题样式',
      detail: '章节标题需要套用"标题 1""标题 2"等样式，Word 才能自动生成目录，学校的格式检测也依赖它。',
      basis: '通用排版惯例',
    })
  } else ctx.pass('headings', '使用标题样式')

  // 看起来像标题、却没用标题样式
  const pseudo = doc.paragraphs.filter(
    (p) => p.index >= start && p.index < s.bodyEnd && p.headingLevel === null && !p.inToc && !p.inTable && !p.numbered && looksLikeHeading(p),
  )
  if (pseudo.length) {
    ctx.addForParagraphs(pseudo, {
      id: 'headings-pseudo', category: 'headings', severity: 'warning',
      title: `${pseudo.length} 处疑似标题没有使用标题样式`,
      detail: '这些段落看起来是章节标题，但套的是正文样式，目录里不会出现。',
      basis: '通用排版惯例',
    })
  }

  // 跳级：一级后面直接出现三级
  const jumps: Paragraph[] = []
  let prev = 0
  for (const p of body) {
    if (p.headingLevel! > prev + 1) jumps.push(p)
    prev = p.headingLevel!
  }
  if (jumps.length) {
    ctx.addForParagraphs(jumps, {
      id: 'headings-skip-level', category: 'headings', severity: 'warning', title: '标题层级跳级',
      detail: '例如一级标题下面直接出现三级标题，中间缺了二级。',
      basis: '通用排版惯例',
    })
  } else if (body.length) ctx.pass('headings', '标题层级连续')

  checkNumberSequence(ctx, body)

  // 各级的编号写法和版式
  const rules = ctx.profile?.format?.headings
  if (!rules?.length) {
    ctx.skip('headings', '各级标题字体字号和编号', '学校档案未规定')
    return
  }
  rules.forEach((rule: HeadingRule | null, i) => {
    if (!rule) return
    const level = i + 1
    const label = `${LEVEL_NAME[i] ?? `${level} 级`}标题`
    const paras = body.filter((p) => p.headingLevel === level)
    if (paras.length === 0) return
    checkTextStyle(ctx, { category: 'headings', label, id: `h${level}`, paragraphs: paras, rule })

    if (rule.numbering) {
      const re = NUMBERING[rule.numbering]
      if (!re) {
        ctx.skip('headings', `${label}编号`, `档案里的编号写法"${rule.numbering}"无法识别`)
        return
      }
      // 自动编号的标题按渲染出来的编号文字检查；编号格式认不出的只能记"未检查"
      const readable = paras.filter((p) => !p.numbered || p.listLabel !== null)
      const bad = readable.filter((p) => !re.test(shownText(p).trim()))
      if (bad.length) {
        ctx.addForParagraphs(bad, {
          id: `h${level}-numbering`, category: 'headings', severity: 'error',
          title: `${label}编号写法不符合要求（${bad.length} 处）`,
          expected: `形如"${rule.numbering}"`,
          actual: bad[0].listLabel !== null ? `自动编号显示为"${bad[0].listLabel}"` : undefined,
          detail: bad.some((p) => p.listLabel !== null) ? '自动编号的写法要在"定义新的多级列表"里改，改一处整级都会变。' : undefined,
          basis: ctx.schoolBasis,
        })
      } else if (readable.length) ctx.pass('headings', `${label}编号写法`)
      if (readable.length < paras.length) ctx.skip('headings', `${label}自动编号`, '使用了无法识别的 Word 自动编号格式，请自己核对编号写法')
    }
  })
}

/** 手写编号的连续性：第一章后面是第三章、2.1 后面是 2.3、3.1 出现在第二章下面 */
function checkNumberSequence(ctx: CheckContext, headings: Paragraph[]) {
  const bad: { p: Paragraph; why: string }[] = []
  const last: number[] = [] // 各级最近的编号
  let checked = 0
  for (const p of headings) {
    if (p.numbered && p.listLabel === null) continue
    const n = headingNumber(shownText(p))
    if (!n) continue
    checked++
    const depth = n.length
    const parentsMatch = n.slice(0, depth - 1).every((v, i) => last[i] === undefined || last[i] === v)
    if (!parentsMatch) {
      bad.push({ p, why: `编号与所在章节 ${last.slice(0, depth - 1).join('.')} 不一致` })
    } else {
      // last 在每个标题后截到当前深度，所以 last[depth-1] 就是同一父级下的上一个兄弟
      const prevSibling = last.length >= depth ? last[depth - 1] : undefined
      const expected = prevSibling === undefined ? 1 : prevSibling + 1
      if (n[depth - 1] !== expected && !(depth === 1 && last.length === 0)) {
        bad.push({ p, why: `应为 ${[...n.slice(0, -1), expected].join('.')}` })
      }
    }
    last.length = depth
    n.forEach((v, i) => (last[i] = v))
  }
  if (bad.length) {
    ctx.add({
      id: 'headings-number-sequence', category: 'headings', severity: 'warning', title: '标题编号不连续或错号',
      detail: bad.slice(0, 3).map((b) => `"${shownText(b.p).trim().slice(0, 20)}"${b.why}`).join('；'),
      locations: bad.map((b) => locate(b.p, ctx.s)), basis: '通用排版惯例',
    })
  } else if (checked > 1) ctx.pass('headings', '标题编号连续')
}
