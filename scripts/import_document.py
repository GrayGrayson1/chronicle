import json
from pathlib import Path
import sys

path = Path(sys.argv[1])
if path.stat().st_size > 10 * 1024 * 1024:
    raise ValueError("Document limit: 10 MB")
if path.suffix.lower() == ".pdf":
    from pypdf import PdfReader
    text = "\n\n".join(page.extract_text() or "" for page in PdfReader(path).pages)
elif path.suffix.lower() == ".docx":
    from docx import Document
    document = Document(path)
    text = "\n".join(p.text for p in document.paragraphs)
    text += "\n" + "\n".join(" | ".join(c.text for c in row.cells) for table in document.tables for row in table.rows)
elif path.suffix.lower() in [".txt", ".md"]:
    text = path.read_text(encoding="utf-8-sig")
else:
    raise ValueError("Supported: PDF, DOCX, TXT, MD")
print(json.dumps({"text": text[:500000]}))
