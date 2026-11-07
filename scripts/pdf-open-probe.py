from __future__ import annotations

import argparse
import atexit
import importlib.util
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time

from probe_app import close_app, main_window, run_probe, sized

HERE = pathlib.Path(__file__).resolve().parent

_spec = importlib.util.spec_from_file_location("browser_probe", HERE / "default-browser-probe.py")
assert _spec and _spec.loader
browser = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(browser)

SPACE = "PDF probe"
NOTE = "Idea"

PAPER = b"""%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R
/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>>>endobj
4 0 obj<</Length 40>>stream
BT /F1 24 Tf 40 100 Td (WORDS) Tj ET
endstream endobj
trailer<</Root 1 0 R>>
%%EOF
"""

TABS = r"""
(() => {
  const ws = nib.workspace
  const front = ws.tabs.find((one) => one.id === ws.activeTabId)
  const pane = front ? front.paneId : null
  const said = (one) => `${one.kind}:${one.path ?? one.name}`
  return JSON.stringify({
    strip: ws.tabs.filter((one) => one.paneId === pane).map(said),
    front: front ? said(front) : null,
  })
})()
"""

def paper(at: pathlib.Path, words: str) -> pathlib.Path:
    at.parent.mkdir(parents=True, exist_ok=True)
    at.write_bytes(PAPER.replace(b"WORDS", words.encode()))
    return at

def tabs(port: int, secret: str) -> dict[str, object]:
    said = browser.ask(port, secret, TABS)
    return said if isinstance(said, dict) else {"error": said}

def fronted(said: dict[str, object], front: str) -> bool:
    shown = str(said.get("front") or "").lower()
    return shown == front.lower() or (front.startswith("pages:") and front.endswith(".pages") and shown.endswith(front[6:].lower()))

def settled(port: int, secret: str, front: str, seconds: float = 60) -> dict[str, object]:

    until = time.perf_counter() + seconds
    said: dict[str, object] = {}
    while time.perf_counter() < until:
        said = tabs(port, secret)
        if fronted(said, front):
            return said
        time.sleep(0.3)
    return said

def pages_tabs(said: dict[str, object]) -> list[str]:
    return [str(one).lower() for one in said.get("strip") or [] if str(one).startswith("pages:")]

class Told(dict[str, object]):

    def __setitem__(self, name: str, value: object) -> None:
        print(f"{name:8} {value}", flush=True)
        super().__setitem__(name, value)

def pdfs(space: pathlib.Path) -> list[str]:
    return sorted(str(one.relative_to(space)) for one in space.rglob("*.pdf"))

def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", required=True)
    parsed.add_argument("--shots", type=pathlib.Path, default=pathlib.Path(tempfile.gettempdir()))
    options = parsed.parse_args()

    browser.wipe(options.identifier)
    space = browser.spaces_root() / SPACE
    space.mkdir(parents=True)
    note = space / f"{NOTE}.md"
    note.write_text(f"# {NOTE}\n\nA note to open the space on.\n", encoding="utf-8")
    paper(space / "Papers" / "Inside.pdf", "inside")

    outside_dir = pathlib.Path(tempfile.mkdtemp(prefix="orden-pdf-probe-downloads-"))
    atexit.register(shutil.rmtree, outside_dir, ignore_errors=True)
    first = paper(outside_dir / "Paper.pdf", "first")
    second = paper(outside_dir / "Second paper.pdf", "second")

    wrong: list[str] = []
    said = Told()
    running: subprocess.Popen[bytes] | None = None
    try:
        running = run_probe(options.exe, quiet=True)
        port, secret = browser.endpoint(options.identifier, 90, running.pid)
        browser.shown(running.pid)
        browser.act(port, secret, "open", {"path": f"{NOTE}.md", "space": SPACE})
        time.sleep(3)
        if not close_app(running):
            running.terminate()
        running.wait(timeout=30)
        browser.allow_eval(options.identifier)

        running = run_probe(options.exe, quiet=True, args=[str(first)])
        port, secret = browser.endpoint(options.identifier, 90, running.pid)
        browser.shown(running.pid)
        root = space.parent
        cold = settled(port, secret, "pages:Paper")
        said["cold"] = cold
        if not fronted(cold, "pages:Paper"):
            wrong.append(f"a launch for a PDF did not open it as a page note: {cold}")

        browser.hand_over(options.exe, str(second))
        warm = settled(port, secret, "pages:Second paper")
        said["warm"] = warm
        if not fronted(warm, "pages:Second paper"):
            wrong.append(f"a PDF handed to the running app is not the tab in front: {warm}")

        browser.hand_over(options.exe, str(first))
        again = settled(port, secret, "pages:Paper")
        said["again"] = again
        if not fronted(again, "pages:Paper"):
            wrong.append(f"the paper handed over again is not in front: {again}")
        if pages_tabs(again).count("pages:paper") != 1:
            wrong.append(f"the same paper was opened twice: {again}")

        said["files"] = pdfs(root)
        copied = [one for one in pdfs(root) if pathlib.Path(one).stem in {"Paper", "Second paper"}]
        if copied:
            wrong.append(f"a PDF handed over was copied into a space: {copied}")

        browser.hand_over(options.exe, str(first))
        settled(port, secret, "pages:Paper")
        hwnd = main_window(running.pid)
        if hwnd:
            sized(hwnd, 1180, 760)
        time.sleep(2.5)
        out = options.shots / "pdf-open.png"
        browser.photograph(running.pid, out)
        said["shot"] = str(out)

        before = tabs(port, secret)
        browser.hand_over(options.exe, str(note))
        browser.hand_over(options.exe, "--url", "https://example.invalid/", str(first))
        time.sleep(3)
        after = tabs(port, secret)
        said["refused"] = after
        if pages_tabs(after) != pages_tabs(before):
            wrong.append(f"a note or a link's command line opened a PDF: {after}")
        opened = [str(one).lower() for one in after.get("strip") or []]
        had = [str(one).lower() for one in before.get("strip") or []]
        if opened.count(f"note:{note}".lower()) > had.count(f"note:{note}".lower()):
            wrong.append(f"a note handed over on the command line was opened: {after}")

    finally:
        if running and running.poll() is None:
            if not close_app(running):
                running.terminate()

    for one in wrong:
        print(f"WRONG: {one}")
    return 1 if wrong else 0

if __name__ == "__main__":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    sys.exit(main())
