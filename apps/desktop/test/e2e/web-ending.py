import io
import json
import zipfile
from datetime import date, timedelta
from pathlib import Path
from playwright.sync_api import Browser, Page
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for, shot = DRIVE.say, DRIVE.wrong, DRIVE.wait_for, DRIVE.shot
NOTICE = ".toast[data-web-ending]"
WORDS = "Orden on the web ends on <date>. Get Orden for your desktop, or Orden Notes, Todo, Chat and Track for your phone."
ASKED = "localStorage.setItem('orden:web-ending', 'show')"
PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
PHONE = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
    " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
)
SAID = f"() => document.querySelector('{NOTICE} p')?.textContent ?? null"
LABELS = f"() => [...document.querySelectorAll('{NOTICE} button')].map((one) => one.textContent.trim())"
def opened(browser: Browser, scheme: str, phone: bool, asked: bool = True, path: str = "/") -> Page:
    context = browser.new_context(
        service_workers="block",
        color_scheme=scheme,
        accept_downloads=True,
        viewport={"width": 390, "height": 844} if phone else {"width": 1280, "height": 800},
        has_touch=phone,
        is_mobile=phone,
        **({"user_agent": PHONE} if phone else {}),
    )
    if asked:
        context.add_init_script(ASKED)
    context.route("https://orden.so/**", lambda route: route.fulfill(status=200, content_type="text/html", body="<title>orden.so</title>"))
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page, path)
    return page
def absent(page: Page, where: str) -> None:
    page.wait_for_timeout(2500)
    if page.locator(NOTICE).count():
        wrong(f"{where}: the notice shows")
def looks(browser: Browser) -> None:
    for scheme in ("light", "dark"):
        for phone in (False, True):
            page = opened(browser, scheme, phone)
            page.wait_for_selector(NOTICE, timeout=15000)
            page.wait_for_timeout(600)
            said = page.evaluate(SAID)
            if said != WORDS:
                wrong(f"the notice says {said!r}")
            labels = page.evaluate(LABELS)
            if labels != ["Dismiss", "Export", "Get Orden"]:
                wrong(f"the notice offers {labels}")
            box = page.locator(NOTICE).bounding_box()
            wide = 390 if phone else 1280
            if not box or box["x"] < 0 or box["x"] + box["width"] > wide:
                wrong(f"the notice runs off a {wide}px screen: {box}")
            shot(page, f"banner2286-{scheme}-{'phone' if phone else 'desktop'}")
            page.context.close()
def exported(browser: Browser) -> None:
    page = opened(browser, "light", False)
    page.wait_for_selector(NOTICE, timeout=15000)
    root = page.evaluate("() => window.ordenApp.workspace.activeSpace.root")
    page.evaluate(
        """async ([path, data]) => {
          const db = await new Promise((done, failed) => {
            const asked = indexedDB.open('orden')
            asked.onsuccess = () => done(asked.result)
            asked.onerror = () => failed(asked.error)
          })
          await new Promise((done, failed) => {
            const change = db.transaction(['assets', 'stats'], 'readwrite')
            change.objectStore('assets').put({ path, type: 'image/png', data, modified: 1 })
            change.objectStore('stats').put({ path, modified: 1, created: 1, size: data.length })
            change.oncomplete = done
            change.onerror = () => failed(change.error)
          })
          db.close()
        }""",
        [f"{root}/assets/kept.png", PIXEL],
    )
    DRIVE.seed(page, "# Worth keeping\n\nWords that must be in the export.\n")
    with page.expect_download(timeout=30000) as download:
        page.locator(f"{NOTICE} button", has_text="Export").click()
    saved = Path(download.value.path())
    name = download.value.suggested_filename
    with zipfile.ZipFile(io.BytesIO(saved.read_bytes())) as archive:
        names = sorted(archive.namelist())
        say(f"{name} holds {json.dumps(names)}")
        space = root.strip("/")
        note = next((one for one in names if one.startswith(f"{space}/Worth keeping")), None)
        if name != "Orden export.zip":
            wrong(f"the export is called {name!r}")
        if not note or b"Words that must be in the export." not in archive.read(note):
            wrong(f"the note is not in the export: {names}")
        if f"{space}/assets/kept.png" not in names:
            wrong(f"the attachment is not in the export: {names}")
    wait_for(page, f"({SAID})()?.startsWith('Your spaces were saved as Orden export.zip.')", "the notice to say it saved")
    labels = page.evaluate(LABELS)
    if labels != ["Dismiss", "Get Orden"]:
        wrong(f"after the export the notice offers {labels}")
    page.wait_for_timeout(400)
    shot(page, "banner2286-light-desktop-exported")
    with page.context.expect_page() as away:
        page.locator(f"{NOTICE} button", has_text="Get Orden").click()
    went = away.value.url
    say(f"Get Orden opens {went}")
    if not went.startswith("https://orden.so/download"):
        wrong(f"Get Orden went to {went!r}")
    away.value.close()
    page.locator(f"{NOTICE} button", has_text="Dismiss").click()
    page.wait_for_timeout(600)
    if page.locator(NOTICE).count():
        wrong("Dismiss left the notice up")
    page.reload(wait_until="domcontentloaded")
    DRIVE.ready(page)
    absent(page, "dismissed today, after a reload")
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    page.evaluate("(day) => localStorage.setItem('orden:web-ending-dismissed', day)", yesterday)
    page.reload(wait_until="domcontentloaded")
    DRIVE.ready(page)
    if not DRIVE.waited(page, f"document.querySelector('{NOTICE}')", "the notice to come back the next day", 15):
        wrong("dismissed yesterday, the notice did not come back")
    page.context.close()
def quiet(browser: Browser) -> None:
    page = opened(browser, "light", False, asked=False)
    absent(page, "a drive that did not ask")
    page.context.close()
    page = opened(browser, "light", False, path="/?demo")
    absent(page, "the demo")
    page.context.close()
def drive(browser: Browser) -> None:
    quiet(browser)
    looks(browser)
    exported(browser)
raise SystemExit(DRIVE.run(drive, "the web app says it is ending, saves every space on Export and stays out of the demo and of other drives"))
