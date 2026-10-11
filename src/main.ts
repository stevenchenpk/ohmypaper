import { citationCountsText, citationResume, formatCountsText, formatResume, previousSessionLabel, withResume } from './dossier/resume'
import { libraryFromResults } from './dossier/io'
import { type Dossier, emptyDossier } from './dossier/schema'
import { createStore } from './dossier/store'
import { type ResumeBar, mountResumeBar } from './dossier/ui'
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

// ---- 继续上次检查：所有存储读写都在 store 里 try/catch，存储不可用时页面照常工作 ----
const store = createStore()
let dossier: Dossier = emptyDossier()
let bar: ResumeBar | null = null
const restoredEl = $<HTMLElement>('restored')
const formatRestoredEl = $<HTMLElement>('format-restored')

async function persist(d: Dossier) {
  dossier = d
  await store.save(d)
  bar?.update(d)
}

function clearRestored() {
  restoredEl.hidden = true
  restoredEl.replaceChildren()
}

function showRestoredCitation(c: NonNullable<NonNullable<Dossier['resume']>['citation']>) {
  const bad = c.items.filter((i) => i.status !== 'verified')
  restoredEl.replaceChildren(
    el('p', { className: 'prev-label' }, previousSessionLabel(c.at)),
    el('p', {}, `参考文献核验 · 上次记录：${citationCountsText(c)}`),
    ...(bad.length
      ? [el('p', { className: 'hint' }, '上次需要你处理的条目（点"开始核验"可重新核验）：'),
         el('ul', {}, ...bad.map((i) => el('li', {}, el('span', { className: `tag ${i.status}` }, `上次：${STATUS_LABEL[i.status]}`), ` [${i.index}] ${i.reason}`)))]
      : [el('p', { className: 'hint' }, '这是上次的记录，不代表现在的状态；提交前请重新核验。'),]),
  )
  restoredEl.hidden = false
}

function showRestoredFormat(f: NonNullable<NonNullable<Dossier['resume']>['format']>) {
  formatRestoredEl.replaceChildren(
    el('p', { className: 'prev-label' }, previousSessionLabel(f.at)),
    el('p', {}, `格式体检 · ${f.filename}（${f.schoolLabel ?? '未选学校'}）· ${formatCountsText(f)}`),
    el('p', { className: 'hint' }, '这是上次的统计，不是本次检查结果；没有保存文件内容，请重新选择 docx 再检查一次。'),
  )
  formatRestoredEl.hidden = false
}

function clearFormatRestored() {
  formatRestoredEl.hidden = true
  formatRestoredEl.replaceChildren()
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
  clearRestored()
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
  const now = new Date()
  const next = withResume(dossier, { citation: citationResume(input.value, results, now) }, now)
  void persist({ ...next, library: libraryFromResults(results, dossier.library, now) })
}

runBtn.addEventListener('click', () => void run())
$<HTMLButtonElement>('sample').addEventListener('click', () => {
  input.value = SAMPLE
  input.focus()
})

const formatCheck = mountFormatCheck({
  onReferences: (refs) => {
    input.value = refs.map((r, i) => `[${i + 1}] ${r}`).join('\n')
    document.getElementById('verify')?.scrollIntoView({ behavior: 'smooth' })
    void run()
  },
  onStart: clearFormatRestored,
  onResult: (info) => void persist(withResume(dossier, { format: formatResume(info) })),
})

void (async () => {
  dossier = (await store.load()) ?? emptyDossier()
  bar = mountResumeBar($<HTMLElement>('resume'), {
    store,
    dossier,
    onChange: (d) => (dossier = d),
    onClear: () => {
      clearRestored()
      clearFormatRestored()
    },
    onRestore: (d) => {
      const c = d.resume?.citation
      if (c) {
        input.value = c.refsText
        resultsEl.replaceChildren()
        summary.hidden = true
        showRestoredCitation(c)
      }
      const f = d.resume?.format
      if (f) {
        formatCheck.setSchool(f.schoolPath)
        showRestoredFormat(f)
      }
    },
  })
})()
