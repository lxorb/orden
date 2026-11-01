#!/usr/bin/env python3
"""A page note made from a PDF wears the PDF's mark in the file list and on its tab.
#676: it wore the page note's, the same as a page note started blank, so nothing in
the list said which of them was the paper somebody brought in.

Run with Orden up (PDFMARK=1 in scripts/wayland-launch.sh). Two PDFs and a blank page
note are put in the open space, and one of the PDFs is opened, which makes it a page
note holding its paper (pages/from-pdf.ts). Its row and its tab have to wear the mark
the other PDF's row wears, and the blank page note's row has to wear another. Then a
second space is made and opened, and the page note opened from it, in a tab of that
space: the tab has to wear the PDF's mark still, though the list in front is another
space's and says nothing of it.

    python3 scripts/pdf-mark-drive.py <out folder>
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

OUT = Path(sys.argv[1])
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"


def endpoint():
    for _ in range(120):
        try:
            kept = json.loads((CONFIG / "automation.json").read_text())
            if kept.get("port"):
                return kept["port"], kept["secret"]
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    raise SystemExit("::error::the app wrote no endpoint")


PORT, SECRET = endpoint()


def run(code):
    body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []})
    asked = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/",
        data=body.encode(),
        headers={"authorization": f"Bearer {SECRET}", "content-type": "application/json"},
        method="POST",
    )
    for _ in range(6):
        try:
            with urllib.request.urlopen(asked, timeout=10) as answer:
                said = json.loads(answer.read())
            return said.get("value") if said.get("ok") else None
        except (TimeoutError, OSError):
            time.sleep(1)
    return None


def until(code, seconds=20):
    for _ in range(seconds * 4):
        said = run(code)
        if said:
            return said
        time.sleep(0.25)
    return None


def pdf(title):
    """One A4 page with a line of text on it, which pdf.js reads."""
    stream = f"BT /F1 24 Tf 72 720 Td ({title}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R"
        b" /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    table = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for at in offsets:
        out += b"%010d 00000 n \n" % at
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, table)
    return bytes(out)


def mark(path):
    """The drawing a row wears, as its markup: two rows wear the same mark when it is
    the same."""
    return run(
        f"(() => {{ const row = document.querySelector('.row[data-path=\"' + CSS.escape({json.dumps(path)}) + '\"]');"
        " const mark = row && row.querySelector('.mark svg'); return mark ? mark.innerHTML : null })()"
    )


root = until("nib.workspace.activeSpace && nib.workspace.activeSpace.root")
if not root:
    sys.exit("::error::no space is open")
folder = Path(root)
lecture, leaflet, sketch = folder / "Lecture.pdf", folder / "Leaflet.pdf", folder / "Sketch.pages"
lecture.write_bytes(pdf("Lecture"))
leaflet.write_bytes(pdf("Leaflet"))
sketch.write_text('{"nodes":[],"edges":[]}')
print(f"pdf mark: two PDFs and a blank page note put in {root}")

# The list is read again as the space's watch hears a change; asked here as well, so a
# watch slow to hear is not what the run measures.
LISTED = "void nib.workspace.loadTree(), "

if not until(
    f"{LISTED}!!nib.workspace.entryAt({json.dumps(str(leaflet))}) && !!nib.workspace.entryAt({json.dumps(str(sketch))})"
    f" && !!nib.workspace.entryAt({json.dumps(str(lecture))})"
):
    sys.exit("::error::the file list never showed the files put in the space")

made = str(folder / "Lecture.pages")
run(f"nib.workspace.openPdf({json.dumps(str(lecture))}); true")
if not until(f"{LISTED}nib.workspace.entryAt({json.dumps(made)})?.path ?? null"):
    sys.exit("::error::opening the PDF made no page note")
print(f"pdf mark: Lecture.pdf opened, and is {made} now, holding its paper: {(folder / 'Lecture.pages.pdf').is_file()}")
time.sleep(1.5)

pdf_mark, made_mark, blank_mark = mark(str(leaflet)), mark(made), mark(str(sketch))
tab_mark = run(
    "(() => { const tab = document.querySelector('.pick[data-tab=\"' + nib.workspace.activeTabId + '\"] .mark svg');"
    " return tab ? tab.innerHTML : null })()"
)
subprocess.run(["grim", str(OUT / "pdf-mark.png")], check=False)

failures = []
if not (pdf_mark and made_mark and blank_mark):
    failures.append(f"a row wore no mark to compare: {[bool(pdf_mark), bool(made_mark), bool(blank_mark)]}")
else:
    print(f"pdf mark: the page note made from the PDF wears the PDF's mark: {made_mark == pdf_mark}")
    print(f"pdf mark: the blank page note wears another: {blank_mark != pdf_mark}")
    if made_mark != pdf_mark:
        failures.append("the page note made from a PDF does not wear the PDF's mark in the file list")
    if blank_mark == pdf_mark:
        failures.append("the blank page note wears the PDF's mark")
if tab_mark is None:
    failures.append("the page note's tab wore no mark")
elif tab_mark != pdf_mark:
    failures.append("the page note's tab does not wear the PDF's mark")
else:
    print("pdf mark: its tab wears the PDF's mark too")

# Another space in front, whose list says nothing of the note: the tab it is opened in
# there has to know it all the same. Its tab here is closed first, or opening it would
# bring this space back to show the tab it already has.
run(f"(() => {{ for (const tab of nib.workspace.tabs) if (tab.path === {json.dumps(made)}) nib.workspace.close(tab.id); return true }})()")
time.sleep(1)
run("void nib.workspace.addSpace('Elsewhere'), true")
if not until("nib.workspace.activeSpace && nib.workspace.activeSpace.name === 'Elsewhere'"):
    failures.append("the second space never opened")
else:
    run(f"void nib.workspace.openPdf({json.dumps(made)}), true")
    elsewhere_tab = until(
        f"(() => {{ const tab = nib.workspace.active; return tab && tab.path === {json.dumps(made)} && tab.id }})()"
    )
    away_mark = None
    for _ in range(40):
        away_mark = run(
            f"(() => {{ const tab = document.querySelector('.pick[data-tab=\"{elsewhere_tab}\"] .mark svg');"
            " return tab ? tab.innerHTML : null })()"
        )
        if away_mark == pdf_mark:
            break
        time.sleep(0.25)
    subprocess.run(["grim", str(OUT / "pdf-mark-elsewhere.png")], check=False)
    front = run("nib.workspace.activeSpace && nib.workspace.activeSpace.name")
    listed = run(f"!!nib.workspace.entryAt({json.dumps(made)})")
    print(f"pdf mark: {front!r} is in front, and its list holds the note: {listed}")
    if front != "Elsewhere" or listed:
        failures.append(f"the note did not open in a tab of the other space: {front!r} in front, listed {listed}")
    print(f"pdf mark: opened from another space, its tab wears the PDF's mark: {away_mark == pdf_mark}")
    if not elsewhere_tab:
        failures.append("the page note never opened in a tab of the other space")
    elif away_mark != pdf_mark:
        failures.append("opened from another space, the page note's tab does not wear the PDF's mark")

for failure in failures:
    print(f"::error::pdf mark: {failure}")
sys.exit(1 if failures else 0)
