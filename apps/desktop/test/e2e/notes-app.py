import os

os.environ["ORDEN_APP"] = "notes"
os.environ["TAURI_ENV_PLATFORM"] = "android"
import harness  # noqa: E402
from harness import Drive  # noqa: E402
from playwright.sync_api import Browser  # noqa: E402

FOLDER = harness.APP / "dist-notes"
harness.build(FOLDER)
DRIVE = Drive(__file__, folder=FOLDER)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
WS = "window.ordenApp.workspace"
HELD = f"(name) => {WS}.files.find((one) => one.path.endsWith(name))?.path ?? null"
def held(page, name: str) -> str | None:
    return page.evaluate(HELD, name)
def drive(browser: Browser) -> None:
    page = DRIVE.page(
        browser,
        viewport={"width": 390, "height": 844},
        user_agent=PHONE_AGENT,
        has_touch=True,
        is_mobile=True,
    )
    page.on("requestfailed", lambda request: "/assets/" in request.url and wrong(f"not loaded: {request.url}"))
    page.on(
        "response",
        lambda response: "/assets/" in response.url
        and response.status >= 400
        and wrong(f"{response.status} for {response.url}"),
    )
    DRIVE.open(page)
    kinds = page.evaluate("() => [...window.ordenApp.hiddenKinds.shown]")
    if kinds != ["note", "canvas", "pages"]:
        wrong(f"Orden Notes offers {kinds}")
    hooks = page.evaluate("() => ['terminals', 'chats', 'time'].filter((one) => one in window.ordenApp)")
    if hooks:
        wrong(f"this is not the Orden Notes build: it carries {hooks}")
    page.evaluate(f"() => {WS}.showPanel('tree')")
    wait_for(page, f"{WS}.panel === 'tree'", "the notes list")
    before = page.evaluate(f"{WS}.active?.id")
    page.locator(".panels:not(.right) button[aria-label='New note']").tap()
    wait_for(
        page,
        f"{WS}.panel === null && {WS}.active?.id !== {before!r} && {WS}.active?.doc === ''",
        "a new note",
    )
    page.wait_for_timeout(500)
    page.keyboard.type("A kestrel hovers above the field.")
    wait_for(page, f"{WS}.active?.doc?.includes('hovers')", "the note written")
    written = page.evaluate(f"() => {WS}.save({WS}.active)")
    if not written:
        wrong("the new note was not saved into the space")
    wait_for(page, f"{WS}.active?.path && !{WS}.writing", "the note saved")
    page.evaluate(f"(path) => {WS}.rename(path, 'Falcon.md')", written)
    wait_for(page, f"{WS}.files.some((one) => one.name === 'Falcon.md')", "the note renamed")
    say(f"renamed to {held(page, '/Falcon.md')}")
    DRIVE.seed(page, "# Keeper\n\nStays where it is.", folder="Birds")
    wait_for(page, f"{WS}.files.some((one) => one.path.endsWith('/Birds/Keeper.md'))", "a folder")
    folder = page.evaluate("(path) => path.slice(0, path.lastIndexOf('/'))", held(page, "/Birds/Keeper.md"))
    page.evaluate(f"([from, into]) => {WS}.move(from, into)", [held(page, "/Falcon.md"), folder])
    wait_for(page, f"{WS}.files.some((one) => one.path.endsWith('/Birds/Falcon.md'))", "the note moved into the folder")
    wait_for(page, f"{WS}.active?.path?.endsWith('/Birds/Falcon.md')", "its tab following the move")
    page.evaluate(f"() => {{ {WS}.showPanel('search'); window.ordenApp.search.ask('hovers') }}")
    wait_for(
        page,
        "window.ordenApp.search.hits.some((one) => one.path.endsWith('/Birds/Falcon.md'))",
        "the note found by its words",
    )
    DRIVE.shot(page, "found")
    page.evaluate(f"(path) => {WS}.remove(path, false)", held(page, "/Birds/Falcon.md"))
    wait_for(page, f"!{WS}.files.some((one) => one.name === 'Falcon.md')", "the note deleted")
    page.evaluate(f"(path) => {WS}.remove(path, true)", folder)
    wait_for(page, f"!{WS}.files.some((one) => one.path.includes('/Birds'))", "the folder deleted")
    page.evaluate(f"() => {WS}.showPanel('tree')")
    page.wait_for_timeout(500)
    DRIVE.shot(page, "after")
    page.context.close()
raise SystemExit(
    DRIVE.run(drive, "Orden Notes makes, writes, renames, moves, finds and deletes a note on a phone, with no part missing")
)
