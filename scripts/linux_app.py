import json
import os
import time
import urllib.request
from pathlib import Path

CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / os.environ.get("DRIVEN_ID", "so.orden.Orden")

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

def said(code, timeout=10, tries=6):
    body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []})
    asked = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/",
        data=body.encode(),
        headers={"authorization": f"Bearer {SECRET}", "content-type": "application/json"},
        method="POST",
    )
    for at in range(tries):
        if at:
            time.sleep(1)
        try:
            with urllib.request.urlopen(asked, timeout=timeout) as answer:
                return json.loads(answer.read())
        except (TimeoutError, OSError):
            pass
    return None

def run(code, timeout=10):
    answer = said(code, timeout)
    return answer.get("value") if answer and answer.get("ok") else None
