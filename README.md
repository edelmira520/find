# 书封素材工作台

这是一个本地 Node 版书封资料库工作台。Excel 只用于初始化或重建历史资料，日常查找和维护都使用本地 `data/books.json` 和 `data/covers/`。

当前版本适合每天做 10 本左右书封核对：粘贴文本后自动识别书名，结果以封面墙展示；资料维护页提供素材库列表和四个封面位编辑。

## 一键启动

```bash
./start.sh
```

或手动启动：

```bash
node server.js
```

打开：

```text
http://localhost:4173
```

## 当前形态

- 当前是 Node 本地版原型，数据直接写入本机文件。
- 每次保存 `books.json` 前，会自动备份到 `data/backups/books-YYYYMMDD-HHMMSS.json`。
- 后续长期使用建议封装为 Tauri 桌面应用，保留本地文件数据，同时获得更自然的文件选择、托盘启动和桌面更新体验。

## 初始化导入

```bash
python3 scripts/import_excel.py "/Users/heyeping/Downloads/樊登讲书-书籍封面.xlsx" --out data
```

生成内容：

```text
data/
  books.json
  covers/
  import-report.json
  import-preview.html
```

`import-preview.html` 用来人工核对封面是否错配，支持筛选：全部、缺封面、重复书名、自制版、原版、普通版。

## Excel 映射

| 工具字段 | Excel 来源 |
|---|---|
| `title` | `C列：书籍名称` |
| `covers.custom.flat` | `K列：自制书封（平封）` |
| `covers.original.flat` | `I列：原版书封（平封）` |
| `covers.original.threeD` | `J列：原版书封（立体封）` |
| `covers.fallback.flat` | `G列：平封` |

保留按 Excel 内嵌图片 anchor 提取图片的逻辑。若找不到指定 sheet，导入报告会明显警告，并记录实际使用的 sheet。

## 展示规则

`preferredVersion` 支持：

```text
auto / custom / original / fallback
```

`auto` 默认按以下顺序解析：

```text
custom > original > fallback
```

如果有自制平封，只展示自制平封，不搭配原版立封，避免错配。若手动选择的版本没有平面封面，维护页会给出警告。

## 日常使用

1. 打开查找页。
2. 粘贴包含多本书名的文本，系统会自动识别。
3. 在书名标签中删除、修改或手动新增。
4. 点击动态按钮，例如“匹配 10 本”。
5. 用“显示全部 / 只看待确认 / 只看未找到”筛选封面墙。
6. 未找到时点击“新增这本书”，保存后会自动回到当前查询并更新为已匹配。

## 每周维护

进入“资料维护”页：

- 左侧列表查看缩略图、当前实际展示版本和是否有立体封。
- 右侧编辑自制平封、原版平封、原版立封、普通平封。
- 每个封面位支持拖拽图片、点击选择图片、输入图片链接和清空。
- “批量草稿”可以一次粘贴多本新书名，生成待补封面的新增记录。

删除书籍时会二次确认，并清理该书不再被任何记录引用的本地封面文件；外链不会删除。
