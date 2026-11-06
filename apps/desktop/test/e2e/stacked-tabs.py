from __future__ import annotations

import json

from playwright.sync_api import Browser, BrowserContext, Page

from settling import HIDE_CARET, quiet

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for


def shot(page: Page, name: str) -> None:
    quiet(page)
    DRIVE.shot(page, name)


NAMES = ["First", "Second", "Third", "Fourth", "Fifth"]
NOTES = [(f"{name}.md", f"# {name}\n\nThe words of the {name.lower()} note.\n") for name in NAMES]

SEED = """
async (notes) => {
  const ws = window.nibApp.workspace
  for (const [, text] of notes) await ws.noteFrom(text, ws.activeSpace.root)
  await ws.loadTree()

  // The welcome note a first visit is given goes first, so what the pane holds is what
  // this drive put in it and the numbers below are its own.
  for (const tab of [...ws.tabs]) ws.close(tab.id)

  for (const [name] of notes) {
    const found = ws.notes.find((one) => one.name === name)
    await ws.openEntry(found.path, { activate: true })
  }

  return ws.tabs.map((one) => one.shown)
}
"""

STACKED = '.stack[data-region="editor"]'

STACK = """
() => {
  const STACKED = '.stack[data-region="editor"]'
  const stack = document.querySelector(STACKED)
  const columns = [...document.querySelectorAll(`${STACKED} .column`)]
  return {
    stacked: !!stack,
    columns: columns.length,
    editors: document.querySelectorAll(`${STACKED} .cm-content`).length,
    spines: columns.map((one) => one.querySelector('.spine')?.textContent?.trim() ?? ''),
    active: columns.findIndex((one) => one.classList.contains('is-active')),
    widths: columns.map((one) => Math.round(one.getBoundingClientRect().width)),
    scrolls: stack ? stack.scrollWidth > stack.clientWidth + 1 : false,
    plain: document.querySelectorAll('.editor').length,
  }
}
"""

SPINE_AT = """
(index) => {
  const STACKED = '.stack[data-region="editor"]'
  const stack = document.querySelector(STACKED)
  const spine = document.querySelectorAll(`${STACKED} .column`)[index]?.querySelector('.spine')
  if (!stack || !spine) return null
  return Math.round(spine.getBoundingClientRect().left - stack.getBoundingClientRect().left)
}
"""


def is_true(claim: bool, what: str) -> None:
    if not claim:
        wrong(what)


def opened(browser: Browser, finger: bool = False) -> tuple[BrowserContext, Page]:
    context = browser.new_context(
        viewport={"width": 420, "height": 880} if finger else {"width": 1400, "height": 880},
        color_scheme="light",
        has_touch=finger,
        is_mobile=finger,
        **(
            {
                "user_agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
                " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
            }
            if finger
            else {}
        ),
    )
    context.add_init_script(HIDE_CARET)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "window.nibApp.workspace.active", "the app to open its own note")
    say(f"the space holds {json.dumps(page.evaluate(SEED, NOTES))}")
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    quiet(page)
    return context, page


def stack(page: Page) -> dict:
    return page.evaluate(STACK)


def off_by_default(page: Page) -> None:
    said = stack(page)
    say(f"[off] {json.dumps(said)}")

    is_true(not said["stacked"], "a pane opens stacked")
    is_true(said["plain"] == 1, f"a pane that is not stacked has {said['plain']} editors")
    is_true(
        not page.evaluate("() => window.nibApp.workspace.stacked()"),
        "the pane says it is stacked before anybody asked",
    )
    is_true(
        page.evaluate("() => window.nibApp.workspace.canStack()"),
        "a pane holding three notes says it cannot stack them",
    )
    shot(page, "01-off")


def the_columns(page: Page) -> None:
    page.evaluate("() => window.nibApp.workspace.toggleStacked()")
    quiet(page)

    said = stack(page)
    say(f"[stacked] {json.dumps(said)}")

    is_true(said["stacked"], "turning it on drew no columns")
    is_true(
        said["columns"] == len(NAMES),
        f"the pane drew {said['columns']} columns rather than {len(NAMES)}",
    )
    is_true(
        said["editors"] == len(NAMES),
        f"{said['editors']} editors are alive rather than {len(NAMES)}",
    )
    is_true(said["spines"] == NAMES, f"the spines say {said['spines']}")
    is_true(
        said["active"] == len(NAMES) - 1,
        f"column {said['active']} is the active one rather than the last",
    )
    widest = max(said["widths"])
    is_true(
        said["widths"][said["active"]] == widest,
        f"the active column is not the widest: {said['widths']}",
    )
    is_true(said["scrolls"], "the row of columns does not scroll sideways")
    shot(page, "02-stacked")


def the_spine(page: Page) -> None:
    before = page.evaluate(SPINE_AT, 0)
    page.evaluate(f"() => {{ document.querySelector('{STACKED}').scrollLeft = 260 }}")
    quiet(page)
    after = page.evaluate(SPINE_AT, 0)
    say(f"[spine] the first spine was {before} from the edge and is now {after}")

    is_true(after is not None and after >= 0, f"the spine went off the edge: {after}")
    page.evaluate(f"() => {{ document.querySelector('{STACKED}').scrollLeft = 0 }}")
    quiet(page)

    page.locator(f"{STACKED} .column .spine").first.click()
    quiet(page)
    said = stack(page)
    say(f"[spine] the active column is now {said['active']}")
    is_true(said["active"] == 0, "pressing the first spine did not make it the active column")
    is_true(
        page.evaluate("() => window.nibApp.workspace.active?.shown") == "First",
        "the pane is showing something other than the note whose spine was pressed",
    )
    shot(page, "03-first-active")


def a_pane_of_its_own(page: Page) -> None:
    page.evaluate("() => window.nibApp.workspace.split('row')")
    quiet(page)

    panes = page.evaluate("() => window.nibApp.workspace.panes.all.map((one) => one.id)")
    stacks = page.evaluate(
        "() => window.nibApp.workspace.panes.all.map((one) => one.stacked)",
    )
    say(f"[split] the panes are {json.dumps(panes)} and say {json.dumps(stacks)}")

    is_true(len(panes) == 2, f"the split made {len(panes)} panes")
    is_true(stacks.count(True) == 1, f"both panes say {json.dumps(stacks)}")
    shot(page, "04-split")

    page.evaluate("() => window.nibApp.workspace.persist()")
    page.reload(wait_until="domcontentloaded")
    wait_for(page, "window.nibApp", "the app again")
    wait_for(page, "window.nibApp.workspace.active", "a note again")
    quiet(page)

    kept = page.evaluate("() => window.nibApp.workspace.panes.all.map((one) => one.stacked)")
    say(f"[restored] the panes say {json.dumps(kept)}")
    is_true(kept.count(True) == 1, f"the arrangement came back as {json.dumps(kept)}")
    shot(page, "05-restored")


def a_handheld(browser: Browser) -> None:
    context, page = opened(browser, finger=True)

    is_true(
        not page.evaluate("() => window.nibApp.workspace.canStack()"),
        "a phone says its pane can stack its notes",
    )
    is_true(not stack(page)["stacked"], "a phone drew columns")
    shot(page, "06-phone")
    context.close()


def drive(browser: Browser) -> None:
    context, page = opened(browser)

    off_by_default(page)
    the_columns(page)
    the_spine(page)
    a_pane_of_its_own(page)

    context.close()
    a_handheld(browser)


def main() -> int:
    return DRIVE.run(drive, "a pane lays its notes out as columns when it is asked to")


if __name__ == "__main__":
    raise SystemExit(main())
