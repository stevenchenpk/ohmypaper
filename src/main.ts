import { mountFormatCheck } from './format/ui'
import { parseReferenceList } from './references/parse'
import { type VerifyResult, type VerifyStatus, verifyAll } from './references/verify'

const STATUS_LABEL: Record<VerifyStatus, string> = {
  verified: '已核实',
  mismatch: '信息不符',
  not_found: '查无此文',
  manual: '需人工核对',
  error: '查询失败',
}

/** 排序：最需要学生处理的排在前面 */
const STATUS_ORDER: VerifyStatus[] = ['not_found', 'mismatch', 'error', 'manual', 'verified']

const SAMPLE = `[1] LECUN Y, BENGIO Y, HINTON G. Deep learning[J]. Nature, 2015, 521(7553): 436-444. DOI:10.1038/nature14539.
[2] VASWANI A, SHAZEER N, PARMAR N, et al. Attention is all you need[C]//Advances in Neural Information Processing Systems. 2017: 5998-6008.
[3] WANG L. Large language models in undergraduate thesis writing[J]. Nature, 2015, 521: 1-9. DOI:10.1038/nature14539.
[4] SMITH J. Neural correlates of thesis anxiety in undergraduate cohorts[J]. Journal of Imaginary Studies, 2023, 12(3): 45-67.
[5] 张三, 李四. 生成式人工智能对高等教育的影响研究[J]. 中国高教研究, 2024(3): 12-19.`

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const input = $<HTMLTextAreaElement>('refs')
const runBtn = $<HTMLButtonElement>('run')
const progress = $<HTMLSpanElement>('progress')
const summary = $<HTMLElement>('summary')
const resultsEl = $<HTMLElement>('results')

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

function renderCard(r: VerifyResult): HTMLElement {
  const head = el('div', { className: 'result-head' },
    el('span', { className: `tag ${r.status}` }, STATUS_LABEL[r.status]),
    el('span', { className: 'idx' }, `[${r.ref.index}]`),
  )
  const body = el('div', { className: 'result-body' },
    el('p', { className: 'raw' }, r.ref.raw),
    el('p', { className: 'reason' }, r.reason),
  )
  if (r.match && r.status !== 'verified') {
    body.append(el('p', { className: 'match' }, `库中最接近的记录：${r.match.title}（${r.match.year ?? '年份未知'}）`))
  }
  const links = el('p', { className: 'links' })
  for (const l of r.links) links.append(el('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.label))
  body.append(links)
  return el('article', { className: `result ${r.status}` }, head, body)
}

function renderSummary(results: VerifyResult[]) {
  const counts = new Map<VerifyStatus, number>()
  for (const r of results) counts.set(r.status, (counts.get(r.status) ?? 0) + 1)
  summary.replaceChildren(
    el('p', {}, `共 ${results.length} 条：`),
    ...STATUS_ORDER.filter((s) => counts.get(s)).map((s) => el('span', { className: `tag ${s}` }, `${STATUS_LABEL[s]} ${counts.get(s)}`)),
  )
  summary.hidden = false
}

async function run() {
  const refs = parseReferenceList(input.value)
  if (refs.length === 0) {
    progress.textContent = '请先粘贴参考文献。'
    return
  }
  runBtn.disabled = true
  resultsEl.replaceChildren()
  summary.hidden = true
  progress.textContent = `正在核验 0 / ${refs.length}…`

  const results = await verifyAll(refs, {
    onProgress: (done) => (progress.textContent = `正在核验 ${done} / ${refs.length}…`),
  })

  const sorted = [...results].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.ref.index - b.ref.index,
  )
  renderSummary(results)
  resultsEl.replaceChildren(...sorted.map(renderCard))
  progress.textContent = '核验完成。'
  runBtn.disabled = false
}

runBtn.addEventListener('click', () => void run())
$<HTMLButtonElement>('sample').addEventListener('click', () => {
  input.value = SAMPLE
  input.focus()
})

mountFormatCheck({
  onReferences: (refs) => {
    input.value = refs.map((r, i) => `[${i + 1}] ${r}`).join('\n')
    document.getElementById('verify')?.scrollIntoView({ behavior: 'smooth' })
    void run()
  },
})
