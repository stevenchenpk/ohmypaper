/**
 * 格式体检入口：docx 二进制 + 学校档案 → 体检报告。
 * 没选学校时只做不依赖学校规则的通用检查（标题结构、页码、GB/T 7714、提交前清理）。
 */

import { type DocxModel, parseDocx } from './docx'
import type { SchoolProfile } from './profile'
import { profileLabel } from './profile'
import type { Report, Severity } from './report'
import { CheckContext } from './checks/context'
import { checkCaptions } from './checks/captions'
import { checkCleanup } from './checks/cleanup'
import { checkHeadings, looksLikeHeading } from './checks/headings'
import { checkPage } from './checks/page'
import { checkReferences, referenceText } from './checks/references'
import { checkTextStyle } from './checks/textStyle'
import { checkToc } from './checks/toc'
import { analyze } from './structure'

const CJK_RE = /[\u3400-\u9fff]/
/** 行尾的公式编号，如 (2-1)、（3.2） */
const EQ_NO_RE = /[（(]\s*\d+\s*[-.．]\s*\d+\s*[)）]\s*$/
const CAPTION_RE = /^(图|表|figure|fig\.|table)\s*[\d一二三四五六七八九十]/i

export function checkDocx(data: Uint8Array, profile: SchoolProfile | null): Report {
  return checkModel(parseDocx(data), profile)
}

export function checkModel(doc: DocxModel, profile: SchoolProfile | null): Report {
  const s = analyze(doc)
  const ctx = new CheckContext(doc, s, profile)

  // 正文段落：去掉标题、表格、目录、图表题注、居中的短行（公式、图片说明）
  const bodyParas = s.bodyStart === null
    ? []
    : doc.paragraphs.slice(s.bodyStart, s.bodyEnd).filter((p) => {
        const t = p.text.trim()
        if (!t || p.headingLevel !== null || p.inTable || p.inToc) return false
        if (/caption|题注/i.test(p.styleName ?? '') || CAPTION_RE.test(t)) return false
        // 居中的短行、纯公式行、带公式编号的行：多是公式或图片说明，不按正文查
        if (p.align === 'center' && (t.length <= 40 || !CJK_RE.test(t) || EQ_NO_RE.test(t))) return false
        // 公式行（公式本身可能是 Office 公式或嵌入对象，不在文字里）：去掉编号后基本没有文字
        if ((p.hasMath || EQ_NO_RE.test(t)) && t.replace(EQ_NO_RE, '').trim().length <= 15) return false
        if (!p.numbered && looksLikeHeading(p)) return false // 另报"疑似标题"
        return true
      })

  checkPage(ctx)

  const bodyRule = profile?.format?.body
  if (bodyRule && s.bodyStart !== null) checkTextStyle(ctx, { category: 'body', label: '正文', id: 'body', paragraphs: bodyParas, rule: bodyRule })
  else if (!bodyRule) ctx.skip('body', '正文字体字号行距', '学校档案未规定')
  else ctx.skip('body', '正文字体字号行距', '没有识别出正文从哪里开始（建议给章标题使用"标题 1"样式）')

  checkHeadings(ctx)
  checkToc(ctx)
  checkCaptions(ctx)
  checkReferences(ctx)
  checkCleanup(ctx)

  const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 }
  const issues = [...ctx.issues].sort((a, b) => rank[a.severity] - rank[b.severity])

  return {
    profileLabel: profile ? profileLabel(profile) : null,
    issues,
    passed: ctx.passed,
    skipped: ctx.skipped,
    stats: {
      paragraphs: doc.paragraphs.filter((p) => p.text.trim()).length,
      bodyParagraphs: bodyParas.length,
      headings: doc.paragraphs.filter((p) => p.headingLevel !== null && !p.inToc).length,
      sections: doc.sections.length,
      references: s.refEntries.length,
    },
    references: s.refEntries.map(referenceText),
  }
}
