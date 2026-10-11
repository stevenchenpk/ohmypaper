import { defineConfig } from 'vite'

export default defineConfig({
  // 相对路径，方便部署到 GitHub Pages 子路径和国内镜像
  base: './',
  build: { outDir: 'dist', target: 'es2020' },
})
