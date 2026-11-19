import json
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
EDGES = """() => [...document.querySelectorAll('.pane')].map((pane) => {
  const box = pane.getBoundingClientRect()
  const look = getComputedStyle(pane)
  return {
    left: Math.round(box.left),
    right: Math.round(innerWidth - box.right),
    foot: Math.round(innerHeight - box.bottom),
    corners: [look.borderTopLeftRadius, look.borderTopRightRadius, look.borderBottomRightRadius, look.borderBottomLeftRadius].map(parseFloat),
  }
})"""
WATCH = """(ms) => new Promise((done) => {
  const seen = []
  const start = performance.now()
  const step = () => {
    const pane = [...document.querySelectorAll('.pane')].at(-1)
    seen.push(Math.round((innerWidth - pane.getBoundingClientRect().right) * 10) / 10)
    if (performance.now() - start < ms) requestAnimationFrame(step)
    else done(seen)
  }
  requestAnimationFrame(step)
})"""
def settle(page: Page) -> None:
    page.wait_for_timeout(600)
def edges(page: Page, label: str):
    seen = page.evaluate(EDGES)
    say(f"[{label}] {json.dumps(seen)}")
    shot(page, label)
    return seen
def check(page: Page, label: str, left_shut: bool, right_shut: bool) -> None:
    seen = edges(page, label)
    for at, one in enumerate(seen):
        last = at == len(seen) - 1
        tl, tr, br, bl = one["corners"]
        if one["foot"] != 0 or br != 0 or bl != 0:
            wrong(f"[{label}] pane {at} does not run square into the window's foot: {one}")
        if at == 0 and left_shut and (one["left"] != 0 or tl != 0):
            wrong(f"[{label}] with the left sidebar shut, pane {at} is not flush and square on the left: {one}")
        if at == 0 and not left_shut and tl < 4:
            wrong(f"[{label}] with the left sidebar open, pane {at} is not rounded on the left: {one}")
        if last and right_shut and (one["right"] != 0 or tr != 0):
            wrong(f"[{label}] with the right sidebar shut, pane {at} is not flush and square on the right: {one}")
        if last and not right_shut and (one["right"] < 4 or tr < 4):
            wrong(f"[{label}] with the right sidebar open, pane {at} is not inset and rounded: {one}")
        if not last and tr < 4:
            wrong(f"[{label}] pane {at} squared a corner that meets another pane: {one}")
def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 760})
    DRIVE.open(page)
    wait_for(page, "!!document.querySelector('.pane')", "a pane")
    page.evaluate("() => { const ws = window.ordenApp.workspace; if (ws.panel !== 'tree') ws.showPanel('tree'); ws.closeRight() }")
    settle(page)
    check(page, "01-left-open-right-shut", False, True)
    page.evaluate("() => window.ordenApp.workspace.closePanel()")
    settle(page)
    check(page, "02-both-shut", True, True)
    page.evaluate("() => window.ordenApp.workspace.toggleSidebar('right')")
    frames = page.evaluate(WATCH, 500)
    settle(page)
    say(f"[opening right] the pane's right edge, frame by frame: {frames}")
    jumps = [b - a for a, b in zip(frames, frames[1:]) if b - a < -0.5]
    if jumps:
        wrong(f"[opening right] the pane's edge jumped back while the sidebar opened: {frames}")
    right_open = page.evaluate("() => window.ordenApp.workspace.rightShows !== null")
    if right_open:
        check(page, "03-right-open", True, False)
        page.evaluate("() => window.ordenApp.workspace.closeRight()")
        frames = page.evaluate(WATCH, 500)
        say(f"[closing right] frame by frame: {frames}")
        if any(b - a > 0.5 for a, b in zip(frames, frames[1:])):
            wrong(f"[closing right] the pane's edge jumped back while the sidebar shut: {frames}")
        settle(page)
    else:
        say("[opening right] this build has nothing to show on the right; skipped")
    page.evaluate("() => window.ordenApp.workspace.split('row')")
    wait_for(page, "document.querySelectorAll('.pane').length === 2", "two panes")
    settle(page)
    check(page, "04-split-both-shut", True, True)
    page.emulate_media(color_scheme="dark")
    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
    settle(page)
    check(page, "05-split-left-open-dark", False, True)
    page.close()
raise SystemExit(DRIVE.run(drive, "a pane runs flush and square into the window wherever no sidebar stands between"))
