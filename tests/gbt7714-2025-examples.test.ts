// 回归测试：GB/T 7714—2025 附录的 141 条示例，按顺序编码制渲染后送进解析器，
// 比对类型、题名、出版年、第一责任者、出处五项。数据来源和许可见 fixtures/third_party/zotero-chinese/README.md。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseGbt7714 } from '../src/references/structured/gbt7714'
import type { CslName } from '../src/references/structured/names'

interface Example {
  id: string
  text: string
  expected: { type: string; title: string | null; year: number | string | null; author: string | null; container: string | null }
}

const examples: Example[] = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/third_party/zotero-chinese/gbt7714-2025-examples.json'), 'utf8'),
)

/** 国标把这些类型并进了更粗的文献类型标识，从著录文本里分不出来 */
const TYPE_EQUIVALENT: Record<string, string[]> = {
  motion_picture: ['webpage'], // 视频标 [EB]
  graphic: ['webpage'], // 图片标 [EB]
  personal_communication: ['manuscript'], // 信件标 [A]
  book: ['periodical'], // 连续出版物整体，原数据记为 book
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
const fullName = (n: CslName | undefined) => (n ? n.literal ?? `${n.family ?? ''}${n.given ?? ''}` : '')

describe('GB/T 7714—2025 附录示例（141 条）', () => {
  it('共 141 条', () => expect(examples).toHaveLength(141))

  for (const ex of examples) {
    it(`${ex.id}：${ex.text.slice(0, 30)}`, () => {
      const { csl } = parseGbt7714(ex.text)
      const e = ex.expected
      expect([e.type, ...(TYPE_EQUIVALENT[e.type] ?? [])]).toContain(csl.type)
      // 解析出的题名可以多带其他题名信息（卷册、比例尺等），以期望题名开头即可
      if (e.title) expect(norm(csl.title).startsWith(norm(e.title))).toBe(true)
      if (e.year !== null) expect(csl.issued?.['date-parts']?.[0]?.[0]).toBe(Number(e.year))
      // 2025 版标准文献不著录责任者，著录文本里没有作者，无从比对
      // 机构名里带逗号时（"Institute for Art and Architecture, Academy of Fine Arts Vienna"）会被拆成两个责任者，
      // 所以两边互为前缀即可
      if (e.author && e.type !== 'standard') {
        const got = norm(fullName(csl.author?.[0]))
        const want = norm(e.author)
        expect(got.length >= 2 && (got.startsWith(want) || want.startsWith(got))).toBe(true)
      }
      if (e.container) expect(norm(csl['container-title'])).toContain(norm(e.container).slice(0, 6))
    })
  }
})
