#!/usr/bin/env python3

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

OUT, PHASE, NAME = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / os.environ.get("DRIVEN_ID", "so.orden.Orden")
failures = []

FIREFOX = "https://addons.mozilla.org/en-US/firefox/addon/sponsorblock/"
DEBUG_PORT = int(os.environ.get("ORDEN_CEF_DEBUG_PORT", "9339"))

def fail(what):
    print(f"::error::{PHASE}: {what}")
    failures.append(what)

def endpoint():
    for _ in range(120):
        try:
            kept = json.loads((CONFIG / "automation.json").read_text())
            if kept.get("port"):
                return kept["port"], kept["secret"]
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    raise SystemExit("::error::the app wrote no endpoint")

PORT, SECRET = endpoint()

def run(code, timeout=10):
    body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []})
    asked = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/",
        data=body.encode(),
        headers={"authorization": f"Bearer {SECRET}", "content-type": "application/json"},
        method="POST",
    )
    for _ in range(6):
        try:
            with urllib.request.urlopen(asked, timeout=timeout) as answer:
                said = json.loads(answer.read())
            return said.get("value") if said.get("ok") else said.get("error")
        except (TimeoutError, OSError):
            time.sleep(1)
    return None

def listed():
    said = run("window.__TAURI_INTERNALS__.invoke('extensions_list').then((all) => JSON.stringify(all))", 40)
    try:
        return json.loads(said)
    except (TypeError, ValueError):
        return None

def ours(all_of):
    return [one for one in all_of or [] if one.get("name") == NAME]

def settings_rows():
    run("(nib.settings.show('general'), 'shown')")
    for _ in range(40):
        said = run(
            "(() => { const head = [...document.querySelectorAll('h3')].find((one) => one.innerText.trim() === 'Extensions');"
            " if (!head) return null; const card = head.nextElementSibling; return 'rows: ' + (card ? card.innerText : '') })()"
        )
        if said:
            return said
        time.sleep(0.5)
    return None

def closed():
    run("(nib.settings.hide ? nib.settings.hide() : (nib.settings.open = false), 'closed')")
    time.sleep(0.5)

CLASS = os.environ.get("CLASS", "nib")

def strangers():

    def walk(node):
        if node.get("pid") and node.get("type") in ("con", "floating_con") and node.get("shell") == "xwayland":
            name, title = (node.get("window_properties") or {}).get("instance"), node.get("name") or ""
            if name != CLASS or title.endswith("Chromium"):
                yield (name, title)
        for child in node.get("nodes", []) + node.get("floating_nodes", []):
            yield from walk(child)

    if not CLASS:
        return []
    try:
        return list(walk(json.loads(subprocess.check_output(["swaymsg", "-r", "-t", "get_tree"]))))
    except (OSError, subprocess.CalledProcessError, ValueError):
        return []

def listing(code):
    try:
        return json.loads(run(code))
    except (TypeError, ValueError):
        return None

def tabs_at(address):
    return listing(
        "JSON.stringify(nib.workspace.tabs"
        f".filter((tab) => tab.address === {json.dumps(address)}).map((tab) => tab.paneId))"
    )

def opened_as_a_tab(address, pane, what, seconds=20):
    strange, panes = set(), None
    for _ in range(seconds * 2):
        strange.update(strangers())
        panes = tabs_at(address)
        if panes:
            break
        time.sleep(0.5)
    for _ in range(4):
        strange.update(strangers())
        time.sleep(0.5)
    panes = tabs_at(address)
    if strange:
        fail(f"{what}: windows not under {CLASS}, or Chromium's: {sorted(strange)}")
    if panes != [pane]:
        fail(f"{what}: not one tab in the reader's pane {pane}, but in {panes}")
        for log in Path.home().rglob("nib.log"):
            if "so.orden.Orden" in str(log):
                said = [line for line in log.read_text(errors="replace").splitlines() if "extensions" in line]
                print(f"{log}: {said[-10:]}")
        return False
    print(f"installed: {what} opened one tab of Orden's, in the reader's pane")
    return True

def reader_tab():
    find = (
        "JSON.stringify(nib.workspace.tabs.filter((tab) => (tab.address ?? '').startsWith('http'))"
        ".map((tab) => [tab.id, tab.paneId]))"
    )
    found = listing(find)
    if not found:
        run("(nib.workspace.openPage('http://127.0.0.1:8765/', 'front'), 'opened')")
        time.sleep(2)
        found = listing(find)
    if not found:
        raise SystemExit(f"::error::{PHASE}: the reader's own web tab is not there")
    return found[0]

def popup_of(one, front):
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from devtools import Session, targets

    run("(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 'closed')")
    time.sleep(0.5)
    run(f"(nib.workspace.activate({json.dumps(front)}), 'shown')")
    time.sleep(1)
    pressed = None
    for _ in range(40):
        pressed = run(
            "(() => { const button = [...document.querySelectorAll('button.extension')]"
            f".find((each) => each.getAttribute('aria-label') === {json.dumps(one['name'])});"
            " if (!button) return null; button.click(); return 'pressed' })()"
        )
        if pressed:
            break
        time.sleep(0.5)
    if not pressed:
        fail("its button is not in the web bar")
        return None
    popup = f"chrome-extension://{one['id']}/popup.html"
    for _ in range(40):
        found = next((each for each in targets(DEBUG_PORT) if str(each.get("url", "")) == popup), None)
        if found:
            return Session(found)
        time.sleep(0.5)
    fail(f"its popup did not open: {[each.get('url') for each in targets(DEBUG_PORT)]}")
    return None

def from_popup(one, front, code, address, pane, what):
    page = popup_of(one, front)
    if not page:
        return
    try:
        said = page.call("Runtime.evaluate", {"expression": code, "userGesture": True, "returnByValue": True})
        page.close()
    except OSError:
        said = {}
    if "error" in said or said.get("exceptionDetails"):
        fail(f"{what}: the popup could not ask: {said}")
        return
    opened_as_a_tab(address, pane, what)

if PHASE == "installed":
    found = []
    for _ in range(60):
        found = ours(listed())
        if found:
            break
        time.sleep(1)
    if not found:
        raise SystemExit(f"::error::installed: the engine never listed {NAME}: {listed()}")
    one = found[0]
    print(f"installed: the engine lists {NAME} as {one.get('id')}")
    base = f"chrome-extension://{one['id']}/"
    front, pane = reader_tab()
    run(f"(nib.workspace.activate({json.dumps(front)}), 'shown')")
    time.sleep(1)

    for _ in range(40):
        if run("!!document.querySelector('[data-opens=\"extensions\"]')"):
            break
        time.sleep(0.5)
    run("(document.querySelector('[data-opens=\"extensions\"]')?.click(), 'pressed')")
    bubble = None
    for _ in range(20):
        bubble = run("document.querySelector('[role=dialog][aria-label=\"Extensions\"]')?.innerText ?? null")
        if bubble and NAME in bubble:
            break
        time.sleep(0.5)
    subprocess.run(["grim", str(OUT / "extensions-bubble.png")], check=False)
    if not bubble or NAME not in bubble:
        fail(f"the web bar's bubble does not name it: {bubble!r}")
    else:
        print(f"installed: the web bar's bubble names it: {bubble.strip()[:120]!r}")
    run("(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 'closed')")

    rows = settings_rows()
    subprocess.run(["grim", str(OUT / "extensions-settings.png")], check=False)
    if not rows or NAME not in rows:
        fail(f"Settings > General > Extensions does not name it: {rows!r}")
    else:
        print(f"installed: Settings > General > Extensions names it: {rows.strip()[:120]!r}")
    closed()

    from_popup(
        one, front, "chrome.runtime.sendMessage('open'), 'asked'",
        f"{base}page.html?background", pane, "chrome.tabs.create from its background",
    )
    from_popup(
        one, front, f"chrome.tabs.create({{ url: {json.dumps(base + 'page.html?tabs')} }}), 'asked'",
        f"{base}page.html?tabs", pane, "chrome.tabs.create from its popup",
    )
    from_popup(
        one, front, f"window.open({json.dumps(base + 'page.html?open')}), 'asked'",
        f"{base}page.html?open", pane, "window.open from its popup",
    )
    subprocess.run(["grim", str(OUT / "extension-tabs.png")], check=False)
    run(
        f"(nib.workspace.tabs.filter((tab) => (tab.address ?? '').startsWith({json.dumps(base)}))"
        ".forEach((tab) => nib.workspace.close(tab.id)), 'closed')"
    )
    run("(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 'closed')")

    removed = run(
        f"window.__TAURI_INTERNALS__.invoke('extensions_remove', {{ id: {json.dumps(one['id'])} }})"
        ".then(() => 'removed', (error) => 'refused: ' + error)",
        60,
    )
    print(f"installed: removed through the engine: {removed!r}")
    if removed != "removed":
        fail(f"the engine did not remove it: {removed!r}")
    left = None
    for _ in range(20):
        left = listed()
        if left is not None and not ours(left):
            break
        time.sleep(0.5)
    if ours(left):
        fail(f"the engine still lists it after it was removed: {left}")
    else:
        print(f"installed: the engine's list after the removal: {left}")
    rows = settings_rows()
    if rows and NAME in rows:
        fail(f"Settings still names it after it was removed: {rows!r}")
    else:
        print(f"installed: Settings after the removal: {(rows or '').strip()[:120]!r}")
    closed()
elif PHASE == "firefox-install":
    said = run(
        "window.__TAURI_INTERNALS__.invoke('extensions_install', "
        f"{{ link: {json.dumps(FIREFOX)}, anyway: true }})"
        ".then((done) => JSON.stringify(done), (error) => 'refused: ' + error)",
        180,
    )
    try:
        done = json.loads(said)
    except (TypeError, ValueError):
        done = None
    if not isinstance(done, dict) or done.get("store") != "firefox":
        raise SystemExit(f"::error::firefox-install: it was not installed as a Firefox add-on: {said!r}")
    print(f"firefox-install: installed {done.get('name')!r} as {done.get('id')}, gaps {done.get('gaps')}")
    if not done.get("pending"):
        fail("it was said to run before Orden starts again, which this engine cannot do")
    rows = settings_rows()
    if not rows or "Starts when Orden next opens" not in rows:
        fail(f"Settings does not say it starts with the next launch: {rows!r}")
    else:
        print(f"firefox-install: Settings says {rows.strip()[:160]!r}")
    closed()
elif PHASE == "firefox-run":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from devtools import Session, targets

    one = None
    for _ in range(60):
        one = next((each for each in listed() or [] if each.get("store") == "firefox"), None)
        if one and not one.get("pending"):
            break
        time.sleep(1)
    if not one or one.get("pending"):
        raise SystemExit(f"::error::firefox-run: the engine did not load it as it started: {one}")
    print(f"firefox-run: the engine runs {one['name']!r} as {one['id']}")
    base = f"chrome-extension://{one['id']}/"

    def target(ending):
        for _ in range(40):
            for each in targets(DEBUG_PORT):
                url = str(each.get("url", ""))
                if url.startswith(base) and url.split("#")[0].split("?")[0].endswith(ending):
                    return each
            time.sleep(0.5)
        return None

    background = target("orden/background.html")
    if not background:
        fail(f"no background page runs: {[each.get('url') for each in targets(DEBUG_PORT)]}")
    else:
        page = Session(background)
        said = page.value("JSON.stringify([globalThis.__ordenBackground === true, typeof browser.runtime.getBrowserInfo])")
        page.close()
        print(f"firefox-run: its background page says {said}")
        if said != '[true,"function"]':
            fail(f"its background page has not the Firefox layer: {said!r}")

    strange, welcome = set(), []
    for _ in range(30):
        strange.update(strangers())
        welcome = [
            address
            for address in listing("JSON.stringify(nib.workspace.tabs.map((tab) => tab.address ?? ''))") or []
            if address.startswith(base)
        ]
        if welcome:
            break
        time.sleep(0.5)
    print(f"firefox-run: the tabs it opened of its own: {welcome}")
    if strange:
        fail(f"windows not under {CLASS}, or Chromium's: {sorted(strange)}")
    front, _ = reader_tab()
    run(f"(nib.workspace.activate({json.dumps(front)}), 'shown')")
    time.sleep(1)
    pressed = None
    for _ in range(40):
        pressed = run(
            "(() => { const button = [...document.querySelectorAll('button.extension')]"
            f".find((each) => each.getAttribute('aria-label') === {json.dumps(one['name'])});"
            " if (!button) return null; button.click(); return 'pressed' })()"
        )
        if pressed:
            break
        time.sleep(0.5)
    if not pressed:
        raise SystemExit("::error::firefox-run: its button is not in the web bar")
    popup = target(one.get("popup") or "popup.html")
    subprocess.run(["grim", str(OUT / "firefox-popup.png")], check=False)
    if not popup:
        fail("its popup did not open")
    else:
        page = Session(popup)
        said = None
        for _ in range(20):
            said = page.value(
                "JSON.stringify([typeof browser.runtime.getBrowserInfo, typeof browser.contextualIdentities,"
                " (document.body?.innerText ?? '').trim().length > 0])"
            )
            if said == '["function","object",true]':
                break
            time.sleep(0.5)
        page.close()
        print(f"firefox-run: its popup says {said}")
        if said != '["function","object",true]':
            fail(f"its popup has not drawn with the Firefox layer in it: {said!r}")
    run("(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 'closed')")
else:
    time.sleep(5)
    left = listed()
    if left is None or ours(left):
        fail(f"started again, the engine lists {left}")
    else:
        print(f"again: started again without it, the engine's list is {left}")

sys.exit(1 if failures else 0)
