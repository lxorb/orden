#!/usr/bin/env python3
"""A DNS over HTTPS server of its own, for scripts/dns-drive.py (#766, #767): it answers
`A` for the one name it is given with 127.0.0.1, refuses every other, and writes each
name it was asked for to its log, so a run can tell its lookups went through it.

    python3 scripts/doh-server.py <port> <cert.pem> <key.pem> <name> <log>
"""

import base64
import ssl
import struct
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT, CERT, KEY, NAME, LOG = int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]


def question(message):
    """The name and type asked, and where the question ends."""
    at, labels = 12, []
    while message[at]:
        length = message[at]
        labels.append(message[at + 1 : at + 1 + length].decode("ascii", "replace"))
        at += 1 + length
    kind = struct.unpack("!H", message[at + 1 : at + 3])[0]
    return ".".join(labels).lower(), kind, at + 5


def answer(message):
    name, kind, end = question(message)
    with open(LOG, "a") as log:
        log.write(f"{name} {kind}\n")
    ident = message[:2]
    found = name == NAME.lower()
    # A response, recursion available, NXDOMAIN for anything not ours.
    flags = 0x8180 if found else 0x8183
    answers = 1 if found and kind == 1 else 0
    head = ident + struct.pack("!HHHHH", flags, 1, answers, 0, 0)
    body = message[12:end]
    if answers:
        body += b"\xc0\x0c" + struct.pack("!HHIH", 1, 1, 60, 4) + bytes([127, 0, 0, 1])
    return head + body


class Doh(BaseHTTPRequestHandler):
    def reply(self, message):
        said = answer(message)
        self.send_response(200)
        self.send_header("content-type", "application/dns-message")
        self.send_header("content-length", str(len(said)))
        self.end_headers()
        self.wfile.write(said)

    def do_GET(self):  # noqa: N802
        asked = parse_qs(urlparse(self.path).query).get("dns", [""])[0]
        self.reply(base64.urlsafe_b64decode(asked + "=" * (-len(asked) % 4)))

    def do_POST(self):  # noqa: N802
        self.reply(self.rfile.read(int(self.headers.get("content-length", "0"))))

    def log_message(self, *_):
        pass


server = ThreadingHTTPServer(("127.0.0.1", PORT), Doh)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(CERT, KEY)
server.socket = context.wrap_socket(server.socket, server_side=True)
print(f"doh on {PORT} for {NAME}", flush=True)
server.serve_forever()
