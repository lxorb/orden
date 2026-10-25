#!/usr/bin/env python3
"""The certificate a web tab's page came with, shown from the site's popover. #776:
"Connection is secure" was said from the address alone, and the certificate could not be
seen.

Run with Orden up on scripts/wayland-launch.sh's site for it (CERT=1), a site served
over https. The popover behind the mark at the left of the address field is opened, its
Certificate pressed, and what it says has to be the certificate the site serves - whom
it was issued to and by, as a TLS connection made here reads them - with a SHA-256
fingerprint, and the connection has to be said to be secure.

    python3 scripts/cert-drive.py <out folder> <host>
"""

import json
import os
import re
import socket
import ssl
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

OUT, HOST = Path(sys.argv[1]), sys.argv[2]
CONFIG = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "ch.emilvinu.nib"
failures = []


def fail(what):
    print(f"::error::{what}")
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


def run(code):
    body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []})
    asked = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/",
        data=body.encode(),
        headers={"authorization": f"Bearer {SECRET}", "content-type": "application/json"},
        method="POST",
    )
    for _ in range(6):
        try:
            with urllib.request.urlopen(asked, timeout=10) as answer:
                said = json.loads(answer.read())
            return said.get("value") if said.get("ok") else None
        except (TimeoutError, OSError):
            time.sleep(1)
    return None


def served():
    """Whom the site's certificate was issued to and by, read over a connection of our own."""
    context = ssl.create_default_context()
    with socket.create_connection((HOST, 443), timeout=10) as raw:
        with context.wrap_socket(raw, server_hostname=HOST) as tls:
            peer = tls.getpeercert()
    name = lambda part: dict(pair for one in peer[part] for pair in one)  # noqa: E731
    return name("subject").get("commonName", ""), name("issuer").get("commonName", "")


# The page has loaded, over https, before its popover can say anything of it.
for _ in range(60):
    if run("[...document.querySelectorAll('input')].some((one) => one.value.startsWith('https://'))"):
        break
    time.sleep(0.5)
time.sleep(3)

opened = run("(() => { const mark = document.querySelector('[data-opens=\"site\"]'); if (!mark) return false; mark.click(); return true })()")
if not opened:
    fail("there is no site mark to open the popover from")
time.sleep(1)
said = run("document.querySelector('.site.nib-bubble')?.innerText ?? ''") or ""
if "Connection is secure" not in said:
    fail(f"the popover does not say the connection is secure: {said!r}")

pressed = None
for _ in range(20):
    pressed = run("(() => { const one = document.querySelector('.site.nib-bubble button.certificate'); if (!one) return false; one.click(); return true })()")
    if pressed:
        break
    time.sleep(0.5)
if not pressed:
    fail("the popover offers no certificate")
time.sleep(1)
subprocess.run(["grim", str(OUT / "certificate.png")], check=False)

details = run("document.querySelector('.site.nib-bubble .details')?.innerText ?? ''") or ""
(OUT / "certificate.txt").write_text(details)
print("the popover's certificate:")
print(details)
to, by = served()
print(f"the site serves one issued to {to!r} by {by!r}")
for label, want in (("Issued to", to), ("Issued by", by)):
    found = re.search(rf"{label}\s*\n([^\n]*)", details)
    if not found or want not in found.group(1):
        fail(f"{label} says {found.group(1) if found else None!r}, not {want!r}")
for label in ("Valid from", "Valid until"):
    if not re.search(rf"{label}\s*\n[^\n]*\d", details):
        fail(f"{label} gives no date")
if not re.search(r"SHA-256 fingerprint\s*\n([0-9A-F]{2}:){31}[0-9A-F]{2}", details):
    fail("there is no SHA-256 fingerprint")

sys.exit(1 if failures else 0)
