"""The web app's two builds, and the row in Settings that moves between them (#424).

Both builds put together the way the deploy does (scripts/web-channels.sh) and handed out
by the real Worker, which picks one by a cookie that `?channel=` sets. On the release:
no mark, and Settings says Stable. Unstable chosen there: the page comes back as the
edge, says so with the mark in the bar at the top, and Settings says Unstable. The
mark opens Settings, Stable chosen there brings the release back, and the mark goes.

    python apps/desktop/test/e2e/web-channel.py
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from playwright.sync_api import Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot
ORIGIN = harness.worker_origin()
PATIENCE = 60
ROOT = harness.APP.parent.parent

MARK = "header .channel"
ROW = ".sheet .nib-segmented[aria-label='Web version']"


def wait(page: Page, script: str, what: str) -> object:
    until = time.monotonic() + PATIENCE
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(250)
    raise SystemExit(f"gave up waiting for {what}")


def both_builds(worker: harness.Worker) -> Path:
    """The release and the edge in one folder, as the deploy leaves them."""
    worker.prepare()
    edge = Path(tempfile.mkdtemp(prefix="nib-web-edge-")) / "dist"
    DRIVE.later(lambda: shutil.rmtree(edge.parent, ignore_errors=True))
    said = os.environ.get("VITE_ORDEN_CHANNEL")
    os.environ["VITE_ORDEN_CHANNEL"] = "unstable"
    try:
        harness.build(edge, served_by_worker=True)
    finally:
        if said is None:
            os.environ.pop("VITE_ORDEN_CHANNEL", None)
        else:
            os.environ["VITE_ORDEN_CHANNEL"] = said

    folder = Path(tempfile.mkdtemp(prefix="nib-web-channel-")) / "dist"
    DRIVE.later(lambda: shutil.rmtree(folder.parent, ignore_errors=True))
    shutil.copytree(harness.WORKER_DIST, folder)
    done = subprocess.run(
        ["bash", str(ROOT / "scripts" / "web-channels.sh"), str(folder), str(edge)],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if done.returncode != 0:
        raise SystemExit(f"the two builds did not go together:\n{done.stdout}\n{done.stderr}")
    say(done.stdout.strip())
    return folder


def settled(page: Page) -> None:
    page.wait_for_load_state("domcontentloaded")
    wait(page, "() => !!window.nibApp?.workspace", "the app")
    page.wait_for_timeout(800)


def row(page: Page) -> str:
    """Which of the two the Web version row says, Settings open on General."""
    page.evaluate("() => window.nibApp.settings.show('general')")
    page.wait_for_timeout(500)
    found = page.locator(ROW)
    if not found.count():
        wrong("Settings has no Web version row")
        return ""
    found.scroll_into_view_if_needed()
    return found.locator("[aria-checked='true']").inner_text().strip()


def choose(page: Page, label: str) -> None:
    """One of the two pressed, and the page the Worker answers with."""
    with page.expect_navigation(timeout=PATIENCE * 1000):
        page.locator(ROW).get_by_role("radio", name=label, exact=True).click()
    settled(page)


def drive(page: Page) -> None:
    page.goto(ORIGIN, wait_until="domcontentloaded")
    settled(page)

    # The release: no mark, and the row says so.
    if page.locator(MARK).count():
        wrong("the release shows the Unstable mark")
    said = row(page)
    say(f"[release] the row says {said!r}")
    if said != "Stable":
        wrong(f"on the release the row says {said!r}")
    shot(page, "1-release-settings")

    # To the edge, through the Worker.
    choose(page, "Unstable")
    cookies = {one["name"]: one["value"] for one in page.context.cookies()}
    say(f"[edge] cookie {cookies.get('orden-channel')!r}, at {page.url}")
    if cookies.get("orden-channel") != "unstable":
        wrong(f"choosing Unstable left no cookie for it: {cookies}")
    if "channel=" in page.url:
        wrong(f"the page came back with the parameter still on it: {page.url}")
    if not page.locator(MARK).count():
        wrong("the edge shows no Unstable mark")
    else:
        shot(page, "2-edge-mark")
    said = row(page)
    say(f"[edge] the row says {said!r}")
    if said != "Unstable":
        wrong(f"on the edge the row says {said!r}")
    shot(page, "3-edge-settings")

    # The mark opens Settings, where the release is chosen again.
    page.evaluate("() => (window.nibApp.settings.open = false)")
    page.wait_for_timeout(400)
    if page.locator(MARK).count():
        page.locator(MARK).click()
        page.wait_for_timeout(400)
        if not page.evaluate("() => window.nibApp.settings.open"):
            wrong("the Unstable mark did not open Settings")
    row(page)
    choose(page, "Stable")
    cookies = {one["name"]: one["value"] for one in page.context.cookies()}
    if cookies.get("orden-channel"):
        wrong(f"choosing Stable left the cookie: {cookies}")
    if page.locator(MARK).count():
        wrong("back on the release, the Unstable mark is still there")
    said = row(page)
    say(f"[release again] the row says {said!r}")
    if said != "Stable":
        wrong(f"back on the release the row says {said!r}")
    shot(page, "4-release-again")


def main() -> int:
    worker = harness.Worker(DRIVE)
    folder = both_builds(worker)
    with DRIVE.session() as browser:
        worker.start(assets=folder)
        context = browser.new_context(viewport={"width": 1280, "height": 820})
        page = context.new_page()
        page.on("pageerror", lambda error: wrong(f"page error: {error}"))
        drive(page)
        context.close()
    return DRIVE.verdict("the web app moves between its two builds from Settings")


if __name__ == "__main__":
    raise SystemExit(main())
