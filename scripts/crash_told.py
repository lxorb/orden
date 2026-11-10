from __future__ import annotations

import json
import pathlib
import sys
import threading
import time
import urllib.error
import urllib.request

TOLD = "orden:crash-reports-told"

REPORTS = "orden:crash-reports"

SETUP = "orden:setup"

CODE = f"""(() => {{
  if (localStorage.getItem({json.dumps(SETUP)}) === null) localStorage.setItem({json.dumps(SETUP)}, '"done"')
  if (window.ordenApp?.setup?.showing) window.ordenApp.setup.finish()
  const sheet = document.querySelector('.orden-screen.sheet[role="dialog"]')
  const box = sheet?.querySelector('input.orden-checkbox')
  const go = sheet?.querySelector('button[data-lands]')
  if (box && go) {{
    if (box.checked) box.click()
    go.click()
    return 'answered'
  }}
  if (localStorage.getItem({json.dumps(TOLD)}) === null) localStorage.setItem({json.dumps(TOLD)}, 'true')
  if (localStorage.getItem({json.dumps(REPORTS)}) === null) localStorage.setItem({json.dumps(REPORTS)}, 'false')
  return 'told'
}})()"""


def ask(port: int, secret: str, code: str, seconds: float = 10) -> object:
    body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []}).encode()
    asked = urllib.request.Request(
        f"http://127.0.0.1:{port}/",
        data=body,
        headers={"authorization": f"Bearer {secret}", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(asked, timeout=seconds) as said:
            return json.loads(said.read().decode("utf-8", "replace")).get("value")
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None


def watched(port: int, secret: str, first: object, watch: float) -> None:
    began = time.monotonic()
    said = [str(first)]
    while time.monotonic() - began < watch:
        time.sleep(0.5)
        now = ask(port, secret, CODE)
        if now == "answered":
            said.append(f"answered at {time.monotonic() - began:.1f} s")
    print(f"crash_told: {', '.join(said)}", flush=True)


def tell(port: int, secret: str, watch: float = 20.0) -> bool:
    first = ask(port, secret, CODE)
    if first is None:
        return False
    watched(port, secret, first, watch)
    return True


def told(port: int, secret: str, watch: float = 20.0) -> bool:
    for _ in range(40):
        first = ask(port, secret, CODE)
        if first is not None:
            threading.Thread(target=watched, args=(port, secret, first, watch), daemon=True).start()
            return True
        time.sleep(0.5)
    return False


def main() -> int:
    config = pathlib.Path(sys.argv[1])
    until = time.monotonic() + 60
    while time.monotonic() < until:
        try:
            kept = json.loads((config / "automation.json").read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            kept = {}
        if kept.get("port") and tell(int(kept["port"]), str(kept["secret"])):
            return 0
        time.sleep(0.5)
    print("crash_told: the app never answered to be told", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
