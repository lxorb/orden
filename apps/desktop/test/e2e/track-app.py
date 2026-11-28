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
PULL = """() => {
  const node = document.querySelector('[data-track-pane]')
  const at = (y) => new Touch({ identifier: 2, target: node, clientX: 180, clientY: y })
  node.dispatchEvent(new TouchEvent('touchstart', { touches: [at(120)], changedTouches: [at(120)], bubbles: true }))
  node.dispatchEvent(new TouchEvent('touchmove', { touches: [at(320)], changedTouches: [at(320)], bubbles: true }))
  node.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [at(320)], bubbles: true }))
}"""
PHONE = """
window.ordenPhone = { states: [], asked: '[]', link: '' }
window.__ORDEN_SYSTEM__ = {
  askForTheFrame() { setTimeout(() => window.__ordenFrame && window.__ordenFrame('word'), 0) },
  trackState(said, json) { if (said === 'word') window.ordenPhone.states.push(JSON.parse(json)) },
  trackTaken(said) { const held = window.ordenPhone.asked; window.ordenPhone.asked = '[]'; return said === 'word' ? held : '[]' },
  handed(said) { const link = window.ordenPhone.link; window.ordenPhone.link = ''; return JSON.stringify({ command: '', open: '', tick: '', link }) },
}
"""
LAST = "window.ordenPhone.states[window.ordenPhone.states.length - 1]"
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
def checked(page: Any, where: str) -> None:
    small = page.evaluate(SMALL)
    if small:
        wrong(f"{where}: under 48 by 48: {small}")
    nameless = page.evaluate(NAMELESS)
    if nameless:
        wrong(f"{where}: no name for TalkBack: {nameless}")
    wide = page.evaluate("() => [document.documentElement.scrollWidth, innerWidth]")
    if wide[0] > wide[1]:
        wrong(f"{where}: wider than the screen: {wide}")
def started(page: Any, name: str) -> None:
    page.locator(f'[data-track-tile="{name}"]').tap()
    wait_for(page, f"{TIME}.running[0] && {TIME}.activity({TIME}.running[0].activity)?.name === {name!r}", f"{name} running")
def above_keys(page: Any, field: str, keys: int, where: str) -> None:
    page.set_viewport_size({"width": 320, "height": 640})
    page.wait_for_timeout(300)
    page.evaluate(f"document.documentElement.style.setProperty('--keyboard', '{keys}px')")
    page.evaluate("document.activeElement?.blur()")
    page.locator(field).focus()
    page.wait_for_timeout(100)
    box = page.locator(field).bounding_box()
    if not box or box["y"] < 0 or box["y"] + box["height"] > 640 - keys:
        wrong(f"{where}: the field is not in sight above a keyboard {keys} high: {box}")
    checked(page, f"{where}, small phone with the keyboard up")
    page.evaluate("document.documentElement.style.removeProperty('--keyboard')")
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(300)
def signed_in(page: Any) -> None:
    wait_for(page, "window.ordenApp && document.querySelector('[data-sign-in] input[type=email]')", "the first screen")
    page.locator("[data-sign-in] input[type=email]").fill(USER["email"])
    page.keyboard.press("Enter")
    page.locator("[data-sign-in] .digits input").wait_for(state="visible")
    checked(page, "code screen")
    above_keys(page, "[data-sign-in] .digits input", 197, "code screen")
    page.locator("[data-sign-in] .digits input").focus()
    page.keyboard.insert_text("246810")
    wait_for(page, "document.querySelector('[data-track=now]')", "Now after signing in")
    page.evaluate("async () => { window.ordenTime = await window.ordenApp.time() }")
    wait_for(page, f"{TIME}.ready", "the time store")
    wait_for(page, "window.ordenApp.account.syncable", "the account settled, with no notes of this phone to wait for")
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
    checked(page, "first screen")
    DRIVE.shot(page, "1-first")
    above_keys(page, "[data-sign-in] input[type=email]", 235, "first screen")
    signed_in(page)
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
    page.locator("[data-undo-run]").tap()
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
    page.locator("[data-tab=settings]").tap()
    page.locator("[data-track-activities]").tap()
    page.locator('[data-activity] button[aria-label="More"]').first.tap()
    page.locator("[data-sheet-menu]").wait_for(state="visible")
    DRIVE.shot(page, "8b-menu")
    page.locator("[data-sheet-menu] button", has_text="Daily goal").tap()
    page.locator("[data-sheet-prompt=text] input").wait_for(state="visible")
    page.locator("[data-sheet-prompt=text] input").fill("1:30")
    DRIVE.shot(page, "8c-prompt")
    page.locator("[data-sheet-confirm]").tap()
    wait_for(page, f"{TIME}.goals.length === 1 && {TIME}.goals[0].ms === 5400000", "a daily goal set from the activity's menu")
    wait_for(page, "!document.querySelector('[data-sheet-prompt]')", "the prompt closed")
    page.go_back()
    wait_for(page, "!document.querySelector('[data-activity]')", "Back closing the activities")
    page.go_back()
    wait_for(page, "!document.querySelector('[data-track-settings]')", "Back closing Settings again")
    page.set_viewport_size({"width": 844, "height": 390})
    wait_for(page, "document.querySelectorAll('[data-track-pane]').length === 2", "Now and Day side by side when wide")
    checked(page, "landscape")
    DRIVE.shot(page, "9-wide")
    if page.evaluate(f"{TIME}.activity({TIME}.running[0]?.activity)?.name") != "Walk":
        wrong("turning the phone lost the running timer")
    context.close()
    phone = DRIVE.context(
        browser,
        viewport={"width": 360, "height": 800},
        user_agent=PHONE_AGENT,
        has_touch=True,
        is_mobile=True,
        reduced_motion="reduce",
    )
    phone.add_init_script(PHONE)
    phone.route("https://orden.so/**", server.answer)
    page = phone.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.goto(f"{DRIVE.origin}/", wait_until="domcontentloaded")
    signed_in(page)
    wait_for(page, f"{TIME}.activities.some((one) => one.name === 'Walk')", "the second phone taking what the first one made")
    wait_for(page, f"{LAST}?.running?.name === 'Walk' && /^#[0-9a-f]{{6}}$/.test({LAST}.running.color)", "the phone told what runs, with its colour")
    told = page.evaluate(LAST)
    if [one["name"] for one in told["activities"]][:1] != ["Walk"] or told["last"] != told["running"]["id"]:
        wrong(f"the phone was told {told}")
    reading = page.evaluate(f"{TIME}.activities.find((one) => one.name === 'Reading').id")
    pressed = page.evaluate("Date.now() - 90000")
    page.evaluate(
        "([id, at]) => { window.ordenPhone.asked = JSON.stringify([{ do: 'start', id, at }]); window.__ordenTrack() }",
        [reading, pressed],
    )
    wait_for(page, f"{TIME}.activity({TIME}.running[0]?.activity)?.name === 'Reading'", "a start pressed on the widget")
    if page.evaluate(f"{TIME}.running[0].start") != pressed:
        wrong("a start pressed on the phone began when the page heard of it, not when it was pressed")
    wait_for(page, f"{LAST}?.running?.name === 'Reading'", "the phone told of the switch")
    page.evaluate("() => { window.ordenPhone.asked = JSON.stringify([{ do: 'stop', at: Date.now() }]); window.__ordenTrack() }")
    wait_for(page, f"{TIME}.running.length === 0 && {LAST}?.running === null", "Stop pressed on the notification")
    page.evaluate("() => { window.ordenPhone.link = 'orden-track://stats'; window.__ordenHanded() }")
    wait_for(page, "document.querySelector('[data-track=stats]')", "a link opening Stats")
    page.evaluate("() => { window.ordenPhone.link = 'orden://stats'; window.__ordenHanded() }")
    page.locator("[data-tab=now]").tap()
    wait_for(page, "document.querySelector('[data-track=now]')", "Now")
    before = len([one for one in server.asked if one == "GET /v2/time"])
    page.evaluate(PULL)
    wait_for(page, "!document.querySelector('[data-track-pane][data-refreshing]')", "the pull to finish")
    if len([one for one in server.asked if one == "GET /v2/time"]) <= before:
        wrong("pulling Now down asked the server for nothing")
    checked(page, "Now at 360")
    phone.close()
raise SystemExit(
    DRIVE.run(
        drive,
        "Orden Track signs in, starts, switches and stops a timer, edits, selects and undoes blocks, swipes days,"
        " shows stats, works offline and lays out wide, on a phone with no part of the workspace",
    )
)
