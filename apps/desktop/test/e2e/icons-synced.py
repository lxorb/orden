import json
import time
from playwright.sync_api import Browser, Page
import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say, wrong = DRIVE.say, DRIVE.wrong
ORIGIN = harness.worker_origin()
OWNER = "icons@example.com"
PATIENCE = 60
PICTURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
WORN = """
(folder) => {
  const ws = window.ordenApp.workspace
  const space = ws.spaces.find((one) => one.name === 'Home')
  return { space: ws.iconFor(space.id), folder: ws.folderIcons.iconOf(`${space.root}/${folder}`) }
}
"""
def wait(page: Page, script: str, what: str, arg: object = None) -> object:
    until = time.monotonic() + PATIENCE
    while time.monotonic() < until:
        answer = page.evaluate(script, arg)
        if answer:
            return answer
        page.wait_for_timeout(250)
    raise SystemExit(f"gave up waiting for {what}")
def device(browser: Browser, label: str, token: str) -> Page:
    context = browser.new_context(viewport={"width": 1280, "height": 820})
    context.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(token)})")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    opened(page, label)
    return page
def opened(page: Page, label: str) -> None:
    wait(page, "() => window.ordenApp?.workspace?.spaces?.some((s) => s.name === 'Home')", f"[{label}] Home")
    page.evaluate(
        "async () => { const ws = window.ordenApp.workspace; const s = ws.spaces.find((o) => o.name === 'Home');"
        " if (ws.activeSpace?.id !== s.id) await ws.showSpace(s.id); await ws.loadTree() }"
    )
def on_account(worker: harness.Worker, space: str) -> dict:
    try:
        row = worker.query(f"select icon, icons from spaces where id = '{space}'")[0]
        return {"space": row["icon"], "folder": json.loads(row["icons"] or "{}").get("Work")}
    except (SystemExit, Exception):  # noqa: BLE001 - a busy database is asked again
        return {}
def worn(page: Page) -> dict:
    return page.evaluate(WORN, "Work")
def drive(browser: Browser, worker: harness.Worker, token: str, space: str) -> None:
    desk = device(browser, "desk", token)
    desk.evaluate(
        """(picture) => {
          const ws = window.ordenApp.workspace
          const space = ws.spaces.find((one) => one.name === 'Home')
          ws.setIcon(space.id, picture)
          ws.setFolderIcon(`${space.root}/Work`, picture)
        }""",
        PICTURE,
    )
    want = {"space": PICTURE, "folder": PICTURE}
    until = time.monotonic() + PATIENCE
    while on_account(worker, space) != want and time.monotonic() < until:
        desk.wait_for_timeout(500)
        if worn(desk) != want:
            break
    if worn(desk) != want:
        wrong(f"[desk] the chosen picture did not stay chosen: {worn(desk)}")
    elif on_account(worker, space) != want:
        wrong(f"[desk] the chosen picture did not reach the account: {on_account(worker, space)}")
    else:
        say("ok   [desk] the space and the folder keep the picture chosen, and the account holds it")
    desk.wait_for_timeout(3000)
    if worn(desk) != want:
        wrong(f"[desk] after the account answered, the picture was taken back: {worn(desk)}")
    desk.reload(wait_until="domcontentloaded")
    opened(desk, "desk")
    desk.wait_for_timeout(3000)
    if worn(desk) != want:
        wrong(f"[desk] after a reload: {worn(desk)}")
    else:
        say("ok   [desk] and still wears it after a reload")
    other = device(browser, "other", token)
    try:
        wait(other, f"() => {{ const w = ({WORN})('Work'); return w.space === {json.dumps(PICTURE)} && w.folder === {json.dumps(PICTURE)} }}", "[other] the picture")
        say("ok   [other] another device wears the same picture on the space and the folder")
    except SystemExit as gave_up:
        wrong(f"[other] {gave_up}: {worn(other)}")
def main() -> int:
    worker = harness.Worker(DRIVE)
    with DRIVE.session() as browser:
        worker.start()
        token = worker.account(OWNER)
        space = worker.request("/v1/spaces", token=token, body={"name": "Home"})["space"]["id"]
        worker.request(f"/v1/spaces/{space}/notes", token=token, body={"path": "Work/Plan.md", "content": "# Plan\n"})
        drive(browser, worker, token, space)
    return DRIVE.verdict("a picture chosen as an icon stays chosen through the account, a reload and another device")
raise SystemExit(main())
