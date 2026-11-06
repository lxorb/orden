from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

ELSEWHERE = """
([at, insert]) => {
  const ws = window.nibApp.workspace
  ws.documentAt(ws.active.path).live.arrived([{ from: at, to: at, insert }])
}
"""

WORDS = "() => window.nibApp.workspace.documentAt(window.nibApp.workspace.active.path).live.text.toString()"
SHOWN = "() => document.querySelector('.cm-content').innerText.trim()"

def composing(page: Page, line: str, at: int, other: int, insert: str, expected: str, label: str) -> None:
    DRIVE.seed(page, line)
    DRIVE.open_note(page, line.split()[0])
    page.locator(".cm-content").first.click()
    page.keyboard.press("Control+End")
    page.wait_for_timeout(200)

    cdp = page.context.new_cdp_session(page)
    cdp.send("Input.imeSetComposition", {"text": "に", "selectionStart": 1, "selectionEnd": 1})
    cdp.send("Input.imeSetComposition", {"text": "にほ", "selectionStart": 2, "selectionEnd": 2})
    page.wait_for_timeout(150)
    page.evaluate(ELSEWHERE, [other, insert])
    page.wait_for_timeout(150)
    cdp.send("Input.insertText", {"text": "日本"})
    page.wait_for_timeout(400)

    held, shown = page.evaluate(WORDS), page.evaluate(SHOWN)
    say(f"[{label}] the note holds {held!r}, the page shows {shown!r}")
    shot(page, label)
    if held != expected or shown != expected:
        wrong(f"[{label}] {held!r} / {shown!r}, not {expected!r}")
    if "に" in held or "ほ" in held or "に" in shown:
        wrong(f"[{label}] half-composed characters were left behind")
    cdp.detach()

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    line = "hello world"
    composing(page, line, len(line), len(line), "ZZ", "hello worldZZ日本", "at-the-composition")
    page.context.close()

    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    line = "hullo world"
    composing(page, line, len(line), 7, "Q", "hullo wQorld日本", "inside-the-word")
    page.context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "words from elsewhere wait for a composition, and nothing half-composed stays"))
