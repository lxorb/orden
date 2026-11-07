#!/usr/bin/env python3

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

OUT = Path(sys.argv[1]).resolve()
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"
SPACES = Path(os.environ["ORDEN_SPACES_DIR"])
SECRET_WORDS = "sekretbytes4711"
WORDS = "the words of the note"

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

PORT, KEY = endpoint()

def run(code):
    body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []})
    asked = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/",
        data=body.encode(),
        headers={"authorization": f"Bearer {KEY}", "content-type": "application/json"},
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

def printed(html, name):
    target = SPACES / f"{name}.pdf"
    page = {"width": 8.27, "height": 11.69, "margin": 1, "landscape": False}
    args = json.dumps({"html": html, "output": str(target), "page": page})
    key = json.dumps(name)
    run(
        f"(window.__pdf ??= {{}})[{key}] = 'waiting'; window.__TAURI_INTERNALS__.invoke('print_pdf', "
        f"{args}).then(() => {{ window.__pdf[{key}] = 'written' }}, "
        f"(error) => {{ window.__pdf[{key}] = 'refused: ' + error }}); true"
    )
    said = "waiting"
    for _ in range(120):
        said = run(f"window.__pdf[{key}]")
        if said != "waiting":
            break
        time.sleep(0.5)
    if said != "written":
        raise SystemExit(f"::error::print_pdf: {said}")
    if target.read_bytes()[:5] != b"%PDF-":
        raise SystemExit("::error::the file is not a PDF")
    info = subprocess.check_output(["pdfinfo", str(target)], text=True)
    text = subprocess.check_output(["pdftotext", str(target), "-"], text=True)
    pages = next(int(line.split()[1]) for line in info.splitlines() if line.startswith("Pages:"))
    print(f"pdf: {name}: {pages} pages, {target.stat().st_size} bytes")
    return pages, text

secret = OUT / "pdf-secret.txt"
secret.write_text(SECRET_WORDS + "\n")
address = f"file://{secret}"

plain = (
    f"<!doctype html><html><head><title>x</title></head><body><h1>{WORDS}</h1>"
    "<div style='break-before:page'>page two</div></body></html>"
)
pages, text = printed(plain, "plain")
if pages != 2 or WORDS not in text or "page two" not in text:
    raise SystemExit(f"::error::a plain page came out as {pages} pages: {text!r}")

hostile = (
    f"<!doctype html><html><head><title>x</title><link rel=stylesheet href='{address}'>"
    f"<style>@import url('{address}');</style></head><body><h1>{WORDS}</h1>"
    f"<iframe src='{address}' width=600 height=100></iframe>"
    f"<object data='{address}' type='text/plain' width=600 height=100></object>"
    f"<embed src='{address}' type='text/plain' width=600 height=100>"
    "<p id=run>no script ran</p>"
    "<script>document.getElementById('run').textContent = 'a script ran'</script>"
    f"<script>fetch('{address}').then(r => r.text()).then(t => document.body.append(t))</script>"
    "</body></html>"
)
pages, text = printed(hostile, "hostile")
(OUT / "pdf-hostile.txt").write_text(text)
if WORDS not in text or "no script ran" not in text:
    raise SystemExit("::error::the hostile page lost its own words; see pdf-hostile.txt")
if SECRET_WORDS in text:
    raise SystemExit("::error::a file on the disk landed in the PDF; see pdf-hostile.txt")
if "a script ran" in text:
    raise SystemExit("::error::a script ran in the print window; see pdf-hostile.txt")
print("pdf: nothing on the disk reached the file, and no script ran")
