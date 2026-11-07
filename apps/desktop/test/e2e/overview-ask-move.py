from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

SEED = """
async () => {
  const ws = window.ordenApp.workspace
  const home = ws.activeSpace
  await ws.addSpace('Work')
  const work = ws.spaces.find((one) => one.name === 'Work')
  await ws.selectSpace(work.id)
  ws.openBlank('Over there', '# Over there')
  await new Promise((go) => setTimeout(go, 300))
  await ws.selectSpace(home.id)
  ws.openBlank('Plan', '# Plan')
  ws.openBlank('Draft', '# Draft')
  ws.openPage('https://example.com/')
  localStorage.setItem('orden:overview-spaces', 'all')
  await new Promise((go) => setTimeout(go, 600))
  return { home: home.id, work: work.id }
}
"""

HOME_OF = """(name) => {
  const ws = window.ordenApp.workspace
  const tab = ws.tabs.find((one) => one.shown === name || one.kind === name)
  if (!tab) return null
  const root = tab.path && ws.spaces.find((space) => tab.path.startsWith(space.root.replace(/\\/+$/, '') + '/'))
  return root ? root.id : tab.note.home
}"""

ORDER = "() => window.ordenApp.workspace.tabs.filter((one) => one.paneId).map((one) => one.shown)"

STATE = "() => window.ordenApp.workspace.tabs.map((one) => [one.shown, one.kind, one.note.home, one.path, !!window.ordenApp.workspace.panes.at(one.paneId)])"

SHEET = "!!document.querySelector('.sheet form')"

def window_of(page: Page, label: str) -> dict | None:
    return page.evaluate(
        """(label) => {
          const one = [...document.querySelectorAll('.canvas .window')].find((node) => node.getAttribute('aria-label') === label)
          if (!one) return null
          const r = one.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        }""",
        label,
    )

def resting(page: Page, label: str) -> dict | None:
    last = window_of(page, label)
    for _ in range(40):
        page.wait_for_timeout(150)
        now = window_of(page, label)
        if now and last and abs(now["x"] - last["x"]) < 0.5 and abs(now["y"] - last["y"]) < 0.5:
            return now
        last = now
    return last

def web_label(page: Page) -> str:
    return page.evaluate("() => window.ordenApp.workspace.tabs.find((one) => one.kind === 'web').shown")

def drag(page: Page, start: dict, end: dict) -> None:
    page.mouse.move(start["x"], start["y"])
    page.mouse.down()
    for step in range(1, 21):
        page.mouse.move(
            start["x"] + (end["x"] - start["x"]) * step / 20,
            start["y"] + (end["y"] - start["y"]) * step / 20,
        )
        page.wait_for_timeout(16)
    page.wait_for_timeout(200)
    page.mouse.up()
    page.wait_for_timeout(900)

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1400, "height": 900})
    DRIVE.open(page)
    ids = page.evaluate(SEED)
    page.keyboard.press("Alt")
    page.keyboard.press("Alt")
    page.wait_for_selector(".canvas .window", timeout=8000)
    page.wait_for_timeout(1200)
    page.get_by_role("button", name="Tidy up").click()
    page.wait_for_timeout(1200)

    order = page.evaluate(ORDER)
    before = resting(page, "Plan")
    there = window_of(page, "Over there")
    if not before or not there:
        wrong(f"no windows to drag: {before} {there}")
        return
    drag(page, before, there)
    if not page.evaluate(SHEET):
        wrong("a note dropped on another space moved without a question")
        return
    said = page.evaluate("() => document.querySelector('.sheet form').innerText")
    buttons = page.evaluate("() => [...document.querySelectorAll('.sheet form button')].map((one) => one.textContent.trim())")
    title = page.evaluate("() => document.querySelector('.sheet form h2, .sheet form .title, .sheet form [id]')?.textContent?.trim() ?? ''")
    say(f"[ask] the question: {said!r}, buttons {buttons}")
    shot(page, "asked")
    if sorted(buttons) != ["Cancel", "Move"]:
        wrong(f"[ask] the buttons are {buttons}, not Move and Cancel")
    if "Work" not in said or said.count("?") != 1:
        wrong(f"[ask] the question is not one short sentence naming the space: {said!r} {title!r}")
    if page.evaluate(HOME_OF, "Plan") != ids["home"]:
        wrong("[ask] the note moved before the answer")
    page.locator(".sheet form button", has_text="Cancel").click()
    wait_for(page, f"!{SHEET}", "the question put away")
    page.wait_for_timeout(1200)
    back = resting(page, "Plan")
    shot(page, "cancelled")
    say(f"[cancel] Plan from {before} to {back}, order {page.evaluate(ORDER)}")
    if page.evaluate(HOME_OF, "Plan") != ids["home"]:
        wrong("[cancel] Cancel still moved the note")
    if not back or abs(back["x"] - before["x"]) > 8 or abs(back["y"] - before["y"]) > 8:
        wrong(f"[cancel] the window did not go back where it was: {before} -> {back}")
    if page.evaluate(ORDER) != order:
        wrong(f"[cancel] the order of the tabs changed: {order} -> {page.evaluate(ORDER)}")
    if not page.evaluate("() => !!document.activeElement?.closest('.canvas')"):
        wrong("[cancel] the keyboard did not come back to the overview")

    drag(page, window_of(page, "Plan"), window_of(page, "Over there"))
    if not page.evaluate(SHEET):
        wrong("[move] the second drop asked nothing")
        return
    page.locator(".sheet form button", has_text="Move").click()
    wait_for(page, f"!{SHEET}", "the question answered")
    page.wait_for_timeout(1500)
    if page.evaluate(HOME_OF, "Plan") != ids["work"]:
        wrong(f"[move] Move did not take the note to Work: {page.evaluate(STATE)}")
    say("ok   [move] Move took the note to Work")
    page.wait_for_timeout(800)
    shot(page, "moved")

    web = web_label(page)
    drag(page, window_of(page, web), window_of(page, "Over there"))
    if page.evaluate(SHEET):
        wrong("[web] a web tab asked before moving")
        page.locator(".sheet form button", has_text="Cancel").click()
    else:
        page.wait_for_timeout(1200)
        if page.evaluate(HOME_OF, "web") != ids["work"]:
            wrong(f"[web] the web tab did not move: {page.evaluate(STATE)}")
        else:
            say("ok   [web] the web tab moved without a question")
    shot(page, "web-moved")
    page.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "notes ask before moving to another space, web tabs do not"))
