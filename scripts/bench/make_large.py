"""
生成一篇"大而真实"的虚构论文，用于格式体检的性能测试（不提交生成的 docx）。

    python3 scripts/bench/make_large.py [输出路径]

约 80 页：6 章、约 4 万汉字正文、60 张随机噪声 PNG（每张 150–300 KB，几乎不可压缩）、
20 张表格、80 条参考文献（正文带 [n] 引用）。需要 python-docx。
"""

import io
import random
import struct
import sys
import zlib
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("large.docx")
rng = random.Random(20261011)

CHARS = "研究方法数据分析模型结果表明本文提出一种基于深度学习的框架实验验证了其有效性在多个公开数据集上取得较好性能同时讨论局限与未来工作理论意义实践价值系统设计实现评估指标准确率召回率显著提升相关工作综述问题定义算法流程复杂度"


def noise_png(target_bytes: int) -> bytes:
    side = int((target_bytes / 3) ** 0.5)
    raw = b"".join(b"\x00" + rng.randbytes(side * 3) for _ in range(side))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", side, side, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")


def sentence(n_refs: int) -> str:
    s = "".join(rng.choice(CHARS) for _ in range(rng.randint(25, 45)))
    if rng.random() < 0.35:
        s += f"[{rng.randint(1, n_refs)}]"
    return s + "。"


def word_like_para(doc, sentences):
    """像 Word 存出来的那样：每句一个 run，带完整 rPr 和 rsid，偶尔夹 proofErr/书签。
    python-docx 默认产物的 document.xml 比真实论文小一个数量级，这样更接近真实体积。"""
    p = doc.add_paragraph()
    p._p.set(qn("w:rsidR"), f"{rng.getrandbits(32):08X}")
    p._p.set(qn("w:rsidRDefault"), f"{rng.getrandbits(32):08X}")
    for s in sentences:
        for piece in (s[: len(s) // 2], s[len(s) // 2 :]):
            if rng.random() < 0.1:
                pe = OxmlElement("w:proofErr")
                pe.set(qn("w:type"), "gramStart")
                p._p.append(pe)
            r = p.add_run(piece)
            r._r.set(qn("w:rsidR"), f"{rng.getrandbits(32):08X}")
            rpr = r._r.get_or_add_rPr()
            for tag, attrs in (
                ("w:rFonts", {"w:ascii": "Times New Roman", "w:hAnsi": "Times New Roman", "w:eastAsia": "宋体", "w:cs": "Times New Roman", "w:hint": "eastAsia"}),
                ("w:kern", {"w:val": "0"}),
                ("w:sz", {"w:val": "24"}),
                ("w:szCs", {"w:val": "24"}),
                ("w:lang", {"w:val": "en-US", "w:eastAsia": "zh-CN", "w:bidi": "ar-SA"}),
            ):
                el = OxmlElement(tag)
                for k, v in attrs.items():
                    el.set(qn(k), v)
                rpr.append(el)
    return p


def set_font(style, cn, en, size):
    style.font.name = en
    style.font.size = Pt(size)
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = rpr.makeelement(qn("w:rFonts"), {})
        rpr.insert(0, rfonts)
    rfonts.set(qn("w:eastAsia"), cn)


def build():
    N_REFS, N_IMG, N_TAB, CHAPTERS = 80, 60, 20, 6
    doc = Document()
    for s in doc.sections:
        s.top_margin = s.bottom_margin = Cm(2.5)
        s.left_margin, s.right_margin = Cm(3.0), Cm(2.5)
    set_font(doc.styles["Normal"], "宋体", "Times New Roman", 12)
    for lvl, size in ((1, 16), (2, 14), (3, 12)):
        set_font(doc.styles[f"Heading {lvl}"], "黑体", "Times New Roman", size)

    doc.add_heading("摘  要", level=1)
    doc.add_paragraph("".join(sentence(N_REFS) for _ in range(12)))
    doc.add_page_break()

    img_slots = sorted(rng.sample(range(CHAPTERS * 4 * 6), N_IMG))
    tab_slots = set(rng.sample(range(CHAPTERS * 4 * 6), N_TAB))
    slot, fig_no, tab_no, chars = 0, 0, 0, 0
    img_set = set(img_slots)
    cn_num = "一二三四五六"
    for ch in range(CHAPTERS):
        doc.add_heading(f"第{cn_num[ch]}章 研究内容{ch + 1}", level=1)
        for sec in range(4):
            doc.add_heading(f"{ch + 1}.{sec + 1} 小节标题{sec + 1}", level=2)
            for k in range(6):
                if k == 3:
                    doc.add_heading(f"{ch + 1}.{sec + 1}.1 细节", level=3)
                sents = [sentence(N_REFS) for _ in range(7)]
                chars += sum(map(len, sents))
                p = word_like_para(doc, sents)
                p.paragraph_format.first_line_indent = Cm(0.74)
                if slot in img_set:
                    fig_no += 1
                    ip = doc.add_paragraph()
                    ip.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    ip.add_run().add_picture(io.BytesIO(noise_png(rng.randint(150_000, 300_000))), width=Cm(8))
                    cp = doc.add_paragraph(f"图{ch + 1}-{fig_no} 实验结果示意")
                    cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
                if slot in tab_slots:
                    tab_no += 1
                    cp = doc.add_paragraph(f"表{ch + 1}-{tab_no} 实验数据对比")
                    cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    t = doc.add_table(rows=8, cols=5)
                    t.style = "Table Grid"
                    for r in range(8):
                        for c in range(5):
                            t.cell(r, c).text = "指标" if r == 0 else f"{rng.random():.3f}"
                slot += 1
        doc.add_page_break()

    doc.add_heading("参考文献", level=1)
    for i in range(1, N_REFS + 1):
        if i % 2:
            doc.add_paragraph(f"[{i}] 张{CHARS[i % 40]}, 李{CHARS[(i * 7) % 40]}. 关于某问题的研究{i}[J]. 某某学报, {2000 + i % 25}, {i % 12 + 1}({i % 4 + 1}): {i}-{i + 9}.")
        else:
            doc.add_paragraph(f"[{i}] Smith J, Doe A. A study of topic {i}[J]. Journal of Things, {2000 + i % 25}, {i}(3): {i * 3}-{i * 3 + 12}.")
    doc.add_heading("致  谢", level=1)
    doc.add_paragraph("".join(sentence(N_REFS) for _ in range(5)))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(OUT)
    import zipfile

    xml_kb = zipfile.ZipFile(OUT).getinfo("word/document.xml").file_size // 1024
    print(f"{OUT}: {OUT.stat().st_size / 1e6:.1f} MB, document.xml {xml_kb} KB, body chars≈{chars}, figures={fig_no}, tables={tab_no}, refs={N_REFS}")


if __name__ == "__main__":
    build()
