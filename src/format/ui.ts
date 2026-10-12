/// <reference types="vite/client" />
/** 格式体检的页面部分：选学校、选文件、显示报告。 */

import { parse } from 'yaml'
import { DocxError } from './docx'
import { checkDocx } from './engine'
import type { WorkerRequest, WorkerResponse } from './worker'
import { type SchoolProfile, profileLabel } from './profile'
import { CATEGORY_LABEL, type Category, type Issue, type Report, type Severity, severityLabel } from './report'

// 构建时把 schools/ 下的档案全部打进页面，运行时不联网
const raw = import.meta.glob('../../schools/*/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
export const PROFILES: { path: string; profile: SchoolProfile }[] = Object.entries(raw)
  .filter(([path]) => !path.includes('/_template/'))
  .map(([path, text]) => ({ path: path.replace('../../', ''), profile: parse(text) as SchoolProfile }))
  .sort((a, b) => a.profile.school.name.localeCompare(b.profile.school.name, 'zh-CN') || b.profile.cohort - a.profile.cohort)

const STATUS_NOTE: Record<SchoolProfile['status'], string> = {
  draft: '这份档案还没经过本校同学核对，结果仅供参考。',
  reviewed: '这份档案已由本校同学核对。',
  outdated: '学校已发布新规定，这份档案可能过期了。',
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

function renderIssue(i: Issue, hasProfile: boolean): HTMLElement {
  const body = el('div', { className: 'row-main' }, el('p', { className: 'raw' }, el('b', {}, i.title)))
  if (i.expected || i.actual) {
    body.append(el('p', { className: 'reason' },
      ...(i.expected ? [el('b', {}, '要求：'), i.expected, '　'] : []),
      ...(i.actual ? [el('b', {}, '实际：'), i.actual] : []),
    ))
  }
  if (i.detail) body.append(el('p', { className: 'reason' }, i.detail))
  if (i.locations.length) {
    const list = el('ul', { className: 'locations' })
    for (const l of i.locations) list.append(el('li', {}, `"${l.excerpt}"`, l.context ? el('span', { className: 'ctx' }, `　在「${l.context}」`) : ''))
    if (i.total && i.total > i.locations.length) list.append(el('li', { className: 'ctx' }, `……共 ${i.total} 处`))
    body.append(list)
  }
  body.append(el('p', { className: 'match' }, `依据：${i.basis}`))
  return el('article', { className: `row sev-${i.severity}` },
    el('div', { className: 'row-side' }, el('span', { className: `st sev-${i.severity}` }, severityLabel(i.severity, hasProfile))),
    body,
  )
}

function renderReport(r: Report, out: HTMLElement, onRefs: (refs: string[]) => void) {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 }
  for (const i of r.issues) counts[i.severity]++

  const hasProfile = r.profileLabel !== null
  const cell = (cls: string, label: string, n: number, note: string) =>
    el('div', { className: `t ${cls}` }, el('div', { className: 'k' }, label), el('div', { className: 'v' }, String(n)), el('div', { className: 'd' }, note))
  // 四格并排：不符、检测到、未检查、通过。未检查和通过同样醒目
  const summary = el('div', {},
    el('p', { className: 'scope mono' }, r.profileLabel ? `按 ${r.profileLabel} 的要求检查` : '通用检查（未选学校）'),
    el('div', { className: 'tally four' },
      cell('t-bad', severityLabel('error', hasProfile), counts.error, '需要修改'),
      cell('t-warn', '检测到，请核对', counts.warning + counts.info, '可能有问题，请对照规范看'),
      cell('t-open', '未检查，需人工确认', r.skipped.length, '工具没有判断，不算通过'),
      cell('t-ok', '通过', r.passed.length, '能自动检查的项'),
    ),
  )
  const nodes: Node[] = [summary]
  if (r.issues.length === 0) nodes.push(el('p', { className: 'note' }, '没有检测到问题。工具只能判断能自动检查的项，提交前仍请对照学校规范通读一遍。'))

  const cats = Object.keys(CATEGORY_LABEL) as Category[]
  for (const c of cats) {
    const list = r.issues.filter((i) => i.category === c)
    if (list.length === 0) continue
    nodes.push(el('h3', { className: 'cat' }, `${CATEGORY_LABEL[c]}（${list.length}）`), el('div', { className: 'rows' }, ...list.map((i) => renderIssue(i, hasProfile))))
  }

  const details = (title: string, items: string[]) => {
    const d = el('details', { className: 'notes' }, el('summary', {}, title))
    d.append(el('ul', {}, ...items.map((t) => el('li', {}, t))))
    return d
  }
  // 未检查的项和问题一样重要，直接展开；通过的项折叠
  if (r.skipped.length) {
    nodes.push(
      el('h3', { className: 'cat' }, `未检查，需人工确认（${r.skipped.length}）`),
      el('p', { className: 'note' }, '下面这些项工具没有判断，不代表符合要求，请对照学校规范自己看一遍。'),
      el('ul', { className: 'skipped' }, ...r.skipped.map((p) => el('li', {}, `${CATEGORY_LABEL[p.category]} · ${p.item}：${p.reason}`))),
    )
  }
  if (r.passed.length) nodes.push(details(`通过的 ${r.passed.length} 项`, r.passed.map((p) => `${CATEGORY_LABEL[p.category]} · ${p.item}`)))

  if (r.references.length) {
    const btn = el('button', { type: 'button', className: 'btn' }, `把抽出的 ${r.references.length} 条参考文献送去核验真伪`)
    btn.addEventListener('click', () => onRefs(r.references))
    nodes.push(el('div', { className: 'actions' }, btn))
  }
  out.replaceChildren(...nodes)
}

/** 优先在 Web Worker 里检查；浏览器不支持时退回主线程 */
function runCheck(data: Uint8Array, profile: SchoolProfile | null): Promise<Report> {
  if (typeof Worker === 'undefined') return Promise.resolve(checkDocx(data, profile))
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    } catch {
      resolve(checkDocx(data, profile))
      return
    }
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      worker.terminate()
      if (e.data.ok) resolve(e.data.report)
      else reject(e.data.readable ? new DocxError(e.data.message) : new Error(e.data.message))
    }
    worker.onerror = () => {
      // 例如以 file:// 打开离线页时不允许启动 Worker
      worker.terminate()
      try {
        resolve(checkDocx(data, profile))
      } catch (err) {
        reject(err)
      }
    }
    // 不转移所有权：Worker 启动失败时主线程还要用这份数据
    worker.postMessage({ data, profile } satisfies WorkerRequest)
  })
}

export function mountFormatCheck(opts: { onReferences: (refs: string[]) => void }) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const select = $<HTMLSelectElement>('school')
  const file = $<HTMLInputElement>('docx')
  const note = $<HTMLParagraphElement>('school-note')
  const status = $<HTMLSpanElement>('format-progress')
  const out = $<HTMLElement>('format-results')

  select.append(el('option', { value: '' }, '不选学校，只做通用检查'))
  PROFILES.forEach(({ profile }, i) => select.append(el('option', { value: String(i) }, profileLabel(profile))))

  const current = () => (select.value === '' ? null : PROFILES[Number(select.value)])
  const showNote = () => {
    const c = current()
    if (!c) {
      note.replaceChildren('通用检查只看标题结构、页码分节、参考文献著录（GB/T 7714）和提交前清理，不查字体字号和页边距。')
      return
    }
    const src = c.profile.sources[0]
    note.replaceChildren(
      `${STATUS_NOTE[c.profile.status]}核实日期 ${c.profile.last_verified}。`,
      ...(src ? ['来源：', el('a', { href: src.url, target: '_blank', rel: 'noopener' }, src.title)] : []),
      '　发现档案有误？',
      el('a', { href: `https://github.com/stevenchenpk/ohmypaper/blob/main/${c.path}`, target: '_blank', rel: 'noopener' }, '去 GitHub 修改'),
    )
  }

  const run = async () => {
    const f = file.files?.[0]
    if (!f) return
    status.textContent = `正在检查 ${f.name}…`
    out.replaceChildren()
    try {
      const report = await runCheck(new Uint8Array(await f.arrayBuffer()), current()?.profile ?? null)
      renderReport(report, out, opts.onReferences)
      status.textContent = `检查完成：${f.name}`
    } catch (e) {
      status.textContent = e instanceof DocxError ? e.message : `检查出错：${(e as Error).message}。可以到 GitHub 提 Issue 告诉我们（请不要附上论文原文）。`
    }
  }

  select.addEventListener('change', () => {
    showNote()
    void run()
  })
  file.addEventListener('change', () => void run())
  showNote()
}
