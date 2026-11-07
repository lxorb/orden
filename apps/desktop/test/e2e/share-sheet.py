from __future__ import annotations

import json
from pathlib import Path

from harness import Drive

DRIVE = Drive(__file__)
say = DRIVE.say
ORIGIN = DRIVE.origin

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

DEVICES = [
    ("desktop-light", 1440, 900, DESKTOP_AGENT, False, "light"),
    ("desktop-dark", 1440, 900, DESKTOP_AGENT, False, "dark"),
    ("phone", 390, 844, PHONE_AGENT, True, "light"),
    ("phone-dark", 390, 844, PHONE_AGENT, True, "dark"),
]

OWNER = {"email": "emil@example.com", "name": "Emil"}

LINK = {"url": "https://orden.so/join/8f2c1d5ab9", "role": "read", "mode": "open"}

def member(email, role="write", pending=False, name=None, guest=None):
    return {"email": email, "guest": guest, "name": name, "role": role, "pending": pending}

def request(email, name, role="write", guest=None):
    return {"email": email, "guest": guest, "name": name, "role": role, "at": 0}

PEOPLE = [
    member("ada@example.com", "write", name="Ada Lovelace"),
    member("grace@example.com", "read"),
    member(None, "write", name="Windows wren", guest="g1"),
]

STATES = [
    ("empty", {"owner": OWNER, "members": [], "requests": [], "link": None}),
    ("people", {"owner": OWNER, "members": PEOPLE, "requests": [], "link": None}),
    (
        "waiting",
        {
            "owner": OWNER,
            "members": PEOPLE + [member("mary@example.com", "read", pending=True)],
            "requests": [
                request("kat@example.com", "Kat"),
                request(None, "iPhone lark", guest="g2"),
            ],
            "link": {**LINK, "mode": "approval"},
        },
    ),
    ("link-off", {"owner": OWNER, "members": PEOPLE, "requests": [], "link": None}),
    ("link-open", {"owner": OWNER, "members": PEOPLE, "requests": [], "link": LINK}),
    (
        "link-asks",
        {
            "owner": OWNER,
            "members": PEOPLE,
            "requests": [],
            "link": {**LINK, "role": "write", "mode": "approval"},
        },
    ),
]

SHOW = """
(who) => {
  const app = window.ordenApp
  app.share.space = app.workspace.activeSpace
  app.share.spaceId = app.workspace.activeSpaceId
  app.share.error = null
  app.share.email = ''
  app.share.wrongAddress = false
  app.share.role = 'write'
  app.share.who = who
  app.share.open = true
}
"""

def drive(browser, out: Path, name, width, height, agent, finger, scheme) -> None:
    out.mkdir(parents=True, exist_ok=True)

    context = browser.new_context(
        viewport={"width": width, "height": height},
        user_agent=agent,
        has_touch=finger,
        is_mobile=finger,
        color_scheme=scheme,
        device_scale_factor=2,
    )
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: say(f"[{name}] page error: {error}"))
    DRIVE.open(page)
    page.evaluate("() => { for (let i = 0; i < 12; i++) history.pushState({ spare: i }, '') }")
    page.evaluate(f"() => window.ordenApp.theme.setScheme('{scheme}')")

    page.evaluate(
        """() => {
          const ws = window.ordenApp.workspace
          ws.setIcon(ws.activeSpaceId, 'notebook-pen', 'teal')
        }"""
    )
    page.wait_for_timeout(300)

    def shot(tag: str) -> None:
        page.screenshot(path=str(out / f"{name}-{tag}.png"))
        say(f"shot {name}-{tag}.png")

    def sheet(tag: str) -> None:
        box = page.locator(".sheet").first.bounding_box()
        if not box:
            shot(tag)
            return

        pad = 24
        page.screenshot(
            path=str(out / f"{name}-{tag}.png"),
            clip={
                "x": max(0, box["x"] - pad),
                "y": max(0, box["y"] - pad),
                "width": min(width, box["width"] + pad * 2),
                "height": min(height, box["height"] + pad * 2),
            },
        )
        say(f"shot {name}-{tag}.png")

    page.evaluate(
        """() => {
          const app = window.ordenApp
          app.share.space = app.workspace.activeSpace
          app.share.spaceId = app.workspace.activeSpaceId
          app.share.who = null
          app.share.open = true
        }"""
    )
    page.wait_for_timeout(500)
    sheet("loading")

    for tag, who in STATES:
        page.evaluate(SHOW, who)
        page.wait_for_timeout(450)
        sheet(tag)

    page.evaluate(SHOW, STATES[1][1])
    page.wait_for_timeout(300)
    field = page.locator(".compose input").first
    field.click()
    field.type("ada@example.com, bob@")
    page.wait_for_timeout(300)
    sheet("typing")

    field.fill("nonsense")
    page.wait_for_timeout(100)
    page.keyboard.press("Enter")
    page.wait_for_timeout(400)
    sheet("wrong")

    page.evaluate(SHOW, STATES[2][1])
    page.wait_for_timeout(400)
    picks = page.locator(".person .pick button")
    if picks.count() > 1:
        picks.nth(1).click(force=True)
        page.wait_for_timeout(400)
        shot("rolemenu")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

        picks.last.click(force=True)
        page.wait_for_timeout(400)
        shot("invitedmenu")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

    page.evaluate("() => window.ordenApp.share.close()")
    context.close()

def main() -> int:
    out = DRIVE.shots
    with DRIVE.session() as browser:
        for one in DEVICES:
            say(f"--- {one[0]} ---")
            drive(browser, out, *one)

    say(json.dumps(sorted(p.name for p in out.glob('*.png'))))
    return DRIVE.verdict(f"shots in {out}")

if __name__ == "__main__":
    raise SystemExit(main())
