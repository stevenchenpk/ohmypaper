import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { DocxError, parseDocx } from '../src/format/docx'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

/** 只带 document.xml（和可选的 styles.xml）的最小 docx */
function docx(body: string, extra: Record<string, string> = {}, ns = W): Uint8Array {
  const doc = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${ns}"><w:body>${body}</w:body></w:document>`
  return zipSync(Object.fromEntries([['word/document.xml', strToU8(doc)], ...Object.entries(extra).map(([k, v]) => [k, strToU8(v)])]))
}
const run = (t: string) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`

describe('修订', () => {
  it('移动修订：旧位置的文字不算正文，移动计入修订数', () => {
    const d = parseDocx(docx(
      `<w:p><w:moveFrom w:id="1" w:author="a">${run('被挪走的一段')}</w:moveFrom></w:p>` +
      `<w:p>${run('第二段')}</w:p>` +
      `<w:p><w:moveTo w:id="2" w:author="a">${run('被挪走的一段')}</w:moveTo></w:p>`,
    ))
    expect(d.paragraphs.map((p) => p.text)).toEqual(['', '第二段', '被挪走的一段'])
    expect(d.trackedChanges).toBe(2)
  })

  it('整段移动（段落标记也带 moveFrom）不留下文字', () => {
    const d = parseDocx(docx(`<w:p><w:pPr><w:rPr><w:moveFrom w:id="3" w:author="a"/></w:rPr></w:pPr><w:moveFrom w:id="4" w:author="a">${run('旧')}</w:moveFrom></w:p>`))
    expect(d.paragraphs[0].text).toBe('')
    expect(d.trackedChanges).toBeGreaterThan(0)
  })

  it('格式修订也算未处理的修订', () => {
    const d = parseDocx(docx(`<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="5" w:author="a"><w:rPr/></w:rPrChange></w:rPr><w:t>改了加粗</w:t></w:r></w:p>` +
      `<w:p><w:pPr><w:jc w:val="center"/><w:pPrChange w:id="6" w:author="a"><w:pPr/></w:pPrChange></w:pPr>${run('改了对齐')}</w:p>`))
    expect(d.trackedChanges).toBe(2)
  })
})

describe('不支持的文件给出明确提示', () => {
  it('Strict OOXML', () => {
    const strict = docx(`<w:p>${run('正文')}</w:p>`, {}, 'http://purl.oclc.org/ooxml/wordprocessingml/main')
    expect(() => parseDocx(strict)).toThrow(/Strict/)
  })

  it('解压后过大或成员过多时拒绝处理', () => {
    const files: Record<string, Uint8Array> = { 'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body/></w:document>`) }
    for (let i = 0; i < 5001; i++) files[`word/media/x${i}.xml`] = strToU8('<a/>')
    expect(() => parseDocx(zipSync(files))).toThrow(DocxError)
  })
})

describe('加粗是切换属性', () => {
  it('段落样式加粗、字符样式也加粗时，两层相互抵消', () => {
    const styles = `<?xml version="1.0"?><w:styles xmlns:w="${W}">
      <w:style w:type="paragraph" w:styleId="H"><w:name w:val="Bold Para"/><w:rPr><w:b/></w:rPr></w:style>
      <w:style w:type="character" w:styleId="E"><w:name w:val="Emph"/><w:rPr><w:b/></w:rPr></w:style></w:styles>`
    const d = parseDocx(docx(
      `<w:p><w:pPr><w:pStyle w:val="H"/></w:pPr><w:r><w:rPr><w:rStyle w:val="E"/></w:rPr><w:t>两层</w:t></w:r>` +
      `<w:r><w:t>一层</w:t></w:r><w:r><w:rPr><w:rStyle w:val="E"/><w:b/></w:rPr><w:t>直接加粗</w:t></w:r></w:p>`,
      { 'word/styles.xml': styles },
    ))
    expect(d.paragraphs[0].runs.map((r) => r.bold)).toEqual([false, true, true])
  })
})
