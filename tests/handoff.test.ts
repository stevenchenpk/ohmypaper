import { describe, expect, it } from 'vitest'
import { planHandoff, singleFlight } from '../src/references/handoff'

describe('格式体检送去核验：只填入，不自动发送', () => {
  const refs = ['A. Title[J]. J, 2020.', 'B. Title[J]. J, 2021.']

  it('核验框为空时直接填入，并给出确认提示', () => {
    const p = planHandoff('', refs)
    expect(p.text).toBe('[1] A. Title[J]. J, 2020.\n[2] B. Title[J]. J, 2021.')
    expect(p.confirm).toBeNull()
    expect(p.note).toBe('已填入从论文中抽出的 2 条参考文献，确认无误后点开始核验')
  })

  it('核验框里有别的内容时先确认', () => {
    expect(planHandoff('[1] 我自己的列表', refs).confirm).toContain('替换')
  })

  it('核验框里就是同一份列表时不用确认', () => {
    expect(planHandoff(planHandoff('', refs).text, refs).confirm).toBeNull()
  })
})

describe('核验防重入', () => {
  it('上一轮没结束时再点不会再跑一轮', async () => {
    let calls = 0
    let release!: () => void
    const run = singleFlight(async () => {
      calls++
      await new Promise<void>((r) => (release = r))
    })
    const first = run()
    expect(await run()).toBe(false)
    release()
    expect(await first).toBe(true)
    expect(calls).toBe(1)
    const third = run()
    release()
    expect(await third).toBe(true)
    expect(calls).toBe(2)
  })
})
