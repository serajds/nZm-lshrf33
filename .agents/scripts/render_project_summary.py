from pathlib import Path

import fitz


PDF_PATH = Path(
    "attached_assets/ملخص_حالة_المشروع_—_مشروع_برج_زهو_مصراتة_الاستثماري_1787391845556.pdf"
)
OUTPUT_DIR = Path(".agents/outputs/project-summary-review")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    document = fitz.open(PDF_PATH)
    text_pages: list[str] = []

    for index, page in enumerate(document):
        pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        pixmap.save(OUTPUT_DIR / f"page-{index + 1}.png")
        text_pages.append(f"--- الصفحة {index + 1} ---\n{page.get_text('text')}")

    (OUTPUT_DIR / "extracted-text.txt").write_text("\n\n".join(text_pages), encoding="utf-8")
    print(f"Rendered {document.page_count} pages to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()