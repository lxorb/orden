from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
PHONE = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
SIZES = [
    ("laptop", 1440, 900, None),
    ("wide", 2560, 1440, None),
    ("portrait", 900, 1400, None),
    ("phone", 390, 844, PHONE),
]
SHEET = """
() => {
  const host = [...document.querySelectorAll('.pages')].find((one) => one.getClientRects().length)
  const sheet = host?.querySelector('.sheet')
  if (!host || !sheet) return null
  const h = host.getBoundingClientRect()
  const s = sheet.getBoundingClientRect()
  return { pane: [h.width, h.height], left: s.left - h.left, right: h.right - s.right, width: s.width, height: s.height, top: s.top - h.top }
}
"""
def opened(page: Page) -> None:
    wait_for(page, "window.ordenApp.workspace.spaces.length > 0", "a space")
    for _try in range(4):
        page.evaluate("() => window.ordenApp.workspace.createPages()")
        page.wait_for_timeout(700)
        if page.evaluate("() => window.ordenApp.workspace.active?.kind === 'pages'"):
            break
    page.wait_for_selector(".pages", timeout=15000)
    page.wait_for_timeout(900)
def sized(browser: Browser, name: str, width: int, height: int, agent: str | None) -> None:
    extra = {"user_agent": agent, "has_touch": True, "is_mobile": True} if agent else {}
    page = DRIVE.page(browser, viewport={"width": width, "height": height}, **extra)
    DRIVE.open(page)
    opened(page)
    seen = page.evaluate(SHEET)
    say(f"{name} {width}x{height}: {seen}")
    if not seen:
        wrong(f"{name}: no page was shown")
        page.context.close()
        return
    pane_w, pane_h = seen["pane"]
    in_sight = (pane_h - max(0, seen["top"])) / seen["height"]
    if agent:
        if seen["width"] < pane_w - 80:
            wrong(f"{name}: a phone should fit the page across the screen ({seen['width']:.0f} of {pane_w:.0f})")
    else:
        if seen["width"] > 1000:
            wrong(f"{name}: the page opened {seen['width']:.0f} px wide, past reading size")
        if seen["width"] > pane_w - 40:
            wrong(f"{name}: the page fills the pane rather than sitting inside it")
        if min(1.0, in_sight) < 0.55:
            wrong(f"{name}: only {in_sight:.0%} of the page height is in sight")
        if abs(seen["left"] - seen["right"]) > 4:
            wrong(f"{name}: the page is not centred ({seen['left']:.0f} left, {seen['right']:.0f} right)")
    page.screenshot(path=str(DRIVE.shots / f"{name}.png"))
    page.context.close()
def drive(browser: Browser) -> None:
    DRIVE.shots.mkdir(parents=True, exist_ok=True)
    for name, width, height, agent in SIZES:
        sized(browser, name, width, height, agent)
raise SystemExit(DRIVE.run(drive, "a page note opens at a size that reads well on a laptop, a wide monitor, a portrait screen and a phone"))
