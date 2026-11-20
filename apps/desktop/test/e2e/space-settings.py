import json
import re
import sys
import time
import uuid
from playwright.sync_api import Browser, Page
import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
wrong = DRIVE.wrong
ORIGIN = harness.worker_origin()
SPACE = "Plans"
OWNER = "owner@example.com"
ADMIN = "admin@example.com"
WRITER = "writer@example.com"
READER = "reader@example.com"
SAM = "sam@example.com"
GUEST = "Windows wren"
PATIENCE = 40
PHONE = {
    "viewport": {"width": 390, "height": 844},
    "has_touch": True,
    "is_mobile": True,
    "device_scale_factor": 2,
    "user_agent": (
        "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
        " Chrome/131.0.0.0 Mobile Safari/537.36"
    ),
}
DESK = {"viewport": {"width": 1180, "height": 820}}
LOOK = """
() => {
  const pane = document.querySelector('[role="region"][aria-label="Settings"] .pane')
  if (!pane) return null
  const heads = [...pane.querySelectorAll('h3')]
  const card = (title) => heads.find((one) => one.textContent.trim() === title)?.nextElementSibling ?? null
  const general = card('General')
  const members = card('Members')
  const told = [...pane.querySelectorAll('.name')].find((one) => one.textContent.trim() === 'Agent instructions')
  const name = pane.querySelector('input[aria-label="Space name"]')
  const icon = general?.querySelector('button[aria-label="Choose an icon"]')
  const rows = members ? [...members.querySelectorAll('.row.person')] : []
  const after = (one, two) => !!one && !!two && !!(one.compareDocumentPosition(two) & Node.DOCUMENT_POSITION_FOLLOWING)
  return {
    head: (pane.querySelector('h2') ?? document.querySelector('[role="region"][aria-label="Settings"] header h2'))?.textContent.trim() ?? null,
    heads: heads.map((one) => one.textContent.trim()),
    generalFirst: after(general, members),
    toldAfter: after(members, told),
    name: name ? { value: name.value, readonly: name.readOnly } : null,
    icon: icon ? { disabled: icon.disabled } : null,
    seats: members?.querySelector('.seats')?.textContent.trim() ?? null,
    bones: members ? members.querySelectorAll('.bone').length : -1,
    rows: rows.map((row) => {
      const pick = row.querySelector('button[role="combobox"][aria-label="Role"]')
      return {
        who: row.querySelector('.name')?.textContent.replace(/\\s+/g, ' ').trim() ?? '',
        owner: !!row.querySelector('.fixed'),
        you: !!row.querySelector('.you'),
        role: pick?.textContent.trim() ?? null,
        disabled: pick ? pick.disabled : null,
      }
    }),
  }
}
"""
INSET = """
() => {
  const pane = document.querySelector('[role="region"][aria-label="Settings"] .pane')
  const card = (title) => [...(pane?.querySelectorAll('h3') ?? [])].find((one) => one.textContent.trim() === title)?.nextElementSibling ?? null
  const words = (el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    return range.getBoundingClientRect()
  }
  const seen = []
  for (const [title, picks] of [
    ['General', [...(card('General')?.querySelectorAll('.what') ?? [])]],
    ['Members', [card('Members')?.querySelector('.seats'), card('Members')?.querySelector('.row.person .who')]],
  ]) {
    const box = card(title)?.getBoundingClientRect()
    for (const el of picks) {
      if (!box || !el) continue
      const at = words(el)
      seen.push({ title, text: el.textContent.trim(), left: Math.round(at.left - box.left), right: Math.round(box.right - at.right) })
    }
  }
  return seen
}
"""
class Worker(harness.Worker):
    def __init__(self) -> None:
        super().__init__(DRIVE)
def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(50)
    raise SystemExit(f"gave up waiting for {what}")
def fresh(browser: Browser, label: str, token: str, device: dict) -> Page:
    context = browser.new_context(**device)
    context.add_init_script(f"localStorage.setItem('orden:session', {json.dumps(token)})")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "() => !!window.ordenApp", f"[{label}] the app to start")
    return page
def arrived(page: Page, label: str, space_id: str) -> str:
    return wait_for(
        page,
        "() => { const app = window.ordenApp; if (!app.account.user) return null;"
        f" const space = app.workspace.spaces.find((one) => app.sync.remoteIdFor(one.root) === {json.dumps(space_id)});"
        " return space ? space.root : null }",
        f"[{label}] the shared space to arrive",
    )
def space_row(page: Page):
    page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")
    header = page.locator("aside .head button.name")
    header.wait_for(state="visible", timeout=10_000)
    page.wait_for_timeout(400)
    if not page.locator("aside .spaces").count():
        header.click()
    rows = page.locator("aside .spaces .line")
    rows.first.wait_for(state="visible", timeout=10_000)
    return rows.filter(has_text=SPACE).first
def through_the_menu(page: Page) -> None:
    space_row(page).locator(".more").click()
    page.wait_for_selector('[role="menu"]:visible', timeout=10_000)
    item = page.get_by_role("menuitem", name="Settings", exact=True)
    item.wait_for(state="visible", timeout=10_000)
    item.click()
    page.evaluate("() => window.ordenApp.workspace.closePanel('left')")
    page.wait_for_timeout(300)
def looked(page: Page, label: str, people: int) -> dict:
    return wait_for(
        page,
        f"() => {{ const seen = ({LOOK})(); return seen && seen.bones === 0 && seen.rows.length === {people + 1}"
        " && seen.name ? seen : null }",
        f"[{label}] the space section with its {people} members",
    )
def row(seen: dict, who: str) -> dict:
    found = [one for one in seen["rows"] if who in one["who"]]
    return found[0] if found else {"who": who, "role": None, "disabled": None, "owner": False, "you": False}
def choices(page: Page, who: str) -> list[str]:
    pick = members(page).locator(".row.person", has_text=who).get_by_role("combobox", name="Role")
    pick.click()
    listed = page.get_by_role("listbox", name="Role")
    listed.wait_for(state="visible", timeout=5_000)
    said = listed.get_by_role("option").evaluate_all("(all) => all.map((one) => one.textContent.trim())")
    page.keyboard.press("Escape")
    listed.wait_for(state="hidden", timeout=5_000)
    return said
def choose(page: Page, who: str, label: str) -> None:
    members(page).locator(".row.person", has_text=who).get_by_role("combobox", name="Role").click()
    page.get_by_role("listbox", name="Role").get_by_role("option", name=label).click()
def members(page: Page):
    return page.locator('[role="region"][aria-label="Settings"] .pane h3:text-is("Members") + .card')
def the_same(seen: dict, label: str) -> None:
    if seen["head"] != SPACE:
        wrong(f"[{label}] the section is headed {seen['head']!r}, not the space's name {SPACE!r}")
    if seen["heads"][:2] != ["General", "Members"]:
        wrong(f"[{label}] the cards are {seen['heads']}, not General then Members")
    if not seen["generalFirst"]:
        wrong(f"[{label}] General is not before Members")
    if not seen["toldAfter"]:
        wrong(f"[{label}] the agent instructions are not after Members")
    if not re.fullmatch(r"\d+ of \d+ places used", seen["seats"] or ""):
        wrong(f"[{label}] Members says {seen['seats']!r} rather than how many places are used")
    owner = seen["rows"][0] if seen["rows"] else {}
    if not owner.get("owner") or OWNER not in owner.get("who", ""):
        wrong(f"[{label}] the first row is {owner!r}, not the owner")
def owner_side(browser: Browser, token: str, space_id: str, sent: list[tuple[str, str, str]]) -> None:
    page = fresh(browser, "owner", token, DESK)
    page.on(
        "request",
        lambda asked: sent.append((asked.method, asked.url, asked.post_data or ""))
        if "/share/members/" in asked.url and asked.method in ("PATCH", "DELETE")
        else None,
    )
    arrived(page, "owner", space_id)
    through_the_menu(page)
    seen = looked(page, "owner", 5)
    the_same(seen, "owner")
    if not seen["rows"][0]["you"]:
        wrong("[owner] the owner's own row does not say (you)")
    if seen["name"]["readonly"]:
        wrong("[owner] the name cannot be changed")
    if seen["icon"] is None or seen["icon"]["disabled"]:
        wrong("[owner] the icon cannot be chosen")
    for one in (ADMIN, WRITER, READER, SAM, GUEST):
        if row(seen, one)["disabled"] is not False:
            wrong(f"[owner] the role of {one} cannot be changed: {row(seen, one)!r}")
    for one in (WRITER, READER):
        got = choices(page, one)
        if not {"View", "Write", "Admin", "Remove"} <= set(got):
            wrong(f"[owner] {one} may be made only {got}")
    got = choices(page, GUEST)
    if "Admin" in got or not {"View", "Write", "Remove"} <= set(got):
        wrong(f"[owner] the guest may be made {got}, which should be View, Write and Remove only")
    if row(seen, ADMIN)["role"] != "Admin":
        wrong(f"[owner] {ADMIN} shows as {row(seen, ADMIN)['role']!r}, not Admin")
    say("the owner sees the space by name, General before Members, and every role open")
    page.evaluate("() => document.activeElement?.blur?.()")
    DRIVE.shot(page, "ui2284-desktop-light")
    page.evaluate("() => window.ordenApp.theme.setScheme('dark')")
    page.wait_for_timeout(400)
    DRIVE.shot(page, "ui2284-desktop-dark")
    page.evaluate("() => window.ordenApp.theme.setScheme('light')")
    page.get_by_role("button", name="Choose an icon").click()
    try:
        page.locator('[role="dialog"][aria-label="Choose an icon"]').wait_for(state="visible", timeout=5_000)
        say("the icon button opens the icon picker")
    except Exception:
        wrong("[owner] the icon button did not open the icon picker")
    page.keyboard.press("Escape")
    page.evaluate("() => window.ordenApp.iconChoice?.close?.()")
    page.wait_for_timeout(300)
    choose(page, SAM, "Admin")
    wait_for(page, f"() => ({LOOK})()?.rows.some((one) => one.who.includes({json.dumps(SAM)}) && one.role === 'Admin')", f"[owner] {SAM} to show as Admin")
    patched = [one for one in sent if one[0] == "PATCH" and "sam%40example.com" in one[1]]
    if not patched or json.loads(patched[-1][2] or "{}").get("role") != "admin":
        wrong(f"[owner] choosing Admin sent {patched!r}, not a PATCH with role admin")
    else:
        say(f"Admin sends PATCH {patched[-1][1].split('/v1', 1)[-1]} {patched[-1][2]}")
    choose(page, SAM, "Remove")
    wait_for(page, f"() => !({LOOK})()?.rows.some((one) => one.who.includes({json.dumps(SAM)}))", f"[owner] {SAM} to go")
    if not [one for one in sent if one[0] == "DELETE" and "sam%40example.com" in one[1]]:
        wrong("[owner] Remove sent no DELETE")
    else:
        say("Remove sends DELETE and the row goes")
    page.context.close()
    phone = fresh(browser, "owner phone", token, PHONE)
    root = arrived(phone, "owner phone", space_id)
    phone.evaluate("(root) => window.ordenApp.settings.show('space', root)", root)
    looked(phone, "owner phone", 4)
    phone.wait_for_timeout(400)
    inside = phone.evaluate(INSET)
    if len(inside) < 4:
        wrong(f"[owner phone] found only {inside} to measure in the cards")
    for one in inside:
        if one["left"] < 8 or one["right"] < 0:
            wrong(f"[owner phone] {one['text']!r} in {one['title']} starts {one['left']}px from the card's left edge and ends {one['right']}px inside its right edge")
    say(f"on a phone the words sit {sorted({one['left'] for one in inside})}px inside the cards")
    phone.evaluate("() => document.activeElement?.blur?.()")
    DRIVE.shot(phone, "ui2284-phone")
    phone.context.close()
def member_side(browser: Browser, label: str, token: str, space_id: str, names: bool, icons: bool, manages: bool) -> None:
    page = fresh(browser, label, token, DESK)
    root = arrived(page, label, space_id)
    page.evaluate("(root) => window.ordenApp.settings.show('space', root)", root)
    seen = looked(page, label, 4)
    the_same(seen, label)
    if seen["rows"][0]["you"]:
        wrong(f"[{label}] the owner's row says (you)")
    if seen["name"]["readonly"] == names:
        wrong(f"[{label}] the name is {'readonly' if seen['name']['readonly'] else 'open'}")
    if seen["icon"] is None or seen["icon"]["disabled"] == icons:
        wrong(f"[{label}] the icon button is {seen['icon']!r}")
    for one in seen["rows"][1:]:
        if one["disabled"] == manages:
            wrong(f"[{label}] the role of {one['who']} is {'shut' if one['disabled'] else 'open'}")
    say(f"the {label} may{'' if names else ' not'} rename, may{'' if icons else ' not'} choose the icon, may{'' if manages else ' not'} change roles")
    page.context.close()
def joined(space: str, email: str, role: str, admin: int, now: int) -> str:
    return (
        "insert into space_members (space_id, email, item, role, admin, joined_at, created_at)"
        f" values ('{space}', '{email}', '', '{role}', {admin}, {now}, {now});"
    )
def steps(browser: Browser) -> None:
    worker = Worker()
    worker.start()
    owner = worker.account(OWNER)
    admin = worker.account(ADMIN)
    writer = worker.account(WRITER)
    reader = worker.account(READER)
    space = harness.request("/v1/spaces", owner, {"name": SPACE})["space"]["id"]
    now = int(time.time() * 1000)
    guest = uuid.uuid4().hex[:12]
    worker.sql(
        joined(space, ADMIN, "write", 1, now)
        + joined(space, WRITER, "write", 0, now)
        + joined(space, READER, "read", 0, now)
        + joined(space, SAM, "write", 0, now)
        + f"insert into guests (id, name, created_at) values ('{guest}', '{GUEST}', {now});"
        + "insert into guest_members (space_id, guest_id, item, role, joined_at, created_at)"
        f" values ('{space}', '{guest}', '', 'write', {now}, {now});"
    )
    say(f"{OWNER} holds {SPACE} with an admin, a writer, a reader, {SAM} and a guest")
    sent: list[tuple[str, str, str]] = []
    owner_side(browser, owner, space, sent)
    member_side(browser, "admin", admin, space, names=True, icons=True, manages=True)
    member_side(browser, "writer", writer, space, names=False, icons=True, manages=False)
    member_side(browser, "reader", reader, space, names=False, icons=False, manages=False)
sys.exit(DRIVE.run(steps, "the space section of Settings shows the space's own settings, each as its role allows"))
