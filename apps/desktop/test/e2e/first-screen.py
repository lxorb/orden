from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

NOTE = "# Long walk\n\n" + "\n\n".join(
    f"## Stage {at}\n\nThe path climbs past the {at}th cairn, and the wind comes round to the west"
    " as it always does in the afternoon. Somebody left a flask on the wall."
    for at in range(80)
)

WATCH = r"""
window.__first = { drawn: null, editor: null, gone: null, top: null, lines: null, list: null, raw: 0, rawSeen: 0 }
const first = window.__first
const linesOf = (content) => {
  const scroller = content.closest('.cm-scroller') ?? content.parentElement
  const box = scroller.getBoundingClientRect()
  return [...content.querySelectorAll('.cm-line')]
    .map((one) => ({ text: one.textContent, y: Math.round(one.getBoundingClientRect().top * 10) / 10, h: Math.round(one.getBoundingClientRect().height * 10) / 10 }))
    .filter((one) => one.y + one.h > box.top && one.y < box.bottom)
}
const topOf = (content) => {
  const scroller = content.closest('.cm-scroller') ?? content.parentElement
  const box = scroller.getBoundingClientRect()
  const line = [...content.querySelectorAll('.cm-line')].find((one) => one.getBoundingClientRect().bottom > box.top + 1)
  return line ? { text: line.textContent, y: Math.round(line.getBoundingClientRect().top * 10) / 10 } : null
}
if (sessionStorage.getItem('first-screen-other-words')) {
  const kept = JSON.parse(localStorage.getItem('orden:first-screen') ?? 'null')
  if (kept) localStorage.setItem('orden:first-screen', JSON.stringify({ ...kept, words: '0:other' }))
}
new MutationObserver(() => {
  const now = performance.now()
  const drawing = document.querySelector('.panes > .first')
  if (first.list === null && document.querySelector('aside .row')) first.list = now
  if (drawing && first.drawn === null) {
    first.drawn = now
    const content = drawing.querySelector('.cm-content')
    if (content) {
      first.top = topOf(content)
      first.lines = linesOf(content)
    }
  }
  if (first.editor === null && [...document.querySelectorAll('.cm-editor')].some((one) => !one.closest('.panes > .first'))) first.editor = now
  if (first.drawn !== null && first.gone === null && !drawing) first.gone = now
}).observe(document, { childList: true, subtree: true })
// Every frame, whether the editor has a heading on screen still showing its marks: the
// note drawn as the characters it is made of rather than as it reads.
first.raw = 0
first.rawSeen = 0
const look = () => {
  const content = [...document.querySelectorAll('.cm-content')].find((one) => !one.closest('.panes > .first'))
  if (content) {
    const box = content.closest('.cm-scroller').getBoundingClientRect()
    const raw = [...content.querySelectorAll('.cm-line')].some((one) => {
      const r = one.getBoundingClientRect()
      return r.bottom > box.top && r.top < box.bottom && one.textContent.startsWith('## ')
    })
    if (raw) first.raw++
    if (raw && !document.querySelector('.panes > .first')) first.rawSeen++
  }
  if (performance.now() < 20000) requestAnimationFrame(look)
}
requestAnimationFrame(look)
"""

EDITOR_LINES = r"""() => {
  const content = [...document.querySelectorAll('.cm-content')].find((one) => !one.closest('.panes > .first'))
  const box = content.closest('.cm-scroller').getBoundingClientRect()
  return [...content.querySelectorAll('.cm-line')]
    .map((one) => ({ text: one.textContent, y: Math.round(one.getBoundingClientRect().top * 10) / 10, h: Math.round(one.getBoundingClientRect().height * 10) / 10 }))
    .filter((one) => one.y + one.h > box.top && one.y < box.bottom)
}"""

EDITOR_TOP = r"""() => {
  const content = [...document.querySelectorAll('.cm-content')].find((one) => !one.closest('.panes > .first'))
  const scroller = content.closest('.cm-scroller')
  const box = scroller.getBoundingClientRect()
  const line = [...content.querySelectorAll('.cm-line')].find((one) => one.getBoundingClientRect().bottom > box.top + 1)
  return line ? { text: line.textContent, y: Math.round(line.getBoundingClientRect().top * 10) / 10 } : null
}"""

KEPT = "() => !!localStorage.getItem('orden:first-screen')"

def left_alone(page: Page) -> None:
    page.wait_for_timeout(1500)
    DRIVE.wait_for(page, KEPT, "the first screen to be kept", 20)
    page.wait_for_timeout(500)

def region(page: Page) -> dict[str, float]:
    return page.evaluate(
        "() => { const r = document.querySelector('.panes').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }"
    )

def relaunched(page: Page, cdp) -> dict:
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
    page.reload(wait_until="domcontentloaded")
    DRIVE.wait_for(page, "window.__first && window.__first.drawn !== null || window.__first.editor !== null", "a first frame", 60)
    held: bytes | None = None
    if page.evaluate("() => !!document.querySelector('.panes > .first')"):
        held = page.screenshot(clip=region(page), animations="disabled")
    DRIVE.ready(page)
    DRIVE.wait_for(page, "window.__first.gone !== null || window.__first.drawn === null", "the handover", 30)
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
    DRIVE.settled(page)
    found = page.evaluate("() => window.__first")
    found["held"] = held
    return found

def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    page.add_init_script(WATCH)
    cdp = page.context.new_cdp_session(page)
    DRIVE.open(page)
    DRIVE.seed(page, NOTE)
    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
    DRIVE.open_note(page, "Long walk")
    page.evaluate(
        "() => { const s = [...document.querySelectorAll('.cm-scroller')].pop(); s.scrollTop = s.scrollHeight / 2 }"
    )
    left_alone(page)
    left = page.evaluate(EDITOR_TOP)
    say(f"left at {json.dumps(left)}")

    found = relaunched(page, cdp)
    at = lambda key: "-" if found[key] is None else f"{found[key]:.0f}"  # noqa: E731
    say(f"list at {at('list')} ms, drawing at {at('drawn')} ms, editor at {at('editor')} ms, drawing gone at {at('gone')} ms")
    if found["drawn"] is None:
        wrong("the note was not drawn before its editor")
        return
    if found["editor"] is not None and found["drawn"] > found["editor"]:
        wrong("the drawing came after the editor")
    marks = page.evaluate(
        "() => Object.fromEntries(performance.getEntriesByType('mark').map((one) => [one.name, one.startTime]))"
    )
    drawn_at = marks.get("orden: first screen drawn")
    frame_at = marks.get("orden: first frame painted")
    say(f"first screen drawn at {drawn_at:.0f} ms, first frame painted at {frame_at:.0f} ms")
    if drawn_at is None or frame_at is None or drawn_at > frame_at + 20:
        wrong("the drawing was not in the launch's first frame")

    top = found["top"]
    after = page.evaluate(EDITOR_TOP)
    say(f"drawn top {json.dumps(top)}, editor top {json.dumps(after)}")
    if not top or not after or top["text"] != after["text"] or abs(top["y"] - after["y"]) > 1:
        wrong("the editor's top line is not the drawing's")
    if not left or not after or left["text"] != after["text"]:
        wrong("the note did not come back where it was left")

    say(f"frames with a heading's marks on screen: {found['raw']}, of them with nothing over them: {found['rawSeen']}")
    if found["rawSeen"]:
        wrong(f"the note showed its marks for {found['rawSeen']} frames")

    drawn = found["lines"] or []
    now = page.evaluate(EDITOR_LINES)
    moved = [
        (one, other)
        for one, other in zip(drawn, now)
        if one["text"] != other["text"] or abs(one["y"] - other["y"]) > 1 or abs(one["h"] - other["h"]) > 1
    ]
    say(f"{len(drawn)} lines drawn, {len(now)} in the editor, {len(moved)} moved")
    if not drawn or len(drawn) != len(now) or moved:
        wrong(f"lines moved at the handover: {moved[:3]}")

    if found["held"] is not None:
        (DRIVE.shots / "01-drawn.png").write_bytes(found["held"])
        (DRIVE.shots / "02-editor.png").write_bytes(page.screenshot(clip=region(page), animations="disabled"))

    page.evaluate("() => sessionStorage.setItem('first-screen-other-words', '1')")
    changed = relaunched(page, cdp)
    if changed["drawn"] is not None:
        wrong("a screen kept of other words was drawn")
    else:
        say("a screen kept of other words was not drawn")

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the note was on screen in the first frame and its editor took over in place"))
