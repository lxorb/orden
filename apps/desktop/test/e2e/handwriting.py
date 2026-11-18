from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

PHONE_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15"
    " (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
)

KEYS = """
(pixels) => {
  const seen = window.ordenApp.viewport
  seen.keyboard = pixels
  seen.typing = pixels > 0
}
"""

CARET = """
() => {
  const view = window.orden
  const line = view.state.doc.line(3)
  view.dispatch({ selection: { anchor: line.to } })
  view.focus()
}
"""

INK = "() => (JSON.parse(window.ordenApp.workspace.active?.doc || '{}').orden?.ink ?? []).length"

ACTIVE = "window.ordenApp.workspace.active"


def write_by_finger(page: Page) -> None:
    box = page.locator(".canvas").first.bounding_box()
    if not box:
        wrong("no canvas to write on")
        return
    cdp = page.context.new_cdp_session(page)
    x = box["x"] + box["width"] / 2 - 90
    y = box["y"] + box["height"] / 2 - 60
    points = [(x + step * 12, y + (step % 5) * 9) for step in range(16)]
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": points[0][0], "y": points[0][1]}]})
    for px, py in points[1:]:
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": px, "y": py}]})
        page.wait_for_timeout(16)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.wait_for_timeout(600)


def phone(browser: Browser, dark: bool, width: int, height: int) -> None:
    tag = f"{'dark-' if dark else ''}{width}-"
    context = DRIVE.context(
        browser,
        viewport={"width": width, "height": height},
        user_agent=PHONE_AGENT,
        has_touch=True,
        is_mobile=True,
        color_scheme="dark" if dark else "light",
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    DRIVE.seed(page, "# Lecture\n\nThe proof goes like this\n\nand then it ends.")
    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
    page.wait_for_timeout(300)
    page.locator("[data-panel=tree]").get_by_text("Lecture").first.tap()
    wait_for(page, f"{ACTIVE}?.shown === 'Lecture' && window.ordenApp.workspace.panel === null", "the note")
    page.wait_for_timeout(400)

    page.evaluate("() => window.ordenApp.toolbar.reset()")
    page.evaluate(CARET)
    page.evaluate(KEYS, 300)
    pen = page.locator('.orden-bar.docked button[aria-label="Handwriting"]')
    pen.wait_for(state="visible", timeout=5000)
    DRIVE.shot(page, f"{tag}bar")
    pen.click()
    page.evaluate(KEYS, 0)

    wait_for(page, f"{ACTIVE}?.kind === 'canvas'", "the handwriting canvas")
    page.wait_for_selector(".canvas", timeout=15000)
    page.wait_for_timeout(600)
    path = page.evaluate(f"() => {ACTIVE}.path")
    say(f"[{tag}] the canvas: {path}")
    if "handwriting-" not in (path or ""):
        wrong(f"[{tag}] the canvas is named {path}")
    note = page.evaluate(
        "() => window.ordenApp.workspace.tabs.find((tab) => tab.shown === 'Lecture')?.doc ?? ''"
    )
    if "![[handwriting-" not in note:
        wrong(f"[{tag}] the note has no embed: {note!r}")
    if "The proof goes like this\n\n![[handwriting-" not in note or ".canvas]]\n\n\nand then" not in note:
        wrong(f"[{tag}] the embed is not on its own line after the caret: {note!r}")

    write_by_finger(page)
    wait_for(page, f"({INK})() > 0", "a stroke written by finger, the pen chosen")
    DRIVE.shot(page, f"{tag}canvas")
    wait_for(page, f"!{ACTIVE}?.dirty", "the drawing saved")

    lecture = page.evaluate(
        "() => window.ordenApp.workspace.tabs.find((tab) => tab.shown === 'Lecture').id"
    )
    page.evaluate(f"() => window.ordenApp.workspace.activate({lecture!r})")
    wait_for(page, f"{ACTIVE}?.shown === 'Lecture'", "back on the note")
    page.wait_for_timeout(1500)
    DRIVE.shot(page, f"{tag}note")
    embed = page.locator(".orden-embed-file[data-kind=canvas]").first
    embed.wait_for(state="visible", timeout=8000)

    embed.tap()
    wait_for(page, f"{ACTIVE}?.kind === 'canvas' && ({INK})() > 0", "the drawing opened again from the note")
    context.close()


def drive(browser: Browser) -> None:
    phone(browser, False, 390, 844)
    phone(browser, True, 390, 844)
    phone(browser, False, 820, 1180)


raise SystemExit(
    DRIVE.run(drive, "the pen in the note's bar puts a drawing in the note and opens it to write in by hand")
)
