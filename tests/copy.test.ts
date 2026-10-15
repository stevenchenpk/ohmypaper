import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const html = read('index.html')
const dossierUi = read('src/dossier/ui.ts')

describe('隐私措辞和实际发出的内容一致', () => {
  it('核验说明写明发出整条文献文字，列出全部服务', () => {
    expect(html).toContain('论文正文和研究数据默认只在浏览器里处理，联网核验只发送你确认过的参考文献信息。')
    expect(html).not.toContain('标题或 DOI')
    for (const s of ['Crossref', 'OpenAlex', 'DataCite', 'doi.org']) expect(html.match(new RegExp(`${s}[^<]*这几个公开学术服务`, 'g'))?.length ?? 0).toBeGreaterThan(0)
    expect((html.match(/作者、题名、刊名/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('不说绝对化或自相矛盾的话', () => {
    for (const text of [html, dossierUi]) {
      expect(text).not.toContain('零上传')
      expect(text).not.toContain('任何服务器')
      expect(text).not.toContain('我们的服务器')
    }
    expect(html).toContain('docx 只在你的浏览器里解析，论文正文不会被发送出去。')
    expect(html).not.toContain('过关')
  })
})
