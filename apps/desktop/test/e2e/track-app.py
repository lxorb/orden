import json
import os
from typing import Any

os.environ["ORDEN_APP"] = "track"
os.environ["TAURI_ENV_PLATFORM"] = "android"
import harness  # noqa: E402
from harness import Drive  # noqa: E402
from playwright.sync_api import Browser  # noqa: E402

FOLDER = harness.APP / "dist-track"
harness.build(FOLDER)
DRIVE = Drive(__file__, folder=FOLDER)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
USER = {"id": "u1", "email": "wren@example.com", "name": "Wren", "syncVersion": 2}
TIME = "window.ordenTime"
SMALL = """() => [...document.querySelectorAll('button, a[href], input, [role=tab], [role=switch], [role=radio]')]
  .filter((one) => one.offsetParent !== null && !one.closest('[aria-hidden=true]') && one.tabIndex !== -1)
  .map((one) => [one.getAttribute('aria-label') || one.textContent.trim().slice(0, 24) || one.tagName,
    Math.round(one.getBoundingClientRect().width), Math.round(one.getBoundingClientRect().height)])
  .filter(([, wide, tall]) => wide < 48 || tall < 48)"""
NAMELESS = """() => [...document.querySelectorAll('button, [role=tab], [role=switch], [role=radio], input')]
  .filter((one) => one.offsetParent !== null && !one.closest('[aria-hidden=true]'))
  .filter((one) => !(one.getAttribute('aria-label') || one.textContent.trim() || one.getAttribute('placeholder')))
  .map((one) => one.outerHTML.slice(0, 80))"""
SWIPE = """([from, to]) => {
  const node = document.querySelector('[data-track-day]')
  const at = (x, y) => new Touch({ identifier: 1, target: node, clientX: x, clientY: y })
  node.dispatchEvent(new TouchEvent('touchstart', { touches: [at(from, 400)], changedTouches: [at(from, 400)], bubbles: true }))
  node.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [at(to, 406)], bubbles: true }))
}"""
class Server:
    def __init__(self) -> None:
        self.entries: dict[str, dict[str, Any]] = {}
        self.next = 1
        self.asked: list[str] = []
    def answer(self, route: Any) -> None:
        request = route.request
        path = request.url.split("orden.so", 1)[1]
        self.asked.append(f"{request.method} {path.split('?')[0]}")
        body = json.loads(request.post_data or "{}") if request.method == "POST" else {}
        if request.method == "OPTIONS":
            self.reply(route, {}, 204)
        elif path == "/v1/auth/code":
            self.reply(route, {"ok": True, "resendIn": 30})
        elif path == "/v1/auth/verify":
            right = body.get("code") == "246810" and body.get("email") == USER["email"]
            self.reply(route, {"token": "drive", "user": USER} if right else {"error": "that code is not right"}, 200 if right else 400)
        elif path == "/v1/me":
            self.reply(route, {"user": USER})
        elif path == "/v1/spaces":
            self.reply(route, {"spaces": [], "deleted": []})
        elif path.startswith("/v2/time") and request.method == "POST":
            for change in body.get("changes", []):
                self.entries[f"{change['kind']}:{change['id']}"] = {**change, "seq": self.next, "at": self.next}
                self.next += 1
            self.reply(route, {"cursor": self.next - 1})
        elif path.startswith("/v2/time"):
            since = int(path.split("since=")[1]) if "since=" in path else 0
            page = sorted((one for one in self.entries.values() if one["seq"] > since), key=lambda one: one["seq"])
            self.reply(route, {"entries": page, "cursor": page[-1]["seq"] if page else since, "more": False})
        else:
            self.reply(route, {}, 404)
    def reply(self, route: Any, body: object, status: int = 200) -> None:
        route.fulfill(
            status=status,
            content_type="application/json",
            headers={
                "access-control-allow-origin": "*",
                "access-control-allow-headers": "*",
                "access-control-allow-methods": "*",
            },
            body="" if status == 204 else json.dumps(body),
        )
    def held(self, kind: str) -> list[dict[str, Any]]:
        return [one for one in self.entries.values() if one["kind"] == kind and one["value"] is not None]
def checked(page: Any, where: str, sized: bool = True) -> None:
    small = page.evaluate(SMALL)
    if small and sized:
        wrong(f"{where}: under 48 by 48: {small}")
    elif small:
        say(f"{where}: under 48 by 48, which is the sign-in module's to hold: {small}")
    nameless = page.evaluate(NAMELESS)
    if nameless:
        wrong(f"{where}: no name for TalkBack: {nameless}")
    wide = page.evaluate("() => [document.documentElement.scrollWidth, innerWidth]")
    if wide[0] > wide[1]:
        wrong(f"{where}: wider than the screen: {wide}")
def started(page: Any, name: str) -> None:
    page.locator(f'[data-track-tile="{name}"]').tap()
    wait_for(page, f"{TIME}.running[0] && {TIME}.activity({TIME}.running[0].activity)?.name === {name!r}", f"{name} running")
def drive(browser: Browser) -> None:
    server = Server()
    context = DRIVE.context(
        browser,
        viewport={"width": 390, "height": 844},
        user_agent=PHONE_AGENT,
        has_touch=True,
        is_mobile=True,
        reduced_motion="reduce",
    )
    context.route("https://orden.so/**", server.answer)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.on("requestfailed", lambda request: "/assets/" in request.url and wrong(f"not loaded: {request.url}"))
    page.goto(f"{DRIVE.origin}/", wait_until="domcontentloaded")
    wait_for(page, "window.ordenApp && document.querySelector('[data-sign-in] input[type=email]')", "the first screen")
    if page.locator("[data-sign-in]").get_attribute("aria-label") != "Orden Track":
        wrong("the first screen does not say which app it is")
    if page.locator("[data-sign-in] button", has_text="Use without an account").count():
        wrong("Orden Track offers to go on without an account")
    carried = page.evaluate("() => ['workspace', 'terminals', 'chats', 'search'].filter((one) => one in window.ordenApp)")
    if carried:
        wrong(f"this is not the Orden Track build: it carries {carried}")
    checked(page, "first screen", sized=False)
    DRIVE.shot(page, "1-first")
    page.locator("[data-sign-in] input[type=email]").fill(USER["email"])
    page.keyboard.press("Enter")
    page.locator('[data-sign-in] input[aria-label="Digit 1"]').wait_for(state="visible")
    page.locator('[data-sign-in] input[aria-label="Digit 1"]').focus()
    page.keyboard.type("246810")
    wait_for(page, "document.querySelector('[data-track=now]')", "Now after signing in")
    page.evaluate("async () => { window.ordenTime = await window.ordenApp.time() }")
    wait_for(page, f"{TIME}.ready", "the time store")
    wait_for(page, "window.ordenApp.account.syncable", "the account settled, with no notes of this phone to wait for")
    page.locator("[data-track-add]").tap()
    sheet = page.locator("[data-track-sheet]")
    sheet.locator("input").fill("Reading")
    page.keyboard.press("Enter")
    wait_for(page, f"{TIME}.running[0] && {TIME}.activities.some((one) => one.name === 'Reading')", "a new activity running")
    page.locator("[data-track-add]").tap()
    sheet.locator("input").fill("Walk")
    page.keyboard.press("Enter")
    wait_for(page, f"{TIME}.activity({TIME}.running[0]?.activity)?.name === 'Walk'", "switched to a second new activity")
    if page.evaluate(f"{TIME}.running.length") != 1:
        wrong("switching left two timers running")
    started(page, "Reading")
    checked(page, "Now")
    DRIVE.shot(page, "2-now")
    page.locator("[data-track-stop]").tap()
    wait_for(page, f"{TIME}.running.length === 0", "stopped")
    page.evaluate(
        f"""() => {{
          const reading = {TIME}.activities.find((one) => one.name === 'Reading').id
          const walk = {TIME}.activities.find((one) => one.name === 'Walk').id
          const day = new Date(); day.setHours(0, 0, 0, 0)
          for (const span of [...{TIME}.spans]) {TIME}.removeSpan(span.id)
          const H = 3600000
          {TIME}.addSpan({{ start: day.getTime() - 15 * H, end: day.getTime() - 14 * H, activity: walk, source: 'manual' }})
          {TIME}.addSpan({{ start: day.getTime() + 1 * H, end: day.getTime() + 2 * H, activity: reading, source: 'manual' }})
          {TIME}.addSpan({{ start: day.getTime() + 2 * H, end: day.getTime() + 2.5 * H, activity: walk, source: 'manual' }})
        }}"""
    )
    page.locator("[data-track-today]").tap()
    wait_for(page, "document.querySelector('[data-track=day]') && document.querySelectorAll('[data-time-block]').length === 2", "today's two blocks")
    checked(page, "Day")
    DRIVE.shot(page, "3-day")
    page.locator("[data-time-block] .body").first.tap()
    page.locator("[data-track-sheet] [data-time-editor]").wait_for(state="visible")
    checked(page, "block editor")
    DRIVE.shot(page, "4-editor")
    page.locator("[data-track-sheet] button", has_text="Split").tap()
    wait_for(page, "document.querySelectorAll('[data-time-block]').length === 3", "the block split in two")
    page.go_back()
    wait_for(page, "!document.querySelector('[data-track-sheet]')", "Back closing the sheet")
    if page.evaluate("document.querySelector('[data-track]').dataset.track") != "day":
        wrong("Back from a sheet left the Day screen")
    first = page.locator("[data-time-block]").first
    box = first.bounding_box() or {"x": 0, "y": 0, "width": 0, "height": 0}
    client = context.new_cdp_session(page)
    at = {"x": box["x"] + box["width"] / 2, "y": box["y"] + box["height"] / 2}
    client.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [at]})
    page.wait_for_timeout(700)
    client.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.locator("[data-time-picked]").wait_for(state="visible")
    page.locator("[data-time-block]").nth(1).locator(".body").tap()
    wait_for(page, "document.querySelector('[data-time-picked] .count')?.textContent.trim() === '2'", "two blocks selected")
    checked(page, "selection")
    DRIVE.shot(page, "5-selected")
    page.locator("[data-time-picked-delete]").tap()
    wait_for(page, "document.querySelectorAll('[data-time-block]').length === 1", "the selected blocks deleted")
    page.locator("[data-track-undo-run]").tap()
    wait_for(page, "document.querySelectorAll('[data-time-block]').length === 3", "Undo bringing them back")
    day = page.evaluate("Number(document.querySelector('[data-track-day]').dataset.trackDay)")
    page.evaluate(SWIPE, [60, 300])
    wait_for(page, f"Number(document.querySelector('[data-track-day]').dataset.trackDay) < {day}", "a swipe right showing the day before")
    wait_for(page, "document.querySelectorAll('[data-time-block]').length === 1", "yesterday's block")
    page.locator("[data-track-after]").tap()
    wait_for(page, f"Number(document.querySelector('[data-track-day]').dataset.trackDay) === {day}", "the arrow going back to today")
    page.locator("[data-tab=stats]").tap()
    wait_for(page, "Number(document.querySelector('[data-track-total]')?.dataset.trackTotal) === 5400000", "today's hour and a half in the stats")
    page.locator("[data-track-range=week]").tap()
    page.locator("[data-track-range=custom]").tap()
    page.locator("[data-track-bounds]").wait_for(state="visible")
    wait_for(page, "Number(document.querySelector('[data-track-total]')?.dataset.trackTotal) === 9000000", "the last seven days in a custom range")
    checked(page, "Stats")
    DRIVE.shot(page, "6-stats")
    page.locator('[data-track-row="Reading"]').tap()
    wait_for(page, "document.querySelector('[data-track=day]') && document.querySelector('[data-track-only]')", "Day filtered to one activity")
    page.go_back()
    wait_for(page, "!document.querySelector('[data-track-only]')", "Back dropping the filter")
    page.go_back()
    wait_for(page, "document.querySelector('[data-track=now]')", "Back reaching Now")
    context.set_offline(True)
    started(page, "Walk")
    context.set_offline(False)
    page.evaluate("() => window.dispatchEvent(new Event('online'))")
    page.wait_for_timeout(4000)
    running = [one for one in server.held("span") if one["value"].get("end") is None]
    if len(running) != 1:
        wrong(f"a timer started offline reached the server as {len(running)} running spans")
    if not any(one["value"].get("name") == "Walk" for one in server.held("activity")):
        wrong(f"the activities never reached the server: {sorted(server.entries)}")
    page.locator("[data-tab=settings]").tap()
    page.locator("[data-track-settings]").wait_for(state="visible")
    checked(page, "Settings")
    DRIVE.shot(page, "7-settings")
    page.locator("[data-track-scheme=dark]").tap()
    wait_for(page, "document.documentElement.dataset.theme === 'dark'", "the dark scheme")
    page.go_back()
    wait_for(page, "!document.querySelector('[data-track-settings]')", "Back closing Settings")
    DRIVE.shot(page, "8-dark")
    page.set_viewport_size({"width": 844, "height": 390})
    wait_for(page, "document.querySelectorAll('[data-track-pane]').length === 2", "Now and Day side by side when wide")
    checked(page, "landscape")
    DRIVE.shot(page, "9-wide")
    if page.evaluate(f"{TIME}.activity({TIME}.running[0]?.activity)?.name") != "Walk":
        wrong("turning the phone lost the running timer")
    context.close()
raise SystemExit(
    DRIVE.run(
        drive,
        "Orden Track signs in, starts, switches and stops a timer, edits, selects and undoes blocks, swipes days,"
        " shows stats, works offline and lays out wide, on a phone with no part of the workspace",
    )
)
