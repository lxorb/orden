from __future__ import annotations

import os
import subprocess
import time
from typing import Any

from playwright.sync_api import Browser, Page

from harness import APP, BUILD_PATIENCE, Drive, Files, tool

FOLDER = APP / "dist-handoff"
DRIVE = Drive(__file__, folder=FOLDER)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PORT = DRIVE.server.port if DRIVE.server else 0
OLD = f"http://rebrand-old.localhost:{PORT}"
NEW = f"http://rebrand-new.localhost:{PORT}"
ELSEWHERE = f"http://rebrand-elsewhere.localhost:{PORT}"

ROW = '.nib-setting:has-text("Notes from nibeditor.com")'

UNANSWERED = (
    "try { if (!sessionStorage.getItem('drive-unanswered')) {"
    " sessionStorage.setItem('drive-unanswered', '1');"
    " localStorage.removeItem('nib:first-visit') } } catch {}"
)

SESSION = "handed-over-token"

ORIGINS = FOLDER / ".handoff-origins"

def built() -> None:
    said = ORIGINS.read_text(encoding="utf-8") if ORIGINS.exists() else ""
    if os.environ.get("NIB_SKIP_BUILD") and (FOLDER / "index.html").exists() and said == f"{OLD} {NEW}":
        say(f"reusing the build in {FOLDER.name}")
        return
    say(f"building the web app into {FOLDER.name} for {OLD} and {NEW}")
    environment = {**os.environ, "VITE_NIB_WEB": NEW, "VITE_NIB_LEGACY_WEB": OLD}
    environment.pop("NODE_ENV", None)
    environment.pop("VITE_NIB_API", None)
    done = subprocess.run(
        [*tool(APP, "vite"), "build", "--mode", "drive", "--outDir", str(FOLDER), "--emptyOutDir"],
        cwd=APP,
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=BUILD_PATIENCE,
        check=False,
    )
    if done.returncode != 0:
        raise SystemExit(f"the build failed:\n{done.stdout}\n{done.stderr}")
    ORIGINS.write_text(f"{OLD} {NEW}", encoding="utf-8")

@DRIVE.answers
def handoff_page(request: Files) -> bool:
    if request.path.split("?", 1)[0] != "/handoff":
        return False
    return request.reply((FOLDER / "handoff.html").read_bytes())

def context(browser: Browser) -> Any:
    made = browser.new_context(
        viewport={"width": 1100, "height": 760}, first_look=True, service_workers="block"
    )
    made.add_init_script(UNANSWERED)
    made.route("https://orden.so/**", lambda route: route.abort())
    made.route("https://nibeditor.com/**", lambda route: route.abort())
    return made

def opened(made: Any, origin: str) -> Page:
    page = made.new_page()
    page.on("pageerror", lambda error: wrong(f"page error at {origin}: {error}"))
    DRIVE.open(page, origin=origin)
    return page

def import_pane(page: Page) -> None:
    page.evaluate("window.nibApp.settings.show('import')")
    wait_for(page, "!!document.querySelector('[role=dialog]')", "Settings > Import")

def files(page: Page) -> list[str]:
    return page.evaluate(  # type: ignore[no-any-return]
        "async () => { await window.nibApp.workspace.loadTree(); return window.nibApp.workspace.notes.map((one) => one.name) }"
    )

def brought(browser: Browser) -> None:
    made = context(browser)

    say("the old address: a first visit, a note written, a session kept")
    old = opened(made, OLD)
    import_pane(old)
    if old.locator(ROW).count():
        wrong("the old address offers to bring notes from itself")
    old.keyboard.press("Escape")
    DRIVE.seed(old, "# Carried over\n\nWritten at the old address.\n")
    old.evaluate("(session) => localStorage.setItem('nib:session', session)", SESSION)
    old.evaluate("() => localStorage.setItem('nib:font-size', '19')")
    before = files(old)
    if not any(name.startswith("Carried over") for name in before):
        wrong(f"the note was never written at the old address: {before}")
    old.close()

    say("the new address: the row, pressed")
    new = opened(made, NEW)
    import_pane(new)
    row = new.locator(ROW)
    try:
        row.first.wait_for(timeout=10_000)
    except Exception:  # noqa: BLE001 - a timeout is the answer "it is not there"
        wrong("the new address does not offer the old address's notes")
        shot(new, "01-no-row")
        return
    shot(new, "01-row")

    new.evaluate("() => { window.driveBefore = true }")
    with new.expect_popup() as asked:
        row.locator("button").click()
    popup = asked.value
    if not popup.url.startswith(f"{OLD}/handoff"):
        wrong(f"the popup went to {popup.url}")

    wait_for(new, "localStorage.getItem('nib:font-size') === '19' && !window.driveBefore", "the page to start again")
    DRIVE.ready(new)

    after = files(new)
    if not any(name.startswith("Carried over") for name in after):
        wrong(f"the note did not come over: {after}")
    session = new.evaluate("() => localStorage.getItem('nib:session')")
    if session != SESSION:
        wrong(f"the session did not come over: {session}")
    if new.evaluate("() => localStorage.getItem('nib:font-size')") != "19":
        wrong("the settings did not come over")
    if new.evaluate("() => localStorage.getItem('nib:first-visit')") != "answered":
        wrong("the first visit is not over after the handoff")
    import_pane(new)
    if new.locator(ROW).count():
        wrong("the row is offered again over the notes it brought")
    shot(new, "02-brought")
    made.close()

def nothing(browser: Browser) -> None:
    say("a browser that never used the old address")
    made = context(browser)
    new = opened(made, NEW)
    import_pane(new)
    with new.expect_popup():
        new.locator(ROW).locator("button").click()
    said = new.locator(ROW).locator(".value")
    said.wait_for(timeout=30_000)
    if said.text_content() != "Nothing there":
        wrong(f"the row said {said.text_content()!r} for an old address that held nothing")
    if any(name.startswith("Carried over") for name in files(new)):
        wrong("notes came from an old address that held none")
    shot(new, "03-nothing")
    made.close()

def elsewhere(browser: Browser) -> None:
    say("a page on another origin opens /handoff")
    made = context(browser)

    old = opened(made, OLD)
    old.evaluate("(session) => localStorage.setItem('nib:session', session)", SESSION)
    old.close()

    page = made.new_page()
    page.goto(f"{ELSEWHERE}/seed.html")
    page.evaluate(
        """(old) => {
          window.heard = []
          addEventListener('message', (event) => window.heard.push(event.origin))
          const button = document.createElement('button')
          button.textContent = 'open'
          button.onclick = () => window.open(`${old}/handoff`, 'x', 'popup')
          document.body.append(button)
        }""",
        OLD,
    )
    with page.expect_popup() as asked:
        page.click("button")
    asked.value.wait_for_event("close", timeout=15_000)
    time.sleep(1)
    heard = page.evaluate("() => window.heard")
    if heard:
        wrong(f"a page on another origin was handed the old address's storage: {heard}")
    made.close()

def drive(browser: Browser) -> None:
    brought(browser)
    nothing(browser)
    elsewhere(browser)

if __name__ == "__main__":
    built()
    raise SystemExit(DRIVE.run(drive, passed="the notes come over, and only to the new address"))
