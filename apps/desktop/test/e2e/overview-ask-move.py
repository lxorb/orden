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
  const saved = await ws.noteFrom('# Plan\\n\\nwords', home.root)
  await ws.loadTree()
  await ws.openEntry(saved, { activate: true })
  const brief = await ws.noteFrom('# Brief\\n\\nwords', home.root)
  await ws.loadTree()
  await ws.openEntry(brief, { activate: true })
  ws.openPage('https://example.com/')
  localStorage.setItem('orden:overview-spaces', 'all')
  await new Promise((go) => setTimeout(go, 600))
  return { home: home.id, work: work.id, homeName: home.name, workRoot: work.root, saved, brief }
}
"""
SPACE_OF = """(name) => {
  const ws = window.ordenApp.workspace
  const tab = ws.tabs.find((one) => one.shown === name)
  return tab ? { space: ws.spaceOfTab(tab), path: tab.path } : null
}"""
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
def asked(page: Page) -> tuple[str, list[str]]:
    said = page.evaluate("() => document.querySelector('.sheet form').innerText")
    buttons = page.evaluate("() => [...document.querySelectorAll('.sheet form button')].map((one) => one.textContent.trim())")
    return said, buttons
def answer(page: Page, label: str) -> None:
    page.locator(".sheet form button", has_text=label).click()
    wait_for(page, f"!{SHEET}", "the question answered")
    page.wait_for_timeout(1400)
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
    before = resting(page, "Plan")
    there = window_of(page, "Over there")
    if not before or not there:
        wrong(f"no windows to drag: {before} {there}")
        return
    drag(page, before, there)
    if not page.evaluate(SHEET):
        wrong("a saved note dropped on another space moved without a question")
        return
    said, buttons = asked(page)
    say(f"[ask] the question: {said!r}, buttons {buttons}")
    shot(page, "asked")
    if sorted(buttons) != ["Move the file too", "Only the tab"]:
        wrong(f"[ask] the buttons are {buttons}")
    if "Plan" not in said or "Work" not in said or ids["homeName"] not in said:
        wrong(f"[ask] the question does not name the note and both spaces: {said!r}")
    if page.evaluate(SPACE_OF, "Plan")["space"] != ids["home"]:
        wrong("[ask] the note moved before the answer")
    page.keyboard.press("Escape")
    wait_for(page, f"!{SHEET}", "the question put away")
    page.wait_for_timeout(1200)
    back = resting(page, "Plan")
    now = page.evaluate(SPACE_OF, "Plan")
    say(f"[cancel] Plan from {before} to {back}: {now}")
    if now["space"] != ids["home"] or now["path"] != ids["saved"]:
        wrong(f"[cancel] Escape still moved the note: {now}")
    if not back or abs(back["x"] - before["x"]) > 8 or abs(back["y"] - before["y"]) > 8:
        wrong(f"[cancel] the window did not go back where it was: {before} -> {back}")
    if not page.evaluate("() => !!document.activeElement?.closest('.canvas')"):
        wrong("[cancel] the keyboard did not come back to the overview")
    drag(page, window_of(page, "Plan"), window_of(page, "Over there"))
    if not page.evaluate(SHEET):
        wrong("[tab] the second drop asked nothing")
        return
    answer(page, "Only the tab")
    now = page.evaluate(SPACE_OF, "Plan")
    if now["space"] != ids["work"] or now["path"] != ids["saved"]:
        wrong(f"[tab] Only the tab did not leave the file where it was and show the tab in Work: {now}")
    else:
        say("ok   [tab] the tab is in Work and its file stays where it was")
    drag(page, window_of(page, "Brief"), window_of(page, "Over there"))
    if not page.evaluate(SHEET):
        wrong("[file] a saved note dropped on another space moved without a question")
    else:
        answer(page, "Move the file too")
        now = page.evaluate(SPACE_OF, "Brief")
        if now["space"] != ids["work"] or not str(now["path"]).startswith(ids["workRoot"].rstrip("/") + "/"):
            wrong(f"[file] Move the file too did not move the file into Work: {now}")
        else:
            say("ok   [file] the note and its file are in Work")
    web = page.evaluate("() => window.ordenApp.workspace.tabs.find((one) => one.kind === 'web').shown")
    drag(page, window_of(page, web), window_of(page, "Over there"))
    if page.evaluate(SHEET):
        wrong(f"[web] a tab with no saved file asked before moving: {asked(page)}")
        page.keyboard.press("Escape")
    elif page.evaluate(SPACE_OF, web)["space"] != ids["work"]:
        wrong(f"[web] the web tab did not move: {page.evaluate(SPACE_OF, web)}")
    else:
        say("ok   [web] the web tab moved without a question")
    here = page.evaluate("() => [...document.querySelectorAll('[data-space-name]')].map((one) => [one.dataset.spaceName, one.textContent.trim()])")
    say(f"[spaces] {here}")
    page.close()
raise SystemExit(DRIVE.run(drive, "a saved tab dragged to another space asks whether its file goes too; others move at once"))
