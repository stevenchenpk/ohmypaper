# M3 AI 使用声明生成器（给 UI 实现者）

代码：`src/declaration/generate.ts`。纯函数，不碰 DOM，不联网。

## API

```ts
generateDeclaration(dossier: Dossier, policy: AiPolicy | null, opts?: { confirmNone?: boolean }): {
  text: string        // 纯文字，可直接粘贴到承诺书/声明页
  markdown: string    // 含表格（日期、工具及版本、用途、环节/章节、本人如何核实）
  warnings: Warning[] // { kind: 'forbidden' | 'consent', entryId, policyItem, message }
  missing: string[]   // 中文，逐条指向“日期 + 工具”
}
```

`policy` 取自学校数据的 `ai_policy`（`AiPolicy` 类型与 `schools/schema.json` 一致）；学校未选或没有数据时传 `null`。

学校从哪里来：用 `declarationSchool(dossier)`。页面没有单独的档案编辑表单，学校取自格式体检里选的那一项（`dossier.resume.format.schoolPath`，如 `schools/fudan/bachelor-2026.yaml`），用这个路径到 `schools/` 里找对应档案的 `ai_policy`。旧版导出文件里 `profile.school` 有值时只作后备，此时没有路径，`path` 为 `null`，UI 应请学生在格式体检里重新选学校。两处都没有时返回 `null`，`policy` 传 `null`，声明里不附学校要求。

## 行为

- `ai_log` 为空且未传 `confirmNone: true`：`text`、`markdown` 为空串，`missing = ['还没有 AI 使用记录']`。UI 应让学生明确点“我确认没有用过”后再传 `confirmNone: true`，此时输出“本人在论文写作过程中未使用生成式人工智能工具。”。
- 有记录：按用途、环节、日期排序分组；版本、核实方式为空时表格里写“（待补充）”，同时进入 `missing`。学校披露要求里出现“位置/章节”时，章节为空也进入 `missing`。
- `warnings` 只是提示，从不阻止生成。UI 应与声明正文分开展示，不要混进 `text`。
  - 润色→“润色”，翻译→“翻译”，代码→“代码”，写作环节→“正文”，数据环节→“数据”，按子串匹配 `policy.forbidden`。检索、解释类用途不按环节匹配。
  - 同一条记录对同一条禁止项只警告一次。
  - `allowed` 某项同时提到“导师”和“同意”，且记录的用途/环节匹配时，给出 `consent` 提示。
- `policy.disclosure` 存在时，`text` 和 `markdown` 末尾附“本校披露要求（原文）”，逐字引用，并提醒 ohmypaper 没有核实学生是否符合规定。`text` 中该段以分隔线标明“不属于声明正文，粘贴前请删除”，UI 最好把它和声明正文分开展示。
- 结尾固定一句：“本声明根据作者本人记录整理，内容由作者负责。”

## 措辞规则（公开内容，务必遵守）

- 只用学生自己记录的内容拼装，不替学生写“做了什么”。有备注（note）时原样放在条目下。
- 《研究生学位论文 AI 使用指南》第七条列出申报内容（工具、版本、用途、环节、核实），第八条要求“可追溯或可验证依据”。该指南没有模板，也没有“留痕”一词。
  - 不写“按指南模板”，不写“留痕”。
  - 可以写“按指南第七条列出的内容整理”“可验证的依据”。
- 输出里不得出现“留痕”“模板”（`tests/declaration.test.ts` 有检查）。
