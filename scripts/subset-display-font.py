"""把思源宋体 Heavy 裁成只含页面标题用字的小文件：src/ui/fonts/noto-serif-sc-900-display.woff2

标题（index.html 里的 h1、h2，以及脚本生成的"体检报告"和"条文献"）改字后要重跑：
  pip install fonttools brotli
  npm i --no-save @fontsource/noto-serif-sc
  python3 scripts/subset-display-font.py node_modules/@fontsource/noto-serif-sc/files
缺字时浏览器会退回系统宋体，不会显示方块，但字形会不一致。
"""
import glob, html, os, re, sys, tempfile
from fontTools import subset
from fontTools.merge import Merger
from fontTools.ttLib import TTFont

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src_dir = sys.argv[1]
page = open(os.path.join(root, 'index.html'), encoding='utf-8').read()
text = ''.join(re.findall(r'<h[12][^>]*>(.*?)</h[12]>', page, re.S)) + '体检报告条文献'
text = re.sub(r'<[^>]+>', '', html.unescape(text))
need = {ord(c) for c in text if ord(c) > 0x2e80}

parts = []
tmp = tempfile.mkdtemp()
for f in sorted(glob.glob(os.path.join(src_dir, '*-900-normal.woff2'))):
    font = TTFont(f)
    have = need & set(font.getBestCmap())
    if not have:
        continue
    opts = subset.Options()
    opts.flavor = None
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=have)
    sub.subset(font)
    out = os.path.join(tmp, f'{len(parts)}.ttf')
    font.flavor = None
    font.save(out)
    parts.append(out)
    need -= have

merged = Merger().merge(parts)
merged.flavor = 'woff2'
dest = os.path.join(root, 'src/ui/fonts/noto-serif-sc-900-display.woff2')
merged.save(dest)
print(f'{dest}: {os.path.getsize(dest)} bytes, chunks {len(parts)}, missing {"".join(map(chr, sorted(need))) or "none"}')
