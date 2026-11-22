from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
BAR = """
() => {
  const bar = [...document.querySelectorAll('.pages > .orden-scrollbar')].find((one) => one.getClientRects().length > 0)
  const thumb = bar?.querySelector('.orden-scrollbar-thumb')
  if (!bar || !thumb) return null
  const box = thumb.getBoundingClientRect()
  return { needed: bar.classList.contains('is-needed'), lit: bar.classList.contains('is-lit'), top: box.top, height: box.height, x: box.x + box.width / 2, width: box.width, bars: [...document.querySelectorAll('.pages .orden-scrollbar')].filter((one) => one.getClientRects().length > 0).length }
}
"""
CAMERA_Y = "() => window.ordenApp.pages.current.store.camera.y"
def opened(page: Page) -> dict:
    wait_for(page, "window.ordenApp.workspace.spaces.length > 0", "a space")
    for _try in range(4):
        page.evaluate("() => window.ordenApp.workspace.createPages()")
        page.wait_for_timeout(700)
        if page.evaluate("() => !!window.ordenApp.workspace.active?.path?.endsWith('.pages')"):
            break
    page.wait_for_selector(".pages:visible", timeout=15000)
    page.wait_for_timeout(500)
    box = page.locator(".pages:visible").first.bounding_box()
    assert box
    return box
def scheme(browser: Browser, colour: str) -> None:
    page = DRIVE.page(browser, viewport={"width": 1100, "height": 760}, color_scheme=colour)
    DRIVE.open(page)
    box = opened(page)
    for _ in range(5):
        page.evaluate("() => window.ordenApp.pages.current.store.addPage()")
    page.wait_for_timeout(600)
    page.evaluate("() => window.ordenApp.pages.current.store.turnTo(1)")
    page.wait_for_timeout(500)
    first = page.evaluate(BAR)
    say(f"{colour}: six pages at the top: {first}")
    if not first or not first["needed"] or first["bars"] != 1:
        wrong(f"{colour}: six pages show no single scroll bar ({first})")
        page.context.close()
        return
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    for _ in range(6):
        page.mouse.wheel(0, 300)
        page.wait_for_timeout(30)
    page.wait_for_timeout(400)
    scrolled = page.evaluate(BAR)
    say(f"{colour}: scrolled down: {scrolled}")
    if not scrolled or scrolled["top"] <= first["top"] + 2 or not scrolled["lit"]:
        wrong(f"{colour}: scrolling down did not move and light the thumb ({first} -> {scrolled})")
    y = page.evaluate(CAMERA_Y)
    grab = scrolled or first
    page.mouse.move(grab["x"], grab["top"] + grab["height"] / 2)
    page.mouse.down()
    page.mouse.move(grab["x"], grab["top"] + grab["height"] / 2 + 120, steps=8)
    page.mouse.up()
    page.wait_for_timeout(300)
    dragged = page.evaluate(CAMERA_Y)
    say(f"{colour}: dragging the thumb 120 px moved the view {y:.0f} -> {dragged:.0f}")
    if dragged <= y + 50:
        wrong(f"{colour}: dragging the thumb did not scroll the page note")
    page.screenshot(path=str(DRIVE.shots / f"bar-{colour}.png"))
    page.context.close()
def drive(browser: Browser) -> None:
    DRIVE.shots.mkdir(parents=True, exist_ok=True)
    for colour in ("light", "dark"):
        scheme(browser, colour)
raise SystemExit(DRIVE.run(drive, "a page note longer than its pane shows Orden's own scroll bar, which follows the view and drags it"))
