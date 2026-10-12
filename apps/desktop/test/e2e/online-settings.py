"""Settings > Online terminal, for a machine in the cloud and for a server of its own, at
three widths of a window, in light and dark, and on a phone.

Issue 245: the machine's Start, Stop or Restart was the card's full-width action rather
than the small one at the end of a row, so it took the whole row and left the row's name
no width at all - `Machine`, its state and its server drawn one letter to a line, down
past the bottom of the window, with `Restart` floating half way down beside them.

The account is answered here: `GET /v2/online/machine` with each of the two machines, and
everything else the app would ask of nibeditor.com refused. What it checks, at every
width and in every look, and fails on:

  - the machine's row is one row: its name as wide as its words, the row no taller than
    its name, its state and its server's line;
  - the action is the small one at the row's end, not a line across it;
  - every meter's name and numbers share a line, and the bar is as wide as the card;
  - nothing in the pane is wider than the pane.

From the repository root; the harness builds the app with its handle on the page the
first time and serves it (see harness.py):

    python apps/desktop/test/e2e/online-settings.py

Screenshots go beside this file under `shots/online-settings/`, which is ignored.
"""

from __future__ import annotations

import json
import time

from playwright.sync_api import Browser, Route

from harness import Drive
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)
PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
    " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
)

GB = 1_000_000_000
HOUR = 3600

#: The month, as the Worker counts it, a little over half way through.
ALLOWANCE = {"awakeS": 20 * HOUR, "cpuS": 10 * HOUR, "homeBytes": 5 * GB, "egressBytes": 20 * GB}
USED = {"awakeS": 17 * HOUR, "cpuS": 2 * HOUR, "homeBytes": int(1.4 * GB), "egressBytes": 3 * GB}

#: The two machines a person can have: one in the cloud that sleeps, and a server of its
#: own that is always on (docs/online-terminal.md 4.15), the one the issue's screenshot
#: was taken of.
MACHINES = {
    "cloud": {
        "id": "m-cloud",
        "state": "asleep",
        "held": False,
        "host": "cloudflare",
        "server": None,
        "disk": None,
    },
    "server": {
        "id": "m-server",
        "state": "awake",
        "held": False,
        "host": "hetzner",
        "server": {
            "type": "cx43",
            "location": "fsn1",
            "cores": 8,
            "memoryGb": 16,
            "diskGb": 160,
            "price": 16.49,
            "currency": "EUR",
        },
        "disk": {"used": 131 * GB, "total": 160 * GB},
    },
}

#: Every look: what the window is, how wide, and in which scheme.
LOOKS = [
    ("desktop", 1280, 860, "light"),
    ("desktop", 960, 760, "light"),
    ("desktop", 720, 720, "dark"),
    ("desktop", 1280, 860, "dark"),
    ("phone", 390, 844, "light"),
    ("phone", 390, 844, "dark"),
]

# A session, put straight into the store, as recording.py does: signing in properly is
# signin.py's drive, and the pane only asks that there is an account.
SIGNED_IN = """
() => {
  const app = window.nibApp
  app.account.token = 'a-drive-session'
  app.account.user = { id: 'drive', email: 'drive@example.com', name: 'Drive' }
  app.account.settling = false
  return !!app.account.accountToken
}
"""

#: What the pane draws, measured: the machine's row and what is in it, every meter, and
#: whether anything in the pane runs past its side.
MEASURE = """
() => {
  const box = (one) => one ? one.getBoundingClientRect() : null
  const pane = document.querySelector('.sheet .body')
  const online = document.querySelector('.online')
  const row = online?.querySelector('.nib-setting')
  const name = row?.querySelector('.name')
  const action = row?.querySelector('button')
  const meters = [...(online?.querySelectorAll('.meter') ?? [])].map((meter) => {
    const line = meter.querySelector('.line')
    const words = [...line.children].map(box)
    return {
      label: line.children[0]?.textContent.trim() ?? '',
      oneLine: words.length === 2 && Math.abs(words[0].top - words[1].top) < 2,
      track: box(meter.querySelector('[role=meter]')).width,
      wide: box(meter).width,
    }
  })
  const past = [...(online?.querySelectorAll('*') ?? [])].filter(
    (one) => box(one).right > box(pane).right + 0.5 || box(one).left < box(pane).left - 0.5,
  )
  return {
    row: box(row) && {
      width: box(row).width,
      height: box(row).height,
      end: box(row).right - parseFloat(getComputedStyle(row).paddingRight),
    },
    name: box(name) && {
      width: box(name).width,
      height: box(name).height,
      words: name.scrollWidth,
      lines: [...name.childNodes].filter((one) => one.textContent.trim()).length,
    },
    action: box(action) && {
      width: box(action).width,
      height: box(action).height,
      right: box(action).right,
      label: action.textContent.trim(),
      chip: action.classList.contains('nib-chip'),
    },
    meters,
    past: past.map((one) => one.className || one.tagName),
    scrolls: pane.scrollWidth > pane.clientWidth,
  }
}
"""


def check(what: str, held: bool) -> None:
    if held:
        say(f"ok   {what}")
    else:
        wrong(what)


def answering(machine: dict[str, object]):
    """The account's answer about its machine and its month."""

    def answer(route: Route) -> None:
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(
                {
                    "allowed": True,
                    "machine": machine,
                    "used": USED,
                    "limit": ALLOWANCE,
                    "resetAt": int((time.time() + 12 * 86400) * 1000),
                }
            ),
        )

    return answer


def look(browser: Browser, kind: str, width: int, height: int, scheme: str) -> None:
    finger = kind == "phone"
    page = DRIVE.page(
        browser,
        viewport={"width": width, "height": height},
        user_agent=PHONE_AGENT if finger else DESKTOP_AGENT,
        has_touch=finger,
        is_mobile=finger,
        color_scheme=scheme,
        reduced_motion="reduce",
        device_scale_factor=2,
    )
    # Playwright tries the newest route first, so the refusal goes in before the answer.
    page.route("https://nibeditor.com/**", lambda route: route.abort())
    for machine, about in MACHINES.items():
        page.unroute("**/v2/online/machine")
        page.route("**/v2/online/machine", answering(about))
        if machine == "cloud":
            DRIVE.open(page)
            DRIVE.wait_for(page, SIGNED_IN, "the account")
        name = f"{kind}-{width}-{scheme}-{machine}"
        page.evaluate("() => window.nibApp.settings.show('general')")
        page.evaluate("() => window.nibApp.settings.show('online')")
        DRIVE.wait_for(page, "document.querySelector('.online .meter')", f"[{name}] the meters")
        quiet(page)
        shot(page, name)

        seen = page.evaluate(MEASURE)
        say(f"[{name}] {json.dumps(seen)}")
        row, words, action = seen["row"], seen["name"], seen["action"]
        if not (row and words and action):
            wrong(f"[{name}] the machine's row is not drawn")
            continue
        check(f"[{name}] the row's name is as wide as its words", words["width"] >= words["words"] - 0.5)
        check(f"[{name}] the row's name is wider than a word", words["width"] >= 120)
        check(f"[{name}] the row is a row, not a column ({row['height']:.0f}px)", row["height"] <= 140)
        check(
            f"[{name}] {action['label']} is the small action at the row's end",
            action["chip"] and action["width"] < row["width"] / 3 and abs(action["right"] - row["end"]) <= 1,
        )
        for meter in seen["meters"]:
            check(f"[{name}] {meter['label']}: its name and numbers share a line", meter["oneLine"])
            check(f"[{name}] {meter['label']}: the bar is the card's width", meter["track"] >= meter["wide"] - 1)
        check(f"[{name}] nothing in the pane runs past its side {seen['past']}", not seen["past"])
        check(f"[{name}] the pane does not scroll sideways", not seen["scrolls"])

    page.context.close()


def drive(browser: Browser) -> None:
    for kind, width, height, scheme in LOOKS:
        look(browser, kind, width, height, scheme)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "Settings > Online terminal is laid out in every look"))
