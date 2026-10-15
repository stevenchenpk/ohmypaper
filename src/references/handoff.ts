/**
 * 格式体检 → 引用核验的交接：只把抽出的参考文献填进核验框，不自动联网。
 * 用户看过、点"开始核验"才发送，符合"联网核验只发送你确认过的参考文献信息"。
 * 纯函数，不碰 DOM。
 */

export interface Handoff {
  /** 要填进核验框的文字 */
  text: string
  /** 核验框里原来有不同内容时，覆盖前要 confirm 的提示；不需要确认时为 null */
  confirm: string | null
  /** 填好后显示在按钮旁的说明 */
  note: string
}

export function planHandoff(current: string, refs: string[]): Handoff {
  const text = refs.map((r, i) => `[${i + 1}] ${r}`).join('\n')
  const cur = current.trim()
  return {
    text,
    confirm: cur && cur !== text.trim()
      ? `引用核验框里已经有你填写的内容，填入从论文中抽出的 ${refs.length} 条参考文献会把它替换掉。确定替换吗？`
      : null,
    note: `已填入从论文中抽出的 ${refs.length} 条参考文献，确认无误后点开始核验`,
  }
}

/** 防重入：上一轮没结束时再调用直接忽略，返回 false */
export function singleFlight<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => Promise<boolean> {
  let running = false
  return async (...args: A) => {
    if (running) return false
    running = true
    try {
      await fn(...args)
    } finally {
      running = false
    }
    return true
  }
}
