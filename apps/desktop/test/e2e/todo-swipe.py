import json
import sys
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
PHONES = {
    "iphone": (
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15"
        " (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        {"width": 390, "height": 844},
    ),
    "android": (
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko)"
        " Chrome/126.0.0.0 Mobile Safari/537.36",
        {"width": 412, "height": 915},
    ),
}
TITLES = ["Call the bank", "Water the plants", "Book the dentist", "Pay the rent"]
ARRANGE = """async (titles) => {
  const { todos, openTodos } = await window.ordenApp.tasks()
  for (const one of [...todos.todos]) await todos.remove(one.id)
  const made = []
  for (const title of titles) {
    const one = await todos.add({ title })
    if (one.ok) made.push(one.value.id)
  }
  openTodos()
  return made
}"""
FINGER = """([id, type, dx, dy]) => {
  const row = document.querySelector(`[data-todos-board] [data-todo="${id}"]`)
  if (!row) return null
  const box = row.getBoundingClientRect()
  const x0 = type === 'right' ? box.left + 40 : box.right - 40
  return { x: x0, y: box.top + box.height / 2, w: box.width }
}"""
SEND = """([id, kind, x, y]) => {
  const row = document.querySelector(`[data-todos-board] [data-todo="${id}"]`)
  if (!row) return false
  row.dispatchEvent(new PointerEvent(kind, { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 5, isPrimary: true, clientX: x, clientY: y }))
  return true
}"""
STATE = """(id) => {
  const swipe = document.querySelector(`[data-todo="${id}"]`)?.closest('.swipe')
  return swipe ? { swipe: swipe.dataset.swipe ?? null, armed: swipe.hasAttribute('data-armed'), x: swipe.style.getPropertyValue('--swipe-x') } : null
}"""
PROBE = """(id) => {
  const swipe = document.querySelector(`[data-todo="${id}"]`)?.closest('.swipe')
  const under = swipe?.querySelector('.under')
  const draw = swipe?.querySelector('.draw')
  const mark = swipe?.querySelector('.mark')
  const css = (one) => one ? (({ display, backgroundColor, opacity, scale, visibility }) => ({ display, backgroundColor, opacity, scale, visibility }))(getComputedStyle(one)) : null
  return { under: css(under), draw: css(draw), mark: css(mark), p: swipe?.style.getPropertyValue('--swipe-p'), cls: swipe?.className }
}"""
def frames(page: Page, tag: str, id: str, way: str, stops: list[float], name: str) -> None:
    start = page.evaluate(FINGER, [id, way, 0, 0])
    if not start:
        wrong(f"[{tag}] no row {id}")
        return
    sign = 1 if way == "right" else -1
    x, y, w = start["x"], start["y"], start["w"]
    page.evaluate(SEND, [id, "pointerdown", x, y])
    page.evaluate(SEND, [id, "pointermove", x + sign * 14, y])
    for at, stop in enumerate(stops):
        page.evaluate(SEND, [id, "pointermove", x + sign * w * stop, y + 2])
        page.wait_for_timeout(90)
        say(f"[{tag}] {way} {stop:.2f}: {page.evaluate(STATE, id)}")
        if "--probe" in sys.argv:
            say("probe " + json.dumps(page.evaluate(PROBE, id)))
        DRIVE.shot(page, f"{tag}-{name}-{at}")
    page.evaluate(SEND, [id, "pointerup", x + sign * w * stops[-1], y + 2])
    for at, wait in enumerate([70, 160, 420]):
        page.wait_for_timeout(wait)
        DRIVE.shot(page, f"{tag}-{name}-after-{at}")
def phone(browser: Browser, name: str, dark: bool) -> None:
    agent, viewport = PHONES[name]
    tag = f"{name}-{'dark' if dark else 'light'}"
    context = DRIVE.context(
        browser,
        viewport=viewport,
        user_agent=agent,
        has_touch=True,
        is_mobile=True,
        device_scale_factor=3 if name == "iphone" else 2.625,
        color_scheme="dark" if dark else "light",
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "window.ordenApp.tasks", "the todos on the handle")
    ids = page.evaluate(ARRANGE, TITLES)
    wait_for(page, f"document.querySelector('[data-todos-board] [data-todo=\"{ids[-1]}\"]')", "the todos shown")
    page.wait_for_timeout(600)
    DRIVE.shot(page, f"{tag}-start")
    frames(page, tag, ids[0], "right", [0.12, 0.26, 0.38, 0.5], "done")
    wait_for(page, f"async () => (await window.ordenApp.tasks()).todos.todo({json.dumps(ids[0])})?.done === true", "the todo done")
    frames(page, tag, ids[1], "left", [0.12, 0.26, 0.38, 0.55], "delete")
    wait_for(page, f"async () => (await window.ordenApp.tasks()).todos.todo({json.dumps(ids[1])}) == null", "the todo deleted")
    page.wait_for_timeout(400)
    DRIVE.shot(page, f"{tag}-deleted")
    frames(page, tag, ids[2], "left", [0.1, 0.2], "back")
    page.wait_for_timeout(500)
    if page.evaluate(f"async () => (await window.ordenApp.tasks()).todos.todo({json.dumps(ids[2])}) == null"):
        wrong(f"[{tag}] a short swipe deleted the todo")
    context.close()
def drive(browser: Browser) -> None:
    only = [one for one in sys.argv[1:] if not one.startswith("--")] or ["iphone", "android"]
    for name in only:
        for dark in (False, True):
            phone(browser, name, dark)
raise SystemExit(DRIVE.run(drive, "a todo swiped right is done and swiped left is deleted on a phone"))
