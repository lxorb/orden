from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

NOTE = """Maths first $a^2 + b^2 = c^2$ on the top line

a paragraph to make room above

another paragraph

and one more, with $\\sqrt{x}$ in it

$$
\\int_0^1 x\\,dx
= \\frac{1}{2}
$$

> [!note]
> In a callout, $e^{i\\pi} + 1 = 0$ holds.

| name | value |
| --- | --- |
| area | $\\pi r^2$ |

the end
""" + "".join(f"\nfiller {n}\n" for n in range(40))

PREVIEW = """
() => {
  const view = window.nib
  const dom = view.dom.querySelector('.orden-maths-preview')
  if (!dom || dom.hidden) return null
  const box = dom.getBoundingClientRect()
  const scroller = view.scrollDOM.getBoundingClientRect()
  const head = view.state.selection.main.head
  const caret = view.coordsAtPos(head, -1) ?? view.coordsAtPos(head, 1)
  const style = getComputedStyle(dom)
  return {
    top: box.top, bottom: box.bottom, left: box.left, right: box.right,
    scroller: { top: scroller.top, bottom: scroller.bottom, left: scroller.left, right: scroller.right },
    caret: caret && { top: caret.top, bottom: caret.bottom },
    katex: !!dom.querySelector('.katex'),
    text: dom.querySelector('.orden-maths-preview-body')?.textContent ?? '',
    error: dom.querySelector('.orden-maths-preview-error:not([hidden])')?.textContent ?? null,
    stale: dom.classList.contains('orden-maths-preview-stale'),
    below: dom.classList.contains('orden-maths-preview-below'),
    background: style.backgroundColor,
    hiddenFromReaders: dom.getAttribute('aria-hidden') === 'true',
  }
}
"""

LINES = "() => [...document.querySelectorAll('.cm-line')].map((l) => Math.round(l.getBoundingClientRect().top))"

def caret_after(page: Page, needle: str, offset: int = 0) -> None:
    page.evaluate(
        """([needle, offset]) => {
          const view = window.nib
          const at = view.state.doc.toString().indexOf(needle)
          if (at < 0) throw new Error(`no ${needle} in the note`)
          view.focus()
          view.dispatch({ selection: { anchor: at + needle.length + offset }, scrollIntoView: true })
        }""",
        [needle, offset],
    )
    page.wait_for_timeout(150)

def preview(page: Page) -> dict | None:
    return page.evaluate(PREVIEW)

def shown(page: Page, what: str) -> dict | None:
    wait_for(page, f"({PREVIEW})()?.katex || ({PREVIEW})()?.error", what, patience=15)
    return preview(page)

def check_inside(seen: dict, label: str) -> None:
    pane = seen["scroller"]
    if seen["left"] < pane["left"] - 1 or seen["right"] > pane["right"] + 1:
        wrong(f"[{label}] the preview leaves the pane sideways: {json.dumps(seen)}")
    if seen["top"] < pane["top"] - 1 or seen["bottom"] > pane["bottom"] + 1:
        wrong(f"[{label}] the preview leaves the pane: {json.dumps(seen)}")
    caret = seen["caret"]
    if caret and seen["top"] < caret["bottom"] - 1 and seen["bottom"] > caret["top"] + 1:
        wrong(f"[{label}] the preview covers the line being typed: {json.dumps(seen)}")

def open_note(page: Page) -> None:
    DRIVE.seed(page, NOTE)
    DRIVE.open_note(page, "Maths first")
    wait_for(page, "() => document.querySelectorAll('.orden-math-block').length === 1", "the formulas")

def desktop(page: Page, scheme: str) -> None:
    open_note(page)

    caret_after(page, "$\\sqrt{x", 0)
    seen = shown(page, "the inline preview")
    say(f"[{scheme}] inline: {json.dumps(seen)}")
    if not seen or not seen["katex"] or seen["below"]:
        wrong(f"[{scheme}] no picture above the inline formula: {seen}")
    elif not seen["hiddenFromReaders"]:
        wrong(f"[{scheme}] the preview is read out to screen readers")
    else:
        check_inside(seen, f"{scheme} inline")
    shot(page, f"{scheme}-inline")

    before = page.evaluate(LINES)
    page.keyboard.type("+y")
    page.wait_for_timeout(200)
    seen = preview(page)
    if not seen or "y" not in seen["text"]:
        wrong(f"[{scheme}] the preview did not follow the typing: {seen}")
    after = page.evaluate(LINES)
    if before != after:
        wrong(f"[{scheme}] typing moved the lines of the note: {before} -> {after}")

    page.keyboard.type("\\frac{")
    page.wait_for_timeout(250)
    seen = preview(page)
    say(f"[{scheme}] half-typed: {json.dumps(seen)}")
    if not seen or not seen["error"] or not seen["stale"] or not seen["katex"]:
        wrong(f"[{scheme}] a half-typed formula did not keep the last picture with its error: {seen}")
    shot(page, f"{scheme}-error")
    page.keyboard.type("1}{2}")
    page.wait_for_timeout(250)
    seen = preview(page)
    if not seen or seen["error"] or seen["stale"]:
        wrong(f"[{scheme}] the error stayed after the formula was finished: {seen}")

    page.keyboard.press("Escape")
    page.wait_for_timeout(150)
    if preview(page):
        wrong(f"[{scheme}] Escape did not hide the preview")
    page.keyboard.type("z")
    page.wait_for_timeout(250)
    if not preview(page):
        wrong(f"[{scheme}] the preview did not come back with the next keystroke")

    caret_after(page, "another paragraph")
    if preview(page):
        wrong(f"[{scheme}] the preview stayed after the caret left the formula")

    caret_after(page, "$\\sqrt{x", 0)
    page.evaluate(
        """() => {
          const view = window.nib
          const head = view.state.selection.main.head
          const row = view.coordsAtPos(head, -1)
          view.scrollDOM.scrollTop += row.top - view.scrollDOM.getBoundingClientRect().top - 4
        }"""
    )
    page.wait_for_timeout(200)
    seen = shown(page, "the preview at the top of the pane")
    if not seen or not seen["below"]:
        wrong(f"[{scheme}] at the top of the note the preview was not put below: {seen}")
    else:
        check_inside(seen, f"{scheme} top")

    caret_after(page, "\\int_0^1", 0)
    first = shown(page, "the block preview")
    caret_after(page, "= \\frac{1}", 0)
    page.wait_for_timeout(150)
    second = preview(page)
    say(f"[{scheme}] block lines: {first and first['top']} -> {second and second['top']}")
    if not first or not second or not second["katex"]:
        wrong(f"[{scheme}] no preview of the display block")
    elif second["top"] <= first["top"]:
        wrong(f"[{scheme}] the preview did not follow the caret down the block")
    else:
        check_inside(second, f"{scheme} block")
    shot(page, f"{scheme}-block")

    caret_after(page, "$e^{i", 0)
    seen = shown(page, "the callout preview")
    if not seen or not seen["katex"]:
        wrong(f"[{scheme}] no preview in a callout: {seen}")

    cell = page.locator(".orden-table td", has_text="pi").first
    cell.click()
    page.wait_for_timeout(150)
    page.evaluate(
        """() => {
          const cell = document.activeElement
          const text = cell.firstChild
          const at = text.textContent.indexOf('r^2')
          getSelection().collapse(text, at)
        }"""
    )
    page.wait_for_timeout(200)
    seen = page.evaluate(
        "() => { const d = document.querySelector('.orden-maths-preview');"
        " return d && !d.hidden && !!d.querySelector('.katex') }"
    )
    if not seen:
        wrong(f"[{scheme}] no preview in a table cell")
    shot(page, f"{scheme}-table")
    page.keyboard.press("Escape")

    caret_after(page, "$\\sqrt{x", 0)
    cdp = page.context.new_cdp_session(page)
    cdp.send("Input.imeSetComposition", {"text": "α", "selectionStart": 1, "selectionEnd": 1})
    page.wait_for_timeout(150)
    cdp.send("Input.insertText", {"text": "α"})
    page.wait_for_timeout(250)
    cdp.detach()
    seen = preview(page)
    if not seen or "α" not in seen["text"]:
        wrong(f"[{scheme}] the preview did not follow a composed character: {seen}")

    page.evaluate("() => window.nibApp.modes.toggleSource()")
    page.wait_for_timeout(300)
    caret_after(page, "$\\sqrt{x", 0)
    seen = shown(page, "the preview in source mode")
    if not seen or not seen["katex"]:
        wrong(f"[{scheme}] no preview in source mode: {seen}")
    shot(page, f"{scheme}-source")
    page.evaluate("() => window.nibApp.modes.toggleSource()")

def phone(page: Page) -> None:
    open_note(page)
    caret_after(page, "$e^{i", 0)
    seen = shown(page, "the preview on a phone")
    say(f"[phone] {json.dumps(seen)}")
    if seen:
        check_inside(seen, "phone")
    shot(page, "phone")

def drive(browser: Browser) -> None:
    backgrounds = {}
    for scheme in ("light", "dark"):
        page = DRIVE.page(browser, viewport={"width": 1180, "height": 820}, color_scheme=scheme)
        DRIVE.open(page)
        desktop(page, scheme)
        caret_after(page, "$\\sqrt{x", 0)
        seen = preview(page)
        backgrounds[scheme] = seen and seen["background"]
        page.context.close()
    if backgrounds["light"] == backgrounds["dark"]:
        wrong(f"the preview looks the same in light and dark: {backgrounds}")

    page = DRIVE.page(browser, viewport={"width": 390, "height": 740}, color_scheme="light", is_mobile=True, has_touch=True)
    DRIVE.open(page)
    phone(page)
    page.context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the formula is drawn live above its source, wherever it is written"))
