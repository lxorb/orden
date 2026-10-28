#!/usr/bin/env python3
"""Whether Orden's pages are put together on the graphics card on Linux, as far as the
app decides it: Chromium runs without the switches that turn that off, unless Settings ›
General › Hardware acceleration did.

#390: under `WebKitGTK` the window flickered on Wayland (#387), and the fix turned
accelerated compositing off for every webview of the app, web tabs included, which is
what took the card away from the sites in them. Orden on Linux runs on CEF now, where
that switch went with `WebKitGTK` (bb5ac23a0) and nothing turns compositing off for a
page, the app's own or a site's - which this holds the app to. Whether the card is used
then is Chromium's and the machine's to say: a runner with no graphics card draws in
software either way, so the switches are what is held to, and what Chromium says of
compositing is printed beside them.

Asked of Chromium itself, over the `DevTools` port the run opened (`NIB_CEF_DEBUG_PORT`):
`SystemInfo.getInfo` answers with the command line the browser runs with - the switches
the app gives it through CEF among them, which no process's own command line shows - and
with what it says of each feature, compositing among them.

    python3 scripts/compositing-check.py <port> [off]

With `off`, the run has Hardware acceleration off, and the switches have to be there.
"""

import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from devtools import Session  # noqa: E402

PORT = int(sys.argv[1])
OFF = len(sys.argv) > 2 and sys.argv[2] == "off"
SWITCHES = ("--disable-gpu-compositing", "--disable-gpu")


def browser():
    for _ in range(60):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=5) as answer:
                return json.loads(answer.read())["webSocketDebuggerUrl"]
        except (OSError, ValueError, KeyError):
            time.sleep(0.5)
    sys.exit(f"::error::compositing: Chromium's DevTools port {PORT} never answered")


session = Session({"webSocketDebuggerUrl": browser()})
info = session.call("SystemInfo.getInfo")
session.close()
if "error" in info:
    sys.exit(f"::error::compositing: Chromium did not say how it runs: {info['error']}")

line = info.get("commandLine", "").split()
status = info.get("gpu", {}).get("featureStatus", {})
found = [switch for switch in SWITCHES if any(one == switch or one.startswith(switch + "=") for one in line)]
print(f"compositing: Chromium runs with {len(line)} switches; of the ones that take the card away: {found or 'none'}")
print(f"compositing: Chromium says of compositing: {status.get('gpu_compositing', '?')}")

if OFF and "--disable-gpu-compositing" not in found:
    sys.exit("::error::compositing: Hardware acceleration is off, and Chromium was not told so")
if not OFF and found:
    sys.exit(f"::error::compositing: the app turned compositing off for every page: {' '.join(found)}")
print(
    "compositing: Hardware acceleration off, and Chromium told so"
    if OFF
    else "compositing: nothing of the app turns compositing off for a page, the window's own or a web tab's"
)
