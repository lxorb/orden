from __future__ import annotations

import contextlib

import json
from urllib.parse import quote

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
ORIGIN = DRIVE.origin

PLAN = """# The plan

A first paragraph.

## Later

What happens later.
"""

OTHER = "# Other\n\nA second note, which nothing links to.\n"

SEED = """
async ([plan, other]) => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root
  await ws.noteFrom(plan, root)
  await ws.noteFrom(other, root)
  await ws.loadTree()
  return ws.notes.map((one) => one.name)
}
"""

STATE = """
() => {
  const caretLine = () => {
    const view = window.orden
    if (!view) return null
    return view.state.doc.lineAt(view.state.selection.main.head).number - 1
  }

  const ws = window.ordenApp.workspace
  return {
    active: ws.active?.name ?? null,
    text: ws.active?.doc ?? null,
    caret: caretLine(),
    panel: ws.panel,
    tabs: ws.tabs.length,
    names: ws.notes.map((one) => one.name),
    trouble: window.ordenApp.busy.trouble,
    query: window.ordenApp.search.text,
    hits: window.ordenApp.search.hits.length,
    address: window.location.search,
  }
}
"""

EXPECTED = ["'frame-ancestors' is ignored when delivered via a <meta> element"]

def heard(kind: str, text: str) -> None:
    if kind != "error":
        return
    if any(one in text for one in EXPECTED):
        return

    wrong(f"console error: {text}")

def ready(page: Page, label: str) -> None:
    wait_for(page, "window.ordenApp", f"[{label}] the app")
    wait_for(page, "window.ordenApp.workspace.activeSpace", f"[{label}] a space")

def fresh(browser: Browser) -> Page:
    context = browser.new_context(
        viewport={"width": 1280, "height": 820},
        color_scheme="light",
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.on("console", lambda message: heard(message.type, message.text))

    page.goto(ORIGIN, wait_until="domcontentloaded")
    ready(page, "seed")
    say(f"the space holds {page.evaluate(SEED, [PLAN, OTHER])}")
    page.wait_for_timeout(300)
    return page

def follow(page: Page, uri: str, label: str) -> dict:
    with contextlib.suppress(Exception):
        page.wait_for_load_state("networkidle", timeout=10_000)
    page.goto(f"{ORIGIN}/?nib={quote(uri, safe='')}", wait_until="domcontentloaded")
    ready(page, label)
    DRIVE.waited(page, "() => !location.search.includes('nib=')", f"[{label}] the link to be read")
    page.wait_for_timeout(900)
    return page.evaluate(STATE)

def drive_opening(page: Page) -> None:
    state = follow(page, "orden://open?path=The plan.md", "open")
    say(f"[open] {json.dumps({k: state[k] for k in ('active', 'address')})}")
    shot(page, "01-opened")

    if state["active"] != "The plan.md":
        wrong(f"a link to a note did not open it: {state['active']}")
    if "nib=" in state["address"]:
        wrong(f"the link is still in the address: {state['address']!r}")
    if state["trouble"]:
        wrong(f"a link that worked said something went wrong: {state['trouble']!r}")

def drive_heading(page: Page) -> None:
    state = follow(page, "orden://open?path=The plan.md&heading=Later", "heading")
    say(f"[heading] the caret is on line {state['caret']}")
    shot(page, "02-heading")

    if state["active"] != "The plan.md":
        wrong(f"the note did not open: {state['active']}")
    if state["caret"] != 4:
        wrong(f"the link did not land on the heading: line {state['caret']}")

def drive_making(page: Page) -> None:
    made = follow(page, "orden://new?name=From a link&content=# From a link%0A%0AWords.", "new")
    say(f"[new] {json.dumps({k: made[k] for k in ('active', 'names')})}")
    shot(page, "03-made")

    if made["active"] != "From a link.md":
        wrong(f"a link did not make the note: {made['active']}")
    if "Words." not in (made["text"] or ""):
        wrong(f"the words the link carried are not in the note: {made['text']!r}")

    added = follow(
        page,
        "orden://new?path=From a link.md&content=More words.&append",
        "append",
    )
    shot(page, "04-appended")

    if (added["text"] or "").count("From a link") != 1:
        wrong("appending wrote a second note instead of adding to the one that is there")
    if "More words." not in (added["text"] or ""):
        wrong(f"appending did not add the words: {added['text']!r}")
    if "Words." not in (added["text"] or ""):
        wrong(f"appending lost what the note already said: {added['text']!r}")

def drive_appending(page: Page) -> None:
    added = follow(
        page,
        "orden://append?path=From a link.md&content=A line from a link.",
        "append",
    )
    shot(page, "04b-appended-by-its-own-action")

    if added["active"] != "From a link.md":
        wrong(f"appending did not open the note it added to: {added['active']}")
    if (added["text"] or "").count("From a link") != 1:
        wrong("appending wrote a second note instead of adding to the one that is there")
    if "A line from a link." not in (added["text"] or ""):
        wrong(f"appending did not add the words: {added['text']!r}")
    if "Words." not in (added["text"] or ""):
        wrong(f"appending lost what the note already said: {added['text']!r}")
    if added["trouble"]:
        wrong(f"appending said something went wrong: {added['trouble']!r}")

    fresh_note = follow(
        page,
        "orden://append?path=inbox/Not there yet.md&content=The first line.",
        "append-new",
    )
    shot(page, "04c-appended-into-a-new-note")

    if fresh_note["active"] != "Not there yet.md":
        wrong(f"appending did not make the note: {fresh_note['active']}")
    if "The first line." not in (fresh_note["text"] or ""):
        wrong(f"the made note is missing the words: {fresh_note['text']!r}")

def drive_searching(page: Page) -> None:
    state = follow(page, "orden://search?query=happens", "search")
    say(f"[search] panel {state['panel']}, {state['hits']} hits for {state['query']!r}")
    shot(page, "05-searched")

    if state["panel"] != "search":
        wrong(f"a search link did not open the search panel: {state['panel']}")
    if state["query"] != "happens":
        wrong(f"the panel is not asking what the link asked: {state['query']!r}")
    if state["hits"] < 1:
        wrong("the search found nothing in a space that says the word")

def drive_refusals(page: Page) -> None:
    before = page.evaluate("() => window.ordenApp.workspace.notes.length")

    outside = follow(page, "orden://open?path=../../secrets.md", "outside")
    shot(page, "06-refused-path")
    if not outside["trouble"]:
        wrong("a link pointing out of the space said nothing at all")
    if outside["active"] == "secrets.md":
        wrong("a link pointing out of the space opened something")

    declined = follow(page, "orden://files.delete?path=Other.md&yes=true", "declined")
    shot(page, "07-declined")
    if not declined["trouble"]:
        wrong("a link asking to delete a note said nothing at all")
    if "Other.md" not in declined["names"]:
        wrong("a link deleted a note, which no link may do")

    written = follow(page, "orden://files.write?path=Other.md&content=gone&yes=true", "write")
    if "A second note" not in (page.evaluate(READ_OTHER) or ""):
        wrong("a link wrote over a note, which no link may do")
    if not written["trouble"]:
        wrong("a link asking to write over a note said nothing at all")

    again = follow(page, "orden://new?path=Other.md&content=gone", "again")
    if "A second note" not in (page.evaluate(READ_OTHER) or ""):
        wrong("`new` wrote over a note that was already there")
    if not again["trouble"]:
        wrong("`new` on a note that exists said nothing at all")

    after = page.evaluate("() => window.ordenApp.workspace.notes.length")
    if after != before:
        wrong(f"the refusals changed how many notes there are: {before} became {after}")

    say(f"[refusals] {after} notes, untouched")

READ_OTHER = """
async () => {
  const ws = window.ordenApp.workspace
  const found = ws.notes.find((one) => one.name === 'Other.md')
  return found ? await ws.noteText(found.path) : null
}
"""

def main() -> int:
    with DRIVE.session() as browser:
        page = fresh(browser)
        say("--- a link that opens a note ---")
        drive_opening(page)
        say("--- a link that lands on a heading ---")
        drive_heading(page)
        say("--- a link that makes a note, and one that adds to it ---")
        drive_making(page)
        say("--- a link that adds to a note ---")
        drive_appending(page)
        say("--- a link that searches ---")
        drive_searching(page)
        say("--- what a link may not do ---")
        drive_refusals(page)
        page.context.close()

    return DRIVE.verdict("a orden:// link opens, makes, appends and searches, and is refused where it should be")

if __name__ == "__main__":
    raise SystemExit(main())
