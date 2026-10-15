import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { DocxError, parseDocx } from '../src/format/docx'
import { checkDocx, checkModel } from '../src/format/engine'
import { cnToInt, headingNumber } from '../src/format/checks/headings'
import { canonicalFont, describeSize, parseLineSpacing, parseSpacing, type SchoolProfile } from '../src/format/profile'

const fixtures = join(__dirname, 'fixtures')
const load = (name: string) => new Uint8Array(readFileSync(join(fixtures, name)))
const profile = parse(readFileSync(join(fixtures, 'test-profile.yaml'), 'utf8')) as SchoolProfile

const ids = (r: ReturnType<typeof checkDocx>) => r.issues.map((i) => i.id)
const serious = (r: ReturnType<typeof checkDocx>) => r.issues.filter((i) => i.severity !== 'info')

describe('格式体检：合格样例不误报', () => {
  for (const file of ['good.docx', 'good-libreoffice.docx']) {
    it(`${file} 按测试档案检查没有问题`, () => {
      const r = checkDocx(load(file), profile)
      expect(serious(r)).toEqual([])
      expect(r.stats.references).toBe(4)
      expect(r.stats.sections).toBe(3)
      expect(r.passed.length).toBeGreaterThan(20)
    })
  }

  it('不选学校时只做通用检查，同样没有问题', () => {
    const r = checkDocx(load('good.docx'), null)
    expect(serious(r)).toEqual([])
    expect(r.skipped.map((s) => s.item)).toContain('页边距')
  })

  it('抽出参考文献原文供引用核验', () => {
    const r = checkDocx(load('good.docx'), profile)
    expect(r.references[0]).toMatch(/^LeCun Y, Bengio Y, Hinton G\. Deep learning\[J\]/)
  })
})

describe('格式体检：错误样例全部检出', () => {
  const r = checkDocx(load('bad.docx'), profile)
  const found = ids(r)

  it.each([
    ['page-margins', '左边距 2.5 厘米'],
    ['header-missing', '正文没有页眉'],
    ['pagenum-body-missing', '正文没有页码'],
    ['pagenum-no-section-break', '摘要目录和正文不分节'],
    ['body-font-cn', '正文用了等线、楷体'],
    ['body-font-en', '正文西文用了 Calibri'],
    ['body-size', '正文五号字'],
    ['body-line-spacing', '正文单倍行距'],
    ['body-indent', '正文没有首行缩进'],
    ['headings-pseudo', '"3.2 研究设计"没用标题样式'],
    ['headings-skip-level', '一级标题下直接三级'],
    ['headings-number-sequence', '第一章后面是第三章'],
    ['refs-unnumbered', '第 2 条参考文献没有序号'],
    ['refs-type-code-present', '缺文献类型标识'],
    ['refs-url-needs-carrier', '网址没标 /OL'],
    ['cite-out-of-range', '正文引用了 [6]'],
    ['cite-uncited', '第 5 条没被引用'],
    ['cleanup-broken-ref', '错误！未找到引用源'],
    ['cleanup-author-metadata', '文档属性留有作者名'],
  ])('%s：%s', (id) => {
    expect(found).toContain(id)
  })

  it('问题按严重程度排序，位置不超过 5 个', () => {
    const rank = { error: 0, warning: 1, info: 2 }
    const order = r.issues.map((i) => rank[i.severity])
    expect(order).toEqual([...order].sort())
    for (const i of r.issues) expect(i.locations.length).toBeLessThanOrEqual(5)
  })

  it('字体问题给出实际值', () => {
    const font = r.issues.find((i) => i.id === 'body-font-cn')!
    expect(font.expected).toBe('宋体')
    expect(font.actual).toContain('等线')
    expect(font.actual).toContain('楷体')
  })
})

describe('种子学校档案', () => {
  const root = join(__dirname, '..', 'schools')
  for (const dir of readdirSync(root).filter((d) => !d.startsWith('_') && !d.includes('.'))) {
    for (const file of readdirSync(join(root, dir)).filter((f) => f.endsWith('.yaml'))) {
      it(`${dir}/${file} 能驱动引擎`, () => {
        const p = parse(readFileSync(join(root, dir, file), 'utf8')) as SchoolProfile
        expect(() => checkDocx(load('good.docx'), p)).not.toThrow()
      })
    }
  }
})

describe('docx 解析', () => {
  it('非 docx 文件给出可读的错误', () => {
    expect(() => parseDocx(new TextEncoder().encode('not a zip'))).toThrow(DocxError)
  })

  it('解析分节、页码格式和页脚页码域', () => {
    const doc = parseDocx(load('good.docx'))
    expect(doc.sections.map((s) => s.pageNumberFormat)).toEqual(['arabic', 'upper_roman', 'arabic'])
    expect(doc.sections[2].pageNumberStart).toBe(1)
    expect(doc.sections[2].footer?.hasPageField).toBe(true)
    expect(doc.sections[2].footer?.pageFieldAlign).toBe('center')
    expect(doc.sections[2].header?.text).toBe('某某大学本科毕业论文')
  })

  it('按样式继承解析字体：主题字体换成实际字体名', () => {
    const doc = parseDocx(load('bad.docx'))
    const heading = doc.paragraphs.find((p) => p.text === '第一章 绪论')!
    expect(heading.headingLevel).toBe(1)
    expect(heading.runs[0].fontCn).toBe('黑体')
    expect(heading.runs[0].sizePt).toBe(16)
    const body = doc.paragraphs.find((p) => p.text.startsWith('深度学习'))!
    expect(body.runs[0].fontCn).toBe('等线')
    expect(body.lineSpacing).toEqual({ kind: 'multiple', value: 1 })
  })
})

describe('档案写法换算', () => {
  it('行距', () => {
    expect(parseLineSpacing('1.5 倍')).toEqual({ kind: 'multiple', value: 1.5 })
    expect(parseLineSpacing('单倍')).toEqual({ kind: 'multiple', value: 1 })
    expect(parseLineSpacing('固定值 20 磅')).toEqual({ kind: 'exact', pt: 20 })
    expect(parseLineSpacing('最小值20磅')).toEqual({ kind: 'atLeast', pt: 20 })
    expect(parseLineSpacing('20 磅')).toBeNull()
  })
  it('段前段后', () => {
    expect(parseSpacing('0.5 行')).toEqual({ lines: 0.5 })
    expect(parseSpacing('12磅')).toEqual({ pt: 12 })
  })
  it('字体别名和字号名', () => {
    expect(canonicalFont('SimSun')).toBe('宋体')
    expect(canonicalFont('楷体_GB2312')).toBe('楷体')
    expect(describeSize(10.5)).toBe('五号（10.5 磅）')
  })
  it('标题编号', () => {
    expect(cnToInt('十二')).toBe(12)
    expect(cnToInt('二十')).toBe(20)
    expect(headingNumber('第三章 研究方法')).toEqual([3])
    expect(headingNumber('2.1.4 样本')).toEqual([2, 1, 4])
    expect(headingNumber('2023年政策回顾')).toBeNull()
  })
})

describe('压测样例：更贴近真实的合格论文不误报', () => {
  // 由 tests/fixtures/make_stress_samples.py 生成
  const stress = (f: string) => new Uint8Array(readFileSync(join(fixtures, 'stress', f)))
  it.each(['toc-field.docx', 'landscape.docx', 'captions.docx', 'mixed-numbering.docx', 'wps-like.docx'])('%s', (f) => {
    expect(serious(checkDocx(stress(f), profile)).map((i) => i.id)).toEqual([])
  })

  it('LibreOffice 转存后题注编号确实被改乱，只报这两项', () => {
    // LibreOffice 不认 SEQ 域的 \s 1（按章重新编号），转存时把编号改成了全文连续
    const found = serious(checkDocx(stress('captions-libreoffice.docx'), profile)).map((i) => i.id).sort()
    expect(found).toEqual(['captions-sequence-figure', 'captions-sequence-table'])
  })

  it('目录域能识别，目录和标题一致时记为通过', () => {
    expect(checkDocx(stress('toc-field.docx'), profile).passed.map((p) => p.item)).toContain('目录与标题一致')
  })

  it('WPS 把页码放在页脚文本框里，按文本框内段落的对齐判断', () => {
    const doc = parseDocx(stress('wps-like.docx'))
    const body = doc.sections[doc.sections.length - 1]
    expect(body.footer?.hasPageField).toBe(true)
    expect(body.footer?.pageFieldAlign).toBe('center')
  })
})

describe('GB/T 7714 版本：学校没写明时过渡期两版都认', () => {
  // 把合格样例的第一条参考文献换成 2015 版写法（西文姓氏全大写）
  const withOldStyle = () => {
    const doc = parseDocx(load('good.docx'))
    const p = doc.paragraphs.find((x) => x.text.includes('Deep learning[J]'))!
    p.text = p.text.replace('LeCun Y, Bengio Y, Hinton G', 'LECUN Y, BENGIO Y, HINTON G')
    return doc
  }
  const withStandard = (standard: NonNullable<SchoolProfile['references']>['standard']) =>
    ({ ...profile, references: { ...profile.references, standard } }) as SchoolProfile

  it('档案写明 2025 版：2015 版写法报不符', () => {
    const r = checkModel(withOldStyle(), withStandard('GB/T 7714-2025'))
    expect(serious(r).map((i) => i.id)).toContain('refs-surname-case')
  })

  it('档案没写版本：2015 版写法只给提示，不算不符', () => {
    const r = checkModel(withOldStyle(), withStandard(null))
    expect(serious(r).map((i) => i.id)).not.toContain('refs-surname-case')
    const note = r.issues.find((i) => i.id === 'refs-surname-case-2015')!
    expect(note.severity).toBe('info')
    expect(note.basis).toContain('过渡期两版都认')
  })

  it('不选学校时同样两版都认', () => {
    const r = checkModel(withOldStyle(), null)
    expect(serious(r).map((i) => i.id)).not.toContain('refs-surname-case')
  })

  it('两版都不接受的写法照样报不符', () => {
    const doc = parseDocx(load('good.docx'))
    const p = doc.paragraphs.find((x) => x.text.includes('Deep learning[J]'))!
    p.text = p.text.replace('436-444', '436~444')
    const r = checkModel(doc, withStandard(null))
    expect(serious(r).map((i) => i.id)).toContain('refs-page-range-hyphen')
  })

  it('学校要求的不是 GB/T 7714：著录格式不查，引用对账照常做，不显示原始枚举值', () => {
    const scu = parse(readFileSync(join(__dirname, '..', 'schools', 'scu', 'bachelor-2026.yaml'), 'utf8')) as SchoolProfile
    expect(scu.references?.standard).toBe('other')
    const base = checkDocx(load('bad.docx'), null)
    const r = checkDocx(load('bad.docx'), scu)
    expect(r.citationMap).not.toBeNull()
    const citeIds = (x: typeof r) => x.issues.map((i) => i.id).filter((id) => id.startsWith('cite-')).sort()
    expect(citeIds(base).length).toBeGreaterThan(0)
    expect(citeIds(r)).toEqual(citeIds(base))
    expect(r.issues.some((i) => /^refs-(surname|page|type)/.test(i.id))).toBe(false)
    const note = r.skipped.find((x) => x.item === '参考文献著录格式')!
    expect(note.reason).toContain('学校要求的参考文献格式不是 GB/T 7714')
    expect(note.reason).toContain('著录格式这次没有检查')
    const all = JSON.stringify([r.skipped, r.passed, r.issues])
    expect(all).not.toMatch(/\bother\b/)
  })

  it('APA-7 时说明写成人话', () => {
    const r = checkDocx(load('bad.docx'), withStandard('APA-7'))
    expect(r.skipped.find((x) => x.item === '参考文献著录格式')?.reason).toContain('APA 第 7 版')
    expect(r.citationMap).not.toBeNull()
  })
})
