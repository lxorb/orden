from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from settling import HIDE_CARET, quiet

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for


def shot(page: Page, name: str) -> None:
    quiet(page)
    DRIVE.shot(page, name)


NOTE = (
    "---\n"
    "title: A note\n"
    "count: 3\n"
    "due: 2026-09-14\n"
    "done: false\n"
    "tags: [one, two]\n"
    "icon-color: violet\n"
    "---\n"
    "\n"
    "# A note\n"
    "\n"
    "Words under the metadata.\n"
)

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith('A note'))
  await ws.openEntry(found.path, { activate: true })
  return found.name
}
"""

SAID = "() => window.nibApp.workspace.active?.note?.latest ?? ''"

CONTROLS = """
() => {
  const out = {}
  for (const row of document.querySelectorAll('#write .property')) {
    const cell = row.querySelector('.property-value')
    const chips = cell?.querySelector('.property-chip, .property-add')
    const control = chips ? null : cell?.querySelector('input, select')
    out[row.dataset.key] = control
      ? `${control.tagName.toLowerCase()}:${control.getAttribute('type') ?? ''}`
      : [...cell.children].map((one) => one.className.split(' ')[0]).join(',')
  }
  return out
}
"""

ROWS = "() => [...document.querySelectorAll('#write .property')].map((row) => row.dataset.key)"
SOURCE = "() => !!document.querySelector('#write .properties-source')"


def is_true(claim: bool, what: str) -> None:
    if not claim:
        wrong(what)


def line(page: Page, key: str) -> str:
    said = page.evaluate(SAID)
    return next((one for one in said.split("\n") if one.startswith(f"{key}:")), "")


def the_controls(page: Page) -> None:
    controls = page.evaluate(CONTROLS)
    say(f"[controls] {json.dumps(controls, ensure_ascii=False)}")

    wanted = {
        "title": "input:text",
        "count": "input:number",
        "due": "input:date",
        "done": "input:checkbox",
        "icon-color": "select:",
    }
    for key, shape in wanted.items():
        is_true(
            controls.get(key) == shape,
            f"the {key} row is {controls.get(key)!r} rather than {shape}",
        )

    is_true(
        controls.get("tags", "").startswith("property-chip,property-chip"),
        f"the tags row is {controls.get('tags')!r} rather than chips and a field",
    )
    is_true(
        "property-add" in controls.get("tags", ""),
        "the list row has no field to add an item with",
    )
    shot(page, "01-rows")


def a_word_and_a_number(page: Page) -> None:
    page.fill("#write .property[data-key='title'] .property-field", "Another name")
    page.locator("#write .property[data-key='count'] .property-field").click()
    quiet(page)
    is_true(bool(page.evaluate(ROWS)), "writing a row turned the rows back into source")
    is_true(line(page, "title") == "title: Another name", f"the title is {line(page, 'title')!r}")

    page.fill("#write .property[data-key='count'] .property-field", "42")
    page.locator("#write .property[data-key='title'] .property-field").click()
    quiet(page)
    is_true(line(page, "count") == "count: 42", f"the count is {line(page, 'count')!r}")

    page.locator("#write .cm-line", has_text="Words under the metadata").click()
    page.keyboard.press("Control+z")
    quiet(page)
    is_true(line(page, "count") == "count: 3", f"undoing left {line(page, 'count')!r}")


def a_checkbox_and_a_date(page: Page) -> None:
    page.check("#write .property[data-key='done'] .property-box")
    quiet(page)
    is_true(line(page, "done") == "done: true", f"the checkbox wrote {line(page, 'done')!r}")

    page.fill("#write .property[data-key='due'] .property-field", "2026-12-24")
    page.locator("#write .property[data-key='title'] .property-field").click()
    quiet(page)
    is_true(line(page, "due") == "due: 2026-12-24", f"the date is {line(page, 'due')!r}")


def a_list(page: Page) -> None:
    page.fill("#write .property[data-key='tags'] .property-add", "three")
    page.keyboard.press("Enter")
    quiet(page)
    is_true(line(page, "tags") == "tags: [one, two, three]", f"adding wrote {line(page, 'tags')!r}")

    page.locator("#write .property[data-key='tags'] .property-chip-off").first.click()
    quiet(page)
    is_true(line(page, "tags") == "tags: [two, three]", f"removing wrote {line(page, 'tags')!r}")
    shot(page, "02-list")


def a_menu(page: Page) -> None:
    page.select_option("#write .property[data-key='icon-color'] .property-menu", "teal")
    quiet(page)
    is_true(
        line(page, "icon-color") == "icon-color: teal",
        f"the menu wrote {line(page, 'icon-color')!r}",
    )


def adding_a_property(page: Page) -> None:
    before = page.evaluate(ROWS)
    page.locator("#write .nib-property-add").click()
    quiet(page)

    said = page.evaluate(SAID)
    is_true("property" in said.split("---")[1], "Add a property wrote no new key")
    is_true(not page.evaluate(ROWS), "the block did not give way to its source")
    page.keyboard.press("Escape")
    page.keyboard.press("Control+z")
    quiet(page)
    say(f"[add] the rows were {json.dumps(before)}")


def the_three_answers(page: Page) -> None:
    for mode, rows, source in [("source", False, True), ("hidden", False, False)]:
        page.evaluate("(mode) => window.nibApp.modes.setProperties(mode)", mode)
        quiet(page)
        drawn = page.evaluate(ROWS)
        is_true(bool(drawn) == rows, f"{mode} drew rows: {json.dumps(drawn)}")
        shot(page, f"03-editor-{mode}")

        page.evaluate("() => window.nibApp.workspace.toggleReading()")
        wait_for(page, "document.querySelector('article#write')", "the reading view")
        quiet(page)
        read = page.evaluate(ROWS)
        is_true(bool(read) == rows, f"{mode} drew rows when read: {json.dumps(read)}")
        is_true(
            page.evaluate(SOURCE) == source,
            f"{mode} drew the source when read: {page.evaluate(SOURCE)}",
        )
        shot(page, f"04-reading-{mode}")

        page.evaluate("() => window.nibApp.workspace.toggleReading()")
        quiet(page)

    page.evaluate("() => window.nibApp.modes.setProperties('properties')")
    quiet(page)
    is_true(
        page.evaluate("() => !!document.querySelector('#write .nib-properties-head')"),
        "the strip did not come back",
    )
    if not page.evaluate(ROWS):
        page.click("#write .nib-properties-head")
        quiet(page)
    is_true(bool(page.evaluate(ROWS)), "the rows did not come back")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    wait_for(page, "document.querySelector('article#write')", "the reading view")
    quiet(page)
    is_true(bool(page.evaluate(ROWS)), "the rows did not come back when read")
    shot(page, "05-reading-rows")
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    quiet(page)


def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1180, "height": 860}, color_scheme="light")
    context.add_init_script(HIDE_CARET)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "window.nibApp.workspace.active", "the app to open its own note")
    say(f"the space holds {page.evaluate(SEED, NOTE)}")
    page.evaluate("() => window.nibApp.modes.setProperties('properties')")
    wait_for(page, "document.querySelector('#write .nib-properties-head')", "the strip")
    quiet(page)
    is_true(not page.evaluate(ROWS), "the strip opened on its own")
    folded = page.inner_text("#write .nib-properties-head")
    say(f"[folded] {folded!r}")
    is_true("title" in folded and "one, two" in folded, "the folded strip says nothing")
    shot(page, "00-folded")

    page.click("#write .nib-properties-head")
    wait_for(
        page,
        "document.querySelector('#write .property[data-key=\\'tags\\']')",
        "the rows to be drawn",
    )
    quiet(page)

    the_controls(page)
    a_word_and_a_number(page)
    a_checkbox_and_a_date(page)
    a_list(page)
    a_menu(page)
    adding_a_property(page)
    the_three_answers(page)

    say(f"[note] {json.dumps(page.evaluate(SAID).split('---')[1])}")
    context.close()


def main() -> int:
    return DRIVE.run(drive, "every property row is edited in the control its shape asks for")


if __name__ == "__main__":
    raise SystemExit(main())
