from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

LOOK = """
() => {
  const box = (one) => {
    if (!one) return null
    const r = one.getBoundingClientRect()
    if (!r.width || !r.height) return null
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  }
  const ws = window.ordenApp.workspace
  const bar = document.querySelector('footer[data-region="status"]')
  return {
    focused: ws.panes.focusedId,
    pane: box(document.querySelector(`[data-pane="${ws.panes.focusedId}"]`)),
    holder: bar?.closest('[data-pane]')?.getAttribute('data-pane') ?? null,
    right: box(document.querySelector('.panels.right.open')),
    left: box(document.querySelector('.panels:not(.right)')),
    bar: box(bar),
    counter: box(bar?.querySelector('.page')),
  }
}
"""

def inside(inner: dict, outer: dict) -> bool:
    return (
        inner["left"] >= outer["left"] - 0.5
        and inner["right"] <= outer["right"] + 0.5
        and inner["top"] >= outer["top"] - 0.5
        and inner["bottom"] <= outer["bottom"] + 0.5
    )

def meets(one: dict, other: dict) -> bool:
    return not (
        one["right"] <= other["left"]
        or other["right"] <= one["left"]
        or one["bottom"] <= other["top"]
        or other["bottom"] <= one["top"]
    )

def checked(page: Page, label: str, what: str = "counter") -> dict:
    said = page.evaluate(LOOK)
    say(f"[{label}] {said}")
    thing = said[what]
    if thing is None:
        wrong(f"[{label}] there is no {what} to measure")
        return said
    if said["holder"] != said["focused"]:
        wrong(f"[{label}] the bar is in pane {said['holder']}, not the focused {said['focused']}")
    if not said["pane"] or not inside(thing, said["pane"]):
        wrong(f"[{label}] the {what} {thing} is outside its pane {said['pane']}")
    if said["right"] and meets(thing, said["right"]):
        wrong(f"[{label}] the {what} {thing} is under the right side {said['right']}")
    if said["left"] and meets(thing, said["left"]):
        wrong(f"[{label}] the {what} {thing} is under the left side {said['left']}")
    return said

def page_note(page: Page) -> None:
    there = "window.ordenApp.workspace.active?.path?.endsWith('.pages')"
    for _try in range(4):
        page.evaluate("() => window.ordenApp.workspace.createPages()")
        page.wait_for_timeout(700)
        if page.evaluate(f"() => !!({there})"):
            break
    else:
        wrong("no page note ever opened")
    page.wait_for_selector(".pages", timeout=15000)
    wait_for(page, "!!document.querySelector('footer[data-region=\"status\"] .page')", "the counter")

def right_open(page: Page) -> None:
    page.evaluate(
        """() => {
          const ws = window.ordenApp.workspace
          ws.movePanel('outline', 'right')
          ws.showPanel('outline')
        }"""
    )
    wait_for(page, "!!document.querySelector('.panels.right.open')", "the right side open")
    page.wait_for_timeout(400)

def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
    page = context.new_page()
    DRIVE.open(page)
    wait_for(page, "window.ordenApp.workspace.spaces.length > 0", "a space")

    page_note(page)
    right_open(page)
    checked(page, "the right side open")

    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
    page.wait_for_timeout(400)
    checked(page, "both sides open")

    page.set_viewport_size({"width": 820, "height": 700})
    page.wait_for_timeout(500)
    checked(page, "a narrow window")
    page.set_viewport_size({"width": 1280, "height": 800})
    page.wait_for_timeout(400)

    page.evaluate("() => window.ordenApp.workspace.split('row')")
    wait_for(page, "document.querySelectorAll('[data-pane]').length === 2", "the split")
    for at in (0, 1):
        page.evaluate(
            f"() => {{ const ws = window.ordenApp.workspace; ws.focusPane(ws.panes.all[{at}].id) }}"
        )
        page.wait_for_timeout(400)
        checked(page, f"split, pane {at + 1} focused")

    page.evaluate(
        """async () => {
          const ws = window.ordenApp.workspace
          await ws.noteFrom('# Words\\n\\nSome words to count.\\n', ws.activeSpace.root)
          await ws.loadTree()
          const note = ws.notes.find((one) => one.name.startsWith('Words'))
          await ws.openEntry(note.path, { activate: true })
        }"""
    )
    wait_for(page, "!!document.querySelector('.cm-content')", "the word note")
    page.wait_for_timeout(400)
    checked(page, "a word note, the right side open", "bar")
    context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the note's corners stay inside its pane"))
