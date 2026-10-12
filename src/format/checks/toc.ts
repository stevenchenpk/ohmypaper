/** 目录与正文标题是否一致：最常见的原因是改了标题却没有"更新目录"。 */

import type { Paragraph } from '../docx'
import { excerpt, locate, norm, shownText } from '../structure'
import type { CheckContext } from './context'

/** 去掉目录行末尾的制表符、点线和页码（含罗马数字页码） */
export function tocEntryTitle(text: string): string {
  return text.replace(/[\t .．…·_-]*([0-9]+|[ivxlcdm]+|[IVXLCDM]+)\s*$/, '').replace(/[\t.．…·]+$/, '').trim()
}

export function checkToc(ctx: CheckContext) {
  const { doc } = ctx
  const entries = doc.paragraphs.filter((p) => p.inToc && p.text.trim() && !/^目\s*录$|^contents$/i.test(p.text.trim()))
  if (entries.length === 0) {
    ctx.skip('headings', '目录与标题一致', '没有找到 Word 自动生成的目录')
    return
  }
  const tocEnd = entries[entries.length - 1].index
  const depth = Math.max(0, ...entries.map((p) => Number(p.styleName?.match(/toc\s*(\d)/i)?.[1] ?? 0))) || 3
  const headings = doc.paragraphs.filter((p) => p.headingLevel !== null && !p.inToc && !p.inTable && p.text.trim())

  // 自动编号的标题，目录里带编号而正文段落文字里没有，所以用"以标题结尾"来匹配
  const matches = (entry: string, h: Paragraph) => {
    const e = norm(entry), t = norm(h.text)
    return e === t || e === norm(shownText(h)) || (t.length >= 2 && e.endsWith(t))
  }

  const titles = entries.map((p) => tocEntryTitle(p.text))
  const stale = entries.filter((_, i) => titles[i] && !headings.some((h) => matches(titles[i], h)))
  const missing = headings.filter((h) => h.index > tocEnd && h.headingLevel! <= depth && !titles.some((t) => matches(t, h)))

  if (stale.length || missing.length) {
    const parts: string[] = []
    if (missing.length) parts.push(`正文里有 ${missing.length} 个标题不在目录中，如"${excerpt(missing[0].text, 20)}"`)
    if (stale.length) parts.push(`目录里有 ${stale.length} 项在正文中找不到，如"${excerpt(tocEntryTitle(stale[0].text), 20)}"`)
    ctx.add({
      id: 'toc-outdated', category: 'headings', severity: 'warning', title: '目录和正文标题对不上，可能没有更新目录',
      detail: `${parts.join('；')}。在目录上右键选择"更新域 → 更新整个目录"。`,
      locations: [...missing.map((p) => locate(p, ctx.s)), ...stale.map((p) => locate(p, ctx.s))],
      total: missing.length + stale.length,
      basis: '提交前自查',
    })
  } else ctx.pass('headings', '目录与标题一致')
}
