import { parseReferenceList } from './references/parse'
import { STATUS_LABEL, STATUS_ORDER, countByStatus, toCsv, toTextReport } from './references/report'
import { type VerifyResult, verifyAll } from './references/verify'

const SAMPLE = `[1] LECUN Y, BENGIO Y, HINTON G. Deep learning[J]. Nature, 2015, 521(7553): 436-444. DOI:10.1038/nature14539.
[2] VASWANI A, SHAZEER N, PARMAR N, et al. Attention is all you need[C]//Advances in Neural Information Processing Systems. 2017: 5998-6008.
[3] WANG L. Large language models in undergraduate thesis writing[J]. Nature, 2015, 521: 1-9. DOI:10.1038/nature14539.
[4] SMITH J. Neural correlates of thesis anxiety in undergraduate cohorts[J]. Journal of Imaginary Studies, 2023, 12(3): 45-67.
[5] 张三, 李四. 生成式人工智能对高等教育的影响研究[J]. 中国高教研究, 2024(3): 12-19.`

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const input = $<HTMLTextAreaElement>('refs')
const runBtn = $<HTMLButtonElement>('run')
const progress = $<HTMLSpanElement>('progress')
const report = $<HTMLElement>('report')
const reportMeta = $<HTMLElement>('report-meta')
const bar = $<HTMLElement>('bar')
const summary = $<HTMLElement>('summary')
const resultsEl = $<HTMLElement>('results')

let last: { results: VerifyResult[]; at: Date } | null = null

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

function renderCard(r: VerifyResult): HTMLElement {
  const body = el('div', { className: 'result-body' },
    el('p', { className: 'raw' }, el('span', { className: 'idx' }, `[${r.ref.index}] `), r.ref.raw),
    el('p', { className: 'reason' }, r.reason),
  )
  if (r.match && r.status !== 'verified') {
    body.append(el('p', { className: 'match' }, `库中最接近的记录：${r.match.title}（${r.match.year ?? '年份未知'}）`))
  }
  const links = el('p', { className: 'links' })
  for (const l of r.links) links.append(el('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.label))
  body.append(links)
  return el('article', { className: `result ${r.status}` },
    el('span', { className: `tag ${r.status}` }, STATUS_LABEL[r.status]),
    body,
  )
}

function renderReport(results: VerifyResult[], at: Date) {
  const counts = countByStatus(results)
  const present = STATUS_ORDER.filter((s) => counts.get(s))

  reportMeta.textContent = `${at.toLocaleString('zh-CN', { hour12: false })} · 共 ${results.length} 条`
  bar.replaceChildren(...present.map((s) => {
    const seg = el('span', { className: `seg ${s}` })
    seg.style.flexGrow = String(counts.get(s))
    return seg
  }))
  summary.replaceChildren(...present.map((s) => el('span', { className: `tag ${s}` }, `${STATUS_LABEL[s]} ${counts.get(s)}`)))

  const sorted = [...results].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.ref.index - b.ref.index,
  )
  resultsEl.replaceChildren(...sorted.map(renderCard))
  report.hidden = false
}

async function run() {
  const refs = parseReferenceList(input.value)
  if (refs.length === 0) {
    progress.textContent = '请先粘贴参考文献。'
    return
  }
  runBtn.disabled = true
  progress.textContent = `正在核验 0 / ${refs.length}…`

  const results = await verifyAll(refs, {
    onProgress: (done) => (progress.textContent = `正在核验 ${done} / ${refs.length}…`),
  })
  last = { results, at: new Date() }
  renderReport(results, last.at)
  progress.textContent = '核验完成，报告在下方。'
  runBtn.disabled = false
  report.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = el('a', { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function flash(btn: HTMLButtonElement, text: string) {
  const old = btn.textContent
  btn.textContent = text
  setTimeout(() => (btn.textContent = old), 1500)
}

runBtn.addEventListener('click', () => void run())
$<HTMLButtonElement>('sample').addEventListener('click', () => {
  input.value = SAMPLE
  input.focus()
})
$<HTMLButtonElement>('copy').addEventListener('click', async (e) => {
  if (!last) return
  try {
    await navigator.clipboard.writeText(toTextReport(last.results, last.at))
    flash(e.currentTarget as HTMLButtonElement, '已复制')
  } catch {
    flash(e.currentTarget as HTMLButtonElement, '复制失败，请改用下载')
  }
})
$<HTMLButtonElement>('csv').addEventListener('click', () => {
  if (last) download(`参考文献核验-${last.at.toISOString().slice(0, 10)}.csv`, toCsv(last.results), 'text/csv;charset=utf-8')
})
$<HTMLButtonElement>('print').addEventListener('click', () => window.print())
