import json
import sys
import time
from typing import Any
import harness
import phone_kit
from phone_kit import Page, adb

EMAIL = "ada@example.com"
SPACE = "Field notes"
HERON = "A heron stands in the reeds.\n\n" + "\n\n".join(f"Reed {at} bends over the water." for at in range(1, 90))
WS = "window.ordenApp.workspace"
CARET = """(() => {
  const picked = getSelection()
  const range = picked && picked.rangeCount ? picked.getRangeAt(0) : null
  const drawn = range ? [...range.getClientRects()].at(-1) ?? range.getBoundingClientRect() : null
  const rect = drawn && drawn.height ? drawn : document.querySelector('.cm-cursor-primary, .cm-cursor')?.getBoundingClientRect()
  return rect && rect.height ? JSON.stringify([Math.round(rect.top), Math.round(rect.bottom)]) : null
})()"""
PHONE = phone_kit.Phone(__file__, "notes")
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
    page.evaluate("document.querySelector('.setup button')?.click()")
    page.wait_for("!document.querySelector('.setup')", "the first screen to leave")
    page.wait_for(f"!!{WS}.activeSpace", "a space")
    new_note(page, "a new note")
    typed(page, "kestrel%shovers", "kestrel", "the first note")
    if not page.evaluate(f"{WS}.save({WS}.active)"):
        wrong("the note written without an account was not saved")
    PHONE.shot("2-written")
def signs_in(page: Page, worker: harness.Worker) -> None:
    already = len(worker.written())
    page.evaluate("window.ordenApp.account.open = true")
    page.wait_for("!!document.querySelector('input[type=email]')", "the sign-in sheet")
    PHONE.above_keys("3-sign-in-email", "input[type=email]", [".panel button[type=submit]", ".panel[role=dialog]"])
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
    page.evaluate("window.ordenApp.prompt.dismiss()")
    page.wait_for("!document.querySelector('.sheet[role=dialog] form input')", "the prompt sheet to leave")
    PHONE.keys_down("after the prompt sheet")
    page.evaluate(f"{WS}.showPanel('search')")
    page.wait_for("!!document.querySelector('.panels:not(.right) input')", "the search panel")
    time.sleep(1)
    PHONE.above_keys("7-search", ".panels:not(.right) input", [".panels:not(.right)"])
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
def seed(worker: harness.Worker) -> None:
    token = worker.account(EMAIL)
    SEEDED["space"] = harness.request("/v1/spaces", token, {"name": SPACE})["space"]["id"]
    harness.request(f"/v1/spaces/{SEEDED['space']}/notes", token, {"path": "Heron.md", "content": HERON})
def steps(worker: harness.Worker) -> None:
    page = PHONE.page
    without_an_account(page)
    signs_in(page, worker)
    other_sheets(page)
    syncs_down(page)
    caret_stays_seen(page)
    syncs_up(page, worker, SEEDED["space"])
def main() -> int:
    return PHONE.run(
        steps, seed, "Orden Notes on a phone: written, signed in, synced both ways, every field above the keyboard"
    )
if __name__ == "__main__":
    sys.exit(main())
