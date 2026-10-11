/**
 * 标题相似度：字符二元组的 Dice 系数。
 * 对大小写、标点、空白不敏感，中英文都适用，不依赖分词。
 */

export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/<[^>]+>/g, '') // Crossref 标题里偶尔带 <i> 等标签
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    m.set(g, (m.get(g) ?? 0) + 1)
  }
  return m
}

export function titleSimilarity(a: string, b: string): number {
  const x = normalizeTitle(a)
  const y = normalizeTitle(b)
  if (x.length === 0 || y.length === 0) return 0
  if (x === y) return 1
  if (x.length < 2 || y.length < 2) return 0

  const bx = bigrams(x)
  const by = bigrams(y)
  let overlap = 0
  for (const [g, n] of bx) overlap += Math.min(n, by.get(g) ?? 0)
  return (2 * overlap) / (x.length - 1 + (y.length - 1))
}
