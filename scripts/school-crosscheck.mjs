// 学校档案里 schema 管不到的交叉约束，validate-schools 和测试共用

/** 按 JSON Pointer 取值；路径不存在返回 undefined */
export function resolvePointer(data, pointer) {
  let cur = data
  for (const key of pointer.slice(1).split('/').map((k) => k.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    if (cur === null || typeof cur !== 'object' || !(key in cur)) return undefined
    cur = cur[key]
  }
  return cur
}

/** schema 管不到的交叉约束：出处下标、字段路径、版本先后 */
export function crossCheck(data) {
  const problems = []
  const n = Array.isArray(data?.sources) ? data.sources.length : 0
  for (const [path, p] of Object.entries(data?.provenance ?? {})) {
    if (p.source >= n) problems.push(`/provenance${path} source ${p.source} 超出 sources 范围`)
    if (resolvePointer(data, path) === undefined) problems.push(`/provenance${path} 指向的字段不存在`)
    if (p.effective && p.supersedes && p.supersedes >= p.effective) problems.push(`/provenance${path} supersedes 应早于 effective`)
  }
  for (const [i, c] of (data?.conflicts ?? []).entries()) {
    for (const claim of c.claims) if (claim.source >= n) problems.push(`/conflicts/${i} source ${claim.source} 超出 sources 范围`)
  }
  return problems
}
