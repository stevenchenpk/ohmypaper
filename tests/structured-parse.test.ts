import { describe, expect, it } from 'vitest'
import { detectExportFormat, parseCnkiExport } from '../src/references/structured/cnki'
import { parseGbt7714 } from '../src/references/structured/gbt7714'
import { splitChineseName, toCslName } from '../src/references/structured/names'
import { ENDNOTE, NOTEEXPRESS, REFWORKS } from './fixtures/cnki-exports'

const FIXTURES: Record<string, string> = { 'endnote.txt': ENDNOTE, 'noteexpress.txt': NOTEEXPRESS, 'refworks.txt': REFWORKS }
const fixture = (name: string) => FIXTURES[name]

describe('中文姓名拆分', () => {
  it('单姓、复姓、少数民族译名、机构', () => {
    expect(splitChineseName('王宁')).toEqual({ family: '王', given: '宁' })
    expect(splitChineseName('欧阳修')).toEqual({ family: '欧阳', given: '修' })
    expect(splitChineseName('司马相如')).toEqual({ family: '司马', given: '相如' })
    expect(toCslName('阿依古丽·买买提')).toEqual({ literal: '阿依古丽·买买提' })
    expect(toCslName('全国信息与文献标准化技术委员会')).toEqual({ literal: '全国信息与文献标准化技术委员会' })
    expect(toCslName('教育部')).toEqual({ literal: '教育部' })
  })

  it('音译外国人名和日本人名不拆', () => {
    expect(toCslName('哈里森')).toEqual({ literal: '哈里森' })
    expect(toCslName('久保智康')).toEqual({ literal: '久保智康' })
  })

  it('西文 GB/T 7714 写法', () => {
    expect(toCslName('Peebles P Z Jr')).toEqual({ family: 'Peebles', given: 'P Z Jr' })
    expect(toCslName('LECUN Y')).toEqual({ family: 'LECUN', given: 'Y' })
    expect(toCslName('De Morgan A')).toEqual({ family: 'De Morgan', given: 'A' })
    expect(toCslName('Li Jiangning')).toEqual({ family: 'Li', given: 'Jiangning' })
  })
})

describe('GB/T 7714 条目解析：2015 版附录示例', () => {
  it('专著', () => {
    const r = parseGbt7714('[1] 陈登原.国史旧闻:第1卷[M].北京:中华书局,2000:29.')
    expect(r.index).toBe(1)
    expect(r.typeCode).toBe('M')
    expect(r.csl).toMatchObject({
      type: 'book',
      title: '国史旧闻:第1卷',
      author: [{ family: '陈', given: '登原' }],
      'publisher-place': '北京',
      publisher: '中华书局',
      issued: { 'date-parts': [[2000]] },
      page: '29',
    })
    expect(r.warnings).toEqual([])
  })

  it('译著和西文专著的版本', () => {
    const tr = parseGbt7714('[2] 哈里森,沃尔德伦.经济数学与金融数学[M].谢远涛,译.北京:中国人民大学出版社,2012:235-236.')
    expect(tr.csl.translator).toEqual([{ family: '谢', given: '远涛' }])
    expect(tr.csl.author).toEqual([{ literal: '哈里森' }, { literal: '沃尔德伦' }])
    const en = parseGbt7714('[3] PEEBLES P Z, Jr. Probability, random variable, and random signal principles[M]. 4th ed. New York: McGraw Hill, 2001.')
    expect(en.csl).toMatchObject({ author: [{ family: 'PEEBLES', given: 'P Z Jr' }], edition: '4th', 'publisher-place': 'New York', publisher: 'McGraw Hill' })
    expect(en.csl.title).toBe('Probability, random variable, and random signal principles')
  })

  it('期刊和联机期刊', () => {
    const j = parseGbt7714('[4] 袁训来,陈哲,肖书海,等.蓝田生物群:一个认识多细胞生物起源和早期演化的新窗口[J].科学通报,2012,55(34):3219.')
    expect(j.etAl).toBe(true)
    expect(j.csl).toMatchObject({ 'container-title': '科学通报', volume: '55', issue: '34', page: '3219' })
    const ol = parseGbt7714('[5] 李炳穆.韩国图书馆法[J/OL].图书情报工作,2008,52(6):6-12[2013-10-25].http://www.docin.com/p-400265742.html.')
    expect(ol.carrier).toBe('OL')
    expect(ol.csl).toMatchObject({ page: '6-12', URL: 'http://www.docin.com/p-400265742.html', accessed: { 'date-parts': [[2013, 10, 25]] } })
    const noVol = parseGbt7714('[12] 杨宗英.电子图书馆的现实模型[J].中国图书馆学报,1996(2):24-29.')
    expect(noVol.csl).toMatchObject({ issue: '2', page: '24-29' })
    expect(noVol.csl.volume).toBeUndefined()
  })

  it('专利、学位论文、标准、报纸、网页、析出文献', () => {
    expect(parseGbt7714('[7] 邓一刚.全智能节电器:200610171314.3[P].2006-12-13.').csl).toMatchObject({
      type: 'patent', title: '全智能节电器', number: '200610171314.3', issued: { 'date-parts': [[2006, 12, 13]] },
    })
    expect(parseGbt7714('[8] 吴云芳.面向中文信息处理的现代汉语并列结构研究[D/OL].北京:北京大学,2003[2013-10-14].http://thesis.lib.pku.edu.cn/dlib/List.asp?lang=gb&DocID=6328.').csl).toMatchObject({
      type: 'thesis', publisher: '北京大学', 'publisher-place': '北京', genre: '学位论文',
    })
    expect(parseGbt7714('[9] 全国信息与文献标准化技术委员会.文献著录:第4部分 非书资料:GB/T 3792.4—2009[S].北京:中国标准出版社,2010:3.').csl).toMatchObject({
      type: 'standard', number: 'GB/T 3792.4—2009', title: '文献著录:第4部分 非书资料', author: [{ literal: '全国信息与文献标准化技术委员会' }],
    })
    expect(parseGbt7714('[10] 丁文祥.数字革命与竞争国际化[N].中国青年报,2000-11-20(15).').csl).toMatchObject({
      type: 'article-newspaper', 'container-title': '中国青年报', issued: { 'date-parts': [[2000, 11, 20]] }, page: '15',
    })
    expect(parseGbt7714('[11] 萧钰.出版业信息化迈入快车道[EB/OL].(2001-12-19)[2002-04-15].http://www.creader.com/news/20011219/200112190019.html.').csl).toMatchObject({
      type: 'webpage', issued: { 'date-parts': [[2001, 12, 19]] }, accessed: { 'date-parts': [[2002, 4, 15]] },
    })
    expect(parseGbt7714('[13] 汪学军.中国农业转基因生物研发进展与安全管理[C]//国家环境保护总局生物安全管理办公室.中国国家生物安全框架实施国际合作项目研讨会论文集.北京:中国环境科学出版社,2002:22-25.').csl).toMatchObject({
      type: 'paper-conference',
      editor: [{ literal: '国家环境保护总局生物安全管理办公室' }],
      'container-title': '中国国家生物安全框架实施国际合作项目研讨会论文集',
      publisher: '中国环境科学出版社',
      page: '22-25',
    })
  })
})

describe('GB/T 7714 条目解析：2025 版附录示例', () => {
  it('标准编号在前、无出版项', () => {
    const r = parseGbt7714('[9] GB/T 3792—2021 信息与文献 资源描述[S].')
    expect(r.csl).toMatchObject({ type: 'standard', number: 'GB/T 3792—2021', title: '信息与文献 资源描述' })
    expect(r.csl.author).toBeUndefined()
  })

  it('期刊析出文献的译者、清华学报这类带括号的刊名', () => {
    expect(parseGbt7714('[5] 久保智康.花枝蝶鸟方镜的镜范:以平安后期的铜镜制作工艺为中心[J].顾幼静,译.东方博物,2009(1):85-92.').csl).toMatchObject({
      translator: [{ family: '顾', given: '幼静' }], 'container-title': '东方博物', issue: '1', page: '85-92',
    })
    expect(parseGbt7714('[4] 于潇,刘义,柴跃廷,等.互联网药品可信交易环境中主体资质审核备案模式[J].清华大学学报(自然科学版),2012,52(11):1518-1523.').csl['container-title']).toBe('清华大学学报(自然科学版)')
  })

  it('西文联机期刊：网址后紧跟 DOI', () => {
    const r = parseGbt7714('[6] Myburg A A, Grattapaglia D, Tuskan G A, et al. The genome of Eucalyptus grandis[J/OL]. Nature, 2014, 510: 356-362. https://www.nature.com/articles/nature13308.pdf. DOI: 10.1038/nature13308.')
    expect(r.etAl).toBe(true)
    expect(r.csl).toMatchObject({ 'container-title': 'Nature', volume: '510', page: '356-362', DOI: '10.1038/nature13308', URL: 'https://www.nature.com/articles/nature13308.pdf' })
  })

  it('网页、数据集、预印本、不带出版项的会议论文、在线优先出版', () => {
    expect(parseGbt7714('[11] 高等教育文献保障系统.馆际互借与文献传递服务[EB/OL].[2025-06-21].http://home.calis.edu.cn/pages/list.html.').csl).toMatchObject({
      author: [{ literal: '高等教育文献保障系统' }], accessed: { 'date-parts': [[2025, 6, 21]] },
    })
    expect(parseGbt7714('[12] 周壮,李盛阳,吴薇,等.天宫二号遥感图像自然景物分类科学数据[DS/OL].V1.0.国家基础学科公共科学数据中心(2023-09-10)[2025-07-15].https://www.nbsdc.cn/general/dataLinks.').csl).toMatchObject({
      type: 'dataset', version: 'V1.0', publisher: '国家基础学科公共科学数据中心', issued: { 'date-parts': [[2023, 9, 10]] },
    })
    expect(parseGbt7714('[13] 方向明,曹迎杰.元宇宙在图书馆的应用:理论研究与实践进展[PP/OL].ChinaXiv(2023-03-03)[2024-09-30].http://www.chinaxiv.org/abs/202303.00020.').csl).toMatchObject({
      type: 'article', publisher: 'ChinaXiv', URL: 'http://www.chinaxiv.org/abs/202303.00020',
    })
    expect(parseGbt7714('[14] 李妍,王莹.医疗机构保洁人员“一前五后”手卫生干预效果研究[C]//中华预防医学会医院感染控制分会第31次全国医院感染学术年会,2022:2.').csl).toMatchObject({
      'event-title': '中华预防医学会医院感染控制分会第31次全国医院感染学术年会', issued: { 'date-parts': [[2022]] }, page: '2',
    })
    expect(parseGbt7714('[15] 张群,程志宝,石志飞.惯性增强动力吸振器-浮置板轨道低频减振性能研究[J/OL].铁道学报,2024-05-09.http://kns.cnki.net/kcms/detail/11.2104.u.20240507.1737.002.html.').csl).toMatchObject({
      'container-title': '铁道学报', issued: { 'date-parts': [[2024, 5, 9]] },
    })
  })
})

describe('GB/T 7714 条目解析：学生常见写法', () => {
  it('知网"引文格式"复制：无空格、期号前导零、句点后接 DOI', () => {
    const r = parseGbt7714('[1]王宁,刘洋.数字人文视域下的古籍整理研究[J].中国图书馆学报,2020,46(03):4-18.DOI:10.13530/j.cnki.jlis.2020.03.001.')
    expect(r.csl).toMatchObject({ volume: '46', issue: '3', page: '4-18', DOI: '10.13530/j.cnki.jlis.2020.03.001' })
  })

  it('全角标点', () => {
    const r = parseGbt7714('［1］ 杨洪升．四库馆私家抄校书考略［J］．文献，2013（1）：56-75．')
    expect(r.csl).toMatchObject({ title: '四库馆私家抄校书考略', 'container-title': '文献', issue: '1', page: '56-75' })
  })

  it('复姓作者', () => {
    expect(parseGbt7714('[3] 欧阳修,宋祁.新唐书[M].北京:中华书局,1975.').csl.author).toEqual([
      { family: '欧阳', given: '修' },
      { family: '宋', given: '祁' },
    ])
  })

  it('缺类型标识或缺出版项时给出提示而不是报错', () => {
    expect(parseGbt7714('王五.某某问题研究.北京大学,2020.').warnings[0]).toMatch(/没有文献类型标识/)
    expect(parseGbt7714('[2] 王五.某某问题研究[D].2020.').warnings).toContain('出版项只有年份')
    expect(parseGbt7714('[2] 王五.某某问题研究[J].中国社会科学,2020(3).').warnings).toContain('期刊文献缺页码')
  })
})

describe('知网导出题录', () => {
  it('识别格式', () => {
    expect(detectExportFormat(fixture('endnote.txt'))).toBe('endnote')
    expect(detectExportFormat(fixture('noteexpress.txt'))).toBe('noteexpress')
    expect(detectExportFormat(fixture('refworks.txt'))).toBe('refworks')
    expect(detectExportFormat('[1] 张三.题名[J].刊名,2020(1):1-2.')).toBeNull()
  })

  it('EndNote：期刊和学位论文', () => {
    const [j, d] = parseCnkiExport(fixture('endnote.txt'))
    expect(j.typeCode).toBe('J')
    expect(j.csl).toMatchObject({
      type: 'article-journal',
      title: '数字人文视域下的古籍整理研究',
      author: [{ family: '王', given: '宁' }, { family: '刘', given: '洋' }],
      'container-title': '中国图书馆学报',
      issued: { 'date-parts': [[2020]] },
      volume: '46',
      issue: '3',
      page: '4-18',
      ISSN: '1001-8867',
      DOI: '10.13530/j.cnki.jlis.2020.03.001',
    })
    expect(d.csl).toMatchObject({ type: 'thesis', publisher: '武汉大学', genre: '硕士学位论文', author: [{ family: '欧阳', given: '明' }] })
    expect(d.warnings).toEqual([])
  })

  it('NoteExpress：作者写在一行，会议论文', () => {
    const [j, c] = parseCnkiExport(fixture('noteexpress.txt'))
    expect(j.csl.author).toEqual([{ family: '张', given: '三' }, { family: '李', given: '四' }])
    expect(j.csl).toMatchObject({ 'container-title': '中国高教研究', issue: '3', page: '12-19', ISSN: '1004-3667' })
    expect(c.csl).toMatchObject({ type: 'paper-conference', 'container-title': '中华预防医学会医院感染控制分会第31次全国医院感染学术年会论文集', page: '2' })
  })

  it('RefWorks：OP 里的页码、报纸的完整日期', () => {
    const [j, n] = parseCnkiExport(fixture('refworks.txt'))
    expect(j.csl).toMatchObject({ volume: '55', issue: '34', page: '3219-3233', ISSN: '0023-074X' })
    expect(j.csl.author).toHaveLength(3)
    expect(n.csl).toMatchObject({ type: 'article-newspaper', issued: { 'date-parts': [[2000, 11, 20]] }, page: '15' })
  })
})

describe('入口', () => {
  it('自动区分题录和著录文本', async () => {
    const { parseReferencesStructured } = await import('../src/references/structured')
    expect(parseReferencesStructured(ENDNOTE)[0].source).toBe('endnote')
    const list = parseReferencesStructured('[1] 陈登原.国史旧闻:第1卷[M].北京:中华书局,2000:29.\n[2] 杨宗英.电子图书馆的现实模型[J].中国图书馆学报,1996(2):24-29.')
    expect(list.map((r) => r.csl.type)).toEqual(['book', 'article-journal'])
  })
})
