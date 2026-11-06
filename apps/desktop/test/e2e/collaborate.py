from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
SHOTS = DRIVE.shots
ORIGIN = harness.worker_origin()

EMAIL = "together@example.com"
SPACE = "Notes"
NOTE = "together.md"
OPENING = "# Together\n\nthe first line\n"

PATIENCE = 40

CEILING = 1500

def request(path: str, token: str | None = None, body: dict | None = None, method: str | None = None):
    data = None if body is None else json.dumps(body).encode()
    headers = {}
    if data is not None:
        headers["content-type"] = "application/json"
    if token:
        headers["authorization"] = f"Bearer {token}"

    call = urllib.request.Request(
        f"{ORIGIN}{path}",
        data=data,
        headers=headers,
        method=method or ("GET" if data is None else "POST"),
    )
    with urllib.request.urlopen(call, timeout=20) as answer:
        return json.loads(answer.read() or b"null")

class Worker(harness.Worker):

    def __init__(self) -> None:
        super().__init__(DRIVE)

    def account(self) -> str:  # type: ignore[override]
        return super().account(EMAIL)

def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")

def long_note() -> str:
    paragraph = (
        "The room holds the note as one document, so two devices that both wrote "
        "end up with the same words and neither is asked to choose.\n\n"
    )

    words = "# A long note\n\n"
    at = 0
    while len(words) < 100 * 1024:
        words += f"## Part {at}\n\n{paragraph}"
        at += 1

    return words

def fresh(browser: Browser, token: str, label: str) -> Page:
    page = signed_in(browser, token, label)
    wait_for(
        page,
        f"() => window.nibApp.workspace.spaces.some((one) => one.name === {json.dumps(SPACE)})",
        f"[{label}] the space to arrive",
    )
    return page

def signed_in(browser: Browser, token: str, label: str) -> Page:
    context = browser.new_context(viewport={"width": 1100, "height": 700})
    context.add_init_script(f"localStorage.setItem('nib:session', {json.dumps(token)})")

    page = context.new_page()
    page.on("console", lambda message: note_console(label, message))
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", f"[{label}] the app to start")
    return page

def note_console(label: str, message) -> None:
    if message.type in ("error", "warning"):
        say(f"[{label}] {message.type}: {message.text[:200]}")

def opened(page: Page, label: str, note_id: str) -> None:
    wait_for(
        page,
        f"() => window.nibApp.workspace.spaces.some((one) => one.name === {json.dumps(SPACE)})",
        f"[{label}] the space to arrive",
    )

    listed = (
        "() => {"
        "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
        "  return walk(window.nibApp.workspace.tree)"
        f"    .includes('/{SPACE}/{NOTE}')"
        "}"
    )
    wait_for(page, listed, f"[{label}] the note to arrive")

    page.evaluate(f"() => window.nibApp.workspace.open('/{SPACE}/{NOTE}')")
    wait_for(page, "() => !!document.querySelector('.cm-content')", f"[{label}] the editor")
    wait_for(
        page,
        f"() => window.nibApp.rooms.carries({json.dumps(note_id)})",
        f"[{label}] the note to join its room",
    )

def words(page: Page) -> str:
    return page.evaluate(
        "() => { window.nibApp.workspace.flush(); return window.nibApp.workspace.active?.doc ?? '' }"
    )

FRONT = "window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)"

def held_at_edge(page: Page, other: Page, side: str, label: str, failures: list[str]) -> None:
    other.evaluate(
        f"() => {{ const view = {FRONT};"
        f" view.dispatch({{ selection: {{ anchor: {'view.state.doc.length' if side == 'below' else '0'} }} }});"
        " view.focus() }"
    )
    page.evaluate(
        f"() => {{ const view = {FRONT}; view.dispatch({{ selection: {{ anchor: "
        f"{'0' if side == 'below' else 'view.state.doc.length'} }}, scrollIntoView: true }}) }}"
    )
    try:
        wait_for(
            page,
            f"() => !!document.querySelector('.cm-nib-held.is-{side} .cm-nib-held-name')",
            f"[{label}] the other caret held {side} the page",
        )
    except SystemExit as gave_up:
        failures.append(str(gave_up))
        return

    held = page.evaluate(
        f"""() => {{
            const name = document.querySelector('.cm-nib-held.is-{side} .cm-nib-held-name')
            const box = name.getBoundingClientRect()
            const page = {FRONT}.scrollDOM.getBoundingClientRect()
            return {{ name: name.textContent, top: box.top - page.top, bottom: page.bottom - box.bottom,
                      inside: box.top >= Math.max(page.top, 0) && box.bottom <= Math.min(page.bottom, innerHeight) }}
        }}"""
    )
    say(f"[{label}] the other caret, out of sight {side}: {json.dumps(held)}")
    page.screenshot(path=str(SHOTS / f"held-{side}-{label}.png"))
    if not held["name"]:
        failures.append(f"[{label}] a caret held {side} the page carried no name")
    if not held["inside"]:
        failures.append(f"[{label}] a caret held {side} the page was drawn past it")
    if held["top" if side == "above" else "bottom"] > 40:
        failures.append(f"[{label}] a caret held {side} the page is not at that edge: {held}")

    page.locator(f".cm-nib-held.is-{side} .cm-nib-held-name").first.click()
    try:
        wait_for(
            page,
            f"""() => {{
                if (document.querySelector('.cm-nib-held.is-{side} .cm-nib-held-name')) return false
                const caret = document.querySelector('.cm-nib-caret')
                if (!caret) return false
                const box = caret.getBoundingClientRect()
                const page = {FRONT}.scrollDOM.getBoundingClientRect()
                return box.top >= page.top && box.bottom <= Math.min(page.bottom, innerHeight)
            }}""",
            f"[{label}] the page to go to the caret held {side} it",
        )
        say(f"[{label}] pressing the name held {side} the page went to the caret")
    except SystemExit as gave_up:
        failures.append(str(gave_up))

def place(page: Page, at: int) -> None:
    page.click(".cm-content")
    page.evaluate(
        "(at) => {"
        "  window.nib.dispatch({ selection: { anchor: Math.min(at, window.nib.state.doc.length) } });"
        "  window.nib.focus()"
        "}",
        at,
    )

def type_at(page: Page, at: int, said: str) -> None:
    place(page, at)
    page.keyboard.type(said, delay=12)

def echo(one: Page, two: Page, at: int, said: str, label: str) -> float:
    two.evaluate(
        "(wanted) => {"
        "  window.__arrived = null;"
        "  const look = () => {"
        "    window.nibApp.workspace.flush();"
        "    if ((window.nibApp.workspace.active?.doc ?? '').includes(wanted)) {"
        "      window.__arrived = Date.now();"
        "      return"
        "    }"
        "    setTimeout(look, 1)"
        "  };"
        "  look()"
        "}",
        said,
    )

    place(one, at)
    sent = one.evaluate("() => Date.now()")
    one.keyboard.type(said)

    until = time.monotonic() + PATIENCE
    while time.monotonic() < until:
        arrived = two.evaluate("() => window.__arrived")
        if arrived:
            took = arrived - sent
            say(f"{label}: {took} ms")
            return float(took)
        two.wait_for_timeout(10)

    raise SystemExit(f"{label} never arrived. one says {words(one)!r}, two says {words(two)!r}")

def main() -> int:
    worker = Worker()
    failures: list[str] = []

    with DRIVE.session(
        args=[
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
        ],
    ) as browser:
        worker.start()

        token = worker.account()
        space = request("/v1/spaces", token, {"name": SPACE})["space"]
        note = request(
            f"/v1/spaces/{space['id']}/notes", token, {"path": NOTE, "content": OPENING}
        )["note"]
        note_id = note["id"]
        say(f"the account holds {SPACE}/{NOTE} as {note_id}")

        one = signed_in(browser, token, "one")
        opened(one, "one", note_id)
        two = signed_in(browser, token, "two")
        opened(two, "two", note_id)

        say("both browsers are in the room")

        for page, label in ((one, "one"), (two, "two")):
            wait_for(
                page,
                "() => Object.values(window.nibApp.rooms.present).some((n) => n > 0)",
                f"[{label}] the other device to appear",
            )
        say("each browser can see that the other is there")

        crossings = [
            echo(one, two, len(OPENING) + turn, str(turn + 1), "one to two")
            for turn in range(5)
        ]
        coming_back = [
            echo(two, one, turn, str(turn + 6), "two to one") for turn in range(5)
        ]
        there = sorted(crossings)[len(crossings) // 2]
        returning = sorted(coming_back)[len(coming_back) // 2]
        say(f"a letter crosses in {there:.0f} ms and comes back in {returning:.0f} ms")

        type_at(one, len(words(one)), "at the same time from one\n")
        type_at(two, 0, "at the same time from two\n")

        until = time.monotonic() + PATIENCE
        while time.monotonic() < until:
            if words(one) == words(two) and "from one" in words(one):
                break
            one.wait_for_timeout(20)

        here, over_there = words(one), words(two)
        if here != over_there:
            failures.append(f"the two never agreed:\n{here!r}\n{over_there!r}")
        else:
            say("both browsers hold the same words")

        for expected in (
            "12345",
            "678910",
            "at the same time from one",
            "at the same time from two",
        ):
            if expected not in here:
                failures.append(f"{expected!r} was lost")

        for took, way in ((there, "to cross"), (returning, "to come back")):
            if took > CEILING:
                failures.append(f"a letter took {took:.0f} ms {way}, past {CEILING} ms")

        two.evaluate("() => { window.nib.dispatch({ selection: { anchor: 3 } }); window.nib.focus() }")
        one.wait_for_selector(".cm-nib-caret", timeout=10_000)
        one.wait_for_timeout(120)
        one.locator(".cm-editor").first.screenshot(path=str(SHOTS / "remote-caret.png"))
        say(f"the remote caret is in {SHOTS / 'remote-caret.png'}")

        one.wait_for_timeout(1800)
        one.locator(".cm-editor").first.screenshot(path=str(SHOTS / "remote-caret-settled.png"))
        named = one.evaluate(
            "() => { const name = document.querySelector('.cm-nib-caret-name');"
            " return name ? Number(getComputedStyle(name).opacity) : null }"
        )
        if not named:
            failures.append(f"the other caret's name went once it stopped ({named})")
        else:
            say("the other caret's name is still there once it stopped")

        one.locator(".strip").first.screenshot(path=str(SHOTS / "presence-dots.png"))

        long = request(
            f"/v1/spaces/{space['id']}/notes",
            token,
            {"path": "long.md", "content": long_note()},
        )["note"]
        say(f"a {len(long_note()) // 1024} KB note is on the account")

        joining = fresh(browser, token, "three")
        wait_for(
            joining,
            "() => {"
            "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
            f"  return walk(window.nibApp.workspace.tree).includes('/{SPACE}/long.md')"
            "}",
            "[three] the long note to arrive",
        )

        started = time.perf_counter()
        joining.evaluate(f"() => window.nibApp.workspace.open('/{SPACE}/long.md')")
        wait_for(
            joining,
            f"() => window.nibApp.rooms.carries({json.dumps(long['id'])})",
            "[three] the long note to join its room",
        )
        took = (time.perf_counter() - started) * 1000
        say(f"a long note joined its room in {took:.0f} ms")
        if took > CEILING * 4:
            failures.append(f"joining took {took:.0f} ms, past {CEILING * 4} ms")

        wait_for(
            one,
            "() => {"
            "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
            f"  return walk(window.nibApp.workspace.tree).includes('/{SPACE}/long.md')"
            "}",
            "[one] the long note to arrive",
        )
        one.evaluate(f"() => window.nibApp.workspace.open('/{SPACE}/long.md')")
        wait_for(
            one,
            f"() => window.nibApp.rooms.carries({json.dumps(long['id'])})",
            "[one] the long note to join its room",
        )
        held_at_edge(one, joining, "below", "desktop", failures)
        held_at_edge(one, joining, "above", "desktop", failures)
        one.set_viewport_size({"width": 390, "height": 844})
        held_at_edge(one, joining, "below", "phone", failures)
        one.set_viewport_size({"width": 1100, "height": 700})

        until = time.monotonic() + PATIENCE
        settled = ""
        while time.monotonic() < until:
            settled = request(f"/v1/notes/{note_id}", token)["content"]
            if settled == here:
                break
            time.sleep(0.2)

        if settled != here:
            failures.append(f"the account holds something else:\n{settled!r}")
        else:
            say("the account holds what both browsers hold")

    if failures:
        print("\nFAILED", flush=True)
        for one_of_them in failures:
            print(f"  - {one_of_them}", flush=True)
        return 1

    print("\nboth browsers wrote in one note and neither lost a word", flush=True)
    return 0

if __name__ == "__main__":
    sys.exit(main())
