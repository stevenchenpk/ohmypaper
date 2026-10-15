import { describe, expect, it } from 'vitest'
import { parseReference } from '../src/references/parse'

const p = (t: string) => parseReference(t, 1)

/** 第二轮红队 R1（review/round2/README.md §1）：出版年取错、全角标点、著者-出版年制 */
describe('出版年取出版项里的年份，不取第一个像年份的数', () => {
  it.each([
    ['标题里带年份', 'Wang L. COVID-19 and the 2008 crisis compared[J]. China Economic Review, 2021, 65: 1-10.', 2021],
    ['标题里有年份区间', '郑十. 1949—1978年中国工业化研究[M]. 上海: 上海人民出版社, 2015.', 2015],
    ['arXiv 编号', 'Brown T, Mann B, Ryder N, et al. Language models are few-shot learners[EB/OL]. arXiv:2005.14165, 2020.', 2020],
    ['题名以年份开头', '张三. 2020年中国经济展望[J]. 经济研究, 2021, 56(1): 1-10.', 2021],
    ['会议名里带年份', 'Li X. A method[C]//Proceedings of the 2019 IEEE Conference on Vision. New York: IEEE, 2020: 1-5.', 2020],
    ['网页：发布日期和引用日期', '教育部. 关于某事项的通知[EB/OL]. (2019-06-01)[2024-01-01]. http://www.moe.gov.cn/2018/a.html.', 2019],
    ['页码像年份', 'Smith J. A study[J]. Journal, 2015, 21: 1998-2005.', 2015],
    ['没有类型标识、标题带年份', 'Wang L. The 2008 crisis revisited. Economic Review, 2021, 65: 1-10.', 2021],
  ])('%s', (_, text, year) => expect(p(text).year).toBe(year))
})

describe('全角标点', () => {
  it('［J］．能认出类型标识，题名不带［J］', () => {
    const r = p('孙七，周八．人工智能伦理研究［J］．哲学研究，2020（3）：100-110．')
    expect(r.docType).toBe('J')
    expect(r.style).toBe('gbt7714')
    expect(r.title).toBe('人工智能伦理研究')
    expect(r.authors).toEqual(['孙七', '周八'])
    expect(r.year).toBe(2020)
  })
})

describe('著者-出版年制：年份不混进作者和题名', () => {
  it('中文："张三, 2020. 题名[J]"', () => {
    const r = p('张三, 2020. 基于深度学习的论文格式检查[J]. 计算机学报, 43(5): 12-20.')
    expect(r.authors).toEqual(['张三'])
    expect(r.title).toBe('基于深度学习的论文格式检查')
    expect(r.year).toBe(2020)
  })

  it('中文："张三. 2020a. 题名[J]"', () => {
    const r = p('张三, 李四. 2020a. 甲研究[J]. 某学报(1): 1-2.')
    expect(r.authors).toEqual(['张三', '李四'])
    expect(r.title).toBe('甲研究')
    expect(r.year).toBe(2020)
  })

  it('英文："et al., 2017. Title[C]"', () => {
    const r = p('Vaswani A, Shazeer N, Parmar N, et al., 2017. Attention is all you need[C]//Advances in Neural Information Processing Systems. Long Beach: Curran Associates: 5998-6008.')
    expect(r.authors).toEqual(['Vaswani A', 'Shazeer N', 'Parmar N'])
    expect(r.title).toBe('Attention is all you need')
    expect(r.year).toBe(2017)
  })

  it('英文："LECUN Y, BENGIO Y. 2015. Title[J]"', () => {
    const r = p('LECUN Y, BENGIO Y, HINTON G. 2015. Deep learning[J]. Nature, 521: 436-444.')
    expect(r.authors).toEqual(['LECUN Y', 'BENGIO Y', 'HINTON G'])
    expect(r.title).toBe('Deep learning')
    expect(r.year).toBe(2015)
  })
})
