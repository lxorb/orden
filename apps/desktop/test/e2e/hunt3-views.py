
from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

RISKY_BASE = """```base
formulas:
  f: /(a+)+$/.matches(note.x)
views:
  - type: table
    name: T
    order:
      - file.name
      - formula.f
```
"""

RISKY_TASKS = """```tasks
not done
description regex matches /(a+)+$/
```
"""

FILLER = "\n\n".join(f"Filler paragraph {at}, long enough to take a line." for at in range(150))

def shared(page: Page, name: str, text: str) -> None:
    page.evaluate(
        "([id, name, text]) => window.ordenApp.workspace.openShared({ id, name, path: name }, text)",
        [name, name, text],
    )
    page.wait_for_timeout(900)

BLOCK = """() => {
  const block = document.querySelector('.base-block')
  return block
    ? {
        rows: block.querySelectorAll('[role="row"], tr').length,
        buttons: block.querySelectorAll('button').length,
        text: block.innerText.slice(0, 160),
      }
    : null
}"""

def base_block(page: Page) -> dict | None:
    DRIVE.waited(page, "document.querySelector('.base-block')", "the base block", 8)
    page.wait_for_timeout(700)
    return page.evaluate(BLOCK)

def drive_shared(page: Page) -> None:
    DRIVE.seed(page, f"# Own base\n\n{RISKY_BASE}")
    DRIVE.open_note(page, "Own base")
    page.wait_for_timeout(700)
    DRIVE.reading(page)
    own = base_block(page)
    say(f"[own, reading] {json.dumps(own)}")
    if not own or own["rows"] == 0:
        wrong(f"the reader's own base with that pattern draws no table: {own}")
    page.evaluate("() => window.ordenApp.workspace.toggleReading()")
    page.wait_for_timeout(500)

    shared(page, "Base.md", f"# Shared base\n\n{RISKY_BASE}")
    editor = base_block(page)
    say(f"[shared, editor] {json.dumps(editor)}")
    if editor and editor["rows"] > 0:
        wrong(f"a file shared on its own ran the pattern in the editor: {editor}")
    DRIVE.reading(page)
    read = base_block(page)
    say(f"[shared, reading] {json.dumps(read)}")
    if read and read["rows"] > 0:
        wrong(f"a file shared on its own ran the pattern in the reading view: {read}")
    page.evaluate("() => window.ordenApp.workspace.toggleReading()")

    shared(page, "Tasks.md", f"# Shared tasks\n\n{RISKY_TASKS}")
    DRIVE.reading(page)
    page.wait_for_timeout(800)
    said = page.evaluate("() => document.querySelector('.orden-query')?.innerText ?? document.querySelector('.orden-query-none')?.innerText ?? ''")
    say(f"[shared tasks, reading] {said!r}")
    if "(a+)+" not in said:
        wrong(f"a tasks fence in a file shared on its own was not refused: {said!r}")
    page.evaluate("() => window.ordenApp.workspace.toggleReading()")

def scroll_of(page: Page) -> dict:
    return page.evaluate(
        """() => {
          const anchor = document.getElementById('^abc')
          const box = document.querySelector('article.orden-write')?.closest('[class*="reading"]') ?? null
          const top = anchor ? anchor.getBoundingClientRect().top : null
          return { top, height: innerHeight, box: !!box }
        }"""
    )

def drive_block_links(page: Page) -> None:
    DRIVE.seed(page, f"# Other block\n\n{FILLER}\n\nThe far one ^far\n")
    DRIVE.seed(page, f"# Own block\n\n[[#^abc]] and [[Other block#^far]]\n\n{FILLER}\n\nThe named one ^abc\n\nMore words\n")
    DRIVE.open_note(page, "Own block")
    page.wait_for_timeout(500)
    DRIVE.reading(page)
    links = page.evaluate("() => [...document.querySelectorAll('a.wikilink')].map((one) => one.getAttribute('href'))")
    say(f"[links] {links}")
    if not any(one.startswith("#") and "abc" in one for one in links):
        wrong(f"the link into this note does not say its block: {links}")
    before = scroll_of(page)
    page.locator("a.wikilink").first.click()
    page.wait_for_timeout(500)
    after = scroll_of(page)
    say(f"[same note] {before} -> {after}")
    if after["top"] is None or not 0 <= after["top"] <= after["height"]:
        wrong(f"a link to a block of this note did not land on it: {after}")

    page.locator("a.wikilink").nth(1).click()
    page.wait_for_timeout(1200)
    shown = page.evaluate(
        """() => {
          const ws = window.ordenApp.workspace
          const far = document.getElementById('^far')
          const line = document.querySelector('.cm-activeLine')?.innerText ?? null
          return { name: ws.active?.name, reading: ws.active?.reading, top: far ? far.getBoundingClientRect().top : null, line, height: innerHeight }
        }"""
    )
    say(f"[other note] {shown}")
    page.evaluate("() => window.ordenApp.workspace.toggleReading()")
    page.wait_for_timeout(600)
    near = page.evaluate(
        """() => {
          const far = document.getElementById('^far')
          return far ? far.getBoundingClientRect().top : null
        }"""
    )
    say(f"[other note, reading, before] {near}")
    page.evaluate(
        """async () => {
          const ws = window.ordenApp.workspace
          await ws.openEntry(ws.notes.find((one) => one.name.startsWith('Own block')).path, { activate: true })
        }"""
    )
    wait_for(page, "document.querySelectorAll('a.wikilink').length > 1", "the links of the note")
    page.locator("a.wikilink").nth(1).click()
    page.wait_for_timeout(1200)
    near = page.evaluate(
        """() => {
          const ws = window.ordenApp.workspace
          const far = document.getElementById('^far')
          return { name: ws.active?.name, reading: ws.active?.reading, top: far ? far.getBoundingClientRect().top : null, height: innerHeight }
        }"""
    )
    say(f"[other note, reading] {near}")
    if near["reading"] and (near["top"] is None or not 0 <= near["top"] <= near["height"]):
        wrong(f"a link to a block of a note in its reading view did not land on it: {near}")
    if near["reading"]:
        page.evaluate("() => window.ordenApp.workspace.toggleReading()")
    if not str(shown["name"]).startswith("Other block"):
        wrong(f"the link to a block of another note opened {shown['name']}")
    if "far one" not in str(shown["line"]):
        wrong(f"the link to a block of another note did not land on it: {shown}")

def drive_ticks(page: Page) -> None:
    inbox = DRIVE.todos(page, "- [ ] Alpha 🔁 every day 📅 2026-11-04\n- [ ] Bravo\n")
    DRIVE.seed(page, "# Fence note\n\n```tasks\nnot done\n```\n")
    page.wait_for_timeout(1000)
    DRIVE.open_note(page, "Fence note")
    DRIVE.reading(page)
    wait_for(page, "document.querySelectorAll('.orden-query input[data-task]').length >= 2", "the rows")
    done = page.evaluate(
        """async () => {
          const box = (words) => [...document.querySelectorAll('.orden-query input[data-task]')]
            .find((one) => one.getAttribute('aria-label').startsWith(words))
          const alpha = box('Alpha')
          const bravo = box('Bravo')
          alpha.click()
          await new Promise((done) => setTimeout(done, 60))
          bravo.click()
          return [alpha.dataset.hash, bravo.dataset.hash]
        }"""
    )
    say(f"[hashes] {done}")
    page.wait_for_timeout(1200)
    page.evaluate("() => window.ordenApp.workspace.toggleReading()")
    words = page.evaluate("async (path) => await window.ordenApp.workspace.noteText(path)", inbox)
    say(f"[inbox] {words!r}")
    if words is not None:
        lines = words.split("\n")
        if not any(line.startswith("- [x] Bravo") for line in lines):
            wrong(f"the second box did not tick its own task: {lines}")
        if sum(1 for line in lines if line.startswith("- [ ] Alpha")) != 1:
            wrong(f"more or fewer than one open Alpha: {lines}")
        if not any(line.startswith("- [x] Alpha") for line in lines):
            wrong(f"the first box was put back by the second: {lines}")

def drive_fixed(page: Page) -> None:
    fence = RISKY_BASE.replace("/(a+)+$/.matches(note.x)", "note.x")
    quoted = "\n".join(f"> {line}" for line in fence.strip().split("\n"))
    DRIVE.seed(page, f"# Free fence\n\n{fence}")
    DRIVE.seed(page, f"# Quoted fence\n\n{quoted}\n")
    DRIVE.open_note(page, "Free fence")
    DRIVE.reading(page)
    free = base_block(page)
    page.evaluate("() => window.ordenApp.workspace.toggleReading()")
    DRIVE.open_note(page, "Quoted fence")
    DRIVE.reading(page)
    held = base_block(page)
    labels = page.evaluate(
        "() => [...document.querySelectorAll('.base-block [aria-label]')].map((one) => one.getAttribute('aria-label'))"
    )
    say(f"[free] {free} [quoted] {labels}")
    for offered in ("New view", "Filter", "Sort", "Settings"):
        if offered in labels:
            wrong(f"a fence in a quote offers {offered}, which it cannot keep: {labels}")
    if "New note" not in labels:
        wrong(f"a fence in a quote can no longer add a note: {labels}")
    page.evaluate("() => window.ordenApp.workspace.toggleReading()")

def drive(browser: Browser) -> None:
    page = browser.new_context(viewport={"width": 1180, "height": 900}).new_page()
    page.add_init_script("localStorage.setItem('orden:hidden-kinds', JSON.stringify(['experimental', 'experimental-bases']))")
    DRIVE.open(page)
    DRIVE.ready(page)
    say("--- a file shared on its own ---")
    drive_shared(page)
    say("--- a link to a block ---")
    drive_block_links(page)
    say("--- two boxes pressed quickly ---")
    drive_ticks(page)
    say("--- a fence that cannot be written back ---")
    drive_fixed(page)
    page.context.close()

def main() -> int:
    return DRIVE.run(drive, "a shared fence is guarded, a block link lands, a row ticks its own task")

if __name__ == "__main__":
    raise SystemExit(main())
