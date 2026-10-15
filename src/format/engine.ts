/**
 * 格式体检入口：docx 二进制 + 学校档案 → 体检报告。
 * 没选学校时只做不依赖学校规则的通用检查（标题结构、页码、GB/T 7714、提交前清理）。
 */

import { type DocxModel, parseDocx } from './docx'
import type { SchoolProfile } from './profile'
import { profileLabel } from './profile'
import type { AuthorYearMap, CitationMap, Report, Severity } from './report'
import { reconcileAuthorYear } from './authorYear'
import { inferCitationStyle, reconcileCitations } from './citations'
import { CheckContext } from './checks/context'
import { checkCaptions } from './checks/captions'
import { checkCleanup } from './checks/cleanup'
import { checkHeadings, looksLikeHeading } from './checks/headings'
import { checkPage } from './checks/page'
import { checkReferences, referenceText } from './checks/references'
import { checkTextStyle } from './checks/textStyle'
import { checkToc } from './checks/toc'
import { type Structure, analyze, locate } from './structure'

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

  // 引用对账按体例分两种；没找到参考文献表时不做
  const citeStyle = s.refHeading === null ? null : inferCitationStyle(doc, s, profile?.references?.style).style

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
    // 对账和著录标准无关，学校要求的不是 GB/T 7714 时也照常做
    citationMap: citeStyle === 'numeric' ? citationMap(doc, s) : null,
    authorYearMap: citeStyle === 'author-year' ? authorYearMap(doc, s) : null,
  }
}

function authorYearMap(doc: DocxModel, s: Structure): AuthorYearMap {
  const r = reconcileAuthorYear(doc, s)
  const at = (i: number) => locate(doc.paragraphs[i], s)
  return {
    citations: r.citations.map((c) => ({ raw: c.raw, author: c.author, year: c.year, suffix: c.suffix, location: at(c.paragraph), narrative: c.narrative, entry: c.entry })),
    references: r.entries.map((e, i) => ({
      author: e.author, year: e.year, suffix: e.suffix, text: referenceText(s.refEntries[i]), timesCited: e.timesCited,
      firstCited: e.firstCitation === null ? null : at(r.citations[e.firstCitation].paragraph),
    })),
    missing: r.missing, yearMismatch: r.yearMismatch, needSuffix: r.needSuffix, listSuffixMissing: r.listSuffixMissing,
    uncited: r.uncited, unreadEntries: r.unreadEntries, maybeCited: r.maybeCited,
    unresolved: r.unresolved.map((u) => ({ raw: u.raw, location: at(u.paragraph) })),
    noteRefs: r.noteRefs,
  }
}

function citationMap(doc: DocxModel, s: Structure): CitationMap {
  const r = reconcileCitations(doc, s)
  const at = (i: number) => locate(doc.paragraphs[i], s)
  return {
    citations: r.citations.map((c) => ({ raw: c.raw, numbers: c.numbers, location: at(c.paragraph), superscript: c.superscript, bare: c.bare })),
    references: r.entries.map((e, i) => ({
      number: e.number, text: referenceText(s.refEntries[i]), timesCited: e.timesCited,
      firstCited: e.firstCitation === null ? null : at(r.citations[e.firstCitation].paragraph),
    })),
    missing: r.missing.map((m) => m.number),
    uncited: r.uncited,
    outOfOrder: r.outOfOrder.map((o) => o.number),
    malformed: r.malformed.map((c) => c.raw),
    uncertain: {
      unreadFieldParagraphs: r.uncertain.unreadFieldParagraphs,
      noteRefs: r.uncertain.noteRefs,
      ambiguous: r.uncertain.ambiguous.map((c) => ({ raw: c.raw, numbers: c.numbers, location: at(c.paragraph), superscript: true, bare: true })),
    },
  }
}
