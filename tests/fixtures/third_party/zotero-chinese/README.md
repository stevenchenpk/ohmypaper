# zotero-chinese/styles 的 GB/T 7714—2025 示例数据（只用于测试）

`gbt7714-2025-examples.json` 由 [zotero-chinese/styles](https://github.com/zotero-chinese/styles) 的两份文件整理而来，取自提交 `cf56b119812c83c91c99606405d7e7861685c3b7`：

- `lib/data/items/gbt7714-data.json`：国标 GB/T 7714—2025 附录中 141 条示例文献的 CSL-JSON，用作期望值（类型、题名、出版年、第一责任者、出处）；
- `src/GB-T-7714—2025（顺序编码，双语）/index.md`：同一批数据按顺序编码制渲染出的文献表，用作解析器的输入。

整理时只去掉了 HTML 标签。

**许可**：这份数据沿用原仓库的 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) 许可，署名 zotero-chinese/styles 贡献者（Zeping Lee 等）。它只被 `tests/gbt7714-2025-examples.test.ts` 读取，不进入构建产物。本仓库其余代码仍是 MIT 许可。
