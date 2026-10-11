/** 页面设置、页眉、页码分节。 */

import type { PageNumberFormat, Section } from '../docx'
import { round } from '../profile'
import type { Location } from '../report'
import { excerpt, norm } from '../structure'
import { type CheckContext, unknownNote } from './context'

const FMT_LABEL: Record<PageNumberFormat | 'none', string> = {
  arabic: '阿拉伯数字（1, 2, 3）',
  lower_roman: '小写罗马数字（i, ii, iii）',
  upper_roman: '大写罗马数字（I, II, III）',
  other: '其他格式',
  none: '无页码',
}

const MARGIN_LABEL = { top: '上', bottom: '下', left: '左', right: '右', gutter: '装订线' } as const

function sectionLocation(ctx: CheckContext, sec: Section): Location {
  const first = ctx.doc.sections[sec.index - 1]?.lastParagraph ?? -1
  const p = ctx.doc.paragraphs.slice(first + 1, sec.lastParagraph + 1).find((x) => x.text.trim())
  return { section: sec.index, excerpt: `第 ${sec.index + 1} 节，从"${p ? excerpt(p.text, 16) : '（空白页）'}"开始` }
}

/** 节里是否有正文段落（排除只有分节符的空节） */
function hasContent(ctx: CheckContext, sec: Section): boolean {
  const first = ctx.doc.sections[sec.index - 1]?.lastParagraph ?? -1
  return ctx.doc.paragraphs.slice(first + 1, sec.lastParagraph + 1).some((p) => p.text.trim())
}

export function checkPage(ctx: CheckContext) {
  const fmt = ctx.profile?.format
  const sections = ctx.doc.sections.filter((s) => hasContent(ctx, s))

  // 纸张
  if (fmt?.paper === 'A4') {
    const readable = sections.filter((s) => s.pageWidthCm !== null && s.pageHeightCm !== null)
    const unknown = sections.length - readable.length
    const bad = readable.filter((s) => {
      const [w, h] = [s.pageWidthCm!, s.pageHeightCm!].sort((a, b) => a - b) // 横向页也算 A4
      return Math.abs(w - 21) > 0.1 || Math.abs(h - 29.7) > 0.1
    })
    if (bad.length) {
      ctx.add({
        id: 'page-paper', category: 'page', severity: 'error', title: '纸张不是 A4',
        expected: 'A4（21 × 29.7 厘米）',
        actual: bad.map((s) => `${round(s.pageWidthCm!)} × ${round(s.pageHeightCm!)} 厘米`).join('；'),
        detail: unknownNote(unknown, '节') || undefined,
        locations: bad.map((s) => sectionLocation(ctx, s)), basis: ctx.schoolBasis,
      })
    } else ctx.settle('page', '纸张大小', readable.length, unknown, '节')
  } else ctx.skip('page', '纸张大小', '学校档案未规定')

  // 页边距
  const want = fmt?.margins_cm
  if (want) {
    const keys = (Object.keys(MARGIN_LABEL) as (keyof typeof MARGIN_LABEL)[]).filter((k) => want[k] != null)
    const bad: { s: Section; diffs: string[] }[] = []
    let readable = 0, unknown = 0
    for (const s of sections) {
      const m = s.margins
      if (!m || keys.some((k) => m[k] === null)) {
        unknown++
        continue
      }
      readable++
      const diffsFor = (w: typeof want) => keys.filter((k) => Math.abs(m[k]! - w[k]!) > 0.05)
      let diffs = diffsFor(want)
      // 横向页：Word 切换方向时会把四边边距一起转 90°，两个方向都接受
      if (diffs.length && s.pageWidthCm !== null && s.pageHeightCm !== null && s.pageWidthCm > s.pageHeightCm) {
        const cw = { ...want, top: want.left, right: want.top, bottom: want.right, left: want.bottom }
        const ccw = { ...want, top: want.right, right: want.bottom, bottom: want.left, left: want.top }
        if (diffsFor(cw).length === 0 || diffsFor(ccw).length === 0) diffs = []
      }
      if (diffs.length) bad.push({ s, diffs: diffs.map((k) => `${MARGIN_LABEL[k]} ${round(m[k]!)}`) })
    }
    if (bad.length) {
      ctx.add({
        id: 'page-margins', category: 'page', severity: 'error',
        title: `页边距不符合要求（${bad.length} / ${sections.length} 节）`,
        expected: keys.map((k) => `${MARGIN_LABEL[k]} ${want[k]}`).join('，') + '（厘米）',
        actual: bad.map((b) => `第 ${b.s.index + 1} 节：${b.diffs.join('，')}`).join('；'),
        detail: [sections.some((s) => s.mirrorMargins) ? '文档开启了"对称页边距"，左右边距分别指内侧和外侧。' : '', unknownNote(unknown, '节')].join('') || undefined,
        locations: bad.map((b) => sectionLocation(ctx, b.s)), basis: ctx.schoolBasis,
      })
    } else ctx.settle('page', '页边距', readable, unknown, '节')
  } else ctx.skip('page', '页边距', '学校档案未规定')

  checkHeader(ctx)
  checkPageNumbers(ctx)
}

function bodySections(ctx: CheckContext): Section[] {
  const { bodyStart, bodyEnd } = ctx.s
  if (bodyStart === null) return []
  const first = ctx.doc.paragraphs[bodyStart].sectionIndex
  const last = ctx.doc.paragraphs[Math.max(bodyStart, bodyEnd - 1)].sectionIndex
  return ctx.doc.sections.slice(first, last + 1)
}

function checkHeader(ctx: CheckContext) {
  const rule = ctx.profile?.format?.header
  if (!rule || (rule.required == null && !rule.text)) {
    ctx.skip('page_numbers', '页眉', '学校档案未规定')
    return
  }
  const secs = bodySections(ctx)
  if (secs.length === 0) {
    ctx.skip('page_numbers', '页眉', '没有识别出正文从哪里开始')
    return
  }
  const missing = secs.filter((s) => !s.header?.text.replace(/\s+/g, ''))
  // 规定了页眉文字，就等于要求有页眉
  if ((rule.required || rule.text) && missing.length) {
    ctx.add({
      id: 'header-missing', category: 'page_numbers', severity: 'error', title: '正文没有页眉',
      expected: rule.text ? `页眉"${rule.text}"` : '有页眉',
      locations: missing.map((s) => sectionLocation(ctx, s)), basis: ctx.schoolBasis,
    })
    return
  }
  if (rule.text) {
    const wrong = secs.filter((s) => s.header && s.header.text && !norm(s.header.text).includes(norm(rule.text!)))
    if (wrong.length) {
      ctx.add({
        id: 'header-text', category: 'page_numbers', severity: 'error', title: '页眉文字与要求不一致',
        expected: rule.text, actual: [...new Set(wrong.map((s) => s.header!.text))].join('；'),
        locations: wrong.map((s) => sectionLocation(ctx, s)), basis: ctx.schoolBasis,
      })
      return
    }
  }
  ctx.pass('page_numbers', '页眉')
}

function checkPageNumbers(ctx: CheckContext) {
  const rule = ctx.profile?.format?.page_numbers ?? null
  const { doc, s } = ctx
  if (s.bodyStart === null) {
    ctx.skip('page_numbers', '页码分节', '没有识别出正文从哪里开始（建议给章标题使用"标题 1"样式）')
    return
  }
  const bodySecs = bodySections(ctx)
  const bodySec = bodySecs[0]
  const pos = rule?.position ?? null
  const inHeader = pos?.startsWith('header') ?? false
  const pageField = (sec: Section) => (inHeader ? sec.header : sec.footer)?.hasPageField === true || (!pos && sec.header?.hasPageField === true)
  const basis = rule ? ctx.schoolBasis : '通用排版惯例'

  // 正文页码有没有
  const wantBody = rule?.body ?? 'arabic'
  if (wantBody !== 'none') {
    const noNumber = bodySecs.filter((sec) => !pageField(sec) && hasContent(ctx, sec))
    if (noNumber.length) {
      ctx.add({
        id: 'pagenum-body-missing', category: 'page_numbers', severity: rule?.body ? 'error' : 'warning',
        title: '正文没有插入页码',
        detail: `在${inHeader ? '页眉' : '页脚'}里没有找到页码域。手打的数字不会随页数变化，请用"插入 → 页码"。`,
        locations: noNumber.map((sec) => sectionLocation(ctx, sec)), basis,
      })
    } else ctx.pass('page_numbers', '正文页码')

    if (rule?.body === 'arabic') {
      const wrongFmt = bodySecs.filter((sec) => sec.pageNumberFormat !== 'arabic')
      if (wrongFmt.length) {
        ctx.add({
          id: 'pagenum-body-format', category: 'page_numbers', severity: 'error', title: '正文页码格式不对',
          expected: FMT_LABEL.arabic, actual: FMT_LABEL[wrongFmt[0].pageNumberFormat],
          locations: wrongFmt.map((sec) => sectionLocation(ctx, sec)), basis,
        })
      } else ctx.pass('page_numbers', '正文页码格式')
    }
  }

  // 正文是否从 1 开始：需要和前置部分分节
  const frontInSameSection = s.frontHeadings.filter((p) => p.sectionIndex === bodySec.index)
  const wantStart = rule?.body_starts_at ?? null
  const differentFormat = rule?.front_matter && rule.front_matter !== 'none' && rule.front_matter !== (rule.body ?? 'arabic')
  if (frontInSameSection.length && (wantStart !== null || differentFormat)) {
    ctx.add({
      id: 'pagenum-no-section-break', category: 'page_numbers', severity: 'error',
      title: '摘要、目录和正文在同一节里，正文页码无法单独编排',
      detail: '在正文第一章前面插入"分节符（下一页）"，再把正文的页码设为"起始页码 1"，并取消页脚的"链接到前一节"。',
      locations: frontInSameSection.map((p) => ({ paragraph: p.index, excerpt: excerpt(p.text) })),
      basis,
    })
  } else if (wantStart !== null) {
    const startsAt = bodySec.pageNumberStart ?? (bodySec.index === 0 && s.bodyStart === firstContentParagraph(ctx) ? 1 : null)
    if (startsAt !== wantStart) {
      ctx.add({
        id: 'pagenum-body-start', category: 'page_numbers', severity: 'error',
        title: `正文页码没有从 ${wantStart} 开始`,
        expected: `起始页码 ${wantStart}`, actual: startsAt === null ? '续前节' : `起始页码 ${startsAt}`,
        detail: '在正文第一节的"页码格式"里把"起始页码"设为 1。',
        locations: [sectionLocation(ctx, bodySec)], basis,
      })
    } else ctx.pass('page_numbers', '正文起始页码')
  } else if (frontInSameSection.length && !rule) {
    ctx.add({
      id: 'pagenum-no-section-break', category: 'page_numbers', severity: 'info',
      title: '摘要、目录和正文在同一节里',
      detail: '多数学校要求前置部分用罗马数字、正文从 1 开始编页码，这需要在正文前插入分节符。请对照本校规范。',
      locations: frontInSameSection.map((p) => ({ paragraph: p.index, excerpt: excerpt(p.text) })),
      basis,
    })
  }

  // 正文中途重新编号
  const restarts = bodySecs.slice(1).filter((sec) => sec.pageNumberStart !== null && hasContent(ctx, sec))
  if (restarts.length) {
    ctx.add({
      id: 'pagenum-restart', category: 'page_numbers', severity: 'warning', title: '正文中间页码重新开始编号',
      detail: '正文各章之间的分节应设为"续前节"，否则页码会断开。',
      locations: restarts.map((sec) => sectionLocation(ctx, sec)), basis,
    })
  }

  // 前置部分
  const fm = rule?.front_matter
  if (fm) {
    const frontSecs = [...new Set(s.frontHeadings.map((p) => p.sectionIndex))].filter((i) => i !== bodySec.index).map((i) => doc.sections[i])
    if (frontSecs.length === 0) ctx.skip('page_numbers', '前置部分页码', '没有找到单独成节的摘要或目录')
    else {
      const bad = frontSecs.filter((sec) => (fm === 'none' ? pageField(sec) : !pageField(sec) || sec.pageNumberFormat !== fm))
      if (bad.length) {
        ctx.add({
          id: 'pagenum-front', category: 'page_numbers', severity: 'error', title: '摘要、目录的页码不符合要求',
          expected: FMT_LABEL[fm],
          actual: bad.map((sec) => (pageField(sec) ? FMT_LABEL[sec.pageNumberFormat] : FMT_LABEL.none)).join('；'),
          locations: bad.map((sec) => sectionLocation(ctx, sec)), basis,
        })
      } else ctx.pass('page_numbers', '前置部分页码')
    }
  } else ctx.skip('page_numbers', '前置部分页码', '学校档案未规定')

  // 页码位置
  if (pos && wantBody !== 'none') {
    const bad: Section[] = []
    for (const sec of bodySecs) {
      const hf = inHeader ? sec.header : sec.footer
      if (!hf?.hasPageField || hf.pageFieldAlign === null) continue
      const align = hf.pageFieldAlign
      if (pos.endsWith('center') && align !== 'center') bad.push(sec)
      else if (pos.endsWith('right') && align !== 'right') bad.push(sec)
      else if (pos.endsWith('outside')) {
        const even = inHeader ? sec.evenHeader : sec.evenFooter
        if (!doc.evenAndOddHeaders || align !== 'right' || even?.pageFieldAlign !== 'left') bad.push(sec)
      }
    }
    if (bad.length) {
      ctx.add({
        id: 'pagenum-position', category: 'page_numbers', severity: 'error', title: '页码位置不符合要求',
        expected: { footer_center: '页脚居中', footer_right: '页脚右侧', footer_outside: '页脚外侧（奇数页右、偶数页左）', header_right: '页眉右侧', header_outside: '页眉外侧' }[pos],
        locations: bad.map((sec) => sectionLocation(ctx, sec)), basis,
      })
    } else ctx.pass('page_numbers', '页码位置')
  } else if (!pos) ctx.skip('page_numbers', '页码位置', '学校档案未规定')
}

function firstContentParagraph(ctx: CheckContext): number {
  return ctx.doc.paragraphs.find((p) => p.text.trim())?.index ?? 0
}
