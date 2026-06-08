# 书封资料库工具

这是一个本地书封资料库第一版。Excel 只用于初始化历史资料，日常查找和维护都使用本地 `data/books.json` 和 `data/covers/`。

## 初始化

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

`import-preview.html` 用来人工核对封面是否错配。

## 启动工具

```bash
node server.js
```

打开：

```text
http://localhost:4173
```

## 第一版字段

只保留：

- 书名
- 封面资料

不保留：

- 嘉宾
- 作者/讲者
- 年份
- 上线日期
- 标签
- 备注
- 是否授权
- 侧封

## Excel 映射

| 工具字段 | Excel 来源 |
|---|---|
| `title` | `C列：书籍名称` |
| `covers.custom.flat` | `K列：自制书封（平封）` |
| `covers.original.flat` | `I列：原版书封（平封）` |
| `covers.original.threeD` | `J列：原版书封（立体封）` |
| `covers.fallback.flat` | `G列：平封` |

忽略 `F列：嘉宾`、`H列：立体封/侧封`、`L列：自制书封（侧封）`。

## 展示规则

`preferredVersion` 固定为 `auto`，展示时动态计算：

```text
custom > original > fallback
```

如果有自制平封，只展示自制平封，不搭配原版立封。

## 日常使用

1. 打开查找页。
2. 粘贴包含多本书名的文本。
3. 先查看“识别书名预览”，可删除、编辑或补充书名。
4. 点击“开始匹配”。
5. 在结果卡片中查看封面。
6. 未找到时点击“新增这本书”，保存后会回到当前查询并更新卡片。

## 每周新增

进入“资料维护”页，点击“新增书籍”，填写书名，并分别上传：

- 自制平封
- 原版平封
- 原版立封
- 普通平封

本地图片会复制到 `data/covers/`，资料写入 `data/books.json`。
