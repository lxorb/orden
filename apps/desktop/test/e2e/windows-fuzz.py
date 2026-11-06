
from __future__ import annotations

import json
import os
import random

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
WS = "window.nibApp.workspace"
SEED = int(os.environ.get("FUZZ_SEED", "4"))
OPS = int(os.environ.get("FUZZ_OPS", "30"))
TYPE = """([word, where]) => {
  const ws = window.nibApp.workspace
  const tab = ws.tabs.find(t => t.path && t.path.endsWith('Fz.md')) ?? ws.tabs.find(t=>t.note.latest.includes('Fz'))
  if (!tab) return false
  const live = tab.note.live
  const length = live.text.length
  const at = where === 'end' ? length : Math.min(5, length)
  live.edit([{from: at, to: at, insert: where === 'end' ? word + '\\n' : '\\n' + word + '\\n'}], {userEvent: 'input'})
  return true
}"""

def drive(browser: Browser) -> None:
    rand = random.Random(SEED)
    ctx = DRIVE.context(browser, viewport={"width": 900, "height": 600})
    first = ctx.new_page()
    DRIVE.open(first)
    DRIVE.seed(first, "# Fz\n\nstart line\n")
    DRIVE.open_note(first, "Fz")
    url = first.url

    def holds_note(page: Page) -> None:
        wait_for(page, f"()=>{WS}.restored", "launched")
        if not page.evaluate(f"()=>{WS}.tabs.some(t=>t.path&&t.path.endsWith('Fz.md'))"):
            DRIVE.open_note(page, "Fz")

    def another() -> Page:
        page = ctx.new_page()
        page.goto(url)
        DRIVE.ready(page)
        holds_note(page)
        return page

    pages = [first, another()]
    typed: list[str] = []
    for step in range(OPS):
        roll = rand.random()
        page = rand.choice(pages)
        if roll < 0.72:
            word = f"T{step:03d}x"
            if page.evaluate(TYPE, [word, rand.choice(["end", "top"])]):
                typed.append(word)
            page.wait_for_timeout(rand.choice([0, 20, 120, 500, 900]))
        elif roll < 0.84:
            pages.remove(page)
            page.evaluate(
                f"()=>{{const ws={WS}; ws.persist(); ws.persist=()=>true; ws.saving.hurry=()=>{{}}; ws.saving.part=()=>{{}}}}"
            )
            page.close()
            pages.append(another())
        elif roll < 0.92:
            pages.remove(page)
            page.close()
            pages.append(another())
        else:
            page.reload()
            DRIVE.ready(page)
            holds_note(page)

    for page in pages:
        page.evaluate(f"()=>{WS}.writesSettled()")
    probe = pages[0]
    path = probe.evaluate(f"()=>{WS}.notes.find(one=>one.name.startsWith('Fz')).path")

    def settled() -> str | None:
        file = probe.evaluate(f"(path)=>{WS}.noteText(path)", path) or ""
        if any(word not in file for word in typed):
            return None
        return file

    for _ in range(40):
        file = settled()
        if file is not None:
            break
        probe.wait_for_timeout(250)
    file = probe.evaluate(f"(path)=>{WS}.noteText(path)", path) or ""
    missing = [word for word in typed if word not in file]
    doubled = {word: file.count(word) for word in typed if file.count(word) > 1}
    say(f"seed {SEED}: {len(typed)} typed, missing {missing}, doubled {doubled}")
    if missing or doubled:
        say("file " + json.dumps(file)[:1500])
        wrong(f"seed {SEED}: missing {missing}, doubled {doubled}")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
