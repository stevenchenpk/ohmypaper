/**
 * 责任者姓名拆分：中文姓名拆出姓和名，西文 GB/T 7714 写法拆出姓和名的首字母，机构名整体保留。
 */

/** CSL-JSON 的姓名对象：个人用 family/given，机构用 literal */
export interface CslName {
  family?: string
  given?: string
  literal?: string
}

/** 常见复姓。不在表里的四字姓名按单姓处理，并在调用方给出提示。 */
const COMPOUND_SURNAMES = new Set([
  '欧阳', '司马', '上官', '诸葛', '东方', '皇甫', '尉迟', '公孙', '慕容', '长孙', '宇文', '司徒', '司空',
  '令狐', '端木', '夏侯', '轩辕', '澹台', '独孤', '南宫', '万俟', '闻人', '呼延', '赫连', '申屠', '公羊',
  '太史', '钟离', '宗政', '濮阳', '淳于', '单于', '百里', '东郭', '西门', '第五', '左丘', '梁丘', '拓跋',
])

const HAN = /^[㐀-鿿]+$/
const HAN_WITH_DOT = /^[㐀-鿿]+[·•・][㐀-鿿·•・]+$/

/** 名称里出现这些字样，按机构处理 */
const ORG_HINT =
  /(委员会|大学|学院|研究院|研究所|研究中心|中心|学会|协会|联合会|出版社|公司|集团|部|局|厅|署|院|办公室|组织|政府|银行|基金会|实验室|编辑部|课题组|编写组|编委会|小组|系统|网|报社|馆)$/

/**
 * 音译外国人名常用字；一个"中文名"里出现两个以上，按译名整体保留（只是不拆姓和名）。
 * 四字且不是复姓开头的，多为日本人名或音译名，同样整体保留。
 */
const TRANSLIT_CHARS = new Set([...'斯尔德特克里森伦姆夫娜丝莉蒂恩逊顿兹科罗萨奎沃霍普默瑟赫勒奥'])

export function looksTransliterated(s: string): boolean {
  if (s.length === 4 && !COMPOUND_SURNAMES.has(s.slice(0, 2))) return true
  return [...s].filter((c) => TRANSLIT_CHARS.has(c)).length >= 2
}

/** 中文个人姓名：2–4 个汉字，或带间隔号的少数民族、外国人译名 */
export function isChinesePersonalName(s: string): boolean {
  if (HAN_WITH_DOT.test(s)) return true
  return HAN.test(s) && s.length >= 2 && s.length <= 4 && !ORG_HINT.test(s)
}

export function splitChineseName(s: string): CslName {
  if (HAN_WITH_DOT.test(s) || looksTransliterated(s)) return { literal: s }
  if (s.length >= 3 && COMPOUND_SURNAMES.has(s.slice(0, 2))) return { family: s.slice(0, 2), given: s.slice(2) }
  return { family: s.slice(0, 1), given: s.slice(1) }
}

/** GB/T 7714 西文个人名：姓在前，名缩写为不带点的首字母，可带 Jr；如 Peebles P Z Jr、LECUN Y、De Morgan A */
const WESTERN_GBT = /^((?:[A-Za-z][A-Za-z'’-]*\s)*?[A-Za-z][A-Za-z'’-]*)\s+((?:[A-Z](?:-[A-Z])?\.?\s*)+?)(?:,?\s*(Jr|Sr|II|III)\.?)?$/
/** 汉语拼音全名：Li Jiangning、LI Jiangning */
const PINYIN_FULL = /^([A-Z][a-zA-Z]+)\s+([A-Z][a-z]+(?:[- ]?[A-Za-z][a-z]+)?)$/

export function splitWesternName(s: string): CslName | null {
  const t = s.trim()
  const m = t.match(WESTERN_GBT)
  if (m) {
    const given = m[2].replace(/\./g, '').trim().replace(/\s+/g, ' ')
    return { family: m[1], given: m[3] ? `${given} ${m[3]}` : given }
  }
  const p = t.match(PINYIN_FULL)
  if (p) return { family: p[1], given: p[2] }
  // "Smith, John" 这类姓名倒置写法（题录导出常见）
  const inverted = t.match(/^([A-Za-z][A-Za-z'’ -]*),\s*([A-Za-z][A-Za-z.' -]*)$/)
  if (inverted) return { family: inverted[1].trim(), given: inverted[2].trim() }
  return null
}

export const ETAL_RE = /^(等|et\s*al\.?|等人)$/i

/** 把一个责任者字符串转成 CSL 姓名；判断不了的按机构整体保留 */
export function toCslName(s: string): CslName {
  const t = s.trim()
  if (isChinesePersonalName(t)) return splitChineseName(t)
  return splitWesternName(t) ?? { literal: t }
}

/**
 * 拆分责任者段。中文用逗号或顿号分隔；西文用逗号分隔（GB/T 7714 西文名内部没有逗号）。
 * 返回姓名列表和是否省略了其余作者（"等"、"et al"）。
 */
export function parseNameList(segment: string, sep: RegExp = /\s*[,，、;；]\s*/): { names: CslName[]; etAl: boolean } {
  let etAl = false
  const names: CslName[] = []
  for (const raw of segment.split(sep)) {
    let t = raw.trim()
    if (!t) continue
    // "张三等"、"Smith J et al" 这类没用逗号隔开的省略
    const tail = t.match(/^(.*?)\s*(等|et\s*al\.?)$/i)
    if (tail && tail[1]) {
      etAl = true
      t = tail[1].trim()
    }
    // "PEEBLES P Z, Jr"：Jr 被逗号隔开，并回前一个人名
    if (/^(Jr|Sr|II|III)\.?$/.test(t) && names.length && names[names.length - 1].given) {
      names[names.length - 1].given += ` ${t.replace('.', '')}`
      continue
    }
    if (ETAL_RE.test(t)) {
      etAl = true
      continue
    }
    names.push(toCslName(t))
  }
  return { names, etAl }
}
