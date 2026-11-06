from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive
from settling import HIDE_CARET, quiet

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

SIZE = {"width": 1280, "height": 800}

ARRANGE = """
async () => {
  const ws = window.nibApp.workspace
  const notes = ws.activeSpace
  await ws.noteFrom('# Plan\\n\\nWhat we are doing.\\n', notes.root)
  await ws.noteFrom('# Ideas\\n\\nWhat we might do.\\n', notes.root)
  const home = await ws.addSpace('Home')
  await ws.noteFrom('# Food\\n\\nWhat to buy.\\n', home.root)
  await ws.showSpace(notes.id)
  await ws.loadTree()
  for (const tab of [...ws.tabs]) ws.close(tab.id)
  for (const name of ['Plan', 'Ideas']) {
    const note = ws.notes.find((one) => one.name.startsWith(name))
    await ws.openEntry(note.path, { activate: true })
  }
  ws.split('row')
  ws.showPanel('tree')
  return { notes: notes.id, home: home.id }
}
"""

LOOK = """
() => {
  const ws = window.nibApp.workspace
  return {
    space: ws.activeSpace?.name ?? null,
    panes: ws.panes.all.map((pane) => ({
      tabs: ws.tabsIn(pane.id).map((one) => one.shown),
      front: ws.showing(pane.id)?.shown ?? null,
    })),
    focused: ws.panes.focusedId,
    drawn: [...document.querySelectorAll('.tab .label')].map((one) => one.textContent.trim()),
  }
}
"""

WATCH = """
() => {
  window.__frames = []
  const look = () => {
    window.__frames.push([...document.querySelectorAll('.tab .label')].map((one) => one.textContent.trim()).join('|'))
    if (window.__frames.length < 600) window.__watching = requestAnimationFrame(look)
  }
  window.__frames.push([...document.querySelectorAll('.tab .label')].map((one) => one.textContent.trim()).join('|'))
  window.__watching = requestAnimationFrame(look)
}
"""

FRAMES = "() => { cancelAnimationFrame(window.__watching); return window.__frames }"

def look(page: Page) -> dict:
    return page.evaluate(LOOK)

HINTS_SEEN = "try { localStorage.setItem('nib:hints', JSON.stringify(['graph', 'palette'])) } catch {}"

def opened(browser: Browser, scheme: str, motion: str = "reduce") -> tuple[Page, dict]:
    context = browser.new_context(viewport=SIZE, color_scheme=scheme, reduced_motion=motion)
    context.add_init_script(HIDE_CARET)
    context.add_init_script(HINTS_SEEN)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    ids = page.evaluate(ARRANGE)
    wait_for(page, "document.querySelectorAll('[data-pane]').length === 2", "the split")
    quiet(page)
    return page, ids

def switcher(page: Page) -> None:
    if not page.locator(".nib-layer.spaces").count():
        page.locator("aside button.name").first.click()
    wait_for(page, "document.querySelector('.nib-layer.spaces')", "the list of spaces")

def space_menu(page: Page, name: str) -> None:
    switcher(page)
    row = page.locator(".spaces .line").filter(has_text=name)
    row.locator(".more").click()
    wait_for(page, "document.querySelector('[role=menu].menu')", "the space's menu")

def no_row(page: Page, scheme: str) -> None:
    space_menu(page, "Notes")
    rows = page.locator(".menu [role=menuitem] .nib-row-label").all_inner_texts()
    say(f"[{scheme}] the space's menu: {rows}")
    if "Tabs" in rows:
        wrong(f"the space's menu still has a Tabs row: {rows}")
    quiet(page)
    DRIVE.steady(page, f"{scheme}-01-menu")
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('[role=menu].menu')", "the menu to close")

def switch(page: Page, name: str) -> None:
    switcher(page)
    page.locator(".spaces .line .nib-row").filter(has_text=name).click()
    wait_for(page, f"window.nibApp.workspace.activeSpace?.name === {json.dumps(name)}", f"{name} on screen")
    DRIVE.settled(page)

def drive(browser: Browser) -> None:
    page, ids = opened(browser, "light")
    no_row(page, "light")

    before = look(page)
    say(f"Notes, its own: {json.dumps(before)}")

    switch(page, "Home")
    home = look(page)
    say(f"Home: {json.dumps(home)}")
    if any("Plan" in tab or "Ideas" in tab for pane in home["panes"] for tab in pane["tabs"]):
        wrong(f"Notes' tabs are on screen in Home: {home}")
    if len(home["panes"]) != 1:
        wrong(f"Home is not one pane of its own: {home}")
    page.evaluate(
        "async () => { const ws = window.nibApp.workspace; const food = ws.notes.find((one) => one.name.startsWith('Food')); await ws.openEntry(food.path, { activate: true }) }"
    )
    wait_for(page, "window.nibApp.workspace.active?.shown?.startsWith('Food')", "Food in Home")
    quiet(page)
    DRIVE.steady(page, "light-03-home")

    switch(page, "Notes")
    back = look(page)
    say(f"Notes again: {json.dumps(back)}")
    if back["panes"] != before["panes"] or back["focused"] != before["focused"]:
        wrong(f"Notes did not come back as it was left: {back} after {before}")
    quiet(page)
    DRIVE.steady(page, "light-04-notes-again")

    switch(page, "Home")
    if [pane["tabs"] for pane in look(page)["panes"]] != [["Food"]]:
        wrong(f"Home did not keep its own: {look(page)}")

    page.reload(wait_until="domcontentloaded")
    DRIVE.ready(page)
    wait_for(page, "window.nibApp.workspace.restored", "the session")
    after = look(page)
    say(f"after the restart: {json.dumps(after)}")
    if after["space"] != "Home" or [pane["tabs"] for pane in after["panes"]] != [["Food"]]:
        wrong(f"the restart did not come back on Home's own tabs: {after}")
    switch(page, "Notes")
    wait_for(page, "window.nibApp.workspace.panes.count === 2", "Notes' split after the restart")
    again = look(page)
    say(f"Notes after the restart: {json.dumps(again)}")
    if [pane["tabs"] for pane in again["panes"]] != [pane["tabs"] for pane in before["panes"]]:
        wrong(f"Notes' split did not come back after the restart: {again}")
    page.context.close()

    page, ids = opened(browser, "light", motion="no-preference")
    switch(page, "Home")
    page.evaluate(
        "async () => { const ws = window.nibApp.workspace; const food = ws.notes.find((one) => one.name.startsWith('Food')); await ws.openEntry(food.path, { activate: true }) }"
    )
    wait_for(page, "window.nibApp.workspace.active?.shown?.startsWith('Food')", "Food in Home")
    page.evaluate(WATCH)
    page.evaluate(f"() => window.nibApp.workspace.showSpace({json.dumps(ids['notes'])})")
    wait_for(page, "window.nibApp.workspace.panes.count === 2", "Notes' split")
    page.wait_for_timeout(400)
    frames = list(page.evaluate(FRAMES))
    seen = list(dict.fromkeys(frames))
    say(f"the strip, frame by frame: {seen}")
    for one in frames:
        names = one.split("|") if one else []
        mixed = "Food" in names and any(name in ("Plan", "Ideas") for name in names)
        if mixed or not names:
            wrong(f"a frame of the switch showed {names or 'no tabs at all'}")
            break
    page.context.close()

    page, ids = opened(browser, "light")
    switch(page, "Home")
    page.evaluate("() => window.nibApp.workspace.openWebsite()")
    wait_for(page, "window.nibApp.workspace.tabs.some((tab) => tab.kind === 'web')", "a web tab in Home")
    page.evaluate(f"() => window.nibApp.workspace.deleteSpace({json.dumps(ids['home'])})")
    wait_for(
        page,
        f"window.nibApp.workspace.activeSpaceId === {json.dumps(ids['notes'])}",
        "Notes on screen after Home is deleted",
    )
    left = "window.nibApp.workspace.tabs.filter((tab) => tab.kind === 'web').length"
    if page.evaluate(left) != 0:
        wrong("a web tab of the deleted space stayed open out of sight")
    page.evaluate("() => window.nibApp.workspace.persist()")
    page.reload(wait_until="domcontentloaded")
    DRIVE.ready(page)
    wait_for(page, "window.nibApp.workspace.restored", "the session")
    wait_for(page, "window.nibApp.workspace.panes.count === 2", "Notes' split after the restart")
    if page.evaluate(left) != 0:
        wrong("a web tab of the deleted space came back with the restart")
    page.context.close()

    page, _ids = opened(browser, "dark")
    no_row(page, "dark")
    page.context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "each space's own tabs swap in, and come back after a restart"))
