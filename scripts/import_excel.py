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

from openpyxl import load_workbook


SHEET_NAME = "樊登读书APP每周书籍"
TITLE_COL = 3
COVER_COLUMNS = {
    11: ("custom", "flat", "custom_flat"),
    9: ("original", "flat", "original_flat"),
    10: ("original", "threeD", "original_3d"),
    7: ("fallback", "flat", "fallback_flat"),
}


def clean_text(value):
    if value is None:
        return ""
    return str(value).strip()


def clean_title(value):
    title = clean_text(value)
    title = re.sub(r"^[《<〈\s]+|[》>〉\s]+$", "", title)
    return re.sub(r"\s+", " ", title).strip()


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


def preview_card(book):
    actual = resolve_actual_version(book)
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

    return f"""
    <article class="book-card {html.escape(actual)}">
      <header>
        <h2>{html.escape(book["title"])}</h2>
        <span>实际展示版本：{version_label(actual)}</span>
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
    cards = "\n".join(preview_card(book) for book in books)
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
      background: #f6f7f9;
      color: #20242a;
    }}
    body {{
      margin: 0;
      padding: 24px;
    }}
    h1 {{
      margin: 0 0 12px;
      font-size: 24px;
    }}
    .summary {{
      white-space: pre-wrap;
      background: #fff;
      border: 1px solid #d9dee7;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 20px;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 16px;
    }}
    .book-card {{
      background: #fff;
      border: 1px solid #d9dee7;
      border-radius: 8px;
      padding: 14px;
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
    .book-card span {{
      flex: 0 0 auto;
      font-size: 12px;
      color: #475467;
      background: #eef2f6;
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
      color: #667085;
      margin-bottom: 6px;
    }}
    img {{
      display: block;
      width: 100%;
      aspect-ratio: 2 / 3;
      object-fit: contain;
      background: #f1f3f6;
      border: 1px solid #e1e6ef;
      border-radius: 6px;
    }}
    .missing {{
      display: grid;
      place-items: center;
      width: 100%;
      aspect-ratio: 2 / 3;
      background: #f1f3f6;
      border: 1px dashed #bcc6d3;
      border-radius: 6px;
      color: #8a94a6;
      font-size: 13px;
    }}
    .custom {{ border-left: 4px solid #0f766e; }}
    .original {{ border-left: 4px solid #2563eb; }}
    .fallback {{ border-left: 4px solid #d97706; }}
    .noCover {{ border-left: 4px solid #b42318; }}
  </style>
</head>
<body>
  <h1>书封导入核对</h1>
  <div class="summary">{summary}</div>
  <main class="grid">{cards}</main>
</body>
</html>
"""


def convert(excel_path, output_dir):
    output_dir = Path(output_dir)
    data_dir = output_dir
    covers_dir = data_dir / "covers"
    if covers_dir.exists():
        shutil.rmtree(covers_dir)
    covers_dir.mkdir(parents=True, exist_ok=True)

    workbook = load_workbook(excel_path, read_only=False, data_only=True)
    worksheet = workbook[SHEET_NAME] if SHEET_NAME in workbook.sheetnames else workbook.worksheets[0]

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
    today = date.today().isoformat()

    for row in range(2, worksheet.max_row + 1):
        title = clean_title(worksheet.cell(row, TITLE_COL).value)
        if not title:
            has_content = any(clean_text(worksheet.cell(row, col).value) for col in range(1, 15))
            if has_content:
                blank_title_rows.append(row)
            continue

        book_id = slug_id(len(books) + 1)
        book = {
            "id": book_id,
            "title": title,
            "preferredVersion": "auto",
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

    report = {
        "summary": {
            "source": str(excel_path),
            "sheet": worksheet.title,
            "generatedAt": today,
            "bookCount": len(books),
            "blankTitleRows": len(blank_title_rows),
            "duplicateTitleCount": len(duplicate_titles),
            "missingCoverCount": len(missing_covers),
            "actualVersionCounts": dict(actual_counts),
        },
        "blankTitleRows": blank_title_rows,
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
