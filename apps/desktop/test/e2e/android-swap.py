
from __future__ import annotations

import json

from harness import Drive
from playwright.sync_api import Browser

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
)
CONTEXT = """() => {
  const { text, selectionStart, selectionEnd } = document.querySelector('.cm-content').editContext
  return { text, selectionStart, selectionEnd }
}"""
WORDS = "() => window.ordenApp.workspace.active.note.latest"

def pane(browser: Browser, label: str, steps: list[tuple[str, ...]]) -> None:
    phone = browser.new_context(
        viewport={"width": 390, "height": 844}, user_agent=AGENT, has_touch=True, is_mobile=True
    )
    page = phone.new_page()
    thrown: list[str] = []
    page.on("pageerror", lambda error: thrown.append(str(error)[:90]))
    DRIVE.open(page)
    if not page.evaluate("() => !!document.querySelector('.cm-content')?.editContext"):
        wrong(f"{label}: no EditContext, so this drive proves nothing")
    DRIVE.seed(
        page,
        "# Longer note\n\nthe quick brown fox jumps over the lazy dog and runs far away\n",
        "# Bbb\n\nshort\n",
    )
    for step in steps:
        if step[0] == "open":
            page.evaluate(
                """async (name) => {
                  const ws = window.ordenApp.workspace
                  await ws.openEntry(ws.notes.find((one) => one.name.startsWith(name)).path, { activate: true })
                }""",
                step[1],
            )
        elif step[0] == "blank":
            page.evaluate("() => window.ordenApp.workspace.openBlank()")
        elif step[0] == "keys":
            page.locator(".cm-content").first.tap()
            page.keyboard.type(step[1])
        elif step[0] == "compose":
            typing = phone.new_cdp_session(page)
            page.locator(".cm-content").first.tap()
            typing.send(
                "Input.imeSetComposition",
                {"text": step[1][:-1], "selectionStart": len(step[1]) - 1, "selectionEnd": len(step[1]) - 1},
            )
            typing.send("Input.insertText", {"text": step[1]})
        page.wait_for_timeout(250)
        words, context = page.evaluate(WORDS), page.evaluate(CONTEXT)
        say(f"{label} {step}: words {json.dumps(words)}, context {json.dumps(context['text'])}")
        if context["text"] != words:
            wrong(f"{label} {step}: the keyboard reads {context['text']!r}, the note holds {words!r}")
        if step[0] in ("keys", "compose") and step[1] not in words:
            wrong(f"{label} {step}: {step[1]!r} did not land in {words!r}")
    if thrown:
        wrong(f"{label}: threw {thrown[:2]} ({len(thrown)} in all)")
    phone.close()

def composing(browser: Browser) -> None:
    phone = browser.new_context(
        viewport={"width": 390, "height": 844}, user_agent=AGENT, has_touch=True, is_mobile=True
    )
    page = phone.new_page()
    DRIVE.open(page)
    DRIVE.seed(page, "# Aaa\n\nfirst\n", "# Bbb\n\nshort\n")
    opening = """async (name) => {
      const ws = window.ordenApp.workspace
      await ws.openEntry(ws.notes.find((one) => one.name.startsWith(name)).path, { activate: true })
    }"""
    page.evaluate(opening, "Aaa")
    page.wait_for_timeout(250)
    typing = phone.new_cdp_session(page)
    page.locator(".cm-content").first.tap()
    typing.send("Input.imeSetComposition", {"text": "wor", "selectionStart": 3, "selectionEnd": 3})
    page.wait_for_timeout(100)
    page.evaluate(opening, "Bbb")
    page.wait_for_timeout(250)
    typing.send("Input.imeSetComposition", {"text": "word", "selectionStart": 4, "selectionEnd": 4})
    page.wait_for_timeout(100)
    typing.send("Input.insertText", {"text": "word"})
    page.wait_for_timeout(250)
    words, context = page.evaluate(WORDS), page.evaluate(CONTEXT)
    say(f"composing across a swap: Bbb holds {json.dumps(words)}, context {json.dumps(context['text'])}")
    if context["text"] != words:
        wrong(f"after a composition across a swap the keyboard reads {context['text']!r}")
    if words != "word# Bbb\n\nshort\n":
        wrong(f"the composition reached into the note swapped in: {words!r}")
    page.evaluate(opening, "Aaa")
    page.wait_for_timeout(250)
    first = page.evaluate(WORDS)
    say(f"Aaa holds {json.dumps(first)}")
    if "wor" not in first or "word" in first:
        wrong(f"the composition did not stay in its own note: {first!r}")
    phone.close()

def drive(browser: Browser) -> None:
    composing(browser)
    pane(browser, "note, then +", [("open", "Longer"), ("keys", "XAX"), ("blank",), ("keys", "one")])
    pane(browser, "draft, then +", [("blank",), ("keys", "one"), ("blank",), ("keys", "two")])
    pane(
        browser,
        "note to note",
        [("open", "Longer"), ("keys", "XAX"), ("open", "Bbb"), ("compose", "word"), ("open", "Longer"), ("keys", "ZZ")],
    )
    pane(browser, "draft to note", [("blank",), ("keys", "one"), ("open", "Bbb"), ("keys", "YBY")])

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
