"""A mail with a 20 MB attachment, read and answered in the packaged app (#1286, #1297).

Windows only. A plain IMAP and SMTP server of its own runs on 127.0.0.1, holding one mail
with a 20 MB file in it; the app links a mail account to it through the drive build's
`nibApp.linked`, opens the mail's conversation as a tab, reads the file back, and answers
with a 20 MB file of its own. The page watches its own long tasks the whole time
(`PerformanceObserver`, `longtask`): reading or sending a large mail must never hold the
window's JS thread for long. What arrives over SMTP, and what is filed in Sent, must be
the bytes the page sent.

    npx vite build --mode drive                     # in apps/desktop
    pnpm --dir apps/desktop tauri build --no-bundle \\
      --config '{"identifier":"ch.emilvinu.nib.probe.mail","version":"99.0.0",
                 "build":{"beforeBuildCommand":""},
                 "plugins":{"updater":{"endpoints":["https://127.0.0.1:9/latest.json"]}}}'
    python scripts/mail-large-probe.py --exe apps/desktop/src-tauri/target/release/nib.exe \\
      --identifier ch.emilvinu.nib.probe.mail

Every launch goes through `run_probe`, off the screen and without the keyboard; the spaces
are made in a temp folder named by `NIB_SPACES_DIR`.
"""

from __future__ import annotations

import argparse
import base64
import email
import email.policy
import email.utils
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import socket
import sys
import threading
import time
from email.message import EmailMessage
from typing import Any

HERE = pathlib.Path(__file__).resolve().parent

def windows_side() -> Any:
    from probe_app import close_app, run_probe

    spec = importlib.util.spec_from_file_location("browser_probe", HERE / "default-browser-probe.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return close_app, run_probe, module

SPACE = "Mail probe"
NOTE = "Idea"
USER = "probe@example.org"
PASSWORD = "right horse"
LARGE = 20 * 1024 * 1024
LONGEST_MS = 400

def say(words: str) -> None:
    print(words, flush=True)

class Box:

    def __init__(self) -> None:
        self.mails: list[dict[str, Any]] = []
        self.next = 0

class FakeMail:

    def __init__(self) -> None:
        self.boxes = {"INBOX": Box(), "Sent": Box()}
        self.sent: list[bytes] = []
        self.lock = threading.Lock()
        self.idlers: set[Any] = set()
        self.imap_port = self._listen(self._imap, (1143, 143))
        self.smtp_port = self._listen(self._smtp, (1025, 2525, 587))

    def deliver(self, box: str, raw: bytes, flags: tuple[str, ...] = ()) -> None:
        with self.lock:
            held = self.boxes.setdefault(box, Box())
            held.next += 1
            held.mails.append({"uid": held.next, "flags": set(flags), "raw": raw})
            idlers = list(self.idlers)
        for wake in idlers:
            wake()

    def _listen(self, handle: Any, ports: tuple[int, ...]) -> int:
        server = socket.socket()
        for port in ports:
            try:
                server.bind(("127.0.0.1", port))
                break
            except OSError:
                continue
        else:
            raise SystemExit(f"none of the mail ports {ports} is free")
        server.listen()

        def accept() -> None:
            while True:
                client, _ = server.accept()
                threading.Thread(target=self._served, args=(handle, client), daemon=True).start()

        threading.Thread(target=accept, daemon=True).start()
        return server.getsockname()[1]

    def _served(self, handle: Any, client: socket.socket) -> None:
        try:
            handle(client)
        except OSError:
            pass
        finally:
            client.close()

    def _imap(self, client: socket.socket) -> None:
        reader = client.makefile("rb")
        writing = threading.Lock()

        def send(data: bytes) -> None:
            with writing:
                client.sendall(data)

        def line(words: str) -> None:
            send(words.encode("latin-1") + b"\r\n")

        caps = "IMAP4rev1 LITERAL+ AUTH=PLAIN SASL-IR IDLE"
        line(f"* OK [CAPABILITY {caps}] fake ready")
        box: str | None = None
        authed = False
        idling: Any = None
        while True:
            raw = reader.readline()
            if not raw:
                if idling:
                    self.idlers.discard(idling)
                return
            said = raw.rstrip(b"\r\n").decode("latin-1")
            data: bytes | None = None
            sized = re.search(r"\{(\d+)\+?\}$", said)
            if sized:
                if "+}" not in said:
                    line("+ go on")
                data = reader.read(int(sized.group(1)))
                reader.readline()
                said = said[: sized.start()].rstrip()
            if idling:
                if said.upper() == "DONE":
                    self.idlers.discard(idling)
                    line(f"{idling.tag} OK idle done")
                    idling = None
                continue
            found = re.match(r"^(\S+) (UID )?([A-Za-z]+) ?(.*)$", said)
            if not found:
                continue
            tag, uid, command, rest = found.group(1), bool(found.group(2)), found.group(3).upper(), found.group(4)
            mails = self.boxes.get(box or "", Box()).mails
            if command == "CAPABILITY":
                line(f"* CAPABILITY {caps}")
                line(f"{tag} OK done")
            elif command == "LOGIN":
                words = [re.sub(r"\\(.)", r"\1", one) for one in re.findall(r'"((?:[^"\\]|\\.)*)"', rest)]
                given = data.decode() if data is not None else (words[1] if len(words) > 1 else "")
                authed = bool(words) and words[0] == USER and given == PASSWORD
                line(f"{tag} OK in" if authed else f"{tag} NO [AUTHENTICATIONFAILED] no")
            elif command == "AUTHENTICATE":
                parts = base64.b64decode(rest.split(" ")[1] if " " in rest else "").split(b"\0")
                authed = len(parts) == 3 and parts[1].decode() == USER and parts[2].decode() == PASSWORD
                line(f"{tag} OK in" if authed else f"{tag} NO [AUTHENTICATIONFAILED] no")
            elif not authed and command != "LOGOUT":
                line(f"{tag} BAD not authenticated")
            elif command == "LIST":
                line('* LIST (\\HasNoChildren) "/" "INBOX"')
                line('* LIST (\\HasNoChildren \\Sent) "/" "Sent"')
                line(f"{tag} OK listed")
            elif command == "SELECT":
                box = rest.strip('"')
                held = self.boxes.get(box, Box())
                line(f"* {len(held.mails)} EXISTS")
                line(f"* OK [UIDNEXT {held.next + 1}] next")
                line(f"{tag} OK [READ-WRITE] selected")
            elif command == "FETCH":
                ranged, _, wanted = rest.partition(" ")
                wanted = wanted.upper()
                for seq, one in enumerate(list(mails), start=1):
                    if not in_range(ranged, one["uid"] if uid else seq, uid, mails):
                        continue
                    parts = [f"UID {one['uid']}".encode(), f"FLAGS ({' '.join(sorted(one['flags']))})".encode()]
                    if "ENVELOPE" in wanted:
                        parts.append(b"ENVELOPE " + envelope(one["raw"]).encode("latin-1"))
                    if "HEADER.FIELDS" in wanted:
                        parsed = email.message_from_bytes(one["raw"], policy=email.policy.compat32)
                        references = parsed.get("References")
                        block = f"References: {references}\r\n\r\n" if references else "\r\n"
                        parts.append(f"BODY[HEADER.FIELDS (REFERENCES)] {{{len(block)}}}\r\n{block}".encode("latin-1"))
                    if "BODY.PEEK[]" in wanted:
                        parts.append(f"BODY[] {{{len(one['raw'])}}}\r\n".encode() + one["raw"])
                    send(f"* {seq} FETCH (".encode() + b" ".join(parts) + b")\r\n")
                line(f"{tag} OK fetched")
            elif command == "STORE":
                ranged = rest.split(" ")[0]
                for one in mails:
                    if in_range(ranged, one["uid"], True, mails) and "\\SEEN" in rest.upper():
                        one["flags"].add("\\Seen")
                line(f"{tag} OK stored")
            elif command == "APPEND":
                name = re.match(r'^"([^"]*)"', rest)
                if data is not None and name:
                    self.deliver(name.group(1), data, ("\\Seen",))
                    line(f"{tag} OK appended")
                else:
                    line(f"{tag} BAD no literal")
            elif command == "IDLE":
                class Idle:
                    def __init__(self, tag: str, wake: Any) -> None:
                        self.tag = tag
                        self.wake = wake

                    def __call__(self) -> None:
                        self.wake()

                current = box or ""
                idling = Idle(tag, lambda: line(f"* {len(self.boxes.get(current, Box()).mails)} EXISTS"))
                self.idlers.add(idling)
                line("+ idling")
            elif command == "NOOP":
                line(f"{tag} OK noop")
            elif command == "LOGOUT":
                line("* BYE")
                line(f"{tag} OK bye")
                return
            else:
                line(f"{tag} BAD unknown")

    def _smtp(self, client: socket.socket) -> None:
        reader = client.makefile("rb")

        def line(words: str) -> None:
            client.sendall(words.encode("latin-1") + b"\r\n")

        line("220 fake ESMTP")
        body: list[bytes] | None = None
        while True:
            raw = reader.readline()
            if not raw:
                return
            said = raw.rstrip(b"\r\n")
            if body is not None:
                if said == b".":
                    self.sent.append(b"\r\n".join(body))
                    body = None
                    line("250 queued")
                else:
                    body.append(said[1:] if said.startswith(b"..") else said)
                continue
            upper = said.decode("latin-1").upper()
            if upper.startswith("EHLO") or upper.startswith("HELO"):
                line("250-fake")
                line("250-AUTH PLAIN LOGIN")
                line("250 8BITMIME")
            elif upper.startswith("AUTH PLAIN"):
                parts = base64.b64decode(said.split(b" ")[2]).split(b"\0")
                right = len(parts) == 3 and parts[1].decode() == USER and parts[2].decode() == PASSWORD
                line("235 ok" if right else "535 no")
            elif upper.startswith("MAIL FROM:") or upper.startswith("RCPT TO:"):
                line("250 ok")
            elif upper == "DATA":
                body = []
                line("354 go on")
            elif upper == "QUIT":
                line("221 bye")
                return
            else:
                line("502 no")

def in_range(ranged: str, at: int, uid: bool, mails: list[dict[str, Any]]) -> bool:
    top = (mails[-1]["uid"] if mails else 0) if uid else len(mails)
    for piece in ranged.split(","):
        low_said, _, high_said = piece.partition(":")
        low = top if low_said == "*" else int(low_said or 0)
        high = low if not high_said else top if high_said == "*" else int(high_said)
        if min(low, high) <= at <= max(low, high):
            return True
    return False

def envelope(raw: bytes) -> str:
    parsed = email.message_from_bytes(raw, policy=email.policy.compat32)

    def quoted(value: str | None) -> str:
        if value is None:
            return "NIL"
        return '"' + re.sub(r'([\\"])', r"\\\1", value) + '"'

    def people(name: str) -> str:
        found = email.utils.getaddresses(parsed.get_all(name) or [])
        if not found:
            return "NIL"
        said = []
        for real, address in found:
            mailbox, _, host = address.partition("@")
            said.append(f"({quoted(real or None)} NIL {quoted(mailbox)} {quoted(host)})")
        return "(" + "".join(said) + ")"

    return (
        f"({quoted(parsed.get('Date'))} {quoted(parsed.get('Subject'))} {people('From')} "
        f"{people('From')} {people('From')} {people('To')} {people('Cc')} NIL "
        f"{quoted(parsed.get('In-Reply-To'))} {quoted(parsed.get('Message-ID'))})"
    )

def large_mail(payload: bytes) -> bytes:
    made = EmailMessage(policy=email.policy.SMTP)
    made["From"] = "Heron <heron@example.net>"
    made["To"] = f"Probe <{USER}>"
    made["Subject"] = "A large paper"
    made["Date"] = email.utils.formatdate(localtime=False)
    made["Message-ID"] = "<large.1@example.net>"
    made.set_content("Here is the paper, all of it.\n")
    made.add_attachment(payload, maintype="application", subtype="octet-stream", filename="paper.bin")
    return made.as_bytes()

def attachment_of(raw: bytes) -> bytes | None:
    parsed = email.message_from_bytes(raw, policy=email.policy.default)
    for part in parsed.walk():
        if part.get_filename():
            return part.get_payload(decode=True)
    return None

LONG_TASKS = """
globalThis.__mailProbeLong = []
globalThis.__mailProbeWatch?.disconnect()
globalThis.__mailProbeWatch = new PerformanceObserver((list) => {
  for (const one of list.getEntries()) globalThis.__mailProbeLong.push(Math.round(one.duration))
})
globalThis.__mailProbeWatch.observe({ type: 'longtask' })
"""

def watched(code: str) -> str:
    return f"""(async () => {{
{LONG_TASKS}
while (!globalThis.nibApp?.linked) await new Promise((done) => setTimeout(done, 100))
const {{ connected, accounts, host, openConversation }} = await nibApp.linked()
const said = await (async () => {{ {code} }})()
await new Promise((done) => setTimeout(done, 500))
return {{ ...said, long: globalThis.__mailProbeLong.slice() }}
}})()"""

DIGEST = """
const digest = async (bytes) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((one) => one.toString(16).padStart(2, '0'))
    .join('')
"""

def served() -> int:
    fake = FakeMail()
    payload = os.urandom(LARGE)
    fake.deliver("INBOX", large_mail(payload))
    say(json.dumps({"imap": fake.imap_port, "smtp": fake.smtp_port, "digest": hashlib.sha256(payload).hexdigest()}))
    sys.stdin.read()

    def digest(raw: bytes) -> str:
        return hashlib.sha256(attachment_of(raw) or b"").hexdigest()

    say(json.dumps({
        "sent": [digest(one) for one in fake.sent],
        "filed": [digest(one["raw"]) for one in fake.boxes["Sent"].mails],
    }))
    return 0

def main() -> int:
    parsed = argparse.ArgumentParser(description=__doc__)
    parsed.add_argument("--serve", action="store_true")
    parsed.add_argument("--exe", type=pathlib.Path)
    parsed.add_argument("--identifier")
    options = parsed.parse_args()
    if options.serve:
        return served()
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0
    if not options.exe or not options.identifier:
        parsed.error("--exe and --identifier are needed")

    close_app, run_probe, browser = windows_side()
    fake = FakeMail()
    payload = os.urandom(LARGE)
    fake.deliver("INBOX", large_mail(payload))
    say(f"fake IMAP on {fake.imap_port}, SMTP on {fake.smtp_port}, mail of {len(fake.boxes['INBOX'].mails[0]['raw'])} bytes")

    browser.wipe(options.identifier)
    space = browser.spaces_root() / SPACE
    space.mkdir(parents=True)
    (space / f"{NOTE}.md").write_text(f"# {NOTE}\n\nA note to open the space on.\n", encoding="utf-8")

    wrong: list[str] = []
    said: dict[str, object] = {}
    running = None
    try:
        running = run_probe(options.exe, quiet=True)
        port, secret = browser.endpoint(options.identifier, 90, running.pid)
        browser.shown(running.pid)
        browser.act(port, secret, "open", {"path": f"{NOTE}.md", "space": SPACE})
        time.sleep(3)
        if not close_app(running):
            running.terminate()
        running.wait(timeout=30)
        browser.allow_eval(options.identifier)

        running = run_probe(options.exe, quiet=True)
        port, secret = browser.endpoint(options.identifier, 90, running.pid)
        browser.shown(running.pid)
        until = time.perf_counter() + 60
        while browser.ask(port, secret, "1 + 1") != 2 and time.perf_counter() < until:
            time.sleep(1)

        config = {
            "address": USER,
            "password": PASSWORD,
            "imapHost": f"127.0.0.1:{fake.imap_port}",
            "smtpHost": f"127.0.0.1:{fake.smtp_port}",
            "imapSecurity": "none",
            "smtpSecurity": "none",
        }
        linked = browser.ask(port, secret, watched(f"""
const one = await connected.link(accounts.providerOf('mail'), {json.dumps(config)}, host)
return {{ account: one.account.id, conversations: one.conversations.map((it) => ({{ id: it.id, title: it.title }})) }}
"""))
        said["linked"] = linked
        conversations = linked.get("conversations") if isinstance(linked, dict) else None
        if not conversations:
            wrong.append(f"the mail account did not link or showed no conversation: {linked}")
            return finish(said, wrong)
        account = linked["account"]
        conversation = conversations[0]["id"]
        key = {"provider": "mail", "account": account, "conversation": conversation}

        opened = browser.ask(port, secret, watched(f"""
const began = performance.now()
openConversation({json.dumps(key)}, 'A large paper')
const until = began + 60000
while (performance.now() < until && !document.body.innerText.includes('paper.bin'))
  await new Promise((done) => setTimeout(done, 50))
return {{ shown: document.body.innerText.includes('paper.bin'), ms: Math.round(performance.now() - began) }}
"""))
        said["opened"] = opened
        if not isinstance(opened, dict) or not opened.get("shown"):
            wrong.append(f"the large mail's conversation never showed its file: {opened}")

        read = browser.ask(port, secret, watched(DIGEST + f"""
const one = connected.find('mail', {json.dumps(account)})
const page = await one.connection.history({json.dumps(conversation)}, {{ limit: 20 }})
const mail = page.messages.find((it) => it.attachments.length)
if (!mail) return {{ error: 'no mail with a file' }}
const began = performance.now()
const bytes = await one.connection.attachment({json.dumps(conversation)}, mail.id, mail.attachments[0].ref)
return {{ ms: Math.round(performance.now() - began), size: bytes.length, digest: await digest(bytes), name: mail.attachments[0].name }}
"""))
        said["read"] = read
        if not isinstance(read, dict) or read.get("digest") != hashlib.sha256(payload).hexdigest():
            wrong.append(f"the file read back is not the file sent: {read}")

        sent = browser.ask(port, secret, watched(DIGEST + f"""
const one = connected.find('mail', {json.dumps(account)})
const bytes = new Uint8Array({LARGE})
for (let at = 0; at < bytes.length; at += 65536) crypto.getRandomValues(bytes.subarray(at, at + 65536))
const wanted = await digest(bytes)
globalThis.__mailProbeLong.length = 0
const began = performance.now()
await one.connection.send({json.dumps(conversation)}, {{ text: 'Here it is back.', attachments: [{{ name: 'back.bin', type: 'application/octet-stream', bytes }}] }})
return {{ ms: Math.round(performance.now() - began), digest: wanted }}
"""))
        said["sent"] = sent
        wanted = sent.get("digest") if isinstance(sent, dict) else None
        if not fake.sent:
            wrong.append(f"nothing arrived over SMTP: {sent}")
        else:
            arrived = attachment_of(fake.sent[-1])
            said["arrived"] = {"bytes": len(fake.sent[-1]), "file": len(arrived or b"")}
            if arrived is None or hashlib.sha256(arrived).hexdigest() != wanted:
                wrong.append("the file that arrived over SMTP is not the file the page sent")
        filed = fake.boxes["Sent"].mails
        if not filed or hashlib.sha256(attachment_of(filed[-1]["raw"]) or b"").hexdigest() != wanted:
            wrong.append(f"Sent holds no copy of the mail with its file: {len(filed)} filed")

        for name in ("linked", "opened", "read", "sent"):
            one = said.get(name)
            longest = max((one.get("long") or [0]) if isinstance(one, dict) else [0])
            if longest > LONGEST_MS:
                wrong.append(f"{name}: the window's JS thread was held for {longest} ms")
    finally:
        if running and running.poll() is None:
            if not close_app(running):
                running.terminate()
    return finish(said, wrong)

def finish(said: dict[str, object], wrong: list[str]) -> int:
    for name, value in said.items():
        print(f"{name:8} {value}")
    for one in wrong:
        print(f"WRONG: {one}")
    return 1 if wrong else 0

if __name__ == "__main__":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    sys.exit(main())
