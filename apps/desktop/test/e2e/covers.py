from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from settling import HIDE_CARET, quiet, steady

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
SHOTS = DRIVE.shots

WIDE = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAICAYAAADeM14FAAAAGklEQVR42mPQyt/wHxkzkCHwoMvmPzImQwAAFNxO0ZYNS9QAAAAASUVORK5CYII="
)

COVERED = f"---\ntitle: Covered\ncover: {WIDE}\n---\n\n# Covered\n\nWords under the band.\n"
PLAIN = "---\ntitle: Plain\n---\n\n# Plain\n\nWords with nothing over them.\n"

SEED = """
async ([covered, plain]) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(covered, ws.activeSpace.root)
  await ws.noteFrom(plain, ws.activeSpace.root)
  await ws.loadTree()
  return ws.notes.map((one) => one.name).join(', ')
}
"""

OPEN = """
async (starts) => {
  const ws = window.nibApp.workspace
  const found = ws.notes.find((one) => one.name.startsWith(starts))
  await ws.openEntry(found.path, { activate: true })
  return found.path
}
"""

DECODED = (
    "(() => { const one = document.querySelector('#write .nib-cover img');"
    " return !!one && one.complete && one.naturalWidth > 0 })()"
)

BANNER = """
() => {
  const host = document.querySelector('#write')
  const cover = host?.querySelector('.nib-cover')
  const picture = cover?.querySelector('img')
  const heading = host?.querySelector('h1, .cm-line')
  return {
    there: !!cover,
    handle: !!cover?.querySelector('.nib-cover-drag'),
    position: picture ? getComputedStyle(picture).objectPosition : null,
    tall: picture ? Math.round(picture.getBoundingClientRect().height) : 0,
    loaded: !!picture && picture.complete && picture.naturalWidth > 0,
    first: !!cover && !!heading
      ? cover.compareDocumentPosition(heading) === Node.DOCUMENT_POSITION_FOLLOWING
      : null,
  }
}
"""

SAID = "() => window.nibApp.workspace.active?.doc ?? ''"

def is_true(claim: bool, what: str) -> None:
    if not claim:
        wrong(what)

def shot(page: Page, name: str) -> bytes:
    SHOTS.mkdir(parents=True, exist_ok=True)
    where = SHOTS / f"{name}.png"
    bytes_ = steady(page, lambda: page.screenshot(path=str(where)))
    say(f"shot {name}.png")
    return bytes_

def note_shot(page: Page, name: str) -> bytes:
    SHOTS.mkdir(parents=True, exist_ok=True)
    where = SHOTS / f"{name}.png"
    surface = page.locator("#write").first
    bytes_ = steady(page, lambda: surface.screenshot(path=str(where)))
    say(f"shot {name}.png")
    return bytes_

def open_note(page: Page, starts: str) -> None:
    page.evaluate(OPEN, starts)
    wait_for(
        page,
        "window.nibApp.workspace.active?.name?.startsWith("
        f"{json.dumps(starts)}) && document.querySelector('#write')",
        f"the {starts} note to be open",
    )
    quiet(page)

def the_editor(page: Page) -> None:
    open_note(page, "Covered")
    DRIVE.waited(page, DECODED, "the cover's picture in the editor", patience=10)
    banner = page.evaluate(BANNER)
    say(f"[editor] {json.dumps(banner)}")
    is_true(banner["loaded"], "the editor's band shows no picture")

    is_true(banner["there"], "the editor draws no banner for a note that names a cover")
    is_true(banner["handle"], "the banner has nothing to take hold of")
    is_true(banner["first"], "the banner is not above the note")
    is_true(banner["tall"] > 60, f"the banner is only {banner['tall']} pixels tall")
    is_true(
        banner["position"].endswith("50%"),
        f"a cover that said nothing does not start in the middle: {banner['position']}",
    )
    shot(page, "01-editor")

    page.evaluate(
        "() => { const at = window.nib.state.doc.toString().indexOf('cover:') + 3;"
        " window.nib.dispatch({ selection: { anchor: at } }); window.nib.focus() }"
    )
    quiet(page)
    inside = page.evaluate(BANNER)
    say(f"[editor, caret in the metadata] {json.dumps(inside)}")
    is_true(inside["there"], "the banner went away when the caret entered the front matter")
    shot(page, "02-editor-source")

def the_drag(page: Page) -> None:
    open_note(page, "Covered")
    handle = page.locator("#write .nib-cover-drag").first
    box = handle.bounding_box()
    if not box:
        wrong("the banner has no handle to drag")
        return

    middle_x = box["x"] + box["width"] / 2
    middle_y = box["y"] + box["height"] / 2
    page.mouse.move(middle_x, middle_y)
    page.mouse.down()
    page.mouse.move(middle_x, middle_y - box["height"] / 3, steps=8)
    page.mouse.up()
    quiet(page)

    said = page.evaluate(SAID)
    say(f"[dragged] {json.dumps(said.split(chr(10))[:4])}")
    is_true("cover-position:" in said, "the drag wrote no position into the note")

    line = next((one for one in said.split("\n") if one.startswith("cover-position:")), "")
    number = line.split(":", 1)[1].strip() if ":" in line else ""
    is_true(number.isdigit(), f"the position is not a whole number: {number!r}")
    is_true(number != "50", "the drag left the band where it found it")
    shot(page, "03-dragged")

    page.keyboard.press("Control+z")
    quiet(page)
    is_true(
        "cover-position:" not in page.evaluate(SAID),
        "undoing the drag left part of it behind",
    )

def the_reading_view(page: Page) -> None:
    open_note(page, "Covered")
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    wait_for(page, "document.querySelector('article#write')", "the reading view")
    quiet(page)

    DRIVE.waited(page, DECODED, "the cover's picture in the reading view", patience=10)
    banner = page.evaluate(BANNER)
    say(f"[reading] {json.dumps(banner)}")
    is_true(banner["loaded"], "the reading view's band shows no picture")
    is_true(banner["there"], "the reading view draws no banner")
    is_true(banner["first"], "the banner is not above the note in the reading view")
    is_true(not banner["handle"], "the reading view offers a drag handle it cannot honour")
    shot(page, "04-reading")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    quiet(page)

def a_note_with_no_cover(page: Page, round_: str) -> tuple[bytes, bytes]:
    open_note(page, "Plain")
    banner = page.evaluate(BANNER)
    is_true(not banner["there"], "a note with no cover was given a banner anyway")
    written = note_shot(page, f"{round_}-plain-editor")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    wait_for(page, "document.querySelector('article#write')", "the reading view")
    quiet(page)
    is_true(
        not page.evaluate(BANNER)["there"],
        "a note with no cover was given a banner in the reading view",
    )
    read = note_shot(page, f"{round_}-plain-reading")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    quiet(page)
    return written, read

def drive(browser: Browser) -> None:
    context = browser.new_context(
        viewport={"width": 1180, "height": 820},
        color_scheme="light",
        accept_downloads=True,
    )
    context.add_init_script(HIDE_CARET)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "window.nibApp.workspace.active", "the app to open its own note")
    say(f"the space holds {page.evaluate(SEED, [COVERED, PLAIN])}")

    before = a_note_with_no_cover(page, "05")

    the_editor(page)
    the_drag(page)
    the_reading_view(page)

    after = a_note_with_no_cover(page, "07")
    is_true(before[0] == after[0], "the plain note is not drawn the same way twice in the editor")
    is_true(before[1] == after[1], "the plain note is not drawn the same way twice when read")

    context.close()

def main() -> int:
    return DRIVE.run(drive, "a note's cover is drawn where a note is drawn")

if __name__ == "__main__":
    raise SystemExit(main())
