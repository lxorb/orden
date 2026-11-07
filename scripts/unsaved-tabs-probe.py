from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import shutil
import sys
import time

from probe_app import close_app

HERE = pathlib.Path(__file__).resolve().parent

def borrowed():

    spec = importlib.util.spec_from_file_location("switch", HERE / "web-switch-probe.py")
    if spec is None or spec.loader is None:
        raise SystemExit("could not read web-switch-probe.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

switch = borrowed()

WORDS = "Probe words, typed and never saved"

IDS = "JSON.stringify(Object.fromEntries(nib.workspace.spaces.map((one) => [one.name, one.id])))"

BACK = """JSON.stringify((() => {
  const ws = nib.workspace
  const note = ws.tabs.find((one) => one.kind === 'note' && one.path === null)
  const web = ws.tabs.find((one) => one.kind === 'web' && one.path === null)
  return {
    note: note ? { doc: note.doc, path: note.path } : null,
    web: web ? { id: web.id, space: ws.spaceOf(web.note), address: web.address ?? null } : null,
    onScreen: ws.activeSpaceId,
  }
})())"""

def asked(app, code: str, seconds: float = 60) -> object:
    print(f"{time.strftime('%H:%M:%S')} asks {code[:70]}", flush=True)
    end = time.perf_counter() + seconds
    said: object = None
    while time.perf_counter() < end:
        said = app.ask(code)
        if not (isinstance(said, dict) and "error" in said):
            return said
        time.sleep(1)
    return said

def until(seconds: float, done) -> bool:
    end = time.perf_counter() + seconds
    while time.perf_counter() < end:
        if done():
            return True
        time.sleep(0.5)
    return False

def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="so.orden.Orden.probe")
    args = parsed.parse_args()

    switch.wipe(args.identifier)
    port = switch.free_port()
    server = switch.serve(port)
    page = f"http://127.0.0.1:{port}/page"

    root = switch.spaces_root()
    for name in ("Work", "Home"):
        shutil.rmtree(root / name, ignore_errors=True)
        (root / name).mkdir(parents=True)
    (root / "Work" / "Idea.md").write_text("# Idea\n\nA note.\n", encoding="utf-8")
    (root / "Home" / "A note.md").write_text("# A note\n", encoding="utf-8")
    (root / "Home" / "Mail.url").write_text(switch.shortcut(f"http://127.0.0.1:{port}/other", "Mail"), encoding="utf-8")

    said: dict[str, object] = {}
    running = None
    try:
        running, app, _ = switch.launch(args.exe, args.identifier)
        if not close_app(running):
            running.terminate()
            running.wait(timeout=30)
        switch.allow_eval(args.identifier)
        time.sleep(1)

        running, app, _ = switch.launch(args.exe, args.identifier, unlike=app.port)
        found: dict[str, object] = {}

        def listed() -> bool:
            found["ids"] = asked(app, IDS)
            return isinstance(found["ids"], dict) and {"Work", "Home"} <= set(found["ids"])

        until(60, listed)
        ids = found.get("ids")
        if not isinstance(ids, dict) or "Work" not in ids or "Home" not in ids:
            raise SystemExit(f"the two spaces are not there: {ids}")
        work, home = str(ids["Work"]), str(ids["Home"])
        said["spaces"] = {"Work": work, "Home": home}
        close_app(running)
        time.sleep(1)

        running, app, _ = switch.launch(args.exe, args.identifier, unlike=app.port)
        asked(app, f"nib.workspace.showSpace({json.dumps(work)}).then(() => 'work')")
        app.open("Idea.md", "Work")
        time.sleep(1)
        asked(app, f"(nib.workspace.openBlank(), nib.workspace.active.note.live.replace({json.dumps(WORDS)}, true), 'typed')")
        asked(app, f"nib.workspace.openPage({json.dumps(page)}, 'behind') && 'opened'")
        asked(app, f"nib.workspace.showSpace({json.dumps(home)}).then(() => 'home')")
        time.sleep(2)
        first = app.port
        closing = time.perf_counter()
        if not close_app(running):
            raise SystemExit("the app did not close when asked")
        said["closed in seconds"] = round(time.perf_counter() - closing, 1)

        running, app, _ = switch.launch(args.exe, args.identifier, unlike=first)
        back: object = None
        until(30, lambda: isinstance(back := asked(app, BACK), dict) and back.get("web") is not None)
        back = asked(app, BACK)
        said["after the restart"] = back
        web = back.get("web") if isinstance(back, dict) else None
        if isinstance(web, dict):
            asked(app, f"nib.workspace.activate({json.dumps(web['id'])}) || 'shown'")

        asked(app, f"nib.workspace.showSpace({json.dumps(work)}).then(() => 'work')")
        mail = f"nib.workspace.spaces.find((one) => one.id === {json.dumps(home)}).root + '/Mail.url'"
        asked(app, f"nib.workspace.openWeb({mail}, {{ activate: false }}).then(() => 'opened')")
        owner = asked(
            app,
            "(() => { const ws = nib.workspace; const tab = ws.tabs.find((one) => (one.path ?? '')"
            ".endsWith('Mail.url')); return tab ? ws.spaceOf(tab.note) : null })()",
        )
        said["web note in its own space"] = owner == home
    finally:
        if running is not None and not close_app(running):
            running.terminate()
        server.shutdown()

    print(json.dumps(said, indent=2))
    after = said.get("after the restart")
    ids = said.get("spaces")
    good = (
        isinstance(after, dict)
        and isinstance(ids, dict)
        and isinstance(after.get("note"), dict)
        and after["note"].get("doc") == WORDS
        and after["note"].get("path") is None
        and isinstance(after.get("web"), dict)
        and after["web"].get("space") == ids["Work"]
        and after.get("onScreen") == ids["Home"]
        and said.get("web note in its own space") is True
    )
    print("PASS" if good else "FAIL")
    return 0 if good else 1

if __name__ == "__main__":
    raise SystemExit(main())
