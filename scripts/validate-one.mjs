// 校验单个档案文件：node scripts/validate-one.mjs <file.yaml>
import { readFileSync } from 'node:fs'
import Ajv from 'ajv/dist/2020.js'
import { parse } from 'yaml'
const schema = JSON.parse(readFileSync(new URL('../schools/schema.json', import.meta.url), 'utf8'))
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema)
let failed = 0
for (const f of process.argv.slice(2)) {
  const ok = validate(parse(readFileSync(f, 'utf8')))
  if (ok) console.log(`✓ ${f}`)
  else { failed++; console.error(`✗ ${f}\n  ${validate.errors.map((e) => `${e.instancePath || '/'} ${e.message}`).join('\n  ')}`) }
}
process.exit(failed ? 1 : 0)
