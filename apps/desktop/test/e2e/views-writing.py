"""What a person writing meets: a block paste, a list key, a block's handle, and a draft
on a phone. Each step is the words the note holds afterwards, read from the editor.

    python apps/desktop/test/e2e/views-writing.py
"""

from __future__ import annotations

from harness import Drive

DRIVE = Drive(__file__)
say, wrong = DRIVE.say, DRIVE.wrong

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)

counter = {"n": 0}


def note(page, words):
    """A note of its own, its body after a title line, and the caret at its start."""
    counter["n"] += 1
    title = f"T{counter['n']}x"
    DRIVE.seed(page, f"# {title}\n\n{words}")
    DRIVE.open_note(page, title)
    page.wait_for_timeout(250)


def body(page):
    whole = page.evaluate("() => window.nib.state.doc.toString()")
    return whole.split("\n\n", 1)[1]


def caret(page, words, offset=0):
    """The caret `offset` past where `words` begin in the note."""
    page.evaluate(
        """([words, offset]) => {
            const view = window.nib
            view.focus()
            view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(words) + offset } })
        }""",
        [words, offset],
    )
    page.wait_for_timeout(80)


def select(page, words):
    page.evaluate(
        """(words) => {
            const view = window.nib
            const at = view.state.doc.toString().indexOf(words)
            view.focus()
            view.dispatch({ selection: { anchor: at, head: at + words.length } })
        }""",
        words,
    )
    page.wait_for_timeout(80)


def paste(page, text="", html="", image=False):
    page.evaluate(
        """([text, html, image]) => {
            const data = new DataTransfer()
            if (text) data.setData('text/plain', text)
            if (html) data.setData('text/html', html)
            if (image) data.items.add(new File([new Uint8Array([137])], 'image.png', { type: 'image/png' }))
            document.activeElement.dispatchEvent(
                new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
            )
        }""",
        [text, html, image],
    )
    page.wait_for_timeout(350)


def holds(page, what, wanted):
    got = body(page)
    if got.rstrip("\n") != wanted.rstrip("\n"):
        wrong(f"{what}: {got!r}, wanted {wanted!r}")
    else:
        say(f"ok: {what}")


def handle(page, words):
    """The grip beside a line, pressed: the block's menu opens."""
    caret(page, words)
    spot = page.evaluate(
        """(words) => {
            const view = window.nib
            const at = view.state.doc.toString().indexOf(words)
            return view.coordsAtPos(view.state.doc.lineAt(at).from)
        }""",
        words,
    )
    page.mouse.move(spot["left"] + 5, spot["top"] + 3)
    page.wait_for_timeout(120)
    grip = page.evaluate(
        """(y) => {
            const all = [...document.querySelectorAll('.nib-block-handle')]
                .map((one) => one.getBoundingClientRect())
                .filter((one) => one.width > 0)
            all.sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y))
            return all[0] && { x: all[0].x + all[0].width / 2, y: all[0].y + all[0].height / 2 }
        }""",
        spot["top"] + 8,
    )
    page.mouse.move(grip["x"], grip["y"])
    page.mouse.click(grip["x"], grip["y"])
    page.wait_for_timeout(200)


def choose(page, label):
    page.locator("[role=menu] [role=menuitem],[role=menu] button", has_text=label).first.click()
    page.wait_for_timeout(250)


def pasting(page):
    table = "| a | b |\n| --- | --- |\n| c | d |"

    note(page, "abc def\n")
    caret(page, "def")
    paste(page, text="a\tb\nc\td")
    holds(page, "cells pasted in a line are a table", f"abc\n\n{table}\n\ndef")
    caret(page, "def")
    if page.locator("table.nib-table").count() != 1:
        wrong("the pasted cells are not drawn as a table")

    note(page, "abc def\n")
    caret(page, "abc def", 7)
    paste(page, text="Head", html="<h2>Head</h2>")
    holds(page, "a heading pasted after words is a heading", "abc def\n\n## Head")

    note(page, "start\n")
    caret(page, "start", 5)
    page.keyboard.press("Enter")
    page.keyboard.type("- ")
    paste(page, text="x\ny", html="<ul><li>x</li><li>y</li></ul>")
    holds(page, "a list on an empty item", "start\n- x\n- y")

    note(page, "start\n")
    caret(page, "start", 5)
    page.keyboard.press("Enter")
    page.keyboard.type("- ")
    paste(page, text="- p\n- q")
    holds(page, "plain text list on an empty item", "start\n- p\n- q")

    note(page, "here: \n")
    caret(page, "here: ", 6)
    paste(page, text="Name\tAge\nBob\t3", html="<table><tr><td>Name</td><td>Age</td></tr></table>", image=True)
    holds(page, "cells beside a picture of them", "here:\n\n| Name | Age |\n| --- | --- |\n| Bob | 3 |")


def keys(page):
    note(page, "1. x\n2. y\n3. z\n")
    caret(page, "2. y", 3)
    page.keyboard.press("Tab")
    holds(page, "Tab under a number nests", "1. x\n   1. y\n3. z")
    page.keyboard.press("Shift+Tab")
    holds(page, "Shift Tab comes back", "1. x\n2. y\n3. z")

    note(page, "**word** tail\n")
    select(page, "word")
    page.keyboard.press("Control+i")
    page.wait_for_timeout(100)
    holds(page, "italic over bold adds to it", "***word*** tail")
    page.keyboard.press("Control+i")
    page.wait_for_timeout(100)
    holds(page, "and comes off", "**word** tail")

    note(page, "a\n\n| x |\n| - |\n| 1 |\n\nb\n")
    caret(page, "a")
    page.keyboard.press("Alt+ArrowDown")
    page.wait_for_timeout(100)
    holds(page, "Alt Down steps over a table", "| x |\n| - |\n| 1 |\n\na\n\nb")
    if page.locator("table.nib-table").count() != 1:
        wrong("the table stopped being one")


SECTION = (
    "# Head\n\npara\n\n- item a\n- [ ] task b\n\n> quoted\n\n```py\n# comment\n- dash\n```\n\n"
    "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n## Sub\n\nunder\n\n# Next\n\nkeep\n"
)


def menus(page):
    for shape, line in (("Heading 2", "## Head"), ("Bullet", "- Head")):
        note(page, SECTION)
        handle(page, "# Head")
        choose(page, "Turn into")
        page.locator("[role=dialog] button,[role=option],[role=menuitem]", has_text=shape).first.click()
        page.wait_for_timeout(300)
        holds(page, f"turning a heading into {shape}", SECTION.replace("# Head", line))

    for name, words, press in (
        ("a fence", "before\n\n```py\ncode\n```\n\nafter\n", "code"),
        ("a table", "before\n\n| a |\n| --- |\n| 1 |\n\nafter\n", "| a |"),
    ):
        note(page, words)
        handle(page, press)
        choose(page, "Copy link")
        page.wait_for_timeout(300)
        got = body(page)
        said = page.evaluate("() => navigator.clipboard.readText()")
        id_ = said.rsplit("^", 1)[-1].rstrip(")]")
        if f"\n\n^{id_}\n\nafter" not in got:
            wrong(f"the name of {name} is not on a line of its own: {got!r}, link {said!r}")
        else:
            say(f"ok: the name of {name} stands under it")
    if page.locator(".cm-content table.nib-table td", has_text="^").count():
        wrong("a table grew a cell with the name in it")


def tap(page, locator):
    box = locator.bounding_box()
    page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.wait_for_timeout(350)


def phone(browser):
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        user_agent=PHONE_AGENT,
        has_touch=True,
        is_mobile=True,
    )
    page = context.new_page()
    DRIVE.open(page)
    tabs = "window.nibApp.workspace.tabs"
    named = "window.nibApp.workspace.notes.some((one) => one.name.includes(%r))"

    tap(page, page.locator("button.fab"))
    page.keyboard.type("Shopping list")
    page.wait_for_timeout(100)
    page.keyboard.press("Enter")
    page.wait_for_timeout(100)
    page.keyboard.type("milk and eggs")
    page.wait_for_timeout(300)

    # The plus again: the words must be a note in the list, and the new tab empty.
    tap(page, page.locator("button.fab"))
    DRIVE.wait_for(page, f"() => {named % 'Shopping list'}", "the draft to be written down")
    DRIVE.wait_for(page, f"() => {tabs}.length === 1", "the draft's tab to go")
    if page.evaluate(f"() => {tabs}[0].doc"):
        wrong("the new tab is not empty")
    say("ok: a draft the plus put away is a note")

    # A tap first: on this Android agent keys pressed right after the plus, with a note
    # with words before it, reach CodeMirror's EditContext and not the note, with or
    # without a draft being written down.
    tap(page, page.locator(".cm-content"))
    page.keyboard.type("Second thought")
    page.wait_for_timeout(1000)
    if page.evaluate("() => window.nib.state.doc.toString()") != "Second thought":
        wrong("what is typed after the plus did not land")
    page.evaluate("() => window.nibApp.workspace.open(window.nibApp.workspace.notes[0].path)")
    DRIVE.wait_for(page, f"() => {named % 'Second thought'}", "the second draft to be written down")
    say("ok: and so is one left by opening another")
    context.close()


def drive(browser):
    page = DRIVE.page(
        browser,
        viewport={"width": 1180, "height": 900},
        permissions=["clipboard-read", "clipboard-write"],
    )
    DRIVE.open(page)
    pasting(page)
    keys(page)
    menus(page)
    phone(browser)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the writing holds"))
