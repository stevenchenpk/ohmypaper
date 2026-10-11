// 检查离线版：不应再引用本地相对文件（script src / link href / img src / url()），并报告体积
import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const file = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist-offline/ohmypaper-offline.html')
const html = readFileSync(file, 'utf8')
const problems = []

for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) problems.push(`<script src="${m[1]}">`)
for (const m of html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["']/gi)) {
  if (!/^(data:|#)/.test(m[1])) problems.push(`<link href="${m[1].slice(0, 60)}">`)
}
for (const m of html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
  if (!/^data:/.test(m[1])) problems.push(`<img src="${m[1].slice(0, 60)}">`)
}
for (const m of html.matchAll(/url\(\s*["']?([^)"']+)["']?\s*\)/gi)) {
  if (!/^(data:|#)/.test(m[1])) problems.push(`url(${m[1].slice(0, 60)})`)
}
if (!html.includes('id="refs"')) problems.push('缺少 #refs 文本框')
if (!/<script type="module">/.test(html)) problems.push('缺少内联脚本')

const size = statSync(file).size
console.log(`体积：${(size / 1024).toFixed(1)} KB（${size} 字节）`)
if (problems.length) {
  console.error('离线版检查失败：\n  ' + problems.join('\n  '))
  process.exit(1)
}
console.log('离线版检查通过：无外部相对文件引用。')
