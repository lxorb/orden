from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
ZOOM = "() => getComputedStyle(document.documentElement).getPropertyValue('--zoom').trim() || '1'"
CAMERAS = {
    "canvas": "() => { const c = window.ordenApp.workspace.active.camera ?? { x: 0, y: 0, scale: 1 }; return [c.x, c.y, c.scale] }",
    "pages": "() => { const c = window.ordenApp.pages.current.store.camera; return [c.x, c.y, c.scale] }",
}
KINDS = {"canvas": (".canvas", "createCanvas", "c"), "pages": (".pages", "createPages", "w")}
def opened(page: Page, kind: str) -> dict:
    selector, make, _ = KINDS[kind]
    wait_for(page, "window.ordenApp.workspace.spaces.length > 0", "a space")
    for _try in range(4):
        page.evaluate(f"() => window.ordenApp.workspace.{make}()")
        page.wait_for_timeout(700)
        if page.evaluate(f"() => !!window.ordenApp.workspace.active?.path?.endsWith('.{kind}')"):
            break
    page.wait_for_selector(selector, timeout=15000)
    page.wait_for_timeout(500)
    box = page.locator(selector).first.bounding_box()
    assert box
    page.keyboard.press("Escape")
    page.mouse.click(box["x"] + 40, box["y"] + box["height"] / 2)
    page.wait_for_timeout(150)
    return box
def camera(page: Page, kind: str) -> list[float]:
    page.wait_for_timeout(450)
    return [round(one, 3) for one in page.evaluate(CAMERAS[kind])]
def zooms(page: Page, kind: str) -> None:
    zoom = page.evaluate(ZOOM)
    before = camera(page, kind)
    page.keyboard.press("Meta+Equal")
    after = camera(page, kind)
    say(f"{kind}: Cmd+= scale {before[2]} -> {after[2]}, app zoom {zoom} -> {page.evaluate(ZOOM)}")
    if not after[2] > before[2]:
        wrong(f"{kind}: Cmd+= did not zoom the surface in")
    if page.evaluate(ZOOM) != zoom:
        wrong(f"{kind}: Cmd+= changed the app's text size too")
    page.keyboard.press("Meta+Minus")
    out = camera(page, kind)
    if not out[2] < after[2]:
        wrong(f"{kind}: Cmd+- did not zoom the surface out")
    page.keyboard.press("Meta+Equal")
    page.keyboard.press("Meta+Equal")
    zoomed = camera(page, kind)
    page.keyboard.press("Shift+Digit1")
    fitted = camera(page, kind)
    say(f"{kind}: Shift+1 camera {fitted} from {zoomed}")
    if fitted == zoomed or page.evaluate(ZOOM) != zoom:
        wrong(f"{kind}: Shift+1 did not fit the surface")
def typed(page: Page, box: dict, kind: str) -> None:
    page.keyboard.press(KINDS[kind][2])
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 3)
    page.wait_for_timeout(500)
    before = camera(page, kind)
    page.keyboard.type("hi", delay=20)
    page.keyboard.press("Shift+Digit1")
    page.keyboard.press("Shift+Digit2")
    page.wait_for_timeout(300)
    text = page.evaluate("() => document.activeElement?.innerText ?? document.activeElement?.value ?? ''")
    after = camera(page, kind)
    say(f"{kind}: typed {text!r}; camera {before} -> {after}")
    if "hi!@" not in text.replace("\n", ""):
        wrong(f"{kind}: Shift+1 and Shift+2 while writing did not type ! and @ ({text!r})")
    if after != before:
        wrong(f"{kind}: Shift+1 or Shift+2 while writing moved the view")
    page.keyboard.press("Escape")
def drive(browser: Browser) -> None:
    for kind in KINDS:
        page = DRIVE.page(browser, viewport={"width": 1200, "height": 800}, user_agent=MAC)
        DRIVE.open(page)
        box = opened(page, kind)
        typed(page, box, kind)
        page.mouse.click(box["x"] + 40, box["y"] + box["height"] - 60)
        page.keyboard.press("Escape")
        zooms(page, kind)
        page.context.close()
raise SystemExit(DRIVE.run(drive, "on a Mac, Cmd+= and Cmd+- zoom a canvas or a page note, Shift+1 fits it, and none of them touch the words being written"))
