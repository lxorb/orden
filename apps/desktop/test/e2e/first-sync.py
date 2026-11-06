from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

from playwright.sync_api import Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
SHOTS = DRIVE.shots
ORIGIN = harness.worker_origin()

EMAIL = "first-sync@example.com"
SPACE = "Account"

NOTES = 200

LATENCY = 300
DOWN = 1_500_000 / 8
UP = 750_000 / 8

PATIENCE = 240

def request(path: str, token: str | None = None, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    headers = {}
    if data is not None:
        headers["content-type"] = "application/json"
    if token:
        headers["authorization"] = f"Bearer {token}"

    call = urllib.request.Request(f"{ORIGIN}{path}", data=data, headers=headers)
    with urllib.request.urlopen(call, timeout=30) as answer:
        return json.loads(answer.read() or b"null")

class Worker(harness.Worker):

    def __init__(self) -> None:
        super().__init__(DRIVE)

    def account(self) -> str:  # type: ignore[override]
        return super().account(EMAIL)

def body(at: int) -> str:
    return (
        "---\nicon: rocket\nicon-color: violet\naliases:\n"
        f"  - note {at} elsewhere\n---\n\n"
        f"# Note {at}\n\n#wind and a line about the weather.\n\n"
        f"See [[note-{(at + 3) % NOTES:04d}]].\n\n"
        "## What went in\n\n- Pressure on the pen\n- Slides out of a note\n"
    )

STATE = """
() => {
  const ws = window.nibApp?.workspace
  if (!ws) return { app: false }

  return {
    spaces: ws.spaces.map((one) => one.name),
    open: ws.activeSpace?.name ?? null,
    notes: ws.notes.length,
    coming: window.nibApp.arriving.coming?.size ?? null,
    rows: document.querySelectorAll('aside .row').length,
    // How many rows the tree has, as against how many of them are drawn: the list
    // draws the ones that fit. See Tree.svelte.
    onTree: Number(
      document.querySelector('aside [aria-setsize]')?.getAttribute('aria-setsize') ?? 0,
    ),
    waiting: !!document.querySelector('.arriving'),
    sync: window.nibApp.sync.status,
  }
}
"""

def when(page: Page, script: str, what: str) -> float:
    try:
        page.wait_for_function(script, timeout=PATIENCE * 1000)
    except Exception:
        say(f"gave up waiting for {what}: {page.evaluate(STATE)}")
        raise

    taken = page.evaluate("() => performance.now()")
    say(f"{what}: {taken:.0f}ms  {page.evaluate(STATE)}")
    return taken

def slow(page: Page) -> None:
    session = page.context.new_cdp_session(page)
    session.send("Network.enable")
    session.send(
        "Network.emulateNetworkConditions",
        {
            "offline": False,
            "latency": LATENCY,
            "downloadThroughput": DOWN,
            "uploadThroughput": UP,
        },
    )

def drive(browser, token: str) -> dict[str, float]:
    context = browser.new_context(viewport={"width": 1280, "height": 860})
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"page error: {error}"))

    page.goto(ORIGIN, wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp", timeout=60000)
    page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=60000)
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.evaluate(
        "async () => { const ws = window.nibApp.workspace;"
        " for (const one of [...ws.spaces]) await ws.deleteSpace(one.id) }"
    )
    page.wait_for_function("() => window.nibApp.workspace.spaces.length === 0", timeout=60000)
    page.wait_for_timeout(1500)

    page.evaluate(f"() => localStorage.setItem('nib:session', {json.dumps(token)})")
    slow(page)

    page.reload(wait_until="commit")

    names = when(
        page,
        "() => Number(document.querySelector('aside [aria-setsize]')"
        f"?.getAttribute('aria-setsize') ?? 0) >= {NOTES}",
        "every name on the tree",
    )
    unblocked = when(
        page,
        "() => !!window.nibApp && !document.querySelector('.arriving')",
        "the app to be usable",
    )
    words = when(
        page,
        f"() => window.nibApp.workspace.notes.length >= {NOTES}"
        " && (window.nibApp.arriving.coming?.size ?? 0) === 0",
        "every body to land",
    )

    context.close()
    return {"names": names, "unblocked": unblocked, "words": words}

def main() -> int:
    tag = sys.argv[1] if len(sys.argv) > 1 else "now"

    worker = Worker()
    with DRIVE.session() as browser:
        worker.start()
        token = worker.account()
        space = request("/v1/spaces", token, {"name": SPACE})["space"]
        for at in range(NOTES):
            request(
                f"/v1/spaces/{space['id']}/notes",
                token,
                {"path": f"note-{at:04d}.md", "content": body(at)},
            )
        say(f"the account holds {NOTES} notes in {SPACE}")

        taken = drive(browser, token)

    print()
    print(f"{tag}, signing in to {NOTES} notes on a {LATENCY}ms line:")
    for key, words in [
        ("names", "every name on the tree"),
        ("unblocked", "the app usable, the overlay gone"),
        ("words", "every body landed"),
    ]:
        print(f"  {words:44} {taken[key]:7.0f}ms")

    print()
    print(json.dumps({key: round(value) for key, value in taken.items()}))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
