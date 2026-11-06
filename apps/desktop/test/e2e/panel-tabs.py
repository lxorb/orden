from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

NOTE = "# Tabs\n\n## A heading\n\nWords.[^1]\n\n[^1]: a footnote\n"

MEASURE = """
() => {
  const aside = document.querySelector('aside.right')
  const row = aside.querySelector('.switch')
  const pill = row.querySelector('[role=tablist]')
  const tools = row.querySelector('.tools')
  const box = (el) => {
    const r = el.getBoundingClientRect()
    return { left: r.left, right: r.right, width: r.width, top: r.top, bottom: r.bottom }
  }
  const tabs = [...row.querySelectorAll('[role=tab]')].map((tab) => ({
    label: tab.getAttribute('aria-label'),
    on: tab.getAttribute('aria-selected') === 'true',
    inPill: pill.contains(tab),
    box: box(tab),
    mark: tab.querySelector('svg').getBoundingClientRect().width,
  }))
  const toolButtons = [...tools.querySelectorAll('button')]
    .filter((one) => one.getClientRects().length && getComputedStyle(one).visibility !== 'hidden')
    .map((one) => ({ label: one.getAttribute('aria-label'), box: box(one) }))
  return {
    aside: box(aside),
    row: box(row),
    pill: box(pill),
    tools: box(tools),
    tabs,
    toolButtons,
    showing: window.nibApp.workspace.rightPanel,
  }
}
"""

def fresh(browser: Browser, scheme: str) -> Page:
    context = browser.new_context(viewport={"width": 1400, "height": 760}, color_scheme=scheme)
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{scheme}] page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "() => !!window.nibApp.workspace.active", f"[{scheme}] the app's own note")
    page.evaluate(
        """async (text) => {
          const ws = window.nibApp.workspace
          await ws.noteFrom(text, ws.activeSpace.root)
          await ws.loadTree()
        }""",
        NOTE,
    )
    DRIVE.open_note(page, "Tabs")
    return page

def width(page: Page, pixels: int) -> None:
    edge = page.locator("aside.right [role=separator].edge")
    edge.focus()
    if pixels >= 520:
        edge.press("End")
    else:
        edge.press("Home")
        for _ in range(round((pixels - 180) / 16)):
            edge.press("ArrowLeft")
    edge.blur()
    page.wait_for_timeout(400)

def judge(at: str, row: dict) -> None:
    tabs, pill, tools = row["tabs"], row["pill"], row["tools"]
    say(f"[{at}] row {row['row']['width']:.0f}, pill {pill['width']:.0f}, "
        f"tabs {[one['label'] for one in tabs]}, tools {[one['label'] for one in row['toolButtons']]}")

    if any(not one["inPill"] for one in tabs):
        wrong(f"[{at}] a tab outside the pill")
    for one in tabs:
        box = one["box"]
        if box["left"] < pill["left"] - 0.5 or box["right"] > pill["right"] + 0.5:
            wrong(f"[{at}] {one['label']} drawn past the pill's edge")
        if box["width"] < one["mark"] + 8 - 0.5:
            wrong(f"[{at}] {one['label']} squeezed to {box['width']:.1f}, under its mark and air")
    if pill["right"] > row["row"]["right"] + 0.5:
        wrong(f"[{at}] the pill runs out of its row")
    if row["toolButtons"] and pill["right"] > tools["left"] + 0.5:
        wrong(f"[{at}] the panel's tools over the pill")
    for one in row["toolButtons"]:
        if one["box"]["right"] > row["row"]["right"] + 0.5:
            wrong(f"[{at}] {one['label']} past the row's end")

    widest = max(one["box"]["width"] for one in tabs)
    if widest > tabs[0]["mark"] + 16 + 1:
        wrong(f"[{at}] the tabs are stretched to {widest:.0f} pixels each")
    if not any(one["on"] for one in tabs):
        wrong(f"[{at}] the panel showing has no tab drawn")

def drive(browser: Browser, scheme: str) -> None:
    page = fresh(browser, scheme)

    page.evaluate("() => window.nibApp.workspace.showPanel('ask')")
    page.wait_for_timeout(500)
    for pixels in (180, 300, 520):
        width(page, pixels)
        at = f"{scheme} {pixels} own"
        judge(at, page.evaluate(MEASURE))
        shot(page, f"{scheme}-{pixels}-own", clip=strip_clip(page))
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_timeout(400)
    shot(page, f"{scheme}-window")

    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          for (const one of ['tree', 'tasks']) ws.movePanel(one, 'right')
          ws.showPanel('ask')
        }"""
    )
    page.wait_for_timeout(500)
    every = 0
    for pixels in (520, 300, 180):
        width(page, pixels)
        at = f"{scheme} {pixels} moved"
        row = page.evaluate(MEASURE)
        judge(at, row)
        labels = [one["label"] for one in row["tabs"]]
        if pixels == 520:
            every = len(labels)
            say(f"[{at}] {every} panels on the side")
            if "More" in labels:
                wrong(f"[{at}] More at the widest, where all of them fit")
            if every < 6:
                wrong(f"[{at}] only {every} panels after two were moved over")
        if pixels == 180:
            if "More" not in labels:
                wrong(f"[{at}] {every} tabs at the narrowest and no More")
            else:
                page.locator("aside.right [role=tab][aria-label=More]").click()
                page.wait_for_timeout(300)
                rows = page.evaluate(
                    "() => [...document.querySelectorAll('[role=menu] [role=menuitem]')]"
                    ".map((one) => one.textContent.trim())"
                )
                say(f"[{at}] behind More: {json.dumps(rows, ensure_ascii=False)}")
                shot(page, f"{scheme}-{pixels}-more-menu")
                hidden = every - (len(labels) - 1)
                if len(rows) != hidden:
                    wrong(f"[{at}] More lists {len(rows)} panels, not the {hidden} not drawn")
                page.keyboard.press("Escape")
                page.wait_for_timeout(200)
        shot(page, f"{scheme}-{pixels}-moved", clip=strip_clip(page))

    page.context.close()

def strip_clip(page: Page) -> dict:
    box = page.evaluate(
        "() => { const r = document.querySelector('aside.right').getBoundingClientRect();"
        " return { x: r.left, y: r.top, width: r.width, height: 120 } }"
    )
    return box

def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            say(f"--- {scheme} ---")
            drive(browser, scheme)

    return DRIVE.verdict("every panel tab is in one pill, sized to its tabs, at every width")

if __name__ == "__main__":
    raise SystemExit(main())
