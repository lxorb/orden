import json
import sys
import time
from typing import Any
import harness
import phone_kit
from phone_kit import Page, adb

EMAIL = "ada@example.com"
SPACE = "Field notes"
LONG = "Thousand"
ROWS = 1000
HERON = "A heron stands in the reeds.\n\n" + "\n\n".join(f"Reed {at} bends over the water." for at in range(1, 90))
WS = "window.ordenApp.workspace"
CARET = """(() => {
  const picked = getSelection()
  const range = picked && picked.rangeCount ? picked.getRangeAt(0) : null
  const drawn = range ? [...range.getClientRects()].at(-1) ?? range.getBoundingClientRect() : null
  const rect = drawn && drawn.height ? drawn : document.querySelector('.cm-cursor-primary, .cm-cursor')?.getBoundingClientRect()
  return rect && rect.height ? JSON.stringify([Math.round(rect.top), Math.round(rect.bottom)]) : null
})()"""
KNOWN = {"small target at note": "#2581"}
PHONE = phone_kit.Phone(__file__, "notes", known=KNOWN)
say, wrong = PHONE.say, PHONE.wrong
SEEDED: dict[str, str] = {}
def typed(page: Page, words: str, mark: str, what: str) -> None:
    size = phone_kit.screen()
    for round in range(4):
        page.evaluate("document.querySelector('.cm-content')?.focus()")
        adb("shell", "input", "tap", str(size[0] // 2), str(size[1] // 3))
        time.sleep(2)
        adb("shell", "input", "text", words)
        time.sleep(3)
        if page.evaluate(f"!!{WS}.active?.doc?.includes({json.dumps(mark)})"):
            say(f"{what}: typed on try {round + 1}")
            return
    raise SystemExit(f"gave up typing {what}")
def new_note(page: Page, what: str) -> None:
    page.evaluate(f"{WS}.showPanel('tree')")
    time.sleep(1)
    before = page.evaluate(f"{WS}.active?.id ?? null")
    page.evaluate("document.querySelector(\".panels:not(.right) button[aria-label='New note']\")?.click()")
    page.wait_for(f"{WS}.panel === null && {WS}.active?.id !== {json.dumps(before)}", what)
    time.sleep(1)
def without_an_account(page: Page) -> None:
    page.wait_for("!!window.ordenApp && !!window.ordenApp.workspace", "the app", 120)
    say(f"the web view: {page.evaluate('navigator.userAgent')}")
    time.sleep(3)
    PHONE.shot("1-first")
    PHONE.look("first screen")
    phone_kit.alone(page)
    page.wait_for(f"!!{WS}.activeSpace", "a space")
    new_note(page, "a new note")
    typed(page, "kestrel%shovers", "kestrel", "the first note")
    if not page.evaluate(f"{WS}.save({WS}.active)"):
        wrong("the note written without an account was not saved")
    PHONE.shot("2-written")
    PHONE.look("note")
def signs_in(page: Page, worker: harness.Worker) -> None:
    already = len(worker.written())
    page.evaluate("window.ordenApp.account.open = true")
    page.wait_for("!!document.querySelector('input[type=email]')", "the sign-in sheet")
    PHONE.above_keys("3-sign-in-email", "input[type=email]", [".panel button[type=submit]", ".panel[role=dialog]"])
    PHONE.look("sign in")
    page.evaluate(
        "(() => { const field = document.querySelector('input[type=email]'); field.focus();"
        f" field.value = {json.dumps(EMAIL)}; field.dispatchEvent(new Event('input', {{ bubbles: true }})) }})()"
    )
    time.sleep(1)
    page.evaluate("document.querySelector('.panel button[type=submit]')?.click()")
    code = worker.waits_for_mail(EMAIL, r"(\d{6}) is your Orden code", "the sign-in code", already).group(1)
    page.wait_for("!!document.querySelector('.digits input')", "the code boxes")
    PHONE.above_keys("4-sign-in-code", ".digits input", [".panel[role=dialog]"])
    page.evaluate(
        "(() => { const box = document.querySelector('.digits input'); box.focus();"
        f" box.value = {json.dumps(code)}; box.dispatchEvent(new Event('input', {{ bubbles: true }})) }})()"
    )
    page.wait_for("!!window.ordenApp.account.accountToken", "the session")
    for _ in range(10):
        kept = page.evaluate(
            "(() => { const keep = [...document.querySelectorAll('button')].find((one) =>"
            " one.innerText.trim() === 'Keep them'); keep?.click(); return !!keep })()"
        )
        if kept or not page.evaluate("window.ordenApp.account.settling"):
            break
        time.sleep(1)
    PHONE.shot("5-signed-in")
def other_sheets(page: Page) -> None:
    PHONE.keys_down("after signing in")
    page.evaluate("void window.ordenApp.prompt.ask({ title: 'Name this', value: 'wren' })")
    page.wait_for("!!document.querySelector('.sheet[role=dialog] form input')", "the prompt sheet")
    PHONE.above_keys("6-prompt", ".sheet[role=dialog] form input", [".sheet[role=dialog]"])
    PHONE.look("prompt")
    page.evaluate("window.ordenApp.prompt.dismiss()")
    page.wait_for("!document.querySelector('.sheet[role=dialog] form input')", "the prompt sheet to leave")
    PHONE.keys_down("after the prompt sheet")
    page.evaluate(f"{WS}.showPanel('search')")
    page.wait_for("!!document.querySelector('.panels:not(.right) input')", "the search panel")
    time.sleep(1)
    PHONE.above_keys("7-search", ".panels:not(.right) input", [".panels:not(.right)"])
    PHONE.look("search")
    PHONE.keys_down("after searching")
    page.evaluate(f"{WS}.closePanel()")
def syncs_down(page: Page) -> None:
    page.wait_for(f"{WS}.spaces.some((one) => one.name === {json.dumps(SPACE)})", "the account's space to arrive", 150)
    page.evaluate(
        f"(() => {{ const found = {WS}.spaces.find((one) => one.name === {json.dumps(SPACE)});"
        f" {WS}.showSpace(found.id) }})()"
    )
    heron = page.wait_for(
        f"(() => {{ const walk = (e) => (e ? [e.path, ...(e.children ?? []).flatMap(walk)] : []);"
        f" return walk({WS}.tree).find((p) => p.endsWith('Heron.md')) ?? null }})()",
        "the server's note to come down",
        120,
    )
    page.evaluate(f"{WS}.openEntry({json.dumps(heron)})")
    page.wait_for(f"{WS}.active?.doc?.includes('heron')", "the note that came down to open")
    time.sleep(1)
    PHONE.shot("8-synced-down")
def caret_stays_seen(page: Page) -> None:
    PHONE.keys_down("before writing in the long note")
    size = phone_kit.screen()
    adb("shell", "input", "tap", str(size[0] // 3), str(size[1] * 3 // 4))
    top = phone_kit.keys_come(15)
    if top is None:
        raise SystemExit("the keyboard never came up over the long note")
    time.sleep(2)
    said = page.where([])
    edge = top / said["ratio"]
    caret = page.evaluate(CARET)
    PHONE.shot("9-caret")
    say(f"the caret is at {caret}; the keyboard's top is at {edge:.0f}")
    if not caret:
        wrong("the caret in the long note could not be found")
    elif json.loads(caret)[1] > edge + 1:
        wrong(f"the caret ends at {json.loads(caret)[1]}, under the keyboard that starts at {edge:.0f}")
def syncs_up(page: Page, worker: harness.Worker, space: str) -> None:
    new_note(page, "a new note in the synced space")
    typed(page, "wren%ssings", "wren", "the second note")
    page.evaluate(f"{WS}.save({WS}.active)")
    arrived = lambda rows: any(one["path"] != "Heron.md" and not one["deleted"] and one["size"] > 0 for one in rows)
    until = time.monotonic() + 120
    rows: list[dict[str, Any]] = []
    while time.monotonic() < until and not arrived(rows):
        time.sleep(2)
        rows = worker.query(f"select path, size, deleted from notes where space_id = '{space}'")
    say(f"the server's notes: {[one['path'] for one in rows]}")
    if not arrived(rows):
        wrong("the note written on the phone never reached the server")
    PHONE.shot("10-synced-up")
PROMPT = ".sheet[role=dialog] form input"
def asks(page: Page) -> None:
    page.evaluate("void window.ordenApp.prompt.ask({ title: 'Name this', value: 'wren' })")
    page.wait_for(f"!!document.querySelector({json.dumps(PROMPT)})", "the prompt sheet")
    time.sleep(1)
def still_here(what: str) -> bool:
    time.sleep(2)
    if PHONE.resumed():
        return True
    wrong(f"Back {what} left the app")
    PHONE.again()
    return False
def back_order() -> None:
    page = PHONE.page
    page.evaluate(f"{WS}.showPanel('tree')")
    page.wait_for(f"{WS}.panel === 'tree'", "the notes list")
    time.sleep(1)
    PHONE.look("list")
    PHONE.back()
    if still_here("from the notes list over a note") and page.evaluate(f"{WS}.panel !== null"):
        wrong("Back did not close the notes list over a note")
    asks(PHONE.page)
    PHONE.keys_down("over the prompt sheet")
    history = (
        "JSON.stringify({ length: history.length, state: history.state, pops: window.__pops ?? null,"
        " touch: window.ordenApp.viewport?.touch ?? null, coarse: matchMedia('(pointer: coarse)').matches,"
        f" points: navigator.maxTouchPoints, sheet: !!document.querySelector({json.dumps(PROMPT)}),"
        " focus: document.activeElement?.tagName ?? null })"
    )
    PHONE.page.evaluate("window.__pops = 0; addEventListener('popstate', () => window.__pops++)")
    say(f"before Back on a sheet: {PHONE.page.evaluate(history)}")
    adb("logcat", "-G", "8M", check=False)
    PHONE.back()
    time.sleep(1)
    here = still_here("from a sheet")
    pid = adb("shell", "pidof", PHONE.package, check=False).strip() or "gone"
    say(f"after Back on a sheet: {PHONE.page.evaluate(history)}; the app is {pid}")
    if here and PHONE.page.evaluate(f"!!document.querySelector({json.dumps(PROMPT)})"):
        wrong("Back did not close the sheet")
        PHONE.page.evaluate("history.back()")
        time.sleep(1)
        say(f"after history.back() from the page: {PHONE.page.evaluate(history)}")
    PHONE.page.evaluate("window.ordenApp.prompt.dismiss()")
    asks(PHONE.page)
    PHONE.page.tap(PROMPT)
    if phone_kit.keys_come(15) is None:
        raise SystemExit("the keyboard never came up over the prompt sheet")
    PHONE.back()
    if not phone_kit.keys_gone(15):
        wrong("Back did not close the keyboard")
    there = f"!!document.querySelector({json.dumps(PROMPT)})"
    if still_here("with the keyboard up") and not PHONE.page.evaluate(there):
        wrong("Back with the keyboard up closed the sheet under it as well")
    PHONE.page.evaluate("window.ordenApp.prompt.dismiss()")
    asks(PHONE.page)
    PHONE.page.tap(PROMPT)
    if phone_kit.keys_come(15) is None:
        raise SystemExit("the keyboard never came up over the prompt sheet a second time")
    PHONE.back()
    PHONE.back()
    still_here("twice while the keyboard closes (#2574)")
    PHONE.page.evaluate("window.ordenApp.prompt.dismiss()")
    phone_kit.keys_gone(15)
    PHONE.page.evaluate(f"{WS}.closePanel()")
    PHONE.steps_out(kept)
def heron() -> None:
    page = PHONE.page
    page.wait_for(f"!!window.ordenApp && !!{WS}.activeSpace", "the app", 120)
    page.evaluate(
        f"(() => {{ const found = {WS}.spaces.find((one) => one.name === {json.dumps(SPACE)});"
        f" return {WS}.showSpace(found.id) }})()"
    )
    path = page.wait_for(
        f"(() => {{ const walk = (e) => (e ? [e.path, ...(e.children ?? []).flatMap(walk)] : []);"
        f" return walk({WS}.tree).find((p) => p.endsWith('Heron.md')) ?? null }})()",
        "the long note in the list",
        120,
    )
    page.evaluate(f"{WS}.openEntry({json.dumps(path)})")
    page.wait_for(f"{WS}.active?.doc?.includes('heron')", "the long note to open")
    time.sleep(2)
def kept() -> str:
    return str(PHONE.page.evaluate(f"JSON.stringify([{WS}.active?.id ?? null, {WS}.active?.doc?.length ?? null])"))
def both_lights() -> None:
    PHONE.night(True)
    try:
        if not PHONE.look("note")["dark"]:
            wrong("the page does not hear that the phone went dark")
        PHONE.shot("11-dark-note")
        PHONE.page.evaluate(f"{WS}.showPanel('tree')")
        time.sleep(1)
        PHONE.look("list")
        PHONE.shot("12-dark-list")
        PHONE.page.evaluate(f"{WS}.closePanel()")
    finally:
        PHONE.night(False)
def long_list() -> None:
    page = PHONE.page
    page.wait_for(f"{WS}.spaces.some((one) => one.name === {json.dumps(LONG)})", "the long space to arrive", 150)
    page.evaluate(
        f"(() => {{ const found = {WS}.spaces.find((one) => one.name === {json.dumps(LONG)});"
        f" return {WS}.showSpace(found.id) }})()"
    )
    page.wait_for(
        f"(() => {{ const walk = (e) => (e ? 1 + (e.children ?? []).reduce((sum, one) => sum + walk(one), 0) : 0);"
        f" const held = walk({WS}.tree); window.__rows = held; return held > {ROWS} }})()",
        f"{ROWS} notes to come down",
        600,
    )
    say(f"the list holds {page.evaluate('window.__rows')} rows")
    page.evaluate(f"{WS}.showPanel('tree')")
    time.sleep(2)
    PHONE.shot("13-long-list")
    PHONE.flung("the list of a thousand notes")
    page.evaluate(f"{WS}.closePanel()")
def seed(worker: harness.Worker) -> None:
    token = worker.account(EMAIL)
    SEEDED["space"] = harness.request("/v1/spaces", token, {"name": SPACE})["space"]["id"]
    harness.request(f"/v1/spaces/{SEEDED['space']}/notes", token, {"path": "Heron.md", "content": HERON})
    long = harness.request("/v1/spaces", token, {"name": LONG})["space"]["id"]
    for at in range(ROWS + 1):
        harness.request(f"/v1/spaces/{long}/notes", token, {"path": f"Reed {at:04}.md", "content": f"Reed {at}"})
def steps(worker: harness.Worker) -> None:
    page = PHONE.page
    without_an_account(page)
    signs_in(page, worker)
    other_sheets(page)
    syncs_down(page)
    caret_stays_seen(page)
    syncs_up(page, worker, SEEDED["space"])
    PHONE.keys_down("after the last note")
    back_order()
    both_lights()
    long_list()
    PHONE.starts()
    heron()
    PHONE.shaped("note", kept, heron)
    PHONE.released()
def main() -> int:
    return PHONE.run(
        steps, seed, "Orden Notes on a phone: written, signed in, synced both ways, every field above the keyboard"
    )
if __name__ == "__main__":
    sys.exit(main())
