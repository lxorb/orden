#!/usr/bin/env python3
import re
import socket
import ssl
import subprocess
import sys
import time
from pathlib import Path
from linux_app import run

OUT, HOST = Path(sys.argv[1]), sys.argv[2]
failures = []
def fail(what):
    print(f"::error::{what}")
    failures.append(what)
def served():
    context = ssl.create_default_context()
    with socket.create_connection((HOST, 443), timeout=10) as raw:
        with context.wrap_socket(raw, server_hostname=HOST) as tls:
            peer = tls.getpeercert()
    name = lambda part: dict(pair for one in peer[part] for pair in one)  # noqa: E731
    return name("subject").get("commonName", ""), name("issuer").get("commonName", "")
for _ in range(60):
    if run("[...document.querySelectorAll('input')].some((one) => one.value.startsWith('https://'))"):
        break
    time.sleep(0.5)
time.sleep(3)
opened = run("(() => { const mark = document.querySelector('[data-opens=\"site\"]'); if (!mark) return false; mark.click(); return true })()")
if not opened:
    fail("there is no site mark to open the popover from")
time.sleep(1)
said = run("document.querySelector('.site.orden-bubble')?.innerText ?? ''") or ""
if "Connection is secure" not in said:
    fail(f"the popover does not say the connection is secure: {said!r}")
pressed = run("(() => { const one = document.querySelector('.site.orden-bubble button.how'); if (!one) return false; one.click(); return true })()")
if not pressed:
    fail("the line saying the connection is secure cannot be pressed")
chain = []
for _ in range(20):
    chain = run("[...document.querySelectorAll('.site.orden-bubble .chain button')].map((one) => [one.dataset.role, one.querySelector('.name')?.innerText ?? ''])") or []
    if chain:
        break
    time.sleep(0.5)
if not chain:
    fail("pressing the line shows no chain of certificates")
time.sleep(1)
subprocess.run(["grim", str(OUT / "certificate.png")], check=False)
print("the popover's chain:")
for role, name in chain:
    print(f"  {role}: {name}")
if run("!!document.querySelector('.site.orden-bubble .certificate .note')"):
    fail("the chain was read separately, not from the page's own connection")
facts = run("""[
  ...[...document.querySelectorAll('.site.orden-bubble .details > dt')].map((one) => [one.innerText, one.nextElementSibling?.innerText ?? '']),
  ...[...document.querySelectorAll('.site.orden-bubble .certificate .code')].map((one) => [one.querySelector('.label')?.innerText ?? '', one.querySelector('.hex')?.textContent ?? '']),
]""") or []
facts = {label.strip(): value.replace("\u200b", "").strip() for label, value in facts}
(OUT / "certificate.txt").write_text("".join(f"{label}\n{value}\n" for label, value in facts.items()))
print("the popover's certificate:")
for label, value in facts.items():
    print(f"  {label}: {value}")
to, by = served()
print(f"the site serves one issued to {to!r} by {by!r}")
for label, want in (("Issued to", to), ("Issued by", by)):
    if want not in facts.get(label, ""):
        fail(f"{label} says {facts.get(label)!r}, not {want!r}")
for label in ("Valid from", "Valid until"):
    if not re.search(r"\d", facts.get(label, "")):
        fail(f"{label} gives no date")
if not re.fullmatch(r"([0-9A-F]{2}:){31}[0-9A-F]{2}", facts.get("SHA-256 fingerprint", "")):
    fail(f"there is no SHA-256 fingerprint: {facts.get('SHA-256 fingerprint')!r}")
if not re.fullmatch(r"[0-9A-F]{2}(:[0-9A-F]{2})*", facts.get("Serial number", "")):
    fail(f"there is no serial number: {facts.get('Serial number')!r}")
roles = [role for role, _ in chain]
if len(chain) < 2 or roles[0] != "site":
    fail(f"the chain is not the site's and its issuers: {chain!r}")
elif by not in chain[1][1]:
    fail(f"the second of the chain is {chain[1][1]!r}, not the site's issuer {by!r}")
if roles and roles[-1] != "root":
    fail(f"the chain ends at {roles[-1]!r}, not at a root")
sys.exit(1 if failures else 0)
