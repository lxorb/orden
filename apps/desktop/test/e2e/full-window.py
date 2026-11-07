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
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root
  await ws.noteFrom('# Plan\\n\\nWhat we are doing, and why it matters.\\n', root)
  await ws.noteFrom('# Other\\n\\nA note beside it.\\n', root)
  await ws.loadTree()
  for (const tab of [...ws.tabs]) ws.close(tab.id)
  for (const name of ['Plan', 'Other']) {
    const note = ws.notes.find((one) => one.name.startsWith(name))
    await ws.openEntry(note.path, { activate: true })
  }
  ws.split('row')
  const [left] = ws.panes.all
  ws.focusPane(left.id)
  const plan = ws.tabsIn(left.id).find((one) => one.shown.startsWith('Plan'))
  ws.activate(plan.id)
  ws.showPanel('tree')
  return left.id
}
"""

LOOK = """
() => {
  const box = (one) => {
    if (!one) return null
    const r = one.getBoundingClientRect()
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]
  }
  const bar = document.querySelector('.bar')
  return {
    fills: window.ordenApp.workspace.panes.fills,
    sidebar: !!document.querySelector('aside'),
    panes: [...document.querySelectorAll('[data-pane]')].map((one) => one.dataset.pane),
    // A pane's own, or its strip in the window's top row (#1037), but not the one in the
    // bar a filled window brings down from the top edge.
    strips: [...document.querySelectorAll('[data-pane] > .head, header [data-top-strip]')]
      .filter((one) => !one.closest('.bar')).length,
    status: !!document.querySelector('[data-region="status"]'),
    pane: box(document.querySelector('[data-pane]')),
    window: [window.innerWidth, window.innerHeight],
    bar: bar ? { shown: bar.classList.contains('shown'), inert: bar.inert,
      tabs: [...bar.querySelectorAll('.tab .label')].map((one) => one.textContent.trim()) } : null,
    typing: !!document.activeElement?.closest('.cm-content'),
    active: window.ordenApp.workspace.active?.shown ?? null,
  }
}
"""

LAYOUT = """
() => JSON.stringify({
  frame: window.ordenApp.workspace.panes.frame,
  panel: window.ordenApp.workspace.panel,
  aside: (() => {
    const list = document.querySelector('aside')
    if (!list) return null
    const on = [...list.querySelectorAll('[data-path].is-on')].map((one) => one.dataset.path)
    return { words: list.innerText, on }
  })(),
  strips: [...document.querySelectorAll('.tab .label')].map((one) => one.textContent.trim()),
})
"""

FLUSH = """
() => {
  const pane = [...document.querySelectorAll('[data-pane]')].find((one) => one.getClientRects().length)
  if (!pane) return null
  const r = pane.getBoundingClientRect()
  const style = getComputedStyle(pane)
  const main = getComputedStyle(document.querySelector('main'))
  return {
    box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    window: [innerWidth, innerHeight],
    radius: style.borderTopLeftRadius,
    shadow: style.boxShadow,
    corner: parseFloat(main.getPropertyValue('--card-radius')) || 0,
  }
}
"""

FILLED = "window.ordenApp.workspace.panes.fills !== null && !document.querySelector('aside')"
BACK = "window.ordenApp.workspace.panes.fills === null && !!document.querySelector('aside')"

def look(page: Page) -> dict:
    return page.evaluate(LOOK)

def opened(browser: Browser, scheme: str) -> Page:
    context = browser.new_context(viewport=SIZE, color_scheme=scheme, reduced_motion="reduce")
    context.add_init_script(HIDE_CARET)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    page.evaluate(ARRANGE)
    wait_for(page, "document.querySelectorAll('[data-pane]').length === 2", "the split")
    page.locator("[data-pane] .cm-content").first.click()
    quiet(page)
    return page

def shot(page: Page, name: str) -> None:
    quiet(page)
    DRIVE.steady(page, name)

def key_in(page: Page, scheme: str) -> str:
    before = page.evaluate(LAYOUT)
    said = look(page)
    say(f"[{scheme}] before {json.dumps(said)}")
    if not said["sidebar"] or len(said["panes"]) != 2 or said["strips"] != 2:
        wrong(f"the window did not open split with its list: {said}")
    shot(page, f"{scheme}-01-before")

    page.keyboard.press("Shift+F11")
    wait_for(page, FILLED, "Shift+F11 to fill the window")
    quiet(page)
    said = look(page)
    say(f"[{scheme}] filled {json.dumps(said)}")
    if said["panes"] != [said["fills"]]:
        wrong(f"another pane is still on screen: {said['panes']}")
    if said["strips"] or said["status"]:
        wrong(f"a strip or the status bar is still on screen: {said}")
    if said["pane"] != [0, 0, *said["window"]]:
        wrong(f"the pane is {said['pane']}, not the window {said['window']}")
    if not said["typing"]:
        wrong("the keyboard left the note")
    if not said["bar"] or said["bar"]["shown"] or not said["bar"]["inert"]:
        wrong(f"the bar is not up out of sight and out of reach: {said['bar']}")
    shot(page, f"{scheme}-02-filled")
    return before

def the_bar(page: Page, scheme: str) -> None:
    page.mouse.move(640, 300)
    page.mouse.move(640, 2)
    wait_for(page, "document.querySelector('.bar')?.classList.contains('shown')", "the bar at the top edge")
    quiet(page)
    said = look(page)
    say(f"[{scheme}] the bar {json.dumps(said['bar'])}")
    if not said["bar"]["tabs"] or not said["bar"]["tabs"][0].startswith("Plan"):
        wrong(f"the bar does not hold the filled pane's tabs: {said['bar']}")
    if said["bar"]["inert"]:
        wrong("the bar came down out of reach")
    shot(page, f"{scheme}-03-bar")

    page.mouse.move(640, 500)
    wait_for(page, "!document.querySelector('.bar')?.classList.contains('shown')", "the bar to go up again")
    if look(page)["fills"] is None:
        wrong("the pointer at the top edge gave the window back")

def tabs_and_escape(page: Page, scheme: str) -> None:
    page.locator("[data-pane] .cm-content").first.click()
    page.keyboard.press("Control+Tab")
    DRIVE.settled(page)
    said = look(page)
    if said["fills"] is None or not (said["active"] or "").startswith("Other"):
        wrong(f"Ctrl+Tab did not keep the window filled on the next tab: {said}")
    page.keyboard.press("Control+Tab")
    DRIVE.settled(page)

    page.locator("[data-pane] .cm-content").first.click()
    page.keyboard.press("Escape")
    DRIVE.settled(page)
    if look(page)["fills"] is None:
        wrong("Escape in the note gave the window back")

    page.evaluate("() => document.activeElement?.blur()")
    page.keyboard.press("Escape")
    wait_for(page, BACK, "Escape on nothing to give the window back")
    say(f"[{scheme}] Escape: the note's in the note, the fill's on nothing")

def key_out(page: Page, scheme: str, before: str) -> None:
    page.locator("[data-pane] .cm-content").first.click()
    page.keyboard.press("Shift+F11")
    wait_for(page, FILLED, "Shift+F11 to fill the window again")
    page.keyboard.press("Shift+F11")
    wait_for(page, BACK, "Shift+F11 to give the window back")
    quiet(page)
    after = page.evaluate(LAYOUT)
    if after != before:
        wrong(f"the window came back different:\n  {before}\n  {after}")
    else:
        say(f"[{scheme}] back exactly as it was")
    shot(page, f"{scheme}-04-back")

def web_tab(page: Page, scheme: str) -> None:
    page.evaluate("() => window.ordenApp.workspace.openWebsite()")
    wait_for(page, "document.querySelector('.web .webbar')", "the web tab's bar")
    quiet(page)
    page.keyboard.press("Shift+F11")
    wait_for(page, FILLED, "Shift+F11 over a web tab, from its address field")
    quiet(page)
    said = page.evaluate(
        """() => {
          const box = (one) => {
            const r = one?.getBoundingClientRect()
            return r && [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]
          }
          return {
            tab: box(document.querySelector('.web')),
            bar: box(document.querySelector('.web > .head')),
            window: [innerWidth, innerHeight],
            typing: document.activeElement?.tagName ?? null,
          }
        }"""
    )
    say(f"[{scheme}] web tab filled {json.dumps(said)}")
    width, height = said["window"]
    if said["tab"] != [0, 0, width, height]:
        wrong(f"the web tab is {said['tab']}, not the window {said['window']}")
    if not said["bar"] or said["bar"][:3] != [0, 0, width]:
        wrong(f"the web tab's own bar is not across the top: {said['bar']}")
    if said["typing"] != "INPUT":
        wrong(f"the keyboard left the address field for {said['typing']}")
    shot(page, f"{scheme}-05-web")
    page.keyboard.press("Shift+F11")
    wait_for(page, BACK, "Shift+F11 out of the web tab")

def flush(page: Page, scheme: str, mode: str) -> None:
    said = page.evaluate(FLUSH)
    say(f"[{scheme}] {mode}: {json.dumps(said)}")
    if not said:
        wrong(f"[{mode}] no pane on screen")
        return
    if said["box"] != [0, 0, *said["window"]]:
        wrong(f"[{mode}] the pane is {said['box']}, not the window {said['window']}")
    if said["radius"] not in ("0px", "0"):
        wrong(f"[{mode}] the pane keeps a rounded corner: {said['radius']}")
    if said["shadow"] not in ("none", "") and "0px 0px 0px 1px" not in said["shadow"]:
        wrong(f"[{mode}] the pane keeps a shadow: {said['shadow']}")
    if "0px 0px 0px 1px rgb" in said["shadow"] and "rgba(0, 0, 0, 0)" not in said["shadow"]:
        wrong(f"[{mode}] the pane keeps an edge: {said['shadow']}")
    if said["corner"]:
        wrong(f"[{mode}] a web page here would be given a corner of {said['corner']}px")

def every_full_mode(page: Page, scheme: str) -> None:
    for kind in ("note", "web tab"):
        if kind == "web tab":
            page.evaluate("() => window.ordenApp.workspace.openWebsite()")
            wait_for(page, "document.querySelector('.web .webbar')", "the web tab's bar")
        quiet(page)
        page.evaluate("() => window.ordenApp.workspace.panes.fills = window.ordenApp.workspace.panes.focusedId")
        wait_for(page, FILLED, f"the {kind} filling the window")
        quiet(page)
        flush(page, scheme, f"{kind}, filling the window")
        page.evaluate("() => window.ordenApp.workspace.panes.fills = null")
        wait_for(page, BACK, f"the {kind} back")

        page.evaluate("() => window.ordenApp.fullscreen.enter(window.ordenApp.workspace.panes)")
        wait_for(page, "window.ordenApp.fullscreen.on", f"full screen over the {kind}")
        quiet(page)
        flush(page, scheme, f"{kind}, full screen")
        page.evaluate("() => window.ordenApp.fullscreen.leave()")
        wait_for(page, "!window.ordenApp.fullscreen.on && !!document.querySelector('aside')", "full screen left")

def drive(browser: Browser) -> None:
    for scheme in ("light", "dark"):
        page = opened(browser, scheme)
        before = key_in(page, scheme)
        the_bar(page, scheme)
        tabs_and_escape(page, scheme)
        key_out(page, scheme, before)
        web_tab(page, scheme)
        every_full_mode(page, scheme)
        page.context.close()

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the tab fills the window and gives it back"))
