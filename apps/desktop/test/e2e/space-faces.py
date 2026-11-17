from __future__ import annotations

import json

from playwright.sync_api import Browser

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
ORIGIN = harness.worker_origin()

OWNER = "studio-owner@example.com"
MEMBER = "studio-member@example.com"
SPACE = "Studio"

ROW = """(name) => {
  const row = [...document.querySelectorAll('[role="menuitem"]')]
    .find((one) => one.querySelector('.orden-row-label')?.textContent.trim() === name)
  return row ? row.querySelectorAll('.faces .one').length : -1
}"""


class Worker(harness.Worker):
    def __init__(self) -> None:
        super().__init__(DRIVE)


def drive(browser: Browser) -> None:
    worker = Worker()
    worker.start()
    owner = worker.account(OWNER)
    member = worker.account(MEMBER)
    space = worker.request("/v1/spaces", owner, {"name": SPACE})["space"]
    worker.request(f"/v1/spaces/{space['id']}/share/invite", owner, {"email": MEMBER, "role": "write"})
    link = worker.waits_for_mail(MEMBER, r"/join/([a-f0-9]+)", "the invitation").group(1)
    worker.request(f"/v1/join/{link}", member, {})
    say(f"{MEMBER} is in {SPACE}")

    context = browser.new_context(viewport={"width": 1180, "height": 760}, reduced_motion="reduce")
    context.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(member)})")
    page = context.new_page()
    page.goto(ORIGIN, wait_until="domcontentloaded")
    for visit in ("first visit", "after a reload"):
        if visit != "first visit":
            page.reload(wait_until="domcontentloaded")
        wait_for(page, "() => !!window.ordenApp?.workspace.activeSpace", f"{visit}: the app")
        page.keyboard.press("Control+Space")
        wait_for(page, f"() => ({ROW})({json.dumps(SPACE)}) >= 0", f"{visit}: the shared space in the list", 60)
        faced = DRIVE.waited(page, f"() => ({ROW})({json.dumps(SPACE)}) > 0", f"{visit}: the owner's face", 30)
        say(f"{visit}: faces on {SPACE}: {page.evaluate(ROW, SPACE)}")
        shot(page, f"space-list-{visit.replace(' ', '-')}")
        if not faced:
            wrong(f"{visit}: {SPACE} lists no face of its owner")
    context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a space shared with the reader shows its people as soon as it arrives"))
