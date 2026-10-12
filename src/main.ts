import { mountFormatCheck } from './format/ui'
import { parseReferenceList } from './references/parse'
import { STATUS_LABEL, STATUS_ORDER, toCsv, toTextReport } from './references/report'
import { type VerifyResult, type VerifyStatus, verifyAll } from './references/verify'

const SAMPLE = `[1] LECUN Y, BENGIO Y, HINTON G. Deep learning[J]. Nature, 2015, 521(7553): 436-444. DOI:10.1038/nature14539.
[2] VASWANI A, SHAZEER N, PARMAR N, et al. Attention is all you need[C]//Advances in Neural Information Processing Systems. 2017: 5998-6008.
[3] WANG L. Large language models in undergraduate thesis writing[J]. Nature, 2015, 521: 1-9. DOI:10.1038/nature14539.
[4] SMITH J. Neural correlates of thesis anxiety in undergraduate cohorts[J]. Journal of Imaginary Studies, 2023, 12(3): 45-67.
[5] 张三, 李四. 生成式人工智能对高等教育的影响研究[J]. 中国高教研究, 2024(3): 12-19.`

/** 三档结果：查无或不符 / 未检查（含查询失败，绝不算通过）/ 检测到一致记录 */
type Tier = 'bad' | 'open' | 'ok'
const TIER_OF: Record<VerifyStatus, Tier> = { not_found: 'bad', mismatch: 'bad', manual: 'open', error: 'open', verified: 'ok' }
const TIERS: { tier: Tier; label: string; note: (n: Map<VerifyStatus, number>) => string }[] = [
  { tier: 'bad', label: '查无此文或信息不符', note: (n) => `查无此文 ${n.get('not_found') ?? 0} · 信息不符 ${n.get('mismatch') ?? 0}` },
  { tier: 'open', label: '未检查，需人工确认', note: (n) => (n.get('error') ? `需人工核对 ${n.get('manual') ?? 0} · 查询失败 ${n.get('error')}，不算通过` : '没有开放接口或查不到，不算通过') },
  { tier: 'ok', label: '检测到一致记录', note: () => '每条写明核对了哪几项' },
]
const TIER_TEXT: Record<Tier, string> = { bad: '需要处理', open: '未检查', ok: '检测到' }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const input = $<HTMLTextAreaElement>('refs')
const runBtn = $<HTMLButtonElement>('run')
const progress = $<HTMLSpanElement>('progress')
const report = $<HTMLElement>('report')
const summary = $<HTMLElement>('summary')
const resultsEl = $<HTMLElement>('results')

let last: { results: VerifyResult[]; at: Date } | null = null

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

function renderRow(r: VerifyResult): HTMLElement {
  const side = el('div', { className: 'row-side' },
    el('span', { className: `st ${r.status}` }, STATUS_LABEL[r.status]),
    el('small', { className: 'mono' }, TIER_TEXT[TIER_OF[r.status]]),
  )
  const main = el('div', { className: 'row-main' },
    el('p', { className: 'raw' }, el('i', { className: 'mono' }, `[${r.ref.index}]`), r.ref.raw),
    el('p', { className: 'reason' }, r.reason),
  )
  if (r.match && r.status !== 'verified') {
    main.append(el('p', { className: 'match' }, `库中最接近的记录：${r.match.title}（${r.match.year ?? '年份未知'}）`))
  }
  if (r.links.length) {
    const links = el('p', { className: 'links' })
    for (const l of r.links) links.append(el('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.label))
    main.append(links)
  }
  return el('article', { className: `row ${r.status} tier-${TIER_OF[r.status]}` }, side, main)
}

function renderReport(results: VerifyResult[], at: Date) {
  const counts = new Map<VerifyStatus, number>()
  for (const r of results) counts.set(r.status, (counts.get(r.status) ?? 0) + 1)
  const tierCount = (t: Tier) => results.filter((r) => TIER_OF[r.status] === t).length

  // 三档并排，未检查和通过同样醒目，不折叠
  summary.replaceChildren(...TIERS.map(({ tier, label, note }) =>
    el('div', { className: `t t-${tier}` },
      el('div', { className: 'k' }, label),
      el('div', { className: 'v' }, String(tierCount(tier))),
      el('div', { className: 'd' }, note(counts)),
    )))

  $('report-count').replaceChildren(String(results.length), el('small', {}, '条'))
  $('report-meta').textContent = `${at.toLocaleString('zh-CN', { hour12: false })} · Crossref · OpenAlex`
  $('report-total').textContent = `共 ${results.length} 条`

  const sorted = [...results].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.ref.index - b.ref.index,
  )
  resultsEl.replaceChildren(...sorted.map(renderRow))
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
  progress.textContent = `核验完成 · ${results.length} 条`
  runBtn.disabled = false
  report.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  el('a', { href: url, download: name }).click()
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
  const btn = e.currentTarget as HTMLButtonElement
  if (!last) return
  try {
    await navigator.clipboard.writeText(toTextReport(last.results, last.at))
    flash(btn, '已复制')
  } catch {
    flash(btn, '复制失败，请改用下载')
  }
})
$<HTMLButtonElement>('csv').addEventListener('click', () => {
  if (last) download(`参考文献核验-${last.at.toISOString().slice(0, 10)}.csv`, toCsv(last.results), 'text/csv;charset=utf-8')
})
$<HTMLButtonElement>('print').addEventListener('click', () => window.print())

mountFormatCheck({
  onReferences: (refs) => {
    input.value = refs.map((r, i) => `[${i + 1}] ${r}`).join('\n')
    document.getElementById('verify')?.scrollIntoView({ behavior: 'smooth' })
    void run()
  },
})
