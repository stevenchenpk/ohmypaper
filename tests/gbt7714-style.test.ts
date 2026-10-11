import { describe, expect, it } from 'vitest'
import { analyzeEntry, checkEntry, checkReferenceList, RULES, type Edition } from '../src/references/style/gbt7714'

describe('每条规则的示例', () => {
  for (const rule of RULES) {
    for (const ex of rule.examples) {
      for (const entry of ex.pass) {
        it(`${rule.id}（${ex.edition}）通过：${entry.slice(0, 40)}`, () => {
          expect(checkEntry(entry, 1, { edition: ex.edition, only: [rule.id] })).toEqual([])
        })
      }
      for (const entry of ex.fail) {
        it(`${rule.id}（${ex.edition}）报出：${entry.slice(0, 40)}`, () => {
          const issues = checkEntry(entry, 1, { edition: ex.edition, only: [rule.id] })
          expect(issues.map((i) => i.ruleId)).toEqual([rule.id])
        })
      }
    }
  }

  it('每条规则至少有一个通过示例和一个报出示例', () => {
    for (const rule of RULES) {
      expect(rule.examples.some((e) => e.pass.length > 0), rule.id).toBe(true)
      expect(rule.examples.some((e) => e.fail.length > 0), rule.id).toBe(true)
      for (const ex of rule.examples) expect(rule.severity[ex.edition], `${rule.id} 在 ${ex.edition} 版不生效却有示例`).toBeDefined()
    }
  })
})

// 标准原文附录里的示例（按原文抄录，全角标点保持原样）。按本版本检查不应报 error 或 warning。
const STANDARD_EXAMPLES: Record<Edition, string[]> = {
  '2015': [
    '[1] 陈登原.国史旧闻:第1卷[M].北京:中华书局,2000:29.',
    '[2] 哈里森,沃尔德伦.经济数学与金融数学[M].谢远涛,译.北京:中国人民大学出版社,2012:235-236.',
    '[3] PEEBLES P Z, Jr. Probability, random variable, and random signal principles[M]. 4th ed. New York: McGraw Hill, 2001.',
    '[4] 袁训来,陈哲,肖书海,等.蓝田生物群:一个认识多细胞生物起源和早期演化的新窗口[J].科学通报,2012,55(34):3219.',
    '[5] 李炳穆.韩国图书馆法[J/OL].图书情报工作,2008,52(6):6-12[2013-10-25].http://www.docin.com/p-400265742.html.',
    '[6] KANAMORI H. Shaking without quaking[J]. Science, 1998, 279(5359): 2063.',
    '[7] 邓一刚.全智能节电器:200610171314.3[P].2006-12-13.',
    '[8] 吴云芳.面向中文信息处理的现代汉语并列结构研究[D/OL].北京:北京大学,2003[2013-10-14].http://thesis.lib.pku.edu.cn/dlib/List.asp?lang=gb&DocID=6328.',
    '[9] 全国信息与文献标准化技术委员会.文献著录:第4部分 非书资料:GB/T 3792.4—2009[S].北京:中国标准出版社,2010:3.',
    '[10] 丁文祥.数字革命与竞争国际化[N].中国青年报,2000-11-20(15).',
    '[11] 萧钰.出版业信息化迈入快车道[EB/OL].(2001-12-19)[2002-04-15].http://www.creader.com/news/20011219/200112190019.html.',
    '[12] 杨宗英.电子图书馆的现实模型[J].中国图书馆学报,1996(2):24-29.',
    '[13] 汪学军.中国农业转基因生物研发进展与安全管理[C]//国家环境保护总局生物安全管理办公室.中国国家生物安全框架实施国际合作项目研讨会论文集.北京:中国环境科学出版社,2002:22-25.',
  ],
  '2025': [
    '[1] 张伯伟.全唐五代诗格汇考[M].南京:江苏古籍出版社,2002:288.',
    '[2] 扬奎斯特,萨金特.递归宏观经济理论[M].杨斌,王忠玉,陈彦斌,译.2版.北京:中国人民大学出版社,2010:798.',
    '[3] Peebles P Z Jr. Probability, random variables, and random signal principles[M]. 4th ed. New York: McGraw-Hill, 2001.',
    '[4] 于潇,刘义,柴跃廷,等.互联网药品可信交易环境中主体资质审核备案模式[J].清华大学学报(自然科学版),2012,52(11):1518-1523.',
    '[5] 久保智康.花枝蝶鸟方镜的镜范:以平安后期的铜镜制作工艺为中心[J].顾幼静,译.东方博物,2009(1):85-92.',
    '[6] Myburg A A, Grattapaglia D, Tuskan G A, et al. The genome of Eucalyptus grandis[J/OL]. Nature, 2014, 510: 356-362. https://www.nature.com/articles/nature13308.pdf. DOI: 10.1038/nature13308.',
    '[7] 王琦.融合星载GNSS-R与SAR数据的高时空分辨率土壤湿度反演方法研究[D].武汉:武汉大学,2022:87.',
    '[8] Cairns B R. Infrared spectroscopic studies of solid oxygen[D]. Berkeley: University of California Berkeley, 1965: 15.',
    '[9] GB/T 3792—2021 信息与文献 资源描述[S].',
    '[10] 丁文祥.数字革命与竞争国际化[N].中国青年报,2000-11-20(15).',
    '[11] 高等教育文献保障系统.馆际互借与文献传递服务[EB/OL].[2025-06-21].http://home.calis.edu.cn/pages/list.html.',
    '[12] 周壮,李盛阳,吴薇,等.天宫二号遥感图像自然景物分类科学数据[DS/OL].V1.0.国家基础学科公共科学数据中心(2023-09-10)[2025-07-15].https://www.nbsdc.cn/general/dataLinks.',
    '[13] 方向明,曹迎杰.元宇宙在图书馆的应用:理论研究与实践进展[PP/OL].ChinaXiv(2023-03-03)[2024-09-30].http://www.chinaxiv.org/abs/202303.00020.',
    '[14] 李妍,王莹.医疗机构保洁人员“一前五后”手卫生干预效果研究[C]//中华预防医学会医院感染控制分会第31次全国医院感染学术年会,2022:2.',
    '[15] 张群,程志宝,石志飞.惯性增强动力吸振器-浮置板轨道低频减振性能研究[J/OL].铁道学报,2024-05-09.http://kns.cnki.net/kcms/detail/11.2104.u.20240507.1737.002.html.',
  ],
}

describe('标准原文示例不被误报', () => {
  for (const edition of ['2015', '2025'] as Edition[]) {
    it(`GB/T 7714—${edition} 附录示例`, () => {
      const issues = checkReferenceList(STANDARD_EXAMPLES[edition], { edition }).filter((i) => i.severity !== 'info')
      expect(issues).toEqual([])
    })
  }

  it('2015 版示例按 2025 版检查，会报出姓氏大写和标准编号位置', () => {
    const ids = new Set(checkReferenceList(STANDARD_EXAMPLES['2015'], { edition: '2025' }).map((i) => i.ruleId))
    expect(ids).toContain('surname-case')
    expect(ids).toContain('standard-order')
  })
})

describe('预处理', () => {
  it('全角标点归一后再判断', () => {
    const v = analyzeEntry('［1］ 杨洪升．四库馆私家抄校书考略［J］．文献，2013（1）：56-75．')
    expect(v.index).toBe(1)
    expect(v.type).toBe('J')
    expect(v.authorSegment).toBe('杨洪升')
    expect(v.isChinese).toBe(true)
  })

  it('[S.l.]、[s.n.] 和引用日期不会被当成类型标识', () => {
    const v = analyzeEntry('[1] Praetzellis A. Death by theory[M/OL]. Rev. ed. [S.l.]: Rowman & Littlefield, 2011: 13. http://lib.myilibrary.com/Open.aspx?id=293666.')
    expect(v.type).toBe('M')
    expect(v.carrier).toBe('OL')
  })

  it('序号不连续时报错', () => {
    const issues = checkReferenceList(['[1] 汪冰.电子图书馆理论与实践研究[M].北京:北京图书馆出版社,1997:16.', '[3] 杨宗英.电子图书馆的现实模型[J].中国图书馆学报,1996(2):24-29.'], { edition: '2025' })
    expect(issues.map((i) => i.ruleId)).toEqual(['sequence-numbering'])
  })
})
