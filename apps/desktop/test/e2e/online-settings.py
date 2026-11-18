import json
import time

from playwright.sync_api import Browser, Page, Route

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

ALLOWANCE = {"awakeS": 20 * HOUR, "cpuS": 10 * HOUR, "homeBytes": 5 * GB, "egressBytes": 20 * GB}
USED = {"awakeS": 17 * HOUR, "cpuS": 2 * HOUR, "homeBytes": int(1.4 * GB), "egressBytes": 3 * GB}

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
            "hourly": 0.0278,
            "currency": "EUR",
            "made": True,
            "spent": 7.31,
        },
        "disk": {"used": 131 * GB, "total": 160 * GB},
    },
}

def offer(name, cores, memory, disk, cpu, arch, monthly, hourly):
    return {
        "name": name,
        "cores": cores,
        "memoryGb": memory,
        "diskGb": disk,
        "cpu": cpu,
        "arch": arch,
        "prices": [{"location": place, "monthly": monthly, "hourly": hourly} for place in ("fsn1", "nbg1")],
    }

OFFERS = {
    "currency": "EUR",
    "locations": [
        {"name": "fsn1", "city": "Falkenstein", "country": "DE"},
        {"name": "nbg1", "city": "Nuremberg", "country": "DE"},
    ],
    "types": [
        offer("cx23", 2, 4, 40, "shared", "x86", 5.34, 0.0093),
        offer("cx43", 8, 16, 160, "shared", "x86", 16.49, 0.0278),
        offer("cx53", 16, 32, 320, "shared", "x86", 27.95, 0.0486),
        offer("cax31", 8, 16, 160, "shared", "arm", 16.05, 0.0272),
        offer("ccx33", 8, 32, 240, "dedicated", "x86", 75.47, 0.1212),
    ],
}

SESSIONS = [
    {
        "term": "note-agent",
        "session": "s_agent",
        "typing": "owner",
        "createdAt": 1_790_000_000_000,
        "space": "space-1",
        "path": "Build/Terminal.term",
        "trashed": False,
        "program": "claude",
        "title": "Fix the flaky upload test and the build that goes with it",
        "alive": True,
        "at": 1_790_000_900_000,
    },
    {
        "term": "note-editor",
        "session": "s_editor",
        "typing": "owner",
        "createdAt": 1_790_000_100_000,
        "space": "space-1",
        "path": "Notes/Terminal 2.term",
        "trashed": False,
        "program": "vim",
        "title": None,
        "alive": True,
        "at": 1_790_000_500_000,
    },
    {
        "term": None,
        "session": "s_orphan",
        "typing": "owner",
        "createdAt": None,
        "space": None,
        "path": None,
        "trashed": False,
        "program": None,
        "title": None,
        "alive": True,
        "at": None,
    },
]

NAMES = ["Fix the flaky upload test and the build that goes with it", "vim", "Terminal"]

ROWS = """
() => {
  const box = (one) => one.getBoundingClientRect()
  return [...document.querySelectorAll('.online .orden-setting')].slice(1).map((row) => {
    const name = row.querySelector('.name')
    const chips = [...row.querySelectorAll('button')]
    return {
      name: name.firstChild.textContent.trim(),
      height: box(row).height,
      width: box(row).width,
      nameWidth: box(name).width,
      chips: chips.map((chip) => ({
        label: chip.textContent.trim(),
        chip: chip.classList.contains('orden-chip'),
        width: box(chip).width,
      })),
      lastRight: chips.length ? box(chips.at(-1)).right : 0,
      end: box(row).right - parseFloat(getComputedStyle(row).paddingRight),
    }
  })
}
"""

class Account:

    def __init__(self) -> None:
        self.sessions = [dict(one) for one in SESSIONS]
        self.ended: list[str] = []
        self.chosen: list[dict[str, str]] = []

    def offers(self, route: Route) -> None:
        route.fulfill(status=200, content_type="application/json", body=json.dumps(OFFERS))

    def choose(self, route: Route) -> None:
        self.chosen.append(json.loads(route.request.post_data or "{}"))
        route.fulfill(status=200, content_type="application/json", body='{"state": "starting"}')

    def answer(self, route: Route) -> None:
        if route.request.method == "DELETE":
            ended = route.request.url.rsplit("/", 1)[-1]
            self.ended.append(ended)
            self.sessions = [one for one in self.sessions if (one["term"] or one["session"]) != ended]
            route.fulfill(status=200, content_type="application/json", body='{"ok": true}')
            return
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"terms": self.sessions}))

LOOKS = [
    ("desktop", 1280, 860, "light"),
    ("desktop", 960, 760, "light"),
    ("desktop", 720, 720, "dark"),
    ("desktop", 1280, 860, "dark"),
    ("phone", 390, 844, "light"),
    ("phone", 390, 844, "dark"),
]

SIGNED_IN = """
() => {
  const app = window.ordenApp
  app.account.token = 'a-drive-session'
  app.account.user = { id: 'drive', email: 'drive@example.com', name: 'Drive' }
  app.account.settling = false
  return !!app.account.accountToken
}
"""

MEASURE = """
() => {
  const box = (one) => one ? one.getBoundingClientRect() : null
  const pane = document.querySelector('.sheet .body')
  const online = document.querySelector('.online')
  const row = online?.querySelector('.orden-setting')
  const name = row?.querySelector('.name')
  const action = row ? [...row.querySelectorAll('button')].at(-1) : null
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
      text: name.textContent.replace(/\\s+/g, ' '),
      bottom: box(name).bottom,
    },
    action: box(action) && {
      width: box(action).width,
      height: box(action).height,
      right: box(action).right,
      label: action.textContent.trim(),
      top: box(action).top,
      chip: action.classList.contains('orden-chip'),
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
    page.route("https://orden.so/**", lambda route: route.abort())
    account = Account()
    page.route("**/v2/online/terms**", account.answer)
    page.route("**/v2/online/types", account.offers)
    page.route("**/v2/online/machine/type", account.choose)
    for machine, about in MACHINES.items():
        page.unroute("**/v2/online/machine")
        page.route("**/v2/online/machine", answering(about))
        if machine == "cloud":
            DRIVE.open(page)
            DRIVE.wait_for(page, SIGNED_IN, "the account")
        name = f"{kind}-{width}-{scheme}-{machine}"
        page.evaluate("() => window.ordenApp.settings.show('general')")
        page.evaluate("() => window.ordenApp.settings.show('online')")
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
        under = action["top"] >= words["bottom"] - 1 and words["width"] >= row["width"] * 0.8
        check(
            f"[{name}] the row is a row, or its actions sit under its full-width facts ({row['height']:.0f}px)",
            row["height"] <= 140 or under,
        )
        check(
            f"[{name}] {action['label']} is the small action at the row's end",
            action["chip"] and action["width"] < row["width"] / 3 and abs(action["right"] - row["end"]) <= 1,
        )
        for meter in seen["meters"]:
            check(f"[{name}] {meter['label']}: its name and numbers share a line", meter["oneLine"])
            check(f"[{name}] {meter['label']}: the bar is the card's width", meter["track"] >= meter["wide"] - 1)
        check(f"[{name}] nothing in the pane runs past its side {seen['past']}", not seen["past"])
        check(f"[{name}] the pane does not scroll sideways", not seen["scrolls"])
        check(
            f"[{name}] the machine's facts have no dot or bullet between them",
            not any(mark in words["text"] for mark in "·•∙⋅"),
        )
        if machine == "server":
            check(f"[{name}] the machine's cost this month is beside its price", "this month" in words["text"])

        every = f"document.querySelectorAll('.online .orden-setting').length === {len(SESSIONS) + 1}"
        DRIVE.wait_for(page, every, f"[{name}] the sessions")
        listed = page.evaluate(ROWS)
        say(f"[{name}] sessions {json.dumps(listed)}")
        check(
            f"[{name}] every session is a row, called by what runs in it, last printed first",
            [one["name"] for one in listed] == NAMES,
        )
        for one in listed:
            label = one["name"][:24]
            check(f"[{name}] {label}: a row, not a column ({one['height']:.0f}px)", one["height"] <= 140)
            check(f"[{name}] {label}: its name has room", one["nameWidth"] >= 80)
            check(
                f"[{name}] {label}: End is the small action at the row's end",
                bool(one["chips"])
                and one["chips"][-1]["label"] == "End"
                and all(chip["chip"] and chip["width"] < one["width"] / 3 for chip in one["chips"])
                and abs(one["lastRight"] - one["end"]) <= 1,
            )

        if kind == "desktop" and width == 1280 and scheme == "light" and machine == "cloud":
            ending(page, account)
        if machine == "server":
            picking(page, account, name, kind == "desktop" and width == 1280 and scheme == "light")

    page.context.close()

def ending(page: Page, account: Account) -> None:
    danger = "document.querySelector('button.orden-button.is-danger')"
    last = page.locator(".online .orden-setting").last
    last.get_by_role("button", name="End").click()
    DRIVE.wait_for(page, danger, "End's question")
    shot(page, "end-asked")
    page.keyboard.press("Escape")
    DRIVE.wait_for(page, f"!{danger}", "the question put away")
    check("put away, the question ends nothing", account.ended == [])

    last.get_by_role("button", name="End").click()
    DRIVE.wait_for(page, danger, "End's question again")
    page.locator("button.orden-button.is-danger").click()
    DRIVE.wait_for(page, "document.querySelectorAll('.online .orden-setting').length === 3", "its row gone")
    check("End ends the session no file names, by its own id", account.ended == ["s_orphan"])
    shot(page, "end-ended")
    account.sessions = [dict(one) for one in SESSIONS]
    account.ended.clear()

PICKER = """
() => {
  const box = (one) => one.getBoundingClientRect()
  const pane = document.querySelector('.sheet .body')
  const picker = document.querySelector('.online .picker')
  if (!picker) return null
  const rows = [...picker.querySelectorAll('[data-type]')].map((row) => ({
    type: row.dataset.type,
    action: row.querySelector('button')?.textContent.trim() ?? row.querySelector('.row .hint')?.textContent.trim() ?? '',
    price: row.querySelector('.price')?.textContent.replace(/\\s+/g, ' ').trim() ?? '',
    height: box(row).height,
  }))
  const past = [...picker.querySelectorAll('*')].filter(
    (one) => box(one).right > box(pane).right + 0.5 || box(one).left < box(pane).left - 0.5,
  )
  return { rows, past: past.map((one) => one.className || one.tagName), scrolls: pane.scrollWidth > pane.clientWidth }
}
"""

def picking(page: Page, account: Account, name: str, flow: bool) -> None:
    page.locator(".online .orden-setting").first.get_by_role("button", name="Change").click()
    DRIVE.wait_for(page, "document.querySelectorAll('.online .picker [data-type]').length === 5", f"[{name}] the machines")
    quiet(page)
    shot(page, f"{name}-picker")
    seen = page.evaluate(PICKER)
    say(f"[{name}] picker {json.dumps(seen)}")
    rows = {one["type"]: one for one in seen["rows"]}
    check(f"[{name}] the machines are listed cheapest first", [one["type"] for one in seen["rows"]] == ["cx23", "cax31", "cx43", "cx53", "ccx33"])
    check(f"[{name}] a smaller disk cannot be chosen", rows["cx23"]["action"] == "Smaller disk")
    check(f"[{name}] Arm cannot be chosen for an x86 machine", rows["cax31"]["action"] == "Other CPU")
    check(f"[{name}] the machine it is now is marked", rows["cx43"]["action"] == "Current")
    check(f"[{name}] a bigger one can be resized to", rows["cx53"]["action"] == "Resize")
    check(f"[{name}] each has its monthly and hourly price", "a month" in rows["cx53"]["price"] and "an hour" in rows["cx53"]["price"])
    check(f"[{name}] nothing in the picker runs past the pane {seen['past']}", not seen["past"])
    check(f"[{name}] the picker does not scroll sideways", not seen["scrolls"])
    if flow:
        resizing(page, account)
        return
    page.locator(".online .orden-setting").first.get_by_role("button", name="Change").click()
    DRIVE.wait_for(page, "!document.querySelector('.online .picker')", f"[{name}] the picker put away")

def resizing(page: Page, account: Account) -> None:
    resize = page.locator('.online .picker [data-type="cx53"]').get_by_role("button", name="Resize")
    resize.click()
    DRIVE.wait_for(page, "document.querySelector('button.orden-button.is-danger')", "the running terminals' warning")
    shot(page, "resize-warned")
    warned = page.evaluate("() => document.querySelector('form')?.textContent ?? ''")
    check("the running terminals are warned of first", "3 terminals are running" in warned)
    page.keyboard.press("Escape")
    DRIVE.wait_for(page, "!document.querySelector('button.orden-button.is-danger')", "the warning put away")
    check("put away, the warning resizes nothing", account.chosen == [])

    resize.click()
    DRIVE.wait_for(page, "document.querySelector('button.orden-button.is-danger')", "the warning again")
    page.get_by_role("button", name="Continue").click()
    DRIVE.wait_for(page, "document.querySelector('form .detail')?.textContent.includes('5 minutes')", "the resize's question")
    shot(page, "resize-asked")
    asked = page.evaluate("() => document.querySelector('form')?.textContent ?? ''")
    say(f"asked: {asked}")
    check("the question says the restart", "about 5 minutes" in asked)
    check("the question says the disk cannot shrink", "cannot shrink again" in asked)
    check("the question says the price difference", "more a month" in asked)
    check("still nothing is resized", account.chosen == [])
    page.locator("form").get_by_role("button", name="Resize").click()
    DRIVE.wait_for(page, "!document.querySelector('.online .picker')", "the picker closed once chosen")
    check("Resize asks for the chosen type, with no place", account.chosen == [{"type": "cx53"}])
    account.chosen.clear()

def drive(browser: Browser) -> None:
    for kind, width, height, scheme in LOOKS:
        look(browser, kind, width, height, scheme)

if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "Settings > Online terminal is laid out in every look"))
