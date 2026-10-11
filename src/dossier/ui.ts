/**
 * "继续上次检查"小卡片。自包含：只依赖 src/dossier/ 下的数据层。
 * 样式在 style.css 里以 .resume 开头的一段。
 */

import { EXPORT_FILENAME, exportDossier, importDossier } from './io'
import { citationCountsText, formatCountsText, formatTime, hasResume, previousSessionLabel } from './resume'
import type { Dossier } from './schema'
import type { DossierStore } from './store'

export interface ResumeBarOptions {
  store: DossierStore
  dossier: Dossier
  /** 点"继续上次检查"时由页面把保存的内容放回去 */
  onRestore: (d: Dossier) => void
  /** 导入或清除后档案被整个替换 */
  onChange: (d: Dossier) => void
  /** 清除后让页面撤掉已恢复的显示 */
  onClear: () => void
}

export interface ResumeBar {
  update(d: Dossier): void
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children)
  return node
}

export function mountResumeBar(container: HTMLElement, opts: ResumeBarOptions): ResumeBar {
  const { store } = opts
  let dossier = opts.dossier
  let message = ''

  function doExport() {
    // 用 data: 链接下载：离线版检查会拦截 createObjectURL(…) 这种写法
    const href = `data:application/json;charset=utf-8,${encodeURIComponent(exportDossier(dossier))}`
    const a = h('a', { href, download: EXPORT_FILENAME })
    document.body.append(a)
    a.click()
    a.remove()
  }

  async function doImport(file: File) {
    try {
      const d = importDossier(await file.text())
      dossier = d
      await store.save(d)
      opts.onChange(d)
      message = hasResume(d) ? '已导入。点"继续上次检查"可以恢复。' : '已导入，但文件里没有可恢复的检查记录。'
    } catch (e) {
      message = (e as Error).message
    }
    render()
  }

  async function doClear() {
    if (!confirm('确定删除保存在这个浏览器里的检查记录吗？删除后无法恢复（已导出的文件不受影响）。')) return
    await store.clear()
    dossier = { ...dossier, resume: undefined, library: [], updated: new Date().toISOString() }
    opts.onChange(dossier)
    opts.onClear()
    message = '已删除本浏览器里保存的检查记录。'
    render()
  }

  function render() {
    const r = dossier.resume
    const can = hasResume(dossier)
    const info = h('div', { className: 'resume-info' })
    if (can) {
      if (r?.citation) info.append(h('p', {}, h('b', {}, '参考文献核验'), `　${formatTime(r.citation.at)}　${citationCountsText(r.citation)}`))
      if (r?.format) info.append(h('p', {}, h('b', {}, '格式体检'), `　${formatTime(r.format.at)}　${r.format.filename}（${r.format.schoolLabel ?? '未选学校'}）　${formatCountsText(r.format)}`))
    } else {
      info.append(h('p', { className: 'hint' }, '做完一次参考文献核验或格式体检后，这里会记住进度，下次打开可以接着看。'))
    }

    const actions = h('div', { className: 'resume-actions' })
    if (can) {
      const restore = h('button', { type: 'button', textContent: '继续上次检查' })
      restore.addEventListener('click', () => {
        opts.onRestore(dossier)
        message = '已恢复。下面显示的是上次会话的记录，不是本次核验；需要最新结果请重新核验。'
        render()
      })
      actions.append(restore)
    }
    const exp = h('button', { type: 'button', className: 'ghost', textContent: '导出为 JSON 文件', disabled: !can })
    exp.addEventListener('click', doExport)
    const fileInput = h('input', { type: 'file', accept: '.json,application/json' })
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0]
      if (f) void doImport(f)
      fileInput.value = ''
    })
    const imp = h('label', { className: 'file ghost' }, '从 JSON 文件恢复', fileInput)
    actions.append(exp, imp)
    if (can) {
      const del = h('button', { type: 'button', className: 'ghost danger', textContent: '清除本浏览器里的记录' })
      del.addEventListener('click', () => void doClear())
      actions.append(del)
    }

    const notice = h(
      'p',
      { className: 'privacy' },
      h('b', {}, '仅存于此浏览器。'),
      store.persistent
        ? '这些记录只保存在你当前这台设备的这个浏览器里，我们的服务器收不到；换浏览器、换设备或清除站点数据后就没有了，需要时请导出文件自行保管。只记参考文献文本、结果摘要，以及格式体检的文件名、学校和统计数字，不保存论文正文。'
        : '当前浏览器不允许保存数据（可能是隐私模式或禁用了站点数据），刷新页面后记录会丢失。你仍可以导出为文件自行保管。',
    )
    container.replaceChildren(h('h2', {}, '继续上次检查'), info, actions, notice, h('p', { className: 'resume-msg', hidden: message === '', textContent: message }))
    container.hidden = false
  }

  render()
  return {
    update(d) {
      dossier = d
      render()
    },
  }
}

export { previousSessionLabel }
