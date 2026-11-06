from __future__ import annotations

import argparse
import hashlib
import json
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
SHOTS = DRIVE.shots
ORIGIN = harness.worker_origin()
APP = harness.APP

EMAIL = "layers-drive@example.com"

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

def request(path: str, token: str | None = None, body: object = None, method: str | None = None):
    data = None if body is None else json.dumps(body).encode()
    ask = urllib.request.Request(f"{ORIGIN}{path}", data=data, method=method)
    if token:
        ask.add_header("authorization", f"Bearer {token}")
    if data is not None:
        ask.add_header("content-type", "application/json")

    try:
        with urllib.request.urlopen(ask, timeout=30) as answer:
            said = answer.read().decode()
            return json.loads(said) if said else {}
    except urllib.error.HTTPError as refused:
        said = refused.read().decode()
        return {"status": refused.code, **(json.loads(said) if said else {})}

class Worker(harness.Worker):

    def __init__(self) -> None:
        super().__init__(DRIVE, variables={"OPENAI_KEY_SECRET": "a secret for the drive"})

    def account(self, device: str = "the drive") -> tuple[str, str]:  # type: ignore[override]
        now = int(time.time() * 1000)
        user = str(uuid.uuid4())
        self.sql(f"insert into users (id, email, created_at) values ('{user}', '{EMAIL}', {now});")
        token = uuid.uuid4().hex + uuid.uuid4().hex
        digest = hashlib.sha256(token.encode()).hexdigest()
        self.sql(
            "insert into sessions (token_hash, user_id, created_at, expires_at, id, name,"
            f" last_used_at) values ('{digest}', '{user}', {now}, {now + 86400000},"
            f" '{uuid.uuid4().hex[:16]}', '{device}', {now});"
        )

        return token, user

def look(page, name: str, tag: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}-{tag}.png"))

def panel(page) -> None:
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_selector("aside .name", timeout=30000)

def held(page, row) -> None:
    row.scroll_into_view_if_needed()
    box = row.bounding_box()
    at = {"x": box["x"] + box["width"] / 2, "y": box["y"] + box["height"] / 2}
    page.evaluate(
        """(at) => {
          const row = document.elementFromPoint(at.x, at.y)?.closest('.nib-row.row')
          if (!row) throw new Error('no row under the finger')
          const touch = new Touch({
            identifier: 1,
            target: row,
            clientX: at.x,
            clientY: at.y,
          })
          row.dispatchEvent(
            new TouchEvent('touchstart', {
              bubbles: true,
              cancelable: true,
              touches: [touch],
              targetTouches: [touch],
              changedTouches: [touch],
            }),
          )
        }""",
        at,
    )
    page.wait_for_timeout(900)

def drive(browser, origin: str, name: str, width, height, agent, finger, token: str) -> list[str]:
    wrong: list[str] = []

    context = browser.new_context(
        viewport={"width": width, "height": height},
        user_agent=agent,
        has_touch=finger,
        is_mobile=finger,
        color_scheme="light",
        device_scale_factor=2,
    )
    context.add_init_script(f"try {{ localStorage.setItem('nib:session', '{token}') }} catch {{}}")

    page = context.new_page()
    page.set_default_timeout(20000)

    def hurt(words: str) -> None:
        wrong.append(f"[{name}] {words}")
        say(f"[{name}] {words}")

    page.on("pageerror", lambda error: hurt(f"PAGE ERROR: {error}"))
    page.on(
        "console",
        lambda one: hurt(f"console {one.type}: {one.text}") if one.type == "error" else None,
    )

    page.goto(origin, wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp", timeout=40000)
    page.wait_for_function("() => !!window.nibApp.account.user", timeout=40000)
    page.wait_for_function(
        "() => window.nibApp.workspace.activeSpace && window.nibApp.sync.status !== 'off'",
        timeout=60000,
    )
    page.wait_for_function("() => window.nibApp.workspace.spaces.length >= 2", timeout=60000)

    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          await ws.noteFrom('# Kestrel notes\\n\\nA kestrel hangs on the wind.', ws.activeSpace.root)
          await ws.loadTree()
        }"""
    )
    page.wait_for_timeout(1500)
    panel(page)
    page.wait_for_timeout(900)
    say(
        f"[{name}] {page.evaluate('() => window.nibApp.workspace.spaces.length')} spaces,"
        f" sync is {page.evaluate('() => window.nibApp.sync.status')},"
        f" panel is {page.evaluate('() => window.nibApp.workspace.panel')!r}"
    )

    switcher = page.locator("aside .name")
    if not switcher.count():
        hurt("no switcher on the panel at all")
    else:
        switcher.first.click()
        page.wait_for_timeout(700)
        spaces = page.locator(".spaces")
        seen = bool(spaces.count()) and spaces.first.is_visible()
        rows = page.locator(".spaces .nib-row").count()
        box = spaces.first.bounding_box() if spaces.count() else None
        say(f"[{name}] the switcher: layer={spaces.count()} seen={seen} rows={rows} box={box}")
        if not seen or not rows:
            hurt("THE SWITCHER DID NOT OPEN")
        if box and (box["width"] < 40 or box["height"] < 20):
            hurt(f"the switcher opened with nothing to see: {box}")
        look(page, name, "switcher")
        page.locator(".spaces .nib-row.is-on").first.click()
        page.wait_for_timeout(700)
        if page.locator(".spaces").count():
            hurt("the switcher did not close on a choice")

    panel(page)
    page.wait_for_timeout(600)
    rows = page.locator("aside .nib-row.row[data-path]")
    if not rows.count():
        hurt("no rows in the file list")
    else:
        if finger:
            held(page, rows.first)
        else:
            rows.first.click(button="right")
        page.wait_for_timeout(900)

        popup = page.locator("[role=menu].menu")
        there = bool(popup.count()) and popup.first.is_visible()
        items = page.locator("[role=menu].menu [role=menuitem]").count()
        box = popup.first.bounding_box() if popup.count() else None
        say(f"[{name}] the note's menu: layer={popup.count()} seen={there} items={items} box={box}")
        if not there or not items:
            hurt("THE NOTE'S MENU DID NOT OPEN")
        look(page, name, "menu")

        if there and items:
            page.locator("[role=menu].menu [role=menuitem]").first.click()
            page.wait_for_timeout(800)
            if page.locator("[role=menu].menu").count():
                hurt("the menu did not close on a choice")

    context.close()
    return wrong

SHAPES = [
    ("desktop", 1440, 900, DESKTOP_AGENT, False),
    ("phone", 390, 844, PHONE_AGENT, True),
]

def main() -> int:
    parse = argparse.ArgumentParser()
    parse.add_argument("--also", type=Path, default=None, help="a second built dist to drive")
    said = parse.parse_args()

    worker = Worker()
    builds: list[tuple[str, Path | None]] = [("main", None)]
    if said.also:
        builds.append(("shipped", said.also.resolve()))

    wrong: list[str] = []
    token: str | None = None

    with DRIVE.session() as browser:
        for which, folder in builds:
            worker.start(assets=folder)
            try:
                if token is None:
                    token, _user = worker.account()
                    for label in ("Field notes", "Ledger"):
                        made = request("/v1/spaces", token, {"name": label}, "POST")
                        say(f"the account holds {made.get('space', {}).get('name')!r}")

                for shape in SHAPES:
                    wrong += drive(browser, ORIGIN, f"{which}-{shape[0]}", *shape[1:], token)
            finally:
                worker.stop()

    say("")
    if wrong:
        say(f"{len(wrong)} thing(s) went wrong:")
        for one in wrong:
            say(f"  {one}")
        return 1

    say("both layers opened on every shape, and the console stayed quiet")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
