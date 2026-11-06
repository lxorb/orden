#!/usr/bin/env python3

import http.server
import sys
import time

PORT, LOG = int(sys.argv[1]), sys.argv[2]
PIECE = b"x" * 65536
PIECES = 200

def say(line):
    with open(LOG, "a") as log:
        log.write(line + "\n")

class Serve(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if self.path.startswith("/slow") or self.path.startswith("/fast"):
            slow = self.path.startswith("/slow")
            self.send_response(200)
            self.send_header("content-type", "application/octet-stream")
            self.send_header("content-disposition", 'attachment; filename="report.bin"')
            self.send_header("content-length", str(len(PIECE) * PIECES))
            self.end_headers()
            sent = 0
            try:
                for sent in range(PIECES):
                    self.wfile.write(PIECE)
                    self.wfile.flush()
                    if slow:
                        time.sleep(0.25)
                say(f"{self.path} sent whole")
            except OSError:
                say(f"{self.path} hung up after {sent} of {PIECES}")
            return
        self.send_response(200)
        self.send_header("content-type", "text/html")
        self.end_headers()
        self.wfile.write(b"<!doctype html><title>downloads</title><p>a page with a file</p>")

    def log_message(self, *_):
        pass

http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Serve).serve_forever()
