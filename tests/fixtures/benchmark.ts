/**
 * M1 验收用的 50 条混合参考文献。
 * 覆盖：真实文献（带/不带 DOI）、虚构 DOI、DOI 与标题错配、
 * 凭空捏造的英文文献、年份写错、中文文献。
 *
 * 真实文献的元数据取自出版方记录；虚构条目均为人为编造，仅用于测试。
 */
import type { VerifyStatus } from '../../src/references/verify'
import type { MockWork } from './mock-sources'

export const REAL_WORKS: MockWork[] = [
  { doi: '10.1038/nature14539', title: 'Deep learning', year: 2015, family: 'LeCun' },
  { doi: '10.48550/arxiv.1706.03762', title: 'Attention Is All You Need', year: 2017, family: 'Vaswani' },
  { doi: '10.1038/s41586-021-03819-2', title: 'Highly accurate protein structure prediction with AlphaFold', year: 2021, family: 'Jumper' },
  { doi: '10.1109/cvpr.2016.90', title: 'Deep Residual Learning for Image Recognition', year: 2016, family: 'He' },
  { doi: '10.1162/neco.1997.9.8.1735', title: 'Long Short-Term Memory', year: 1997, family: 'Hochreiter' },
  { doi: '10.1038/nature16961', title: 'Mastering the game of Go with deep neural networks and tree search', year: 2016, family: 'Silver' },
  { doi: '10.1145/3065386', title: 'ImageNet classification with deep convolutional neural networks', year: 2017, family: 'Krizhevsky' },
  { doi: '10.18653/v1/n19-1423', title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding', year: 2019, family: 'Devlin' },
  { doi: '10.1126/science.1127647', title: 'Reducing the Dimensionality of Data with Neural Networks', year: 2006, family: 'Hinton' },
  { doi: '10.1007/bf00994018', title: 'Support-vector networks', year: 1995, family: 'Cortes' },
  { doi: '10.1023/a:1010933404324', title: 'Random Forests', year: 2001, family: 'Breiman' },
  { doi: '10.1191/1478088706qp063oa', title: 'Using thematic analysis in psychology', year: 2006, family: 'Braun' },
  { doi: '10.2307/249008', title: 'Perceived Usefulness, Perceived Ease of Use, and User Acceptance of Information Technology', year: 1989, family: 'Davis' },
  { doi: '10.1016/0749-5978(91)90020-t', title: 'The theory of planned behavior', year: 1991, family: 'Ajzen' },
  { doi: '10.2307/2393553', title: 'Absorptive Capacity: A New Perspective on Learning and Innovation', year: 1990, family: 'Cohen' },
]

export interface BenchCase {
  text: string
  expected: VerifyStatus
  kind: string
}

const cite = (w: MockWork, opts: { doi?: string | null; year?: number; title?: string } = {}) => {
  const doi = opts.doi === undefined ? w.doi : opts.doi
  return `${w.family.toUpperCase()} A. ${opts.title ?? w.title}[J]. Journal, ${opts.year ?? w.year}, 1(1): 1-10.${doi ? ` DOI:${doi}.` : ''}`
}

const FAKE_TITLES = [
  'Neural correlates of thesis anxiety in undergraduate cohorts',
  'A longitudinal survey of citation hallucination in student essays',
  'Blockchain-enabled peer review for regional agricultural journals',
  'Quantum hermeneutics of medieval tax ledgers',
  'Generative agents for automated dissertation committee simulation',
]

const CHINESE = [
  '张三, 李四. 生成式人工智能对高等教育的影响研究[J]. 中国高教研究, 2024(3): 12-19.',
  '王五. 乡村振兴背景下农村电商发展路径研究[D]. 武汉: 华中农业大学, 2023.',
  '赵六. 数字经济与制造业转型升级[M]. 北京: 经济科学出版社, 2022.',
  '陈七, 刘八. 大学生学术诚信认知的调查分析[J]. 学位与研究生教育, 2025(5): 40-47.',
  '孙九. 短视频平台用户持续使用意愿影响因素研究[J]. 情报科学, 2021, 39(6): 88-95.',
  '周十. 基于深度学习的图像分割方法综述[J]. 计算机学报, 2020, 43(2): 1-20.',
  '吴一. 碳达峰背景下区域能源结构优化研究[D]. 上海: 复旦大学, 2024.',
  '郑二. 新媒体环境下的品牌传播策略[J]. 新闻与传播研究, 2023(8): 66-80.',
  '钱三. 中小企业融资约束与创新绩效[J]. 管理世界, 2022, 38(4): 100-115. DOI:10.19744/j.cnki.11-1235/f.2022.0050.',
  '冯四. 高校思政课教学改革的实践探索[J]. 思想理论教育导刊, 2024(1): 120-126.',
]

export function buildBenchmark(): BenchCase[] {
  const cases: BenchCase[] = []
  // 15 条真实文献，带 DOI
  for (const w of REAL_WORKS) cases.push({ text: cite(w), expected: 'verified', kind: '真实·带DOI' })
  // 5 条真实文献，不带 DOI，靠检索核实
  for (const w of REAL_WORKS.slice(0, 5)) cases.push({ text: cite(w, { doi: null }), expected: 'verified', kind: '真实·无DOI' })
  // 5 条虚构 DOI，标题也是编的。（真标题配错 DOI 不算假文献，判"信息不符"并给出正确 DOI，见 adversarial.test.ts）
  for (let i = 0; i < 5; i++) {
    const title = `${FAKE_TITLES[i]}: a replication study`
    cases.push({ text: `ROE K. ${title}[J]. Imaginary Review, 2020, 3(1): 1-9. DOI:10.9999/fake.${2020 + i}.${i}.`, expected: 'not_found', kind: '虚构DOI' })
  }
  // 5 条 DOI 真实，但标题是另一篇（AI 张冠李戴）
  for (let i = 0; i < 5; i++) {
    const title = FAKE_TITLES[i]
    cases.push({ text: cite(REAL_WORKS[i + 5], { title }), expected: 'mismatch', kind: 'DOI与标题错配' })
  }
  // 5 条凭空捏造、无 DOI
  for (const title of FAKE_TITLES) {
    cases.push({ text: `DOE J. ${title}[J]. Imaginary Review, 2022, 4(2): 1-9.`, expected: 'not_found', kind: '捏造·无DOI' })
  }
  // 5 条年份写错（差 5 年以上）
  for (const w of REAL_WORKS.slice(5, 10)) {
    cases.push({ text: cite(w, { year: w.year - 6 }), expected: 'mismatch', kind: '年份错误' })
  }
  // 10 条中文文献：开放接口无法核验，必须交给人工
  for (const text of CHINESE) cases.push({ text, expected: 'manual', kind: '中文' })
  return cases
}
