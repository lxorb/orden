import json
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__, dev=True)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot
NOTES = ["# ETHCC\n\nW.", "# advertisement ideas\n\nW.", "# Expenses\n\nW.", "# Sponsors\n\nW.", "# Old Branding\n\nW."]
REMOTE = """(root, role) => ({ id: 'r1', name: 'Kept', role, position: 0, icon: null, shared: true, notes: 5, createdAt: 0, updatedAt: 0,
  bookmarks: [], icons: { 'ETHCC.md': 'sparkles' }, graph: null, excluded: [], sort: 'manual',
  arranged: { '': ['ETHCC.md', 'advertisement ideas.md', 'Expenses.md', 'Sponsors.md'] },
  archived: { 'Old Branding.md': 1700000000000 } })"""
LOOK = """() => ({ rows: [...document.querySelectorAll('aside .row[data-path]')].map((one) => one.dataset.path.split('/').pop()),
  sort: window.ordenApp.workspace.sortMode })"""
def client(browser: Browser, who: str, role: str) -> dict:
    page: Page = DRIVE.page(browser, viewport={"width": 1100, "height": 640}, color_scheme="dark")
    DRIVE.open(page)
    DRIVE.seed(page, *NOTES)
    root = page.evaluate("() => window.ordenApp.workspace.activeSpace.root")
    page.evaluate(f"""() => {{ const app = window.ordenApp; app.sync.remoteIdFor = () => 'r1';
      const a = app.account; a.token = 'drive';
      if ({json.dumps(who)} === 'guest') a.guest = {{ id: 'g1', name: 'Guest' }}; else a.user = {{ id: 'u1', email: 'wren@example.com', name: 'Wren' }};
      a.spaces = [({REMOTE})({json.dumps(root)}, {json.dumps(role)})] }}""")
    page.wait_for_timeout(2500)
    seen = page.evaluate(LOOK)
    say(f"{who}/{role}: {seen}")
    page.context.close()
    return seen
def drive(browser: Browser) -> None:
    owner = client(browser, "user", "owner")
    if owner["sort"] != "manual" or (owner["rows"] or [None])[0] != "ETHCC.md" or "Old Branding.md" in owner["rows"]:
        wrong(f"the web owner does not take the space's order: {owner}")
    for who, role in (("guest", "write"), ("user", "read")):
        seen = client(browser, who, role)
        if seen != owner:
            wrong(f"{who}/{role} shows another tree than the owner: {seen} vs {owner}")
raise SystemExit(DRIVE.run(drive, "the web shows the same tree for an owner, a guest and a reader"))
