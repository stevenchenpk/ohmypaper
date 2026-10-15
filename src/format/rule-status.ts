/**
 * 学校档案里一条规则能下多重的结论（schema v2 提案第 3 节）。
 * 引擎目前还没接这个函数；接上以后，只有 confirmed 才能说"符合学校要求"或"不符合学校要求"。
 */

import type { SchoolProfile } from './profile'

/**
 * confirmed：已确认的硬性要求，经人工复核、出自学校强制文件或模板、没有冲突、适用于这名学生
 * advisory：一般建议，只能说"与学校文件写法不一致，建议核对"
 * unknown：目前无法判断，请学生按学院通知自己核对
 */
export type RuleStatus = 'confirmed' | 'advisory' | 'unknown'

export interface StudentContext {
  /** 学生选的学院；没选为 null */
  department?: string | null
  cohort?: number | null
}

/** 取 JSON Pointer 指向的值；不存在返回 undefined */
export function valueAt(data: unknown, pointer: string): unknown {
  let cur: unknown = data
  for (const key of pointer.slice(1).split('/').map((k) => k.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    if (cur === null || typeof cur !== 'object' || !(key in cur)) return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

export function ruleStatus(profile: SchoolProfile, pointer: string, student: StudentContext = {}): RuleStatus {
  const value = valueAt(profile, pointer)
  if (value === null || value === undefined) return 'unknown'
  // 冲突记在本字段或它的上级、下级字段上，都算这条规则有争议
  const related = (p: string) => p === pointer || p.startsWith(`${pointer}/`) || pointer.startsWith(`${p}/`)
  if ((profile.conflicts ?? []).some((c) => related(c.path))) return 'unknown'

  const scope = profile.scope
  if (scope?.cohorts?.length && student.cohort != null && !scope.cohorts.includes(student.cohort)) return 'unknown'
  if (scope?.departments?.length) {
    if (!student.department) return 'unknown'
    if (!scope.departments.includes(student.department)) return 'unknown'
  }

  const p = profile.provenance?.[pointer]
  if (!p) return 'advisory'
  if (p.check === 'manual' || p.review === 'disputed') return 'unknown'
  if (p.review !== 'reviewed') return 'advisory'
  if (p.authority === 'school_mandatory' || p.authority === 'school_template') return 'confirmed'
  // 学院、专业的要求，只有学生选了学院才算数
  if ((p.authority === 'department_notice' || p.authority === 'major_requirement') && student.department) return 'confirmed'
  return 'advisory'
}
