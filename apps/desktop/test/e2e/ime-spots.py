from __future__ import annotations

from playwright.sync_api import Browser, CDPSession, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

NOTE = """# Spots

- item one
- [ ] a task
**bold** after
## Heading two
> [!note] Callout
> body here
Inline $x+1$ math
A [[Wiki]] link
`code` span
1. numbered
end
"""

DOC = "() => window.orden.state.doc.toString()"
HEAD = "() => window.orden.state.selection.main.head"

PLACE = """
([words, offset]) => {
  const view = window.orden
  const at = view.state.doc.toString().indexOf(words) + offset
  view.dispatch({ selection: { anchor: at } })
  view.focus()
  return at
}
"""

PUT_BACK = """
(text) => {
  const view = window.orden
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
}
"""

LINE_WITH = """
(words) => [...document.querySelectorAll('.cm-line')]
  .map((one) => one.innerText)
  .find((one) => one.includes(words))
"""

SPOTS = [
    ("`code` span", len("`code`"), "right after inline code"),
    ("`code` span", len("`co"), "inside inline code"),
    ("`code` span", 0, "before inline code"),
    ("Inline $x+1$ math", len("Inline $x+1$"), "right after maths"),
    ("A [[Wiki]] link", len("A [[Wiki]]"), "right after a wikilink"),
    ("**bold** after", len("**bold**"), "right after bold"),
    ("- item one", len("- item one"), "at the end of a list item"),
    ("- [ ] a task", len("- [ ] "), "at the start of a task's words"),
    ("## Heading two", len("## "), "at the start of a heading"),
    ("> body here", len("> "), "at the start of a callout's body"),
    ("1. numbered", len("1. "), "at the start of a numbered item"),
]


def compose(page: Page, cdp: CDPSession, words: str, offset: int, label: str) -> None:
    before = page.evaluate(DOC)
    at = page.evaluate(PLACE, [words, offset])
    page.wait_for_timeout(120)
    for text in ["n", "に", "にほ", "日本"]:
        cdp.send("Input.imeSetComposition", {"text": text, "selectionStart": len(text), "selectionEnd": len(text)})
        page.wait_for_timeout(60)
    cdp.send("Input.insertText", {"text": "日本"})
    page.wait_for_timeout(300)

    after = page.evaluate(DOC)
    expected = before[:at] + "日本" + before[at:]
    if after != expected:
        wrong(f"[{label}] {after[max(0, at - 12):at + 16]!r}, not {expected[max(0, at - 12):at + 16]!r}")
        shot(page, label.replace(" ", "-"))
    elif page.evaluate(HEAD) != at + 2:
        wrong(f"[{label}] the caret is at {page.evaluate(HEAD)}, not after what was composed")
    else:
        say(f"[{label}] kept")

    if label == "right after inline code":
        page.wait_for_timeout(200)
        line = page.evaluate(LINE_WITH, "span")
        if "`" in line:
            wrong(f"[{label}] the backticks still show once the composition is over: {line!r}")

    page.evaluate(PUT_BACK, before)
    page.wait_for_timeout(100)


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    DRIVE.seed(page, NOTE)
    DRIVE.open_note(page, "Spots")
    page.locator(".cm-content").first.click()
    cdp = page.context.new_cdp_session(page)
    for words, offset, label in SPOTS:
        compose(page, cdp, words, offset, label)
    cdp.detach()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a composition keeps what is beside it, wherever it starts"))
