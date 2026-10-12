// 生成单文件离线版：dist-offline/ohmypaper-offline.html
// 用法：npm run build:offline（先 vite build，再把 CSS/JS/小图片内联）
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const outDir = resolve(root, 'dist-offline')
const outFile = resolve(outDir, 'ohmypaper-offline.html')

if (!process.argv.includes('--no-build')) {
  execSync('npx vite build', { cwd: root, stdio: 'inherit' })
}

const MIME = {
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
}
const MAX_INLINE = 64 * 1024 // 小资源才内联为 data URI

const read = (rel) => readFileSync(resolve(dist, rel.replace(/^\.?\//, '')))
const dataUri = (rel) => {
  const buf = read(rel)
  const mime = MIME[extname(rel).toLowerCase()]
  if (!mime || buf.length > MAX_INLINE) throw new Error(`无法内联资源：${rel}`)
  return `data:${mime};base64,${buf.toString('base64')}`
}
// 防止内联内容提前结束标签
const safeScript = (s) => s.replace(/<\/(script)/gi, '<\\/$1')
const safeStyle = (s) => s.replace(/<\/(style)/gi, '<\\/$1')

let html = readFileSync(resolve(dist, 'index.html'), 'utf8')

// <link rel="stylesheet" href="./assets/x.css">
html = html.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g, (tag) => {
  const href = /href="([^"]+)"/.exec(tag)?.[1]
  if (!href || /^https?:/.test(href)) return tag
  let css = read(href).toString('utf8')
  // CSS 里的 url(...) 小图片转 data URI
  css = css.replace(/url\((['"]?)(?!data:|https?:|#)([^)'"]+)\1\)/g, (_m, _q, p) =>
    `url(${dataUri('assets/' + p.replace(/^\.\//, ''))})`)
  return `<style>\n${safeStyle(css)}\n</style>`
})

// <script type="module" src="./assets/x.js">
html = html.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, (tag, src) => {
  if (/^https?:/.test(src)) return tag
  const js = read(src).toString('utf8')
  return `<script type="module">\n${safeScript(js)}\n</script>`
})

// <link rel="icon" href=...> 等小图标
html = html.replace(/<link\b[^>]*rel="(?:icon|shortcut icon|apple-touch-icon)"[^>]*>/g, (tag) =>
  tag.replace(/href="([^"]+)"/, (m, href) => (/^(https?:|data:)/.test(href) ? m : `href="${dataUri(href)}"`)))
// <img src="./x.png">
html = html.replace(/(<img\b[^>]*\bsrc=")([^"]+)(")/g, (m, a, src, c) =>
  /^(https?:|data:)/.test(src) ? m : `${a}${dataUri(src)}${c}`)

mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, html)
const kb = (statSync(outFile).size / 1024).toFixed(1)
console.log(`离线版已生成：${outFile}（${kb} KB）`)

if (!process.argv.includes('--no-check')) {
  execSync(`node ${JSON.stringify(resolve(root, 'scripts/check-offline.mjs'))}`, { stdio: 'inherit' })
}
