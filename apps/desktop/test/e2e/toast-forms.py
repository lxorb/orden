from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
PIXEL = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
DEVICES = {
    "iphone": {"viewport": {"width": 393, "height": 852}, "user_agent": IPHONE, "is_mobile": True, "has_touch": True},
    "android": {"viewport": {"width": 412, "height": 915}, "user_agent": PIXEL, "is_mobile": True, "has_touch": True},
    "desktop": {"viewport": {"width": 1280, "height": 820}},
}
FORMS = {"iphone": "ios", "android": "android", "desktop": "desktop"}
SWIPES = {"iphone": (0, -110), "android": (140, 4)}
SEED = """
async (name) => {
  const ws = window.ordenApp.workspace
  await ws.noteFrom(`# ${name}\\n\\nApples, bread.\\n`, ws.activeSpace.root)
  await ws.loadTree()
  return ws.notes.find((one) => one.name === `${name}.md`).path
}
"""
UNDO = "[...document.querySelectorAll('.toast button')].some((one) => one.textContent === 'Undo')"
BOX = """() => {
  const toast = document.querySelector('.toast')
  if (!toast) return null
  const box = toast.getBoundingClientRect()
  return { form: [...toast.classList].find((one) => ['ios', 'android', 'desktop'].includes(one)) ?? null, top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, tall: innerHeight, wide: innerWidth, button: document.querySelector('.toast button')?.getBoundingClientRect().height ?? 0 }
}"""
AT = """() => {
  const box = document.querySelector('.toast')?.getBoundingClientRect()
  return box ? { x: box.left + 40, y: box.top + box.height / 2 } : null
}"""
def deleted(page: Page, name: str) -> None:
    path = page.evaluate(SEED, name)
    page.evaluate("(path) => window.ordenApp.workspace.remove(path, false)", path)
    wait_for(page, UNDO, f"the undo toast for {name}")
    page.wait_for_timeout(500)
def swipe(page: Page, dx: int, dy: int) -> None:
    at = page.evaluate(AT)
    if not at:
        return
    cdp = page.context.new_cdp_session(page)
    def touch(kind: str, x: float, y: float) -> None:
        points = [] if kind == "touchEnd" else [{"x": x, "y": y, "id": 1}]
        cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})
    touch("touchStart", at["x"], at["y"])
    for step in (0.3, 0.6, 1):
        touch("touchMove", at["x"] + dx * step, at["y"] + dy * step)
        page.wait_for_timeout(30)
    touch("touchEnd", at["x"] + dx, at["y"] + dy)
    cdp.detach()
def one(browser: Browser, device: str, scheme: str) -> None:
    tag = f"[{device} {scheme}]"
    page = DRIVE.page(browser, color_scheme=scheme, device_scale_factor=2, **DEVICES[device])
    DRIVE.open(page)
    page.wait_for_timeout(800)
    deleted(page, "Groceries")
    if device == "desktop":
        page.hover(".toast")
        page.wait_for_timeout(300)
    box = page.evaluate(BOX)
    say(f"{tag} {box}")
    if not box or box["form"] != FORMS[device]:
        wrong(f"{tag} the toast is {box and box['form']}, not {FORMS[device]}")
    shot(page, f"{device}-{scheme}-undo")
    if device != "desktop" and box:
        if box["left"] > 16 or box["width"] < box["wide"] / 2:
            wrong(f"{tag} the toast is {box['width']}px of {box['wide']}px from {box['left']}, not full width")
        if box["button"] < 44:
            wrong(f"{tag} the Undo button is {box['button']}px tall, under 44")
        if device == "iphone" and box["top"] > box["tall"] / 2:
            wrong(f"{tag} the toast sits at {box['top']}, not near the top")
        if device == "android" and box["bottom"] < box["tall"] / 2:
            wrong(f"{tag} the toast ends at {box['bottom']}, not near the bottom")
        dx, dy = SWIPES[device]
        swipe(page, dx // 4, dy // 4)
        page.wait_for_timeout(500)
        if not page.evaluate(UNDO):
            wrong(f"{tag} a short pull put the toast away")
        swipe(page, dx, dy)
        wait_for(page, f"!({UNDO})", f"{tag} the toast swiped away")
        say(f"{tag} swiped away")
    page.context.close()
def drive(browser: Browser) -> None:
    for device in ["iphone", "android"]:
        for scheme in ["light", "dark"]:
            one(browser, device, scheme)
    one(browser, "desktop", "light")
    one(browser, "desktop", "dark")
raise SystemExit(DRIVE.run(drive, "a toast takes the phone's form, is swiped away there and is unchanged on the desktop"))
