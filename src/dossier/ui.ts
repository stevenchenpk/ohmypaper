/**
 * "我的论文档案"小条。自包含：只依赖 src/dossier/ 下的数据层，不依赖页面其他部分，
 * 页面改版时整体搬走即可（样式在 style.css 里以 .dossier 开头的一段）。
 */

import { EXPORT_FILENAME, exportDossier, importDossier } from './io'
import { type Dossier, emptyDossier } from './schema'
import { type DossierStore, getLastExportAt, needsBackupReminder, setLastExportAt } from './store'

export const DEGREE_LABELS: Record<string, string> = { bachelor: '本科', master: '硕士', doctor: '博士' }

/** 已收录规则档案的学校（schools/ 目录）。其余学校可以直接填代码。 */
export const KNOWN_SCHOOLS: Record<string, string> = { fudan: '复旦大学' }

export function schoolLabel(code: string | null): string {
  if (!code) return '未设置'
  return KNOWN_SCHOOLS[code] ?? code
}

/** 档案概要，如"复旦大学 · 本科 · 2027 届"；一项都没填返回"未设置" */
export function profileSummary(d: Dossier): string {
  const p = d.profile
  const parts: string[] = []
  if (p.school) parts.push(schoolLabel(p.school))
  if (p.degree) parts.push(DEGREE_LABELS[p.degree] ?? p.degree)
  if (p.cohort !== null && p.cohort !== undefined) parts.push(`${p.cohort} 届`)
  return parts.length > 0 ? parts.join(' · ') : '未设置'
}

export function countsText(d: Dossier): string {
  return `文献库 ${d.library.length} 条 · AI 使用记录 ${d.ai_log.length} 条`
}

/** 把编辑框里的内容整理成档案字段；届次不合法时返回 error */
export function parseProfileForm(school: string, degree: string, cohort: string): { school: string | null; degree: string | null; cohort: number | null; error?: string } {
  const s = school.trim()
  const c = cohort.trim()
  let cohortNum: number | null = null
  if (c !== '') {
    if (!/^\d{4}$/.test(c)) return { school: null, degree: null, cohort: null, error: '届次请填 4 位年份，如 2027。' }
    cohortNum = Number(c)
  }
  return { school: s === '' ? null : s, degree: degree === '' ? null : degree, cohort: cohortNum }
}

export interface DossierBarOptions {
  store: DossierStore
  dossier: Dossier
  /** 导入或删除后档案对象会被整个替换，用这个拿到新的 */
  onChange?: (d: Dossier) => void
}

export interface DossierBar {
  /** 档案在外部被改动（如核验结果并入文献库）后刷新显示 */
  update(d: Dossier): void
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

export function mountDossierBar(container: HTMLElement, opts: DossierBarOptions): DossierBar {
  const { store } = opts
  let dossier = opts.dossier
  let message = ''
  let editing = false

  const commit = async (d: Dossier) => {
    dossier = d
    await store.save(d)
    opts.onChange?.(d)
    render()
  }

  function doExport() {
    const blob = new Blob([exportDossier(dossier)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = h('a', { href: url, download: EXPORT_FILENAME })
    document.body.append(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    setLastExportAt()
    message = '已导出。文件请自己保管好。'
    render()
  }

  async function doImport(file: File) {
    try {
      const d = importDossier(await file.text())
      if (dossier.library.length + dossier.ai_log.length > 0 && !confirm('导入会用文件里的档案替换当前档案。要继续吗？')) return
      message = '已导入。'
      await commit(d)
    } catch (e) {
      message = e instanceof Error ? e.message : '导入失败。'
      render()
    }
  }

  async function doDelete() {
    const ok = confirm('删除后无法恢复。\n\n建议先点"导出"保存一份。确定要删除当前档案吗？')
    if (!ok) return
    await store.clear()
    dossier = emptyDossier()
    message = '档案已删除。'
    opts.onChange?.(dossier)
    render()
  }

  function renderEditor(): HTMLElement {
    const p = dossier.profile
    const school = h('input', { type: 'text', value: p.school ?? '', placeholder: '学校代码，如 fudan' })
    school.setAttribute('list', 'dossier-schools')
    school.setAttribute('aria-label', '学校')
    const list = h('datalist', { id: 'dossier-schools' }, ...Object.entries(KNOWN_SCHOOLS).map(([code, name]) => h('option', { value: code }, name)))
    const degree = h('select', {}, h('option', { value: '' }, '学位'), ...Object.entries(DEGREE_LABELS).map(([v, l]) => h('option', { value: v }, l)))
    degree.value = p.degree ?? ''
    degree.setAttribute('aria-label', '学位')
    const cohort = h('input', { type: 'text', value: p.cohort === null || p.cohort === undefined ? '' : String(p.cohort), placeholder: '届次，如 2027' })
    cohort.inputMode = 'numeric'
    cohort.setAttribute('aria-label', '届次')
    const err = h('span', { className: 'dossier-note' })
    const save = h('button', { type: 'button' }, '保存')
    save.addEventListener('click', () => {
      const r = parseProfileForm(school.value, degree.value, cohort.value)
      if (r.error) {
        err.textContent = r.error
        return
      }
      editing = false
      message = ''
      void commit({ ...dossier, updated: new Date().toISOString(), profile: { ...dossier.profile, school: r.school, degree: r.degree, cohort: r.cohort } })
    })
    const cancel = h('button', { type: 'button', className: 'ghost' }, '取消')
    cancel.addEventListener('click', () => {
      editing = false
      render()
    })
    return h('div', { className: 'dossier-edit' }, school, list, degree, cohort, save, cancel, err)
  }

  function render() {
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true })
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0]
      fileInput.value = ''
      if (f) void doImport(f)
    })
    const btn = (label: string, onClick: () => void, ghost = true) => {
      const b = h('button', { type: 'button', className: ghost ? 'ghost' : '' }, label)
      b.addEventListener('click', onClick)
      return b
    }

    const info = h('div', { className: 'dossier-info' },
      h('b', {}, '我的论文档案'),
      h('span', { className: 'dossier-profile' }, profileSummary(dossier)),
      h('span', { className: 'dossier-counts' }, countsText(dossier)),
    )
    const actions = h('div', { className: 'dossier-actions' },
      btn('设置', () => {
        editing = !editing
        render()
      }),
      btn('导出', doExport),
      btn('导入', () => fileInput.click()),
      btn('删除', () => void doDelete()),
      fileInput,
    )

    const lines: HTMLElement[] = []
    if (editing) lines.push(renderEditor())
    if (!store.persistent) lines.push(h('p', { className: 'dossier-note' }, '当前浏览器没法保存档案，它只在这个标签页里有效，关掉就没了。需要的话请先导出。'))
    if (needsBackupReminder(dossier, getLastExportAt())) lines.push(h('p', { className: 'dossier-note' }, '浏览器数据可能被清掉，建议点"导出"备份一份档案。'))
    if (message) lines.push(h('p', { className: 'dossier-msg', role: 'status' }, message))
    lines.push(h('p', { className: 'dossier-note' }, '档案只存在你的浏览器里，不含论文正文。'))

    container.replaceChildren(h('section', { className: 'card dossier' }, info, actions, ...lines))
  }

  render()
  return {
    update(d) {
      dossier = d
      render()
    },
  }
}
