from __future__ import annotations

import json
import shutil
from pathlib import Path

from playwright.sync_api import BrowserContext, Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
problems = DRIVE.failures
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots
APP = harness.APP
ROOT = harness.ROOT

PATIENCE = 60

def opened(context: BrowserContext) -> Page:
    page = context.pages[0] if context.pages else context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    return page

NOTE = """# Getting about

above the formula

$$
E = mc^2
$$

below the formula, above the diagram

```mermaid
graph TD
  A --> B
```

below the diagram, above the contents

[toc]

below the contents

## One

first section

## Two

second section
"""

WRITE = """
async (text) => {
  const ws = window.nibApp.workspace
  const made = await ws.noteFrom(text, ws.activeSpace.root)
  if (!made) throw new Error('nothing written')
  await ws.loadTree()
  await ws.openEntry(made)
  return made
}
"""

SPANS = """
() => {
  const doc = window.nib.state.doc
  const lines = []
  for (let at = 1; at <= doc.lines; at++) lines.push(doc.line(at))

  const spanOf = (first, last) => ({ from: first.from, to: last.to })
  const found = {}

  const dollars = lines.filter((one) => one.text.trim() === '$$')
  if (dollars.length === 2) found.formula = spanOf(dollars[0], dollars[1])

  const fences = lines.filter((one) => one.text.startsWith('```'))
  if (fences.length === 2) found.diagram = spanOf(fences[0], fences[1])

  const toc = lines.find((one) => one.text.trim() === '[toc]')
  if (toc) found.contents = spanOf(toc, toc)

  return found
}
"""

STATE = """
() => ({
  head: window.nib.state.selection.main.head,
  widgets: {
    formula: document.querySelectorAll('.nib-math-block').length,
    diagram: document.querySelectorAll('.nib-diagram').length,
    contents: document.querySelectorAll('.nib-toc').length,
  },
})
"""

BLOCKS = ["formula", "diagram", "contents"]

PRESSES = [
    ("from above", "ArrowDown"),
    ("from below", "ArrowUp"),
    ("from in front", "ArrowRight"),
    ("from behind", "ArrowLeft"),
]

def caret_at(page: Page, at: int) -> None:
    page.evaluate(
        "(at) => window.nib.dispatch({ selection: { anchor: at }, scrollIntoView: true })", at
    )
    page.wait_for_timeout(120)

def start_of(page: Page, span: dict, where: str) -> int:
    doc_end = page.evaluate("() => window.nib.state.doc.length")
    if where == "from above":
        return page.evaluate(
            "(at) => window.nib.state.doc.lineAt(Math.max(0, at - 1)).to", span["from"]
        )
    if where == "from below":
        return page.evaluate(
            "(at) => window.nib.state.doc.lineAt(Math.min(window.nib.state.doc.length, at + 1)).from",
            span["to"],
        )
    if where == "from in front":
        return max(0, span["from"] - 1)

    return min(doc_end, span["to"] + 1)

def drive(playwright, profile: Path) -> None:
    context = DRIVE.persistent(
        playwright,
        profile,
        viewport={"width": 1180, "height": 900},
        color_scheme="light",
    )
    try:
        page = opened(context)
        made = page.evaluate(WRITE, NOTE)
        say(f"wrote {made}")

        wait_for(page, "() => !!window.nib", "the editor")
        wait_for(
            page,
            "() => document.querySelectorAll('.nib-math-block').length === 1"
            " && document.querySelectorAll('.nib-diagram').length === 1"
            " && document.querySelectorAll('.nib-toc').length === 1",
            "the three blocks to be drawn",
        )
        page.locator(".cm-content").first.screenshot(path=str(SHOTS / "drawn.png"))
        say("wrote drawn.png")

        spans = page.evaluate(SPANS)
        say(f"blocks: {json.dumps(spans)}")
        for name in BLOCKS:
            if name not in spans:
                raise SystemExit(f"the note has no {name} in it, so nothing was measured")

        for name in BLOCKS:
            span = spans[name]
            for where, key in PRESSES:
                caret_at(page, 0)
                caret_at(page, start_of(page, span, where))
                page.keyboard.press(key)
                page.wait_for_timeout(200)

                now = page.evaluate(STATE)
                head = now["head"]
                inside = span["from"] <= head <= span["to"]
                opened_up = now["widgets"][name] == 0
                say(f"{name} {where}: caret {head} in {span['from']}..{span['to']}, "
                    f"{name} widgets {now['widgets'][name]}")

                if not inside:
                    wrong(f"{key} {where} skipped the {name}: caret {head}, "
                          f"block {span['from']}..{span['to']}")
                elif not opened_up:
                    wrong(f"{key} {where} put the caret in the {name} without opening it")

        caret_at(page, 0)
        page.wait_for_timeout(200)
        closed = page.evaluate(STATE)
        if any(closed["widgets"][name] != 1 for name in BLOCKS):
            wrong(f"a block did not close behind the caret: {json.dumps(closed['widgets'])}")
        else:
            say("and every block closed again behind the caret")

        page.locator(".cm-content").first.screenshot(path=str(SHOTS / "closed.png"))
        say("wrote closed.png")
    finally:
        context.close()

def main() -> int:
    profile = Path(ROOT / "target" / "caret-blocks-profile")
    if profile.exists():
        shutil.rmtree(profile, ignore_errors=True)
    profile.mkdir(parents=True, exist_ok=True)

    with DRIVE.session(playwright=True) as playwright:
        drive(playwright, profile)

    return DRIVE.verdict("every block opens to an arrow rather than standing in its way")

if __name__ == "__main__":
    raise SystemExit(main())
