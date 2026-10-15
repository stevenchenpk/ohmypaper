/** 提交前清理：残留的修订、批注、高亮、交叉引用错误、文档属性里的作者名。 */

import type { Paragraph } from '../docx'
import type { CheckContext } from './context'

const BROKEN_REF = /(错误[！!]\s*(未找到引用源|未定义书签|文档中没有指定样式的文字)|Error!\s*(Reference source not found|Bookmark not defined|No text of specified style))/i

export function checkCleanup(ctx: CheckContext) {
  const { doc } = ctx

  const broken: Paragraph[] = doc.paragraphs.filter((p) => BROKEN_REF.test(p.text))
  if (broken.length) {
    ctx.addForParagraphs(broken, {
      id: 'cleanup-broken-ref', category: 'cleanup', severity: 'error', title: `有 ${broken.length} 处交叉引用失效`,
      detail: '文中出现"错误！未找到引用源"之类的文字，通常是删掉了被引用的图表或标题。打印前务必修好。',
      basis: '提交前自查',
    })
  } else ctx.pass('cleanup', '交叉引用')

  if (doc.trackedChanges > 0) {
    ctx.add({
      id: 'cleanup-tracked-changes', category: 'cleanup', severity: 'warning', title: `还有 ${doc.trackedChanges} 处未处理的修订`,
      detail: '在"审阅"里选择"接受所有修订"或逐条处理，否则别人打开时会看到修改痕迹。', basis: '提交前自查',
    })
  } else ctx.pass('cleanup', '修订痕迹')

  if (doc.comments > 0) {
    ctx.add({
      id: 'cleanup-comments', category: 'cleanup', severity: 'warning', title: `还有 ${doc.comments} 条批注`,
      detail: '提交前在"审阅"里删除所有批注。', basis: '提交前自查',
    })
  } else ctx.pass('cleanup', '批注')

  if (doc.highlights > 0) {
    ctx.add({
      id: 'cleanup-highlight', category: 'cleanup', severity: 'info', title: `有 ${doc.highlights} 处文字带高亮底色`,
      detail: '可能是写作时留下的标记，确认是否需要去掉。', basis: '提交前自查',
    })
  }

  const blind = ctx.profile?.format?.blind_review
  const reviewers = doc.reviewAuthors ?? []
  if (doc.authors.length) {
    ctx.add({
      id: 'cleanup-author-metadata', category: 'cleanup', severity: blind ? 'warning' : 'info',
      title: '文档属性里留有作者信息',
      actual: doc.authors.join('、'),
      detail: '盲审时这会暴露身份。在 Word 的"文件 → 信息 → 检查问题 → 检查文档"里删除文档属性和个人信息。',
      basis: blind ? `${ctx.schoolBasis}（盲审要求）` : '提交前自查',
    })
  } else if (!blind) ctx.pass('cleanup', '文档属性中的作者信息')

  // 盲审匿名化不能打绿勾：工具只看了文档属性，正文和批注修订里的身份信息都没查
  if (blind) {
    const checked = doc.authors.length ? '文档属性里留有作者名（见上）' : '文档属性里没有作者名'
    const reviewNote = reviewers.length ? `批注和修订上记的作者有：${reviewers.join('、')}，提交前请一并删除。` : ''
    ctx.skip('cleanup', '盲审匿名',
      `本工具只看了文档属性：${checked}。但正文、封面、致谢、页眉页脚里的姓名、学号、导师姓名，以及批注和修订的作者，都没有检查，请按学校盲审要求自己核对。${reviewNote}`)
  }
}
