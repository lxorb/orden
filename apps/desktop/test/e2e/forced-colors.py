from __future__ import annotations

import io
import json

from PIL import Image
from playwright.sync_api import Browser, Page

from harness import WEBKIT, Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

NOTE = """# Plan

Before the code, ==a plain mark== and ==🔴 a red one==.

```js
const hello = 'world'
```

After it.
"""

SYSTEM = """
() => {
  const probe = document.createElement('div')
  document.body.append(probe)
  const read = (name) => { probe.style.color = name; return getComputedStyle(probe).color }
  const out = { canvas: read('Canvas'), text: read('CanvasText'), highlight: read('Highlight'), gray: read('GrayText'), mark: read('Mark') }
  probe.remove()
  return out
}
"""

SPACERS = """
() => [...document.querySelectorAll('.cm-line.orden-code-open, .cm-line.orden-code-close, .cm-line.orden-frontmatter')].map((line) => {
  const style = getComputedStyle(line)
  const sides = ['Top', 'Bottom', 'Left', 'Right'].filter((side) => parseFloat(style[`border${side}Width`]) > 2)
  return { line: line.className, sides: sides.map((side) => [side, style[`border${side}Color`]]) }
})
"""

CONTROLS = """
() => {
  const style = (one) => getComputedStyle(one)
  return {
    switches: [...document.querySelectorAll('[role=dialog] .orden-switch')].filter((one) => one.checkVisibility()).map((one) => ({
      on: one.classList.contains('on'), edge: style(one).borderTopColor, edgeWide: style(one).borderTopWidth, ground: style(one).backgroundColor,
    })),
    segments: [...document.querySelectorAll('[role=dialog] .orden-segmented button')].filter((one) => one.checkVisibility()).map((one) => ({
      on: one.classList.contains('on'), ground: style(one).backgroundColor, words: one.textContent.trim(),
    })),
    swatches: [...document.querySelectorAll('[role=dialog] .swatch:not(.picked)')].filter((one) => one.checkVisibility()).map((one) => getComputedStyle(one, one.classList.contains('active') ? '::after' : null).backgroundColor),
  }
}
"""

def system(page: Page) -> dict[str, str]:
    return page.evaluate(SYSTEM)

def track_ends(page: Page, canvas: str) -> list[str]:
    bad = []
    for at, slider in enumerate(page.locator("[role=dialog] .orden-slider").all()):
        if not slider.is_visible():
            continue
        picture = Image.open(io.BytesIO(slider.screenshot())).convert("RGB")
        wide, tall = picture.size
        ground = tuple(int(part) for part in canvas[canvas.index("(") + 1 : canvas.index(")")].split(",")[:3])
        for x in (4, wide - 4):
            column = [picture.getpixel((x, y)) for y in range(tall)]
            if all(sum(abs(a - b) for a, b in zip(pixel, ground)) < 60 for pixel in column):
                bad.append(f"slider {at} has nothing drawn at x={x} of {wide}")
    return bad

WORDS_BOX = """
(button) => {
  const range = document.createRange()
  range.selectNodeContents(button)
  const words = range.getBoundingClientRect()
  const box = button.getBoundingClientRect()
  return [words.left - box.left, words.top - box.top, words.width, words.height]
}
"""

def words_unseen(page: Page) -> list[str]:
    bad = []
    for button in page.locator("[role=dialog] .orden-segmented button.on").all():
        if not button.is_visible():
            continue
        picture = Image.open(io.BytesIO(button.screenshot())).convert("RGB")
        left, top, wide, tall = button.evaluate(WORDS_BOX)
        ground = picture.getpixel((2, picture.size[1] // 2))
        inside = [
            picture.getpixel((x, y))
            for x in range(max(0, int(left)), min(picture.size[0], int(left + wide)))
            for y in range(max(0, int(top)), min(picture.size[1], int(top + tall)))
        ]
        near = sum(1 for pixel in inside if sum(abs(a - b) for a, b in zip(pixel, ground)) < 40)
        if not inside or near < len(inside) * 0.2:
            bad.append(f"the chosen segment {button.text_content()!r} has its words on a plate of their own, {near} of {len(inside)} pixels its ground")
    return bad

def drive_scheme(browser: Browser, scheme: str) -> None:
    context = browser.new_context(viewport={"width": 1280, "height": 800}, forced_colors="active", color_scheme=scheme)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{scheme}] page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "window.ordenApp && window.ordenApp.workspace.active", "the app")
    page.evaluate(
        "async (note) => { const ws = window.ordenApp.workspace; await ws.noteFrom(note, ws.activeSpace.root); await ws.loadTree();"
        " const found = ws.notes.find((one) => one.name.startsWith('Plan')); await ws.openEntry(found.path, { activate: true }) }",
        NOTE,
    )
    wait_for(page, "document.querySelector('.cm-line.orden-code-open')", "the code block")
    page.wait_for_timeout(400)
    colours = system(page)
    say(f"[{scheme}] system colours {json.dumps(colours)}")
    DRIVE.shot(page, f"{scheme}-note")

    page.evaluate("() => window.orden.dispatch({ selection: { anchor: window.orden.state.doc.length } })")
    page.wait_for_timeout(300)
    marks = page.evaluate("() => [...document.querySelectorAll('.cm-content .orden-highlight')].map((one) => [one.textContent, getComputedStyle(one).backgroundColor])")
    if len(marks) != 2:
        wrong(f"[{scheme}] the note's two highlights are not both marked: {marks}")
    for words, colour in marks:
        if colour != colours["mark"]:
            wrong(f"[{scheme}] the highlight {words!r} is painted {colour}, not the system's mark {colours['mark']}")

    edge = page.evaluate(
        "() => { const s = getComputedStyle(document.querySelector('.cm-line.orden-code-open'), '::after'); return [s.borderTopStyle, s.borderTopColor, s.borderLeftStyle] }"
    )
    if edge[0] != "solid" or edge[1] != colours["text"] or edge[2] != "solid":
        wrong(f"[{scheme}] the code block has no edge of its own to tell it from the words: {edge}")

    for one in page.evaluate(SPACERS):
        for side, colour in one["sides"]:
            if colour != colours["canvas"]:
                wrong(f"[{scheme}] {one['line']}: the room on its {side.lower()} is drawn as a bar of {colour}, not the window's {colours['canvas']}")

    page.evaluate("() => window.ordenApp.settings.show('appearance')")
    page.wait_for_timeout(400)
    field = page.locator("[role=dialog] input[type=search], [role=dialog] input").first
    field.focus()
    page.keyboard.type("x")
    ring = page.evaluate(
        "() => { const on = document.activeElement; const held = on.closest('.orden-field') ?? on; const s = getComputedStyle(held); return [s.outlineStyle, s.outlineColor] }"
    )
    if ring[0] == "none" or ring[1] != colours["highlight"]:
        wrong(f"[{scheme}] the field being typed in looks like every other field: {ring}")
    page.keyboard.press("Backspace")

    for pane in ("appearance", "editor"):
        page.evaluate("(pane) => window.ordenApp.settings.show(pane)", pane)
        page.wait_for_timeout(500)
        DRIVE.shot(page, f"{scheme}-{pane}")
        found = page.evaluate(CONTROLS)
        say(f"[{scheme}] {pane}: {len(found['switches'])} switches, {len(found['segments'])} segments, {len(found['swatches'])} swatches")
        for at, one in enumerate(found["switches"]):
            if one["edgeWide"] in ("0px", "") or one["edge"] == colours["canvas"]:
                wrong(f"[{scheme}] {pane}: switch {at} has no edge to be seen by: {one}")
            if one["on"] and one["ground"] != colours["highlight"]:
                wrong(f"[{scheme}] {pane}: switch {at} is on and does not say so: {one}")
        on = [one for one in found["segments"] if one["on"]]
        off = [one for one in found["segments"] if not one["on"]]
        for one in on:
            if one["ground"] != colours["highlight"] or any(other["ground"] == one["ground"] for other in off):
                wrong(f"[{scheme}] {pane}: the chosen segment {one['words']!r} looks like the others: {one['ground']}")
        for colour in found["swatches"]:
            if colour in (colours["canvas"], "rgba(0, 0, 0, 0)"):
                wrong(f"[{scheme}] {pane}: a colour to choose is drawn as nothing: {colour}")
        for one in words_unseen(page):
            wrong(f"[{scheme}] {pane}: {one}")
        for one in track_ends(page, colours["canvas"]):
            wrong(f"[{scheme}] {pane}: {one}")

    page.evaluate("() => { window.ordenApp.settings.open = false }")
    page.wait_for_timeout(300)
    page.keyboard.press("Control+Shift+P")
    wait_for(page, "document.querySelector('.palette .orden-row.is-on')", "the palette's current row")
    current = page.evaluate(
        "() => { const s = getComputedStyle(document.querySelector('.palette .orden-row.is-on')); return [s.outlineStyle, s.outlineColor, s.backgroundColor] }"
    )
    if current[0] == "none" and current[2] != colours["highlight"]:
        wrong(f"[{scheme}] the palette's current row looks like every other: {current}")
    DRIVE.shot(page, f"{scheme}-palette")
    context.close()

def drive(browser: Browser) -> None:
    if WEBKIT:
        say("WebKit has no forced colours to emulate")
        return
    for scheme in ("dark", "light"):
        drive_scheme(browser, scheme)

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
