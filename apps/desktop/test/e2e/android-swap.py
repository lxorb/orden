"""Under an Android agent CodeMirror takes its keys through an EditContext, which it fills
when a view is built and keeps up with transactions. A pane's one view swaps states when
the note changes (packages/editor/src/held.ts), and each swap has to fill it again: keys
after + threw `Invalid change range` and the draft stayed empty, and the keyboard read
another note's words."""

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
WORDS = "() => window.nibApp.workspace.active.note.latest"


def pane(browser: Browser, label: str, steps: list[tuple[str, ...]]) -> None:
    """A fresh phone, the steps on it, and after each one the keyboard's text and the note's."""
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
                  const ws = window.nibApp.workspace
                  await ws.openEntry(ws.notes.find((one) => one.name.startsWith(name)).path, { activate: true })
                }""",
                step[1],
            )
        elif step[0] == "blank":
            page.evaluate("() => window.nibApp.workspace.openBlank()")
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


def drive(browser: Browser) -> None:
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
