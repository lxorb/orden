from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
failures = DRIVE.failures
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots

FILLER = "\n\n".join(f"Paragraph {n} of the body, here to make the note tall." for n in range(60))
FIRST = f"# Smoke\n\nA line with **stout** in it, and *slanted* too.\n\n{FILLER}\n"

SECOND = "# Second\n\nThe second note says quinine and nothing else.\n"

SEED = """
async ([first, second]) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(first, ws.activeSpace.root)
  await ws.noteFrom(second, ws.activeSpace.root)
  await ws.loadTree()
  const named = (start) => ws.notes.find((one) => one.name.startsWith(start))
  await ws.openEntry(named('Smoke').path, { activate: true })
  await ws.openEntry(named('Second').path, { activate: true })
  return ws.notes.length
}
"""

SHOW = """
async (start) => {
  const ws = window.nibApp.workspace
  const tab = ws.tabs.find((one) => one.note?.name?.startsWith(start))
  if (!tab) return null
  ws.activate(tab.id)
  return tab.note.name
}
"""

def show(page: Page, start: str) -> None:
    if not page.evaluate(SHOW, start):
        raise SystemExit(f"there is no tab on a note called {start}")

    wait_for(
        page,
        f"window.nibApp.workspace.active?.note?.name?.startsWith({json.dumps(start)})",
        f"the {start} tab to come forward",
    )
    page.wait_for_timeout(120)
    page.evaluate("() => { const s = document.querySelector('.cm-scroller'); if (s) s.scrollTop = 0 }")
    page.wait_for_timeout(60)

def rows_now(page: Page) -> int:
    return page.evaluate("() => document.querySelectorAll('.orden-row').length")

def weight_of(page: Page, words: str) -> float:
    return page.evaluate(
        """
        (words) => {
          const content = document.querySelector('.cm-content')
          if (!content) return 0
          const walk = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
          let heaviest = 0
          for (let node = walk.nextNode(); node; node = walk.nextNode()) {
            if (!node.textContent.includes(words)) continue
            for (let el = node.parentElement; el && el !== content; el = el.parentElement) {
              const weight = parseInt(getComputedStyle(el).fontWeight, 10) || 0
              if (weight > heaviest) heaviest = weight
            }
          }
          return heaviest
        }
        """,
        words,
    )

def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1180, "height": 820}, color_scheme="light")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "window.nibApp.workspace.active", "the app to open its own note")
    say(f"the space holds {page.evaluate(SEED, [FIRST, SECOND])} notes")
    wait_for(page, "document.querySelector('.cm-content')", "the writing surface")
    stamp = page.evaluate("() => window.nibBuild || 'unstamped'")
    say(f"driving build {stamp}")

    show(page, "Smoke")
    shot(page, "01-smoke")

    stout = weight_of(page, "stout")
    plain = weight_of(page, "A line with")
    if stout < 600:
        wrong(f"**stout** is drawn at weight {stout}, which is not bold")
    elif stout <= plain:
        wrong(f"**stout** at {stout} is no heavier than the line around it at {plain}")
    else:
        say(f"bold is {stout} against {plain} for the line it sits in")

    heading, body = page.evaluate(
        """
        () => {
          const size = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : 0)
          const content = document.querySelector('.cm-content')
          const lines = [...content.querySelectorAll('.cm-line')]
          const head = lines.find((one) => one.textContent.includes('Smoke'))
          const para = lines.find((one) => one.textContent.startsWith('Paragraph 1'))
          return [size(head), size(para)]
        }
        """
    )
    if heading <= body:
        wrong(f"the heading is {heading}px against {body}px of body text, so it is not a heading")
    else:
        say(f"the heading is {heading}px against {body}px")

    typed = page.evaluate(
        """
        () => {
          const view = window.nib
          if (!view) return false
          view.dispatch({ selection: { anchor: view.state.doc.length } })
          view.focus()
          return true
        }
        """
    )
    if not typed:
        say("no view handle in this build; the typed-bold question is skipped")
    else:
        page.keyboard.press("Enter")
        page.keyboard.press("Enter")
        page.keyboard.type("Typed **marzipan** here.")
        page.wait_for_timeout(250)
        page.keyboard.press("Home")
        page.keyboard.press("ArrowUp")
        page.wait_for_timeout(300)
        weight = weight_of(page, "marzipan")
        if weight < 600:
            wrong(f"**marzipan** typed into the note is drawn at weight {weight}")
        else:
            say(f"bold typed into the note came out at {weight}")
        shot(page, "01b-typed")

    room = page.evaluate(
        """
        () => {
          const scroller = document.querySelector('.cm-scroller')
          if (!scroller) return null
          return { over: scroller.scrollHeight - scroller.clientHeight, at: scroller.scrollTop }
        }
        """
    )
    if room is None:
        wrong("there is no scroller in the editor at all")
    elif room["over"] <= 1:
        wrong(f"a sixty paragraph note has {room['over']}px to scroll, so it does not scroll")
    else:
        moved = page.evaluate(
            """
            () => {
              const scroller = document.querySelector('.cm-scroller')
              scroller.scrollTop = 400
              return scroller.scrollTop
            }
            """
        )
        if moved < 200:
            wrong(f"the scroller was asked for 400px and went to {moved}px")
        else:
            say(f"the note has {room['over']}px to scroll and went to {moved}px")

        page.evaluate("() => { document.querySelector('.cm-scroller').scrollTop = 0 }")
        page.wait_for_timeout(60)
        box = page.evaluate(
            """
            () => {
              const r = document.querySelector('.cm-scroller').getBoundingClientRect()
              return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
            }
            """
        )
        page.mouse.move(box["x"], box["y"])
        page.mouse.wheel(0, 600)
        page.wait_for_timeout(300)
        wheeled = page.evaluate("() => document.querySelector('.cm-scroller').scrollTop")
        if wheeled < 100:
            wrong(f"a 600px wheel over the note moved it {wheeled}px, so it does not scroll")
        else:
            say(f"a 600px wheel moved the note {wheeled}px")
        shot(page, "02-scrolled")

    for name, mine, theirs in [
        ("Second", "quinine", "stout"),
        ("Smoke", "stout", "quinine"),
        ("Second", "quinine", "stout"),
    ]:
        show(page, name)
        drawn = page.evaluate("() => document.querySelector('.cm-content')?.innerText ?? ''")
        held = page.evaluate(
            "() => window.nibApp.workspace.active?.note?.live?.text?.toString() ?? ''"
        )
        if mine not in drawn:
            wrong(f"the {name} tab does not show its own words")
        if theirs in drawn:
            wrong(f"the {name} tab shows words from the note before it")
        if mine not in held:
            wrong(f"the {name} tab does not hold its own words")
        if theirs in held:
            wrong(f"the {name} tab holds words from the note before it")

    held = page.evaluate(
        """
        () => {
          const ws = window.nibApp.workspace
          return ws.notes.map((one) => one.name).sort()
        }
        """
    )
    if len(held) != len(set(held)):
        wrong(f"the space has two notes under one name: {held}")
    say(f"the tabs kept their own words; the space holds {json.dumps(held)}")
    shot(page, "03-switched")

    page.evaluate("() => { window.nibApp.workspace.showPanel('tree') }")
    page.wait_for_timeout(350)
    before_rows = rows_now(page)

    page.reload(wait_until="domcontentloaded")
    wait_for(page, "window.nibApp", "the app after a reload")
    wait_for(page, "window.nibApp.workspace.activeSpace", "the space after a reload")
    wait_for(page, "document.querySelector('.cm-content')", "the writing surface after a reload")
    page.wait_for_timeout(400)

    panel = page.evaluate("() => window.nibApp.workspace.panel")
    if before_rows and panel != "tree":
        say(f"the app came back with panel {json.dumps(panel)}; not asking about rows")
    elif before_rows and not rows_now(page):
        wrong(f"the file list had {before_rows} rows and has none after a reload")
    elif before_rows:
        say(f"after a reload the file list still has {rows_now(page)} rows")
    else:
        say("no file list rows before the reload either; not asking about them")

    show(page, "Smoke")
    again = page.evaluate(
        """
        () => {
          const scroller = document.querySelector('.cm-scroller')
          if (!scroller) return null
          return scroller.scrollHeight - scroller.clientHeight
        }
        """
    )
    if again is None:
        wrong("after a reload there is no scroller in the editor")
    elif again <= 1:
        wrong(f"after a reload the long note has {again}px to scroll, so it does not scroll")
    else:
        say(f"after a reload the long note still has {again}px to scroll")

    shot(page, "04-reloaded")
    context.close()

def main() -> int:
    with DRIVE.session() as browser:
        drive(browser)

    if failures:
        say(f"{len(failures)} of the floor's questions came back wrong")
        return 1

    say("the floor holds")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
