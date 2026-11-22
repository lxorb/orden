import base64
import json
import sys
from playwright.sync_api import Page
from harness import Drive, HERE, SIGNED_IN

DRIVE = Drive(__file__)
say = DRIVE.say
PICKER = ".sheet"
FAVICONS = HERE.parent.parent / "src" / "lib" / "icons" / "test" / "favicons"
SITES = [
    ("github.com", "GitHub", "github.com"),
    ("google.com", "Google", "google.com"),
    ("news.ycombinator.com", "Hacker News", "news.ycombinator.com"),
    ("duck.example", "Duck Example", "duckduckgo.com"),
]
HELD = json.dumps(
    [
        {
            "site": site,
            "label": label,
            "seen": 1763800000000 - at * 1000,
            "hash": None,
            "picture": "data:image/png;base64," + base64.b64encode((FAVICONS / f"{file}.png").read_bytes()).decode(),
        }
        for at, (site, label, file) in enumerate(SITES)
    ]
)
SEED = """
async () => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root
  if (ws.panel !== 'tree') ws.showPanel('tree')
  for (const name of ['Reading', 'Code']) await ws.noteFrom(`# ${name}\\n\\nsome words\\n`, root)
  await ws.loadTree()
  const paths = ['Reading', 'Code'].map((name) => ws.files.find((one) => one.name.startsWith(name)).path)
  for (const path of paths) await ws.openEntry(path, { activate: true })
  return paths
}
"""
WEB = f"""
() => {{
  const rows = [...document.querySelectorAll('{PICKER} .grid .row')]
  const head = rows.findIndex((one) => one.textContent.trim() === 'Web icons')
  if (head < 0) return null
  return [...(rows[head + 1]?.querySelectorAll('button.cell') ?? [])].map((cell) => ({{
    label: cell.getAttribute('aria-label'),
    kind: cell.querySelector('img') ? 'picture' : cell.querySelector('.masked') ? 'mask' : cell.querySelector('svg') ? 'drawn' : 'none',
  }}))
}}
"""
ONE_COLOUR = f"() => {{ const web = ({WEB.strip()})(); return web?.length === {len(SITES)} && web.every((one) => one.kind === 'mask' || one.kind === 'drawn') && web }}"
PLAIN = f"() => [...document.querySelectorAll('{PICKER} button.clear')].some((one) => one.textContent.includes('plain mark'))"
def check(fine: bool, what: str) -> None:
    say(("ok   " if fine else "FAIL ") + what)
    if not fine:
        DRIVE.failures.append(what)
def pick(page: Page, path: str) -> None:
    page.evaluate("(path) => window.ordenApp.iconChoice.file(path)", path)
    page.locator(f"{PICKER} .grid button.cell").first.wait_for(timeout=40_000)
    page.wait_for_timeout(400)
def walk(page: Page, scheme: str) -> None:
    page.evaluate(SIGNED_IN)
    reading, code = page.evaluate(SEED)
    page.wait_for_timeout(500)
    pick(page, reading)
    check(not page.evaluate(PLAIN), f"[{scheme}] no 'Use the plain mark instead' for a note that wears no icon")
    coloured = DRIVE.wait_for(page, WEB, f"[{scheme}] the web icons")
    check(all(one["kind"] == "picture" for one in coloured), f"[{scheme}] web icons in colour: {coloured}")
    DRIVE.shot(page, f"{scheme}-1-colour")
    page.locator(f"{PICKER} label.tick input").check()
    plain = DRIVE.wait_for(page, ONE_COLOUR, f"[{scheme}] every web icon in one colour")
    say(f"[{scheme}] in one colour: {plain}")
    check(plain[0]["kind"] == "drawn", f"[{scheme}] GitHub takes its Simple Icons mark")
    check(plain[3]["kind"] == "mask", f"[{scheme}] a site without a Simple Icons mark takes its silhouette")
    page.wait_for_timeout(300)
    DRIVE.shot(page, f"{scheme}-2-one-colour")
    page.locator(f'{PICKER} .grid button.cell[aria-label="duck example"]').first.click()
    worn = DRIVE.wait_for(
        page,
        "() => !document.querySelector('.sheet .grid') && document.querySelectorAll('.masked').length",
        f"[{scheme}] the note wearing the one-colour web icon",
    )
    check(worn > 0, f"[{scheme}] the note wears the silhouette ({worn} drawn)")
    pick(page, code)
    page.locator(f"{PICKER} label.tick input").check()
    DRIVE.wait_for(page, ONE_COLOUR, f"[{scheme}] one colour again")
    page.locator(f'{PICKER} .grid button.cell[aria-label="github"]').first.click()
    page.wait_for_timeout(800)
    DRIVE.shot(page, f"{scheme}-3-worn")
    pick(page, reading)
    check(page.evaluate(PLAIN), f"[{scheme}] 'Use the plain mark instead' shows for a note that wears a chosen icon")
    page.keyboard.press("Escape")
def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ["light", "dark"]:
            context = browser.new_context(
                viewport={"width": 1180, "height": 760}, color_scheme=scheme, device_scale_factor=2
            )
            context.add_init_script(f"localStorage.setItem('orden:site-icons', {json.dumps(HELD)})")
            context.route("**/api/**", lambda route: route.abort())
            page = context.new_page()
            page.on("pageerror", lambda error: say(f"page error: {error}"))
            DRIVE.open(page)
            try:
                walk(page, scheme)
            finally:
                context.close()
    return DRIVE.verdict("web icons take a one-colour form; the plain mark is offered only when it applies")
sys.exit(main())
