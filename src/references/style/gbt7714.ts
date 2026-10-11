/**
 * GB/T 7714 参考文献著录格式检查规则（2015 版与 2025 版）。
 *
 * 每条规则写明它在两个版本中的条款号、是否生效和严重程度，
 * 并附通过和不通过的示例；tests/gbt7714-style.test.ts 会逐条跑这些示例。
 * 只检查能从纯文本可靠判断的项；判断不了的列在 MANUAL_CHECKS 里，交给人工核对。
 *
 * 依据：GB/T 7714—2015 正文与附录 A、B；GB/T 7714—2025 正文与附录 A、B。
 * 差异说明见 standards/gbt7714/2015-vs-2025.md。
 */

export type Edition = '2015' | '2025'
export type Severity = 'error' | 'warning' | 'info'
export type FalsePositiveRisk = 'low' | 'medium' | 'high'

/** 一条参考文献经过预处理后的视图 */
export interface EntryView {
  /** 条目序号，取自 [n]；没有序号时为 null */
  index: number | null
  /** 去掉序号后的原文 */
  raw: string
  /** 全角标点换成半角后的文本，规则都基于它判断 */
  text: string
  /** 文献类型标识，如 J、M、EB；没有则为 null */
  type: string | null
  /** 文献载体标识，如 OL；没有则为 null */
  carrier: string | null
  /** 类型标识之前的部分（责任者与题名） */
  head: string
  /** 作者段：第一个句点之前的部分；判断不出时为 null */
  authorSegment: string | null
  isChinese: boolean
  urls: string[]
}

export interface StyleRule {
  id: string
  title: string
  /** 2025 版相对 2015 版：new 新增 / modified 修改 / unchanged 未变 */
  change: 'new' | 'modified' | 'unchanged'
  clause: Record<Edition, string | null>
  /** 适用的文献类型标识；'all' 表示全部 */
  appliesTo: string[] | 'all'
  /** 各版本下的严重程度；某版本缺省表示该版本不检查这条 */
  severity: Partial<Record<Edition, Severity>>
  falsePositiveRisk: FalsePositiveRisk
  /** 误报从哪里来，给维护者和报告页看 */
  falsePositiveNote?: string
  /** 命中时返回提示文字，未命中返回 null */
  check: (entry: EntryView, edition: Edition) => string | null
  examples: { edition: Edition; pass: string[]; fail: string[] }[]
}

export interface StyleIssue {
  ruleId: string
  /** 条目在列表中的位置，从 1 开始 */
  position: number
  severity: Severity
  message: string
}

// ---------------------------------------------------------------- 预处理

const FULLWIDTH: Record<string, string> = {
  '．': '.', '，': ',', '：': ':', '；': ';', '（': '(', '）': ')', '［': '[', '］': ']', '／': '/', '　': ' ',
}

export function normalizePunctuation(s: string): string {
  return s.replace(/[．，：；（）［］／　]/g, (c) => FULLWIDTH[c])
}

const INDEX_RE = /^\s*[[［](\d+)[\]］]\s*/
const TYPE_TAG_RE = /\[([A-Z]{1,2})(?:\/([A-Z]{2}))?\]/
const URL_RE = /https?:\/\/[^\s]+/g
const CJK_RE = /[㐀-鿿]/g

export function analyzeEntry(entry: string): EntryView {
  const idx = entry.match(INDEX_RE)
  const raw = entry.replace(INDEX_RE, '').trim()
  const text = normalizePunctuation(raw)
  const tag = text.match(TYPE_TAG_RE)
  const head = tag ? text.slice(0, tag.index) : text
  const dot = head.search(/\.(?=\s|[^\s\d])/)
  const authorSegment = dot > 0 ? head.slice(0, dot).trim() : null
  const sample = head.replace(/\s+/g, '')
  const cjk = sample.match(CJK_RE)?.length ?? 0
  return {
    index: idx ? Number(idx[1]) : null,
    raw,
    text,
    type: tag?.[1] ?? null,
    carrier: tag?.[2] ?? null,
    head,
    authorSegment,
    isChinese: sample.length > 0 && cjk / sample.length > 0.3,
    // 网址后面紧跟“.DOI:”时（中间不空格），把 DOI 从网址里切出去
    urls: (text.match(URL_RE) ?? []).map((u) => u.split(/\.?DOI:/i)[0]),
  }
}

// ---------------------------------------------------------------- 作者

/** 西文个人责任者：姓 + 名的首字母，如 Einstein A、DE MORGAN A、Peebles P Z Jr */
const WESTERN_AUTHOR_RE = /^([A-Za-z][A-Za-z'’-]*(?: [A-Za-z][A-Za-z'’-]*)*?) ((?:[A-Z]-?)(?: [A-Z]-?[A-Z]?)*)(?:,? Jr)?$/
/** 中文个人责任者：2–6 个汉字，可带间隔号 */
const CHINESE_AUTHOR_RE = /^[㐀-鿿·•]{2,6}$/

function splitAuthors(segment: string): string[] {
  return segment.split(/\s*[,、]\s*/).map((a) => a.trim()).filter(Boolean)
}

/** 作者段里的西文个人责任者；只要有一项不像人名就返回 null，避免误判机构名和题名 */
function westernAuthors(e: EntryView): { surname: string }[] | null {
  if (e.isChinese || !e.authorSegment) return null
  const people: { surname: string }[] = []
  for (const token of splitAuthors(e.authorSegment)) {
    if (/^et al$/i.test(token)) continue
    const m = token.match(WESTERN_AUTHOR_RE)
    if (!m) return null
    people.push({ surname: m[1] })
  }
  return people.length > 0 ? people : null
}

function authorCount(e: EntryView): number | null {
  if (!e.authorSegment) return null
  const tokens = splitAuthors(e.authorSegment).filter((t) => !/^(et al|等)$/i.test(t))
  if (/(et al|等)$/i.test(e.authorSegment)) return null
  if (e.isChinese) return tokens.every((t) => CHINESE_AUTHOR_RE.test(t)) ? tokens.length : null
  return westernAuthors(e)?.length ?? null
}

// ---------------------------------------------------------------- 类型标识

const TYPE_CODES: Record<Edition, string[]> = {
  '2015': ['M', 'C', 'G', 'N', 'J', 'D', 'R', 'S', 'P', 'DB', 'CP', 'EB', 'A', 'CM', 'DS', 'Z'],
  '2025': ['M', 'J', 'N', 'C', 'D', 'R', 'S', 'P', 'EB', 'A', 'CM', 'DS', 'PP', 'G', 'CP', 'DB', 'Z'],
}
const CARRIER_CODES: Record<Edition, string[]> = {
  '2015': ['MT', 'DK', 'CD', 'OL'],
  '2025': ['MT', 'DK', 'CD', 'OL', 'MM'],
}

const CITED_DATE_RE = /\[\d{4}-\d{2}-\d{2}\]/
const PREPRINT_HOST_RE = /arxiv\.org|10\.48550\/arxiv|chinaxiv|biorxiv|medrxiv|psyarxiv|ssrn\.com|preprints\.org|researchsquare|zsyyb\.cn|PSSXiv/i
const STANDARD_NO_RE = /(?:GB\/[TZ]|GB|GJB|[A-Z]{2}\/T|ISO(?:\/IEC)?|IEC(?:\/IEEE)?|IEEE|ASTM|ANSI|DIN|EN|BS|JIS)\s?[A-Z]?\s?\d+(?:\.\d+)*(?:-\d+)?\s?[—–\-:]\s?\d{4}/

function startsWithStandardNo(head: string): boolean {
  const m = head.match(STANDARD_NO_RE)
  return m !== null && m.index === 0
}

// ---------------------------------------------------------------- 规则

export const RULES: StyleRule[] = [
  {
    id: 'type-code-present',
    title: '著录文献类型标识',
    change: 'modified',
    clause: { '2015': '4.1.1（任选）', '2025': '7.3、8.2–8.15（必备）' },
    appliesTo: 'all',
    severity: { '2015': 'info', '2025': 'error' },
    falsePositiveRisk: 'low',
    check: (e, ed) =>
      e.type
        ? null
        : ed === '2025'
          ? '缺少文献类型标识，如 [J]、[M]。2025 版各类型都把它列为必备项。'
          : '没有文献类型标识。2015 版列为任选，但大多数学校要求写。',
    examples: [
      { edition: '2025', pass: ['[1] 杨洪升.四库馆私家抄校书考略[J].文献,2013(1):56-75.'], fail: ['[1] 杨洪升.四库馆私家抄校书考略.文献,2013(1):56-75.'] },
    ],
  },
  {
    id: 'type-code-known',
    title: '文献类型和载体标识代码在本版本的代码表内',
    change: 'modified',
    clause: { '2015': '附录 B', '2025': '附录 A（新增 PP 预印本、MM 缩微资料）' },
    appliesTo: 'all',
    severity: { '2015': 'error', '2025': 'error' },
    falsePositiveRisk: 'low',
    check: (e, ed) => {
      if (e.type && !TYPE_CODES[ed].includes(e.type)) {
        return e.type === 'PP'
          ? '[PP] 预印本是 2025 版新增的类型，2015 版没有这个代码，可写作 [EB/OL] 或按学校要求。'
          : `[${e.type}] 不在 GB/T 7714—${ed} 的文献类型代码表里。`
      }
      if (e.carrier && !CARRIER_CODES[ed].includes(e.carrier)) {
        return `载体标识 /${e.carrier} 不在 GB/T 7714—${ed} 的代码表里。`
      }
      return null
    },
    examples: [
      { edition: '2025', pass: ['[1] 方向明,曹迎杰.元宇宙在图书馆的应用:理论研究与实践进展[PP/OL].ChinaXiv(2023-03-03)[2024-09-30].http://www.chinaxiv.org/abs/202303.00020.'], fail: ['[1] 某某.某题名[XY].北京:某出版社,2020.'] },
      { edition: '2015', pass: ['[1] 汪冰.电子图书馆理论与实践研究[M].北京:北京图书馆出版社,1997:16.'], fail: ['[1] 方向明,曹迎杰.元宇宙在图书馆的应用[PP/OL].(2023-03-03)[2024-09-30].http://www.chinaxiv.org/abs/202303.00020.'] },
    ],
  },
  {
    id: 'online-needs-url',
    title: '电子资源著录获取和访问路径',
    change: 'unchanged',
    clause: { '2015': '4.1.1 等（电子资源必备）', '2025': '7.8、8.2–8.15（电子资源必备）' },
    appliesTo: 'all',
    severity: { '2015': 'error', '2025': 'error' },
    falsePositiveRisk: 'low',
    check: (e) => (e.carrier === 'OL' && e.urls.length === 0 ? '标了 /OL 却没有网址。联机资源必须写获取和访问路径。' : null),
    examples: [
      { edition: '2025', pass: ['[1] 高等教育文献保障系统.馆际互借与文献传递服务[EB/OL].[2025-06-21].http://home.calis.edu.cn/pages/list.html.'], fail: ['[1] 高等教育文献保障系统.馆际互借与文献传递服务[EB/OL].[2025-06-21].'] },
    ],
  },
  {
    id: 'url-needs-carrier',
    title: '写了网址的条目标注 /OL',
    change: 'unchanged',
    clause: { '2015': '8.2.2', '2025': '7.3' },
    appliesTo: 'all',
    severity: { '2015': 'warning', '2025': 'warning' },
    falsePositiveRisk: 'medium',
    falsePositiveNote: '引用的是纸本、只是顺手附了链接时，不加 /OL 也说得通。',
    check: (e) =>
      e.type && !e.carrier && e.urls.some((u) => !/doi\.org\//i.test(u))
        ? `写了网址，类型标识却是 [${e.type}]。引用的是网络版就写成 [${e.type}/OL]。`
        : null,
    examples: [
      { edition: '2025', pass: ['[1] 赵学功.当代美国外交[M/OL].北京:社会科学文献出版社,2001.http://www.cadal.zju.edu.cn/book/trySinglePage/33023884/1.'], fail: ['[1] 赵学功.当代美国外交[M].北京:社会科学文献出版社,2001.http://www.cadal.zju.edu.cn/book/trySinglePage/33023884/1.'] },
    ],
  },
  {
    id: 'cited-date-required',
    title: '需要引用日期的电子资源写了引用日期',
    change: 'modified',
    clause: { '2015': '4.1–4.6、8.4.4（电子资源一律写引用日期）', '2025': '7.6、8.11、8.14、8.15（网站网页、数据集、预印本必备）' },
    appliesTo: 'all',
    severity: { '2015': 'error', '2025': 'error' },
    falsePositiveRisk: 'low',
    check: (e, ed) => {
      if (e.carrier !== 'OL' || CITED_DATE_RE.test(e.text)) return null
      if (ed === '2015') return '联机资源缺少引用日期，格式如 [2026-10-11]。'
      return ['EB', 'DS', 'PP'].includes(e.type ?? '') ? `[${e.type}/OL] 缺少引用日期，格式如 [2026-10-11]。` : null
    },
    examples: [
      { edition: '2015', pass: ['[1] 李炳穆.韩国图书馆法[J/OL].图书情报工作,2008,52(6):6-12[2013-10-25].http://www.docin.com/p-400265742.html.'], fail: ['[1] 李炳穆.韩国图书馆法[J/OL].图书情报工作,2008,52(6):6-12.http://www.docin.com/p-400265742.html.'] },
      { edition: '2025', pass: ['[1] 李炳穆.韩国图书馆法[J/OL].图书情报工作,2008,52(6):6-12.http://www.docin.com/p-400265742.html.'], fail: ['[1] 许振超.“好好干,当一个好工人”[EB/OL].(2025-02-17).http://cpc.people.com.cn/n1/2025/0217/c443712-40419790.html.'] },
    ],
  },
  {
    id: 'cited-date-not-needed',
    title: '非网站类联机文献不再写引用日期',
    change: 'modified',
    clause: { '2015': null, '2025': '8.2–8.10、8.12、8.13（著录项目表不含引用日期）' },
    appliesTo: ['M', 'J', 'N', 'C', 'D', 'R', 'S', 'P', 'A', 'CM', 'G'],
    severity: { '2025': 'info' },
    falsePositiveRisk: 'low',
    check: (e) =>
      e.carrier === 'OL' && e.type && !['EB', 'DS', 'PP', 'CP', 'DB', 'Z'].includes(e.type) && CITED_DATE_RE.test(e.text)
        ? `2025 版的 [${e.type}/OL] 不再要求引用日期，方括号里的日期可以删掉；学校仍要求的话保留。`
        : null,
    examples: [
      { edition: '2025', pass: ['[1] 陈建军.从数字地球到智慧地球[J/OL].国土资源导刊,2010,7(10):93.https://d.wanfangdata.com.cn/periodical/hunandz201010038.'], fail: ['[1] 陈建军.从数字地球到智慧地球[J/OL].国土资源导刊,2010,7(10):93[2013-03-20].https://d.wanfangdata.com.cn/periodical/hunandz201010038.'] },
    ],
  },
  {
    id: 'surname-case',
    title: '西文和汉语拼音作者姓氏的大小写',
    change: 'modified',
    clause: { '2015': '6.3、8.1.1（姓全部大写，如 EINSTEIN A）', '2025': '7.1.1（姓首字母大写，如 Einstein A）' },
    appliesTo: 'all',
    severity: { '2015': 'error', '2025': 'error' },
    falsePositiveRisk: 'medium',
    falsePositiveNote: '作者段里混入机构缩写（如 WHO）或无作者条目的题名时可能误判；作者段有一项不像人名就整条跳过。',
    check: (e, ed) => {
      const people = westernAuthors(e)
      if (!people) return null
      const upper = (s: string) => /[A-Z]{2}/.test(s) && s === s.toUpperCase()
      if (ed === '2025') {
        const bad = people.filter((p) => upper(p.surname))
        return bad.length ? `2025 版作者姓氏只大写首字母：${bad[0].surname} 应写成 ${titleCase(bad[0].surname)}。` : null
      }
      const bad = people.filter((p) => !upper(p.surname) && p.surname.replace(/[^A-Za-z]/g, '').length > 1)
      return bad.length ? `2015 版作者姓氏全部大写：${bad[0].surname} 应写成 ${bad[0].surname.toUpperCase()}。` : null
    },
    examples: [
      { edition: '2025', pass: ['[1] Myburg A A, Grattapaglia D, Tuskan G A, et al. The genome of Eucalyptus grandis[J]. Nature, 2014, 510: 356-362.'], fail: ['[1] MYBURG A A, GRATTAPAGLIA D, TUSKAN G A, et al. The genome of Eucalyptus grandis[J]. Nature, 2014, 510: 356-362.'] },
      { edition: '2015', pass: ['[1] KANAMORI H. Shaking without quaking[J]. Science, 1998, 279(5359): 2063.', '[2] DE MORGAN A. A budget of paradoxes[M]. London: Longmans, 1872.'], fail: ['[1] Kanamori H. Shaking without quaking[J]. Science, 1998, 279(5359): 2063.'] },
    ],
  },
  {
    id: 'author-limit',
    title: '责任者超过 3 个时只列前 3 个',
    change: 'unchanged',
    clause: { '2015': '8.1.2', '2025': '7.1.2' },
    appliesTo: 'all',
    severity: { '2015': 'warning', '2025': 'warning' },
    falsePositiveRisk: 'medium',
    falsePositiveNote: '部分学校要求列出全部作者；作者段拆分不出时跳过。',
    check: (e) => {
      const n = authorCount(e)
      if (n === null || n <= 3) return null
      return `列了 ${n} 位作者。超过 3 位时只写前 3 位，后加“${e.isChinese ? ',等' : ', et al.'}”。`
    },
    examples: [
      { edition: '2025', pass: ['[1] 印森林,吴胜和,李俊飞,等.某题名[J].某学报,2020,1(1):1-2.'], fail: ['[1] 印森林,吴胜和,李俊飞,冯文杰.某题名[J].某学报,2020,1(1):1-2.', '[2] Fordham E W, Ali A, Turner D A, Charters J R. Some title[J]. Some Journal, 2020, 1(1): 1-2.'] },
    ],
  },
  {
    id: 'etal-language',
    title: '“等”与“et al.”跟随文献语种',
    change: 'unchanged',
    clause: { '2015': '8.1.2', '2025': '5.1、7.1.2' },
    appliesTo: 'all',
    severity: { '2015': 'warning', '2025': 'warning' },
    falsePositiveRisk: 'low',
    check: (e) => {
      if (!e.authorSegment) return null
      if (e.isChinese && /et al\b/i.test(e.authorSegment)) return '中文文献用“等”，不用“et al.”。'
      if (!e.isChinese && /等$/.test(e.authorSegment)) return '西文文献用“et al.”，不用“等”。'
      return null
    },
    examples: [
      { edition: '2025', pass: ['[1] 于潇,刘义,柴跃廷,等.互联网药品可信交易环境中主体资质审核备案模式[J].清华大学学报(自然科学版),2012,52(11):1518-1523.'], fail: ['[1] 于潇,刘义,柴跃廷, et al.互联网药品可信交易环境中主体资质审核备案模式[J].清华大学学报(自然科学版),2012,52(11):1518-1523.'] },
    ],
  },
  {
    id: 'first-edition',
    title: '第 1 版不著录',
    change: 'modified',
    clause: { '2015': '8.3（第1版不著录）', '2025': '7.4（1版可不著录）' },
    appliesTo: ['M', 'C', 'G'],
    severity: { '2015': 'error', '2025': 'info' },
    falsePositiveRisk: 'low',
    check: (e, ed) =>
      /(?:^|\.)\s*(?:第\s*1\s*版|1\s*版|1st ed)\.?(?=\s*\.|\s*$|\s+[A-Z㐀-鿿])/.test(e.text.slice(e.head.length))
        ? ed === '2015' ? '2015 版规定第 1 版不著录。' : '2025 版规定 1 版可以不写。'
        : null,
    examples: [
      { edition: '2015', pass: ['[1] 徐光宪,王祥云.物质结构[M].2版.北京:科学出版社,2010.'], fail: ['[1] 徐光宪,王祥云.物质结构[M].1版.北京:科学出版社,2010.'] },
    ],
  },
  {
    id: 'journal-year-issue',
    title: '期刊年卷期写法',
    change: 'unchanged',
    clause: { '2015': '8.8.2（示例 2010(6):23）', '2025': '8.5.1.1（示例 2010(6):23）' },
    appliesTo: ['J'],
    severity: { '2015': 'error', '2025': 'error' },
    falsePositiveRisk: 'low',
    check: (e) => {
      if (/\b(?:19|20)\d{2}\s*,\s*\(/.test(e.text)) return '无卷号时写成“年(期)”，年和括号之间不加逗号，如 2010(6):23。'
      if (/\b(?:19|20)\d{2}\s*,\s*\d+\s*,\s*\(?\d+\)?\s*:/.test(e.text) && !/\b(?:19|20)\d{2}\s*,\s*\d+\s*\(/.test(e.text)) {
        return '年卷期写成了“年,卷,期”。应写成“年,卷(期)”，如 2012,52(11):1518-1523。'
      }
      return null
    },
    examples: [
      { edition: '2025', pass: ['[1] 杨宗英.电子图书馆的现实模型[J].中国图书馆学报,1996(2):24-29.', '[2] 于潇,刘义,柴跃廷,等.互联网药品可信交易环境中主体资质审核备案模式[J].清华大学学报(自然科学版),2012,52(11):1518-1523.'], fail: ['[1] 杨宗英.电子图书馆的现实模型[J].中国图书馆学报,1996,(2):24-29.', '[2] 于潇,刘义,柴跃廷,等.某题名[J].清华大学学报(自然科学版),2012,52,11:1518-1523.'] },
    ],
  },
  {
    id: 'page-range-hyphen',
    title: '起讫页码用短横线连接',
    change: 'unchanged',
    clause: { '2015': '7.2（“-”用于起讫页码间）', '2025': '6.2' },
    appliesTo: 'all',
    severity: { '2015': 'warning', '2025': 'warning' },
    falsePositiveRisk: 'low',
    check: (e) => (/:\s*\d+\s*[~～—–－]\s*\d+/.test(e.text) ? '起讫页码之间用短横线“-”，不用“~”或长横线。' : null),
    examples: [
      { edition: '2025', pass: ['[1] 杨洪升.四库馆私家抄校书考略[J].文献,2013(1):56-75.'], fail: ['[1] 杨洪升.四库馆私家抄校书考略[J].文献,2013(1):56～75.'] },
    ],
  },
  {
    id: 'standard-order',
    title: '标准文献的标准编号位置',
    change: 'modified',
    clause: { '2015': '8.2.3（标准号作为其他题名信息，放在标准名称后）', '2025': '8.9.2（标准编号放在最前，后接标准名称）' },
    appliesTo: ['S'],
    severity: { '2015': 'warning', '2025': 'warning' },
    falsePositiveRisk: 'medium',
    falsePositiveNote: '标准编号写法五花八门（行业标准、企业标准），认不出编号时跳过。',
    check: (e, ed) => {
      if (e.type !== 'S' || !STANDARD_NO_RE.test(e.head)) return null
      const first = startsWithStandardNo(e.head)
      if (ed === '2025' && !first) return '2025 版标准写成“标准编号 标准名称[S]”，编号放最前，如 GB/T 3792—2021 信息与文献 资源描述[S]。'
      if (ed === '2015' && first) return '2015 版标准写成“责任者.标准名称:标准编号[S]”，编号放在名称后。'
      return null
    },
    examples: [
      { edition: '2025', pass: ['[1] GB/T 3792—2021 信息与文献 资源描述[S].'], fail: ['[1] 全国信息与文献标准化技术委员会.信息与文献 都柏林核心元数据元素集:GB/T 25100—2010[S].北京:中国标准出版社,2010:2-3.'] },
      { edition: '2015', pass: ['[1] 全国信息与文献标准化技术委员会.信息与文献 都柏林核心元数据元素集:GB/T 25100—2010[S].北京:中国标准出版社,2010:2-3.'], fail: ['[1] GB/T 3792—2021 信息与文献 资源描述[S].'] },
    ],
  },
  {
    id: 'preprint-type',
    title: '预印本用 [PP/OL]',
    change: 'new',
    clause: { '2015': null, '2025': '8.15、附录 A' },
    appliesTo: 'all',
    severity: { '2025': 'warning' },
    falsePositiveRisk: 'medium',
    falsePositiveNote: '预印本已正式发表时，应按期刊著录，此时不该提示。',
    check: (e) =>
      e.type && e.type !== 'PP' && PREPRINT_HOST_RE.test(e.text)
        ? `这条看起来是预印本（arXiv、ChinaXiv 等）。2025 版预印本写作 [PP/OL]；如果已正式发表，请改引正式版。`
        : null,
    examples: [
      { edition: '2025', pass: ['[1] Jenkins S D, Ruostekoski J. Controlled manipulation of light by cooperative response of atoms in an optical lattice[PP/OL]. V2. (2012-03-18)[2020-06-24]. https://doi.org/10.48550/arXiv.1112.6136.'], fail: ['[1] Jenkins S D, Ruostekoski J. Controlled manipulation of light by cooperative response of atoms in an optical lattice[EB/OL]. (2012-03-18)[2020-06-24]. https://arxiv.org/abs/1112.6136.'] },
    ],
  },
  {
    id: 'newspaper-date',
    title: '报纸文章著录出版日期和版次',
    change: 'unchanged',
    clause: { '2015': '8.4.3.2、8.8.5', '2025': '7.5.4.2、8.5.1.4' },
    appliesTo: ['N'],
    severity: { '2015': 'error', '2025': 'error' },
    falsePositiveRisk: 'low',
    check: (e) =>
      e.type === 'N' && !/\d{4}-\d{2}-\d{2}\s*\(\s*\d+\s*\)/.test(e.text) ? '报纸文章要写出版日期和版次，如 2000-11-20(15)。' : null,
    examples: [
      { edition: '2025', pass: ['[1] 丁文祥.数字革命与竞争国际化[N].中国青年报,2000-11-20(15).'], fail: ['[1] 丁文祥.数字革命与竞争国际化[N].中国青年报,2000.'] },
    ],
  },
  {
    id: 'patent-number-date',
    title: '专利文献著录专利号和公告日期',
    change: 'modified',
    clause: { '2015': '4.5.2（专利号）', '2025': '8.10.2（专利申请号）' },
    appliesTo: ['P'],
    severity: { '2015': 'error', '2025': 'error' },
    falsePositiveRisk: 'low',
    check: (e) => {
      if (e.type !== 'P') return null
      if (!/:\s*[A-Z]{0,2}\s?[\dX.]{6,}[A-Z]?\d?\s*\[P/.test(e.text)) return '专利题名后要接“:专利号”（2025 版为专利申请号），再写 [P]。'
      if (!/\d{4}-\d{2}-\d{2}/.test(e.text)) return '专利要写公告日期或公开日期，格式 YYYY-MM-DD。'
      return null
    },
    examples: [
      { edition: '2025', pass: ['[1] 邓一刚.全智能节电器:200610171314.3[P].2006-12-13.'], fail: ['[1] 邓一刚.全智能节电器[P].2006-12-13.', '[2] 邓一刚.全智能节电器:200610171314.3[P].2006.'] },
    ],
  },
  {
    id: 'doi-duplicated',
    title: '网址已含 DOI 时不必重复著录',
    change: 'modified',
    clause: { '2015': '8.7（数字对象唯一标识符）', '2025': '7.9.1（永久标识符）' },
    appliesTo: 'all',
    severity: { '2015': 'info', '2025': 'info' },
    falsePositiveRisk: 'low',
    check: (e) => {
      const m = e.text.match(/DOI\s*:\s*(10\.\S+?)\.?(?:\s|$)/i)
      if (!m) return null
      const doi = m[1].toLowerCase()
      return e.urls.some((u) => u.toLowerCase().includes(doi)) ? '网址里已经有这个 DOI，末尾的 DOI 可以省略。' : null
    },
    examples: [
      { edition: '2025', pass: ['[1] 储大同.恶性肿瘤个体化治疗靶向药物的临床表现[J/OL].中华肿瘤杂志,2010,32(10):721-724.https://rs.yiigle.com/cmaid/37528.DOI:10.3760/cma.j.issn.0253-3766.2010.10.001.'], fail: ['[1] Deverell W, Igler D. A companion to California history[M/OL]. New York: John Wiley & Sons, 2013: 21-22. https://onlinelibrary.wiley.com/doi/book/10.1002/9781444305036. DOI: 10.1002/9781444305036.'] },
    ],
  },
  {
    id: 'eb-for-typed-resource',
    title: '网上的期刊、图书等按本来的类型著录，不写 [EB/OL]',
    change: 'modified',
    clause: { '2015': '4.6', '2025': '8.11.1（以网页形式出现的图书、期刊等按相应类型著录）、附录 A（EB 改为“网站、网页”）' },
    appliesTo: ['EB'],
    severity: { '2025': 'warning' },
    falsePositiveRisk: 'high',
    falsePositiveNote: '只凭“年,卷(期)”或 ISBN 字样推断，网页里恰好提到这些信息时会误判。',
    check: (e) => {
      if (e.type !== 'EB') return null
      const tail = e.text.slice(e.head.length)
      if (/\b(?:19|20)\d{2}\s*,\s*\d+\s*\(\d+\)\s*:/.test(tail)) return '这条有“年,卷(期):页”，看起来是期刊文章。2025 版应写 [J/OL]，[EB/OL] 只用于网站和网页。'
      if (/ISBN/i.test(e.text)) return '这条带 ISBN，看起来是图书。2025 版应写 [M/OL]。'
      return null
    },
    examples: [
      { edition: '2025', pass: ['[1] 高等教育文献保障系统.馆际互借与文献传递服务[EB/OL].[2025-06-21].http://home.calis.edu.cn/pages/list.html.'], fail: ['[1] 储大同.恶性肿瘤个体化治疗靶向药物的临床表现[EB/OL].中华肿瘤杂志,2010,32(10):721-724.https://rs.yiigle.com/cmaid/37528.'] },
    ],
  },
  {
    id: 'thesis-publication',
    title: '学位论文著录授予单位所在地、授予单位、授予年',
    change: 'unchanged',
    clause: { '2015': '4.1.2（按专著格式：出版地:出版者,出版年）', '2025': '8.7.2' },
    appliesTo: ['D'],
    severity: { '2015': 'warning', '2025': 'warning' },
    falsePositiveRisk: 'medium',
    falsePositiveNote: '外文学位论文的授予单位里本身带逗号（如 University of California, Berkeley）时可能误判。',
    check: (e) => {
      if (e.type !== 'D') return null
      const tail = e.text.slice(e.head.length)
      return /\.\s*[^.:]+:\s*[^:]+?,\s*(?:19|20)\d{2}/.test(tail) ? null : '学位论文要写“授予单位所在地:授予单位,年份”，如 武汉:武汉大学,2022。'
    },
    examples: [
      { edition: '2025', pass: ['[1] 王琦.融合星载GNSS-R与SAR数据的高时空分辨率土壤湿度反演方法研究[D].武汉:武汉大学,2022:87.'], fail: ['[1] 王琦.融合星载GNSS-R与SAR数据的高时空分辨率土壤湿度反演方法研究[D].武汉大学,2022.'] },
    ],
  },
]

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s'’-])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase())
}

/** 只能人工核对、不做自动检查的项 */
export const MANUAL_CHECKS: { title: string; reason: string }[] = [
  { title: '著录信息与原文献一致（题名、作者、卷期页）', reason: '要对照原文献或数据库，纯文本看不出来；由参考文献核验模块负责。' },
  { title: '文献类型判断是否正确（如会议论文误标为期刊）', reason: '要看文献本身的出版形式。' },
  { title: '汉语拼音人名的名是否写全称（2025 版：名宜用全称）', reason: '拼音缩写和西文名首字母在文本上无法区分。' },
  { title: '责任者顺序、机构名称分级', reason: '要对照原文献的署名。' },
  { title: '引文页码是否为实际引用页', reason: '要对照正文和原文献。' },
  { title: '出版地是否为城市名、出版者是否用规范名称', reason: '要有出版社名录，误报率高。' },
  { title: '标点全角还是半角', reason: '国标示例用半角，但很多学校模板用全角，由学校规则决定。' },
]

// ---------------------------------------------------------------- 入口

export interface StyleCheckOptions {
  edition: Edition
  /** 只运行这些规则；不传则全部运行 */
  only?: string[]
}

/** 检查单条参考文献 */
export function checkEntry(entry: string, position: number, opts: StyleCheckOptions): StyleIssue[] {
  const view = analyzeEntry(entry)
  const issues: StyleIssue[] = []
  for (const rule of RULES) {
    const severity = rule.severity[opts.edition]
    if (!severity || (opts.only && !opts.only.includes(rule.id))) continue
    if (rule.appliesTo !== 'all' && view.type && !rule.appliesTo.includes(view.type)) continue
    const message = rule.check(view, opts.edition)
    if (message) issues.push({ ruleId: rule.id, position, severity, message })
  }
  return issues
}

/** 检查整份参考文献表：逐条规则，加上顺序编码制的序号连续性 */
export function checkReferenceList(entries: string[], opts: StyleCheckOptions): StyleIssue[] {
  const issues = entries.flatMap((e, i) => checkEntry(e, i + 1, opts))
  const numbers = entries.map((e) => analyzeEntry(e).index)
  if (numbers.every((n) => n !== null)) {
    numbers.forEach((n, i) => {
      if (n !== i + 1) {
        issues.push({ ruleId: 'sequence-numbering', position: i + 1, severity: 'error', message: `第 ${i + 1} 条的序号是 [${n}]，顺序编码制的序号应从 1 开始连续编排。` })
      }
    })
  }
  return issues
}
