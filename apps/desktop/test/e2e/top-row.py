from __future__ import annotations

from typing import Any

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

SLIVER = 24

MEASURE = """
() => {
  const box = (one) => {
    const r = one.getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
  }
  const bar = document.querySelector('header[data-chrome="top"]')
  const strips = [...bar.querySelectorAll('[data-top-strip]')].map((slot) => {
    const strip = slot.querySelector(':scope > .strip')
    const sliver = strip?.querySelector(':scope > .drag[data-tauri-drag-region]')
    return {
      id: slot.dataset.topStrip,
      slot: box(slot),
      strip: strip ? box(strip) : null,
      sliver: sliver ? sliver.getBoundingClientRect().width : 0,
    }
  })
  const panes = [...document.querySelectorAll('[data-pane]')].map((pane) => ({
    id: pane.dataset.pane,
    box: box(pane),
    head: !!pane.querySelector(':scope > .head'),
  }))
  const lead = bar.querySelector(':scope > .lead')
  const end = bar.querySelector(':scope > .end')
  // What a press lands on in the room between two strips, half way down the bar.
  const between = []
  const sorted = [...strips].sort((a, b) => a.slot.left - b.slot.left)
  for (let at = 1; at < sorted.length; at++) {
    const x = (sorted[at - 1].slot.right + sorted[at].slot.left) / 2
    const y = (box(bar).top + box(bar).bottom) / 2
    const hit = document.elementFromPoint(x, y)
    between.push(!!hit && hit.hasAttribute('data-tauri-drag-region'))
  }
  return {
    bar: box(bar),
    strips,
    panes,
    lead: lead && lead.getClientRects().length ? box(lead) : null,
    end: end && end.getClientRects().length ? box(end) : null,
    between,
  }
}
"""

def check(page: Any, state: str) -> None:
    DRIVE.settled(page)
    page.wait_for_timeout(500)
    seen: dict[str, Any] = page.evaluate(MEASURE)
    bar, strips, panes = seen["bar"], seen["strips"], seen["panes"]
    say(f"[{state}] strips {[one['id'] for one in strips]}, panes {[(one['id'], one['head']) for one in panes]}")

    top = min(one["box"]["top"] for one in panes)
    if abs(top - bar["bottom"]) > 0.5:
        wrong(f"[{state}] the panes start {top - bar['bottom']:.1f}px under the bar, not where it ends")

    stripped = {one["id"] for one in strips}
    for one in panes:
        along_top = abs(one["box"]["top"] - top) < 0.5
        if along_top and one["head"]:
            wrong(f"[{state}] pane {one['id']} along the top carries a second row of tabs")
        if along_top and one["id"] not in stripped:
            wrong(f"[{state}] pane {one['id']} along the top has no strip in the bar")
        if not along_top and not one["head"]:
            wrong(f"[{state}] pane {one['id']} under another one has no strip")
        if not along_top and one["id"] in stripped:
            wrong(f"[{state}] pane {one['id']} under another one has a strip in the bar")

    boxes = {one["id"]: one["box"] for one in panes}
    for one in strips:
        under = boxes.get(one["id"])
        if not under:
            wrong(f"[{state}] a strip in the bar for a pane that is not there: {one['id']}")
            continue
        for edge in ("left", "right"):
            if abs(one["slot"][edge] - under[edge]) > 0.5:
                wrong(f"[{state}] strip {one['id']} {edge} {one['slot'][edge]:.1f} is not its pane's {under[edge]:.1f}")
        strip = one["strip"]
        if not strip:
            wrong(f"[{state}] strip {one['id']} draws nothing")
            continue
        lead, end = seen["lead"], seen["end"]
        if lead and strip["left"] < lead["right"] - 0.5 and strip["right"] > lead["left"] + 0.5:
            wrong(f"[{state}] strip {one['id']} runs under the bar's start: {strip['left']:.1f} < {lead['right']:.1f}")
        if end and strip["right"] > end["left"] + 0.5 and strip["left"] < end["right"] - 0.5:
            wrong(f"[{state}] strip {one['id']} runs under the window's buttons: {strip['right']:.1f} > {end['left']:.1f}")
        if one["sliver"] < SLIVER - 0.5:
            wrong(f"[{state}] strip {one['id']} has {one['sliver']:.1f}px to drag the window by")

    if not all(seen["between"]):
        wrong(f"[{state}] the room between two strips does not move the window: {seen['between']}")

    shot(page, state, clip={"x": 0, "y": 0, "width": page.viewport_size["width"], "height": 120})

def drive(browser: Any) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 760})
    DRIVE.open(page)
    DRIVE.seed(page, "# Plan\n\nWhat we are doing.\n", "# Kestrel\n\nA bird.\n")
    DRIVE.open_note(page, "Plan")
    ws = "window.ordenApp.workspace"

    check(page, "01-one")
    page.evaluate(f"() => {ws}.split('row')")
    check(page, "02-side-by-side")
    page.evaluate(f"() => {ws}.toggleSidebar('left')")
    check(page, "03-left-open")
    page.evaluate(f"() => {ws}.toggleSidebar('right')")
    check(page, "04-both-open")
    page.evaluate(f"() => {{ {ws}.toggleSidebar('right'); {ws}.toggleSidebar('left') }}")
    page.evaluate(f"() => {ws}.split('column')")
    check(page, "05-three")
    page.evaluate(
        f"""() => {{
          const ws = {ws}
          ws.focusPane(document.querySelector('[data-pane]').dataset.pane)
          ws.split('column')
        }}"""
    )
    check(page, "06-four")
    page.set_viewport_size({"width": 900, "height": 600})
    check(page, "07-narrow")

    rtl = DRIVE.page(browser, viewport={"width": 1280, "height": 760})
    rtl.add_init_script("localStorage.setItem('orden:language', 'ar')")
    DRIVE.open(rtl)
    DRIVE.seed(rtl, "# Plan\n\nWhat we are doing.\n")
    DRIVE.open_note(rtl, "Plan")
    rtl.evaluate(f"() => {ws}.split('row')")
    check(rtl, "08-right-to-left")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
