#!/usr/bin/env python3
import argparse
import copy
import html
import json
import re
import shutil
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

SHEET_NAME = "樊登读书APP每周书籍"
TITLE_COL = 3
STATUS_COL = 13
COVER_COLUMNS = {
    11: ("custom", "flat", "custom_flat"),
    9: ("original", "flat", "original_flat"),
    10: ("original", "threeD", "original_3d"),
    7: ("fallback", "flat", "fallback_flat"),
}
OFFLINE_KEYWORDS = ["下线", "下架", "已下", "停用", "不可用"]
PREFER_ORIGINAL_KEYWORD = "优先使用原版书封"


def clean_text(value):
    if value is None:
        return ""
    return str(value).strip()


def clean_title(value):
    title = clean_text(value)
    title = re.sub(r"^[《<〈\s]+|[》>〉\s]+$", "", title)
    return re.sub(r"\s+", " ", title).strip()


def resolve_status(value):
    text = clean_text(value)
    return "offline" if any(keyword in text for keyword in OFFLINE_KEYWORDS) else "active"


def resolve_preferred_version(note):
    compact = re.sub(r"\s+", "", clean_text(note))
    return "original" if PREFER_ORIGINAL_KEYWORD in compact else "auto"


def slug_id(index):
    return f"book_{index:03d}"


def image_extension(image):
    path = getattr(image, "path", "") or ""
    suffix = Path(path).suffix.lower()
    if suffix in [".jpg", ".jpeg", ".png", ".webp", ".gif"]:
        return ".jpg" if suffix == ".jpeg" else suffix
    fmt = (getattr(image, "format", "") or "").lower()
    if fmt in ["jpeg", "jpg"]:
        return ".jpg"
    if fmt in ["png", "webp", "gif"]:
        return f".{fmt}"
    return ".jpg"


def image_anchor(image):
    anchor = getattr(image, "anchor", None)
    if not anchor:
        return None
    try:
        return anchor._from.row + 1, anchor._from.col + 1
    except Exception:
        return None


def extract_image_bytes(image):
    image_copy = copy.copy(image)
    return image_copy._data()


def write_image(image, output_path):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(extract_image_bytes(image))


def resolve_actual_version(book):
    covers = book["covers"]
    preferred = book.get("preferredVersion", "auto")
    if preferred in ["custom", "original", "fallback"]:
        return preferred if covers[preferred]["flat"] else "noCover"
    if covers["custom"]["flat"]:
        return "custom"
    if covers["original"]["flat"]:
        return "original"
    if covers["fallback"]["flat"]:
        return "fallback"
    return "noCover"


def rel_img(path):
    if not path:
        return ""
    return path.replace("\\", "/")


def preview_card(book, duplicate_titles):
    actual = resolve_actual_version(book)
    status = book.get("status", "active")
    covers = book["covers"]
    cells = []
    columns = [
        ("自制平封", covers["custom"]["flat"]),
        ("原版平封", covers["original"]["flat"]),
        ("原版立封", covers["original"]["threeD"]),
        ("普通平封", covers["fallback"]["flat"]),
    ]
    for label, path in columns:
        if path:
            img = f'<img src="{html.escape(path)}" alt="{html.escape(label)}">'
        else:
            img = '<div class="missing">缺失</div>'
        cells.append(f"<div class='cover-cell'><div class='label'>{html.escape(label)}</div>{img}</div>")

    duplicate = book["title"] in duplicate_titles
    duplicate_badge = '<strong class="dup-badge">重复书名</strong>' if duplicate else ""
    filters = ["all", actual]
    if actual == "noCover":
        filters.append("missing")
    if duplicate:
        filters.append("duplicate")
    if status == "offline":
        filters.append("offline")

    return f"""
    <article class="book-card {html.escape(actual)}" data-filters="{' '.join(filters)}">
      <header>
        <h2>{html.escape(book["title"])}{duplicate_badge}</h2>
        <span class="actual">当前实际展示：{version_label(actual)} · {"已下架" if status == "offline" else "正常"}</span>
      </header>
      <div class="covers">{''.join(cells)}</div>
    </article>
    """


def version_label(version):
    return {
        "custom": "自制版",
        "original": "原版",
        "fallback": "普通版",
        "noCover": "缺封面",
    }.get(version, version)


def build_preview_html(books, report):
    duplicate_titles = {item["title"] for item in report.get("duplicateTitles", [])}
    cards = "\n".join(preview_card(book, duplicate_titles) for book in books)
    summary = html.escape(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>书封导入核对</title>
  <style>
    :root {{
      color-scheme: light;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      background: #f3efe7;
      color: #25221d;
    }}
    body {{
      margin: 0;
      padding: 24px;
      background: repeating-linear-gradient(0deg, rgba(117, 94, 62, 0.035) 0 1px, transparent 1px 32px);
    }}
    h1 {{
      margin: 0 0 12px;
      font-size: 24px;
    }}
    .summary {{
      white-space: pre-wrap;
      background: #fffdf8;
      border: 1px solid #e2d8ca;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
    }}
    .filters {{
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin: 0 0 18px;
    }}
    button {{
      border: 1px solid #e2d8ca;
      border-radius: 999px;
      background: #fffdf8;
      padding: 8px 12px;
      cursor: pointer;
    }}
    button.active {{
      border-color: #116a5b;
      color: #116a5b;
      background: #edf8f5;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(390px, 1fr));
      gap: 16px;
    }}
    .book-card {{
      background: #fffdf8;
      border: 1px solid #e2d8ca;
      border-radius: 8px;
      padding: 14px;
      box-shadow: 0 12px 28px rgba(78, 58, 34, 0.1);
    }}
    .book-card header {{
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }}
    .book-card h2 {{
      margin: 0;
      font-size: 17px;
      line-height: 1.35;
    }}
    .book-card .actual {{
      flex: 0 0 auto;
      font-size: 12px;
      color: #51483c;
      background: #f7f1e8;
      border-radius: 999px;
      padding: 4px 8px;
    }}
    .covers {{
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }}
    .cover-cell {{
      min-width: 0;
    }}
    .label {{
      font-size: 12px;
      color: #746f66;
      margin-bottom: 6px;
    }}
    img {{
      display: block;
      width: 100%;
      aspect-ratio: 2 / 3;
      object-fit: contain;
      background: #f5ecdf;
      border: 1px solid #e2d8ca;
      border-radius: 6px;
    }}
    .missing {{
      display: grid;
      place-items: center;
      width: 100%;
      aspect-ratio: 2 / 3;
      background: #f5ecdf;
      border: 1px dashed #c9bba8;
      border-radius: 6px;
      color: #9a8d7b;
      font-size: 13px;
    }}
    .dup-badge {{
      display: inline-flex;
      margin-left: 8px;
      padding: 3px 7px;
      border-radius: 999px;
      color: #b42318;
      background: #fff1ee;
      font-size: 12px;
      vertical-align: middle;
    }}
    .custom {{ border-left: 4px solid #0f766e; }}
    .original {{ border-left: 4px solid #2563eb; }}
    .fallback {{ border-left: 4px solid #d97706; }}
    .noCover {{ border-left: 4px solid #b42318; }}
    .book-card.hidden {{ display: none; }}
  </style>
</head>
<body>
  <h1>书封导入核对</h1>
  <div class="summary">{summary}</div>
  <div class="filters">
    <button class="active" data-filter="all">全部</button>
    <button data-filter="missing">缺封面</button>
    <button data-filter="duplicate">重复书名</button>
    <button data-filter="offline">已下架</button>
    <button data-filter="custom">自制版</button>
    <button data-filter="original">原版</button>
    <button data-filter="fallback">普通版</button>
  </div>
  <main class="grid">{cards}</main>
  <script>
    const buttons = Array.from(document.querySelectorAll("button[data-filter]"));
    const cards = Array.from(document.querySelectorAll(".book-card"));
    buttons.forEach(button => button.addEventListener("click", () => {{
      buttons.forEach(item => item.classList.toggle("active", item === button));
      const filter = button.dataset.filter;
      cards.forEach(card => {{
        card.classList.toggle("hidden", !card.dataset.filters.split(" ").includes(filter));
      }});
    }}));
  </script>
</body>
</html>
"""


def convert(excel_path, output_dir):
    from openpyxl import load_workbook

    output_dir = Path(output_dir)
    data_dir = output_dir
    covers_dir = data_dir / "covers"
    if covers_dir.exists():
        shutil.rmtree(covers_dir)
    covers_dir.mkdir(parents=True, exist_ok=True)

    workbook = load_workbook(excel_path, read_only=False, data_only=True)
    sheet_warning = ""
    if SHEET_NAME in workbook.sheetnames:
        worksheet = workbook[SHEET_NAME]
    else:
        worksheet = workbook.worksheets[0]
        sheet_warning = f"警告：未找到指定 sheet「{SHEET_NAME}」，实际使用第一个 sheet「{worksheet.title}」。"

    images_by_cell = defaultdict(list)
    ignored_images = []
    for index, image in enumerate(getattr(worksheet, "_images", []), 1):
        anchor = image_anchor(image)
        if not anchor:
            ignored_images.append({"imageIndex": index, "reason": "missing anchor"})
            continue
        images_by_cell[anchor].append(image)

    books = []
    row_reports = []
    blank_title_rows = []
    skipped_empty_rows = []
    today = date.today().isoformat()

    for row in range(2, worksheet.max_row + 1):
        title = clean_title(worksheet.cell(row, TITLE_COL).value)
        if not title:
            has_content = any(clean_text(worksheet.cell(row, col).value) for col in range(1, 15))
            if has_content:
                blank_title_rows.append(row)
            else:
                skipped_empty_rows.append(row)
            continue

        book_id = slug_id(len(books) + 1)
        note = clean_text(worksheet.cell(row, STATUS_COL).value)
        book = {
            "id": book_id,
            "title": title,
            "note": note,
            "status": resolve_status(note),
            "preferredVersion": resolve_preferred_version(note),
            "covers": {
                "custom": {"flat": "", "threeD": ""},
                "original": {"flat": "", "threeD": ""},
                "fallback": {"flat": "", "threeD": ""},
            },
            "createdAt": today,
            "updatedAt": today,
        }

        extracted = {}
        multiple_images = []
        for col, (version, slot, suffix) in COVER_COLUMNS.items():
            images = images_by_cell.get((row, col), [])
            if not images:
                continue
            if len(images) > 1:
                multiple_images.append({"column": col, "count": len(images)})
            image = images[0]
            extension = image_extension(image)
            filename = f"{book_id}_{suffix}{extension}"
            output_path = covers_dir / filename
            write_image(image, output_path)
            book["covers"][version][slot] = rel_img(f"covers/{filename}")
            extracted[f"{version}.{slot}"] = rel_img(f"covers/{filename}")

        books.append(book)
        row_reports.append({
            "row": row,
            "id": book_id,
            "title": title,
            "note": book["note"],
            "status": book["status"],
            "actualVersion": resolve_actual_version(book),
            "covers": extracted,
            "multipleImagesInCell": multiple_images,
        })

    title_counts = Counter(book["title"] for book in books)
    duplicate_titles = [
        {"title": title, "count": count, "ids": [book["id"] for book in books if book["title"] == title]}
        for title, count in title_counts.items()
        if count > 1
    ]
    missing_covers = [
        {"id": book["id"], "title": book["title"]}
        for book in books
        if resolve_actual_version(book) == "noCover"
    ]
    actual_counts = Counter(resolve_actual_version(book) for book in books)
    offline_count = sum(1 for book in books if book.get("status", "active") == "offline")

    report = {
        "summary": {
            "source": str(excel_path),
            "requestedSheet": SHEET_NAME,
            "usedSheet": worksheet.title,
            "sheetWarning": sheet_warning,
            "generatedAt": today,
            "columnMapping": {
                "title": "C列：书籍名称",
                "covers.custom.flat": "K列：自制书封（平封）",
                "covers.original.flat": "I列：原版书封（平封）",
                "covers.original.threeD": "J列：原版书封（立体封）",
                "covers.fallback.flat": "G列：平封",
            },
            "importedCount": len(books),
            "missingCoverCount": len(missing_covers),
            "duplicateTitleCount": len(duplicate_titles),
            "offlineCount": offline_count,
            "skippedEmptyRowCount": len(skipped_empty_rows),
            "blankTitleWithContentRowCount": len(blank_title_rows),
            "actualVersionCounts": dict(actual_counts),
        },
        "blankTitleRows": blank_title_rows,
        "skippedEmptyRows": skipped_empty_rows,
        "duplicateTitles": duplicate_titles,
        "missingCovers": missing_covers,
        "ignoredImages": ignored_images,
        "rows": row_reports,
    }

    (data_dir / "books.json").write_text(json.dumps(books, ensure_ascii=False, indent=2), encoding="utf-8")
    (data_dir / "import-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (data_dir / "import-preview.html").write_text(build_preview_html(books, report), encoding="utf-8")

    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Import book covers from Excel embedded images.")
    parser.add_argument("excel", help="Path to the source .xlsx file")
    parser.add_argument("--out", default="data", help="Output data directory")
    args = parser.parse_args()
    convert(Path(args.excel), Path(args.out))


if __name__ == "__main__":
    main()
