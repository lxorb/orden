from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

HEAD = "() => window.orden.state.selection.main.head"
SET = "(text) => { const v = window.orden; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } }) }"
CARET = "(at) => { const v = window.orden; v.dispatch({ selection: { anchor: at } }); v.focus() }"

RTL = "# عنوان\n\nمرحبا بالعالم\n\n- عنصر واحد\n\nplain words\n"


def at(page: Page, pos: int) -> None:
    page.evaluate(CARET, pos)
    page.wait_for_timeout(100)


def check(label: str, got: object, want: object) -> None:
    if got != want:
        wrong(f"[{label}] {got!r}, not {want!r}")
    else:
        say(f"[{label}] ok")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1100, "height": 800})
    DRIVE.open(page)
    DRIVE.seed(page, "# RTL\n\nx\n")
    DRIVE.open_note(page, "RTL")
    page.locator(".cm-content").first.click()
    page.evaluate(SET, RTL)
    page.wait_for_timeout(300)

    word = RTL.index("بالعالم")
    line_from = RTL.index("مرحبا")
    line_to = line_from + len("مرحبا بالعالم")
    at(page, word)
    page.keyboard.press("End")
    check("End goes to where the line ends", page.evaluate(HEAD), line_to)
    at(page, word)
    page.keyboard.press("Home")
    check("Home goes to where the line starts", page.evaluate(HEAD), line_from)
    at(page, word)
    page.keyboard.press("ArrowLeft")
    check("Left moves on through a right-to-left line", page.evaluate(HEAD), word + 1)
    at(page, word)
    page.keyboard.press("ArrowRight")
    check("Right moves back through it", page.evaluate(HEAD), word - 1)

    item = RTL.index("واحد")
    at(page, item)
    page.keyboard.press("ArrowLeft")
    check("Left in a right-to-left list item", page.evaluate(HEAD), item + 1)

    plain = RTL.index("words")
    at(page, plain)
    page.keyboard.press("ArrowLeft")
    check("Left in a left-to-right line is still back", page.evaluate(HEAD), plain - 1)
    shot(page, "lines")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "Home, End and the arrows go the way each line reads"))
