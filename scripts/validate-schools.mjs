// 校验 schools/ 下所有规则档案是否符合 schema.json
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import Ajv from 'ajv/dist/2020.js'
import { parse } from 'yaml'

const root = new URL('../schools/', import.meta.url).pathname
const schema = JSON.parse(readFileSync(join(root, 'schema.json'), 'utf8'))
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema)

let failed = 0
for (const dir of readdirSync(root)) {
  const full = join(root, dir)
  if (!statSync(full).isDirectory()) continue
  for (const file of readdirSync(full).filter((f) => f.endsWith('.yaml'))) {
    const data = parse(readFileSync(join(full, file), 'utf8'))
    const rel = `schools/${dir}/${file}`
    const problems = []
    if (!validate(data)) problems.push(...validate.errors.map((e) => `${e.instancePath || '/'} ${e.message}`))
    if (dir !== '_template' && data?.school?.code !== dir) problems.push(`school.code 应与目录名 ${dir} 一致`)
    if (problems.length) {
      failed++
      console.error(`✗ ${rel}\n  ${problems.join('\n  ')}`)
    } else console.log(`✓ ${rel}`)
  }
}
process.exit(failed ? 1 : 0)
