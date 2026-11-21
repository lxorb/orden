from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
TOUCH_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)
CAMERA_Y = "() => window.ordenApp.pages.current.store.camera.y"
def opened(page: Page) -> dict:
    wait_for(page, "window.ordenApp.workspace.spaces.length > 0", "a space")
    for _try in range(4):
        page.evaluate("() => window.ordenApp.workspace.createPages()")
        page.wait_for_timeout(700)
        if page.evaluate("() => !!window.ordenApp.workspace.active?.path?.endsWith('.pages')"):
            break
    page.wait_for_selector(".pages", timeout=15000)
    page.wait_for_timeout(500)
    for _ in range(4):
        page.evaluate("() => window.ordenApp.pages.current.store.addPage()")
    page.wait_for_timeout(500)
    page.evaluate("() => window.ordenApp.pages.current.store.turnTo(1)")
    page.wait_for_timeout(700)
    box = page.locator(".pages").first.bounding_box()
    assert box
    return box
def moved(page: Page, label: str, act) -> None:
    before = page.evaluate(CAMERA_Y)
    act()
    page.wait_for_timeout(700)
    after = page.evaluate(CAMERA_Y)
    say(f"{label}: the view went {before:.0f} -> {after:.0f}")
    if after <= before + 100:
        wrong(f"{label} did not scroll a five page note down")
def by_wheel(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1100, "height": 760})
    DRIVE.open(page)
    box = opened(page)
    middle = (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.move(*middle)
    def wheel() -> None:
        for _ in range(6):
            page.mouse.wheel(0, 120)
            page.wait_for_timeout(40)
    moved(page, "a mouse wheel", wheel)
    def pad() -> None:
        for _ in range(40):
            page.mouse.wheel(0, 9)
            page.wait_for_timeout(16)
    moved(page, "a trackpad", pad)
    here = page.evaluate("() => window.ordenApp.workspace.activeTabId")
    other = page.evaluate("() => window.ordenApp.workspace.tabs.find((one) => one.id !== window.ordenApp.workspace.activeTabId)?.id")
    page.evaluate("(id) => window.ordenApp.workspace.activate(id)", other)
    page.wait_for_timeout(600)
    page.evaluate("(id) => window.ordenApp.workspace.activate(id)", here)
    page.wait_for_timeout(800)
    page.evaluate("() => window.ordenApp.pages.current.store.turnTo(1)")
    page.wait_for_timeout(500)
    page.mouse.move(*middle)
    moved(page, "a mouse wheel after the tab was away and back", wheel)
    page.evaluate("() => window.ordenApp.workspace.createPages()")
    page.wait_for_timeout(1200)
    page.evaluate("() => window.ordenApp.workspace.createCanvas()")
    page.wait_for_timeout(1200)
    page.evaluate("(id) => window.ordenApp.workspace.activate(id)", here)
    page.wait_for_timeout(900)
    page.evaluate("() => window.ordenApp.pages.current?.store.turnTo(1)")
    page.wait_for_timeout(500)
    shown = page.evaluate("() => [...document.querySelectorAll('.pages')].map((one) => one.getClientRects().length > 0)")
    say(f"page notes mounted, shown: {shown}")
    page.mouse.move(*middle)
    moved(page, "a mouse wheel with another page note and a canvas kept behind", wheel)
    page.context.close()
def by_touch(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1100, "height": 760}, user_agent=TOUCH_AGENT, has_touch=True)
    DRIVE.open(page)
    box = opened(page)
    cdp = page.context.new_cdp_session(page)
    x = box["x"] + box["width"] / 2
    def swipe() -> None:
        top, bottom = box["y"] + box["height"] * 0.75, box["y"] + box["height"] * 0.25
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": top, "id": 1}]})
        for step in range(1, 21):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": top + (bottom - top) * step / 20, "id": 1}]})
            page.wait_for_timeout(12)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    moved(page, "a finger", swipe)
    page.context.close()
def drive(browser: Browser) -> None:
    by_wheel(browser)
    by_touch(browser)
raise SystemExit(DRIVE.run(drive, "a page note of five pages scrolls by a mouse wheel, a trackpad and a finger"))
