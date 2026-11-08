from __future__ import annotations

import argparse
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Any

HERE = pathlib.Path(__file__).resolve().parent
NAME = "nibprobe-named.txt"


def borrowed(name: str, file: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


TURN_ON = "localStorage.setItem('orden:hidden-kinds', JSON.stringify(['experimental', 'experimental-explorer'])); 1"

PRESS_SHOW = """(async () => {
  const wait = (ms) => new Promise((done) => setTimeout(done, ms))
  document.querySelector('.webbar .saving')?.click()
  for (let at = 0; at < 40; at += 1) {
    const button = [...document.querySelectorAll('button[aria-label]')].find(
      (one) => one.getAttribute('aria-label') === 'Show in folder',
    )
    if (button) {
      button.click()
      return 'pressed'
    }
    await wait(250)
  }
  return 'no Show in folder button'
})()"""

SHOWN = """JSON.stringify((() => {
  const tab = orden.workspace.tabs.find((one) => one.id === orden.workspace.activeTabId)
  const picked = [...document.querySelectorAll('.orden-row.entry[aria-selected="true"]')].map(
    (one) => one.innerText.trim(),
  )
  const rows = [...document.querySelectorAll('.orden-row.entry')].map((one) => one.innerText.trim())
  return { kind: tab?.kind ?? null, name: tab?.name ?? null, doc: tab?.doc ?? null, picked, rows }
})())"""


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0
    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="so.orden.Orden.probe.reveal")
    parsed.add_argument("--shot", type=pathlib.Path, default=None)
    args = parsed.parse_args()
    sys.path.insert(0, str(HERE))
    probe = borrowed("downloads_probe", "web-downloads-probe.py")

    probe.wipe(args.identifier)
    port = probe.free_port()
    probe.serve(port)
    root = pathlib.Path(tempfile.mkdtemp(prefix="orden-reveal-probe-"))
    os.environ["ORDEN_SPACES_DIR"] = str(root / "spaces")
    arrive = root / "downloads"
    arrive.mkdir()
    os.environ["ORDEN_DOWNLOADS_DIR"] = str(arrive)
    space = root / "spaces" / probe.SPACE
    space.mkdir(parents=True)
    (space / f"{probe.NOTE}.md").write_text(f"# {probe.NOTE}\n", encoding="utf-8")
    (space / f"{probe.SITE}.url").write_text(
        f"[InternetShortcut]\r\nURL=http://127.0.0.1:{port}/login\r\nTitle={probe.SITE}\r\n",
        encoding="utf-8",
    )

    wrong: list[str] = []
    running = None
    try:
        running, app = probe.launch(args.exe, args.identifier)
        running.terminate()
        running.wait(timeout=30)
        probe.allow_eval(args.identifier)
        running, app = probe.launch(args.exe, args.identifier, unlike=app.port)
        app.open(f"{probe.NOTE}.md", probe.SPACE)
        time.sleep(2)
        print("explorer turned on", app.ask(TURN_ON), flush=True)
        running.terminate()
        running.wait(timeout=30)

        running, app = probe.launch(args.exe, args.identifier, unlike=app.port)
        app.open(f"{probe.NOTE}.md", probe.SPACE)
        time.sleep(2)
        app.open(f"{probe.SITE}.url")
        tab = probe.wait_for_tab(app, probe.SITE)
        time.sleep(3)
        probe.quiet(app)
        probe.go(app, tab, f"{probe.host(0, port)}/case/named")
        until = time.perf_counter() + 30
        while not (arrive / NAME).exists() and time.perf_counter() < until:
            time.sleep(0.5)
        if not (arrive / NAME).exists():
            wrong.append(f"{NAME} never arrived")
        time.sleep(2)
        print("show", app.ask(PRESS_SHOW), flush=True)
        time.sleep(4)
        shown = app.ask(SHOWN)
        print("shown", json.dumps(shown), flush=True)
        if args.shot:
            probe.shoot(running.pid, args.shot)
        said = shown if isinstance(shown, dict) else {}
        if said.get("kind") != "explorer":
            wrong.append(f"the folder button did not open the Orden explorer: {said}")
        folder = json.loads(said.get("doc") or "{}").get("folder", "")
        if pathlib.Path(folder or "/").resolve() != arrive.resolve():
            wrong.append(f"the explorer is at {folder}, not {arrive}")
        if not any(NAME in one for one in said.get("picked") or []):
            wrong.append(f"{NAME} is not picked: {said.get('picked')}")
    finally:
        if running is not None:
            running.terminate()
            try:
                running.wait(timeout=30)
            except subprocess.TimeoutExpired:
                running.kill()
        shutil.rmtree(root, ignore_errors=True)
    for one in wrong:
        print(f"WRONG: {one}")
    print("PASS" if not wrong else f"FAIL ({len(wrong)})")
    return 1 if wrong else 0


if __name__ == "__main__":
    raise SystemExit(main())
