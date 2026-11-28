import json
import sys
import time
import harness
import phone_kit
from phone_kit import adb

EMAIL = "wren@example.com"
ROWS = 1000
TIME = "window.ordenTime"
FIRST = "[data-sign-in]"
MAIL = f"{FIRST} input[type=email]"
DIGIT = f"{FIRST} .digits input"
NAME = "[data-track-sheet] input"
HOLD = "(async () => { window.ordenTime = await window.ordenApp.time(); return true })()"
KEPT = (
    "(async () => { const held = await window.ordenApp.time();"
    " const running = held.running[0] ? held.activity(held.running[0].activity)?.name ?? null : null;"
    " return JSON.stringify([document.querySelector('[data-track]')?.dataset.track ?? null, running]) })()"
)
LONG = f"""(() => {{
  const reading = {TIME}.activities.find((one) => one.name === 'Reading').id
  const walk = {TIME}.activities.find((one) => one.name === 'Walk').id
  const day = new Date()
  day.setHours(0, 0, 0, 0)
  const from = day.getTime() - 24 * 3600000
  for (let at = 0; at < {ROWS}; at++) {{
    const start = from + at * 60000
    {TIME}.addSpan({{ start, end: start + 60000, activity: at % 2 ? walk : reading, source: 'manual' }})
  }}
  const now = Date.now()
  const base = Math.max(day.getTime(), now - 2 * 3600000)
  const half = base + Math.floor((now - 60000 - base) / 2)
  {TIME}.addSpan({{ start: base, end: half, activity: reading, source: 'manual' }})
  {TIME}.addSpan({{ start: half, end: now - 60000, activity: walk, source: 'manual' }})
  return {TIME}.spans.length
}})()"""
KNOWN: dict[str, str] = {}
PHONE = phone_kit.Phone(__file__, "track", known=KNOWN, ready="!!window.ordenApp && !!window.ordenApp.time")
say, wrong = PHONE.say, PHONE.wrong
SEEDED: dict[str, str] = {}
def typed(words: str, into: str, what: str) -> None:
    page = PHONE.page
    page.evaluate("document.activeElement?.blur()")
    phone_kit.keys_gone(8)
    page.press(into)
    if phone_kit.keys_come(15) is None:
        raise SystemExit(f"{what}: the keyboard never came up")
    adb("shell", "input", "text", words)
    page.wait_for(f"document.querySelector({json.dumps(into)})?.value === {json.dumps(words)}", what, 30)
def opens_and_closes() -> None:
    page = PHONE.page
    page.press("[data-tab=day]")
    page.wait_for("!!document.querySelector('[data-track=day]')", "Day")
    page.press("[data-time-block] .body")
    page.wait_for("!!document.querySelector('[data-track-sheet] [data-time-editor]')", "the block editor")
    page.evaluate("document.activeElement?.blur()")
    phone_kit.keys_gone(8)
    for _ in range(3):
        PHONE.back()
        try:
            page.wait_for("!document.querySelector('[data-track-sheet]')", "Back closing the block editor", 6)
            return
        except SystemExit:
            continue
    raise SystemExit("three presses of Back did not close the block editor")
def kept() -> str:
    return str(PHONE.page.evaluate(KEPT))
def running(name: str | None, what: str) -> None:
    held = "null" if name is None else json.dumps(name)
    PHONE.page.wait_for(
        f"({TIME}.running[0] ? {TIME}.activity({TIME}.running[0].activity)?.name ?? null : null) === {held}", what
    )
def asks_code(worker: harness.Worker) -> str:
    page = PHONE.page
    already = len(worker.written())
    typed(EMAIL, MAIL, "the email address typed on the first screen")
    PHONE.above_keys("2-email", MAIL, [])
    adb("shell", "input", "keyevent", "66")
    code = worker.waits_for_mail(EMAIL, r"(\d{6}) is your Orden code", "the sign-in code", already).group(1)
    page.wait_for(f"!!document.querySelector({json.dumps(DIGIT)})", "the code boxes")
    time.sleep(1)
    PHONE.look("code")
    page.evaluate("document.activeElement?.blur()")
    phone_kit.keys_gone(8)
    page.press(DIGIT)
    if phone_kit.keys_come(15) is None:
        raise SystemExit("the keyboard never came up over the code boxes")
    PHONE.above_keys("3-code", DIGIT, [])
    return code
def signs_in(worker: harness.Worker) -> None:
    page = PHONE.page
    page.wait_for(f"!!window.ordenApp && !!document.querySelector({json.dumps(MAIL)})", "the first screen", 120)
    say(f"the web view: {page.evaluate('navigator.userAgent')}")
    time.sleep(2)
    PHONE.shot("1-first")
    if page.evaluate(f"document.querySelector({json.dumps(FIRST)}).getAttribute('aria-label')") != "Orden Track":
        wrong("the first screen does not say which app it is")
    carried = page.evaluate("['workspace', 'terminals', 'chats', 'search'].filter((one) => one in window.ordenApp)")
    if carried:
        wrong(f"this is not the Orden Track build: it carries {carried}")
    PHONE.look("first screen")
    code = asks_code(worker)
    adb("shell", "input", "text", code)
    page.wait_for("!!document.querySelector('[data-track=now]')", "Now after six digits typed at once", 90)
    page.evaluate(HOLD)
    page.wait_for(f"{TIME}.ready", "the time store")
    page.wait_for("window.ordenApp.account.syncable", "the account settled")
def adds(name: str) -> None:
    page = PHONE.page
    page.press("[data-track-add]")
    page.wait_for(f"!!document.querySelector({json.dumps(NAME)})", "the sheet that names a new activity")
    time.sleep(1)
    typed(name, NAME, f"{name} typed as a new activity")
    PHONE.above_keys(f"sheet-{name.lower()}", NAME, ["[data-track-sheet]"])
    adb("shell", "input", "keyevent", "66")
    running(name, f"{name} running")
    PHONE.keys_down(f"after naming {name}")
def times() -> None:
    page = PHONE.page
    adds("Reading")
    adds("Walk")
    if page.evaluate(f"{TIME}.running.length") != 1:
        wrong("switching left two timers running")
    page.press('[data-track-tile="Reading"]')
    running("Reading", "a touch on a tile switching the timer")
    time.sleep(1)
    PHONE.shot("4-now")
    PHONE.look("now")
    shown()
    page.press('[data-track-tile="Reading"]')
    running("Reading", "a timer running again")
    page.press("[data-track-stop]")
    running(None, "stopped on the page")
    time.sleep(3)
    if phone_kit.notified(PHONE.package, "Reading"):
        wrong("the timer stopped on the page and its notification stayed")
def shown() -> None:
    until = time.monotonic() + 30
    while time.monotonic() < until and not phone_kit.notified(PHONE.package, "Reading"):
        time.sleep(1)
    if not phone_kit.notified(PHONE.package, "Reading"):
        wrong("a running timer shows no notification with the activity's name")
        return
    if not phone_kit.notified(PHONE.package, "Reading", "Stop"):
        wrong("the running timer's notification offers no Stop")
        return
    if phone_kit.shade_press("Stop", PHONE.shots):
        say("Stop pressed in the notification shade")
    elif phone_kit.broadcast(PHONE.package, "TrackReceiver", "so.orden.Orden.track.STOP"):
        say("the shade could not be read, so Stop was sent as the notification's own broadcast")
    else:
        wrong("Stop could neither be pressed in the shade nor sent as its broadcast")
        return
    try:
        running(None, "Stop in the notification stopping the timer on the page")
    except SystemExit as gave:
        wrong(str(gave))
        return
    time.sleep(2)
    if phone_kit.notified(PHONE.package, "Reading"):
        wrong("Stop in the notification left the notification up")
def screens() -> None:
    page = PHONE.page
    say(f"the day before holds {page.evaluate(LONG)} spans")
    page.press("[data-track-today]")
    page.wait_for("!!document.querySelector('[data-track=day] [data-time-block]')", "Day with today's blocks")
    time.sleep(1)
    PHONE.shot("5-day")
    PHONE.look("day")
    page.press("[data-time-block] .body")
    page.wait_for("!!document.querySelector('[data-track-sheet] [data-time-editor]')", "the block editor")
    time.sleep(1)
    PHONE.shot("6-editor")
    PHONE.look("block editor")
    PHONE.keys_down("over the block editor")
    PHONE.back()
    page.wait_for("!document.querySelector('[data-track-sheet]')", "Back closing the block editor")
    if page.evaluate("document.querySelector('[data-track]').dataset.track") != "day":
        wrong("Back from a sheet left the Day screen")
    page.press("[data-tab=stats]")
    page.wait_for("!!document.querySelector('[data-track-total]')", "Stats")
    time.sleep(1)
    PHONE.shot("7-stats")
    PHONE.look("stats")
    page.press("[data-tab=settings]")
    page.wait_for("!!document.querySelector('[data-track-settings]')", "Settings")
    time.sleep(1)
    PHONE.shot("8-settings")
    PHONE.look("settings")
    PHONE.back()
    page.wait_for("!document.querySelector('[data-track-settings]')", "Back closing Settings")
def both_lights() -> None:
    page = PHONE.page
    PHONE.night(True)
    try:
        page.press("[data-tab=now]")
        page.wait_for("!!document.querySelector('[data-track=now]')", "Now")
        time.sleep(1)
        if not PHONE.look("now")["dark"]:
            wrong("the page does not hear that the phone went dark")
        PHONE.shot("9-dark-now")
        page.press("[data-tab=day]")
        page.wait_for("!!document.querySelector('[data-track=day]')", "Day")
        time.sleep(1)
        PHONE.look("day")
        PHONE.shot("10-dark-day")
    finally:
        PHONE.night(False)
def long_day() -> None:
    page = PHONE.page
    page.press("[data-tab=day]")
    page.wait_for("!!document.querySelector('[data-track=day]')", "Day")
    page.press("[data-track-before]")
    page.wait_for("document.querySelectorAll('[data-time-block]').length > 20", "the day before, full of blocks", 60)
    time.sleep(2)
    PHONE.shot("11-long-day")
    PHONE.flung("a day of a thousand blocks")
def reaches(worker: harness.Worker) -> None:
    until = time.monotonic() + 90
    names: list[str] = []
    while time.monotonic() < until and "Walk" not in names:
        time.sleep(3)
        said = harness.request("/v2/time?since=0", SEEDED["token"])
        names = [one["value"].get("name", "") for one in said.get("entries", []) if one.get("kind") == "activity"]
    say(f"the server's activities: {sorted(set(names))}")
    if "Walk" not in names or "Reading" not in names:
        wrong("the activities made on the phone never reached the server")
def now() -> None:
    page = PHONE.page
    page.wait_for("!!window.ordenApp && !!document.querySelector('[data-track]')", "the app", 120)
    page.evaluate(HOLD)
    page.wait_for(f"{TIME}.ready", "the time store")
    page.press("[data-tab=now]")
    page.wait_for("!!document.querySelector('[data-track=now]')", "Now")
    time.sleep(1)
def seed(worker: harness.Worker) -> None:
    SEEDED["token"] = worker.account(EMAIL)
def steps(worker: harness.Worker) -> None:
    signs_in(worker)
    times()
    reaches(worker)
    screens()
    both_lights()
    PHONE.page.press("[data-tab=now]")
    PHONE.page.wait_for("!!document.querySelector('[data-track=now]')", "Now")
    PHONE.page.press('[data-track-tile="Walk"]')
    running("Walk", "a timer running before Back")
    PHONE.steps_out(kept)
    long_day()
    PHONE.starts()
    now()
    PHONE.shaped("now", kept, now)
    if phone_kit.NIGHT:
        PHONE.page.press("[data-track-stop]")
        running(None, "stopped before the night's measures")
        PHONE.memory(opens_and_closes)
        PHONE.background(PHONE.asked)
    PHONE.released()
def main() -> int:
    return PHONE.run(
        steps,
        seed,
        "Orden Track on a phone: signed in, a timer started, switched and stopped, every screen held to the gates",
    )
if __name__ == "__main__":
    sys.exit(main())
