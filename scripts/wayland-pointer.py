#!/usr/bin/env python3
"""A mouse for a headless sway, which has none: a pointer the compositor itself moves
and presses, so a click lands on whatever surface is on top where it is - the app's own
page, or a web tab's page over it - the way a reader's click does. A click the drive
sends into the app's page as an event would land on the app however wrong the web tab's
page is placed; #387's web tab took the clicks meant for the tab strip and the ⋯ menu.

sway with no input devices tells a client its seat has no pointer, and `wlrctl` makes a
pointer for one command and takes it away again, before the app has a pointer to hear
it with. This holds one for as long as it runs: the wlr-virtual-pointer protocol, spoken
on the Wayland socket by hand (it is four requests), so nothing is installed for it.

Lines read from the FIFO at <path>, made if it is not there:

    move X Y      to X, Y in sway's layout, in its own (logical) pixels
    click         the left button pressed and let go
    quit

    python3 scripts/wayland-pointer.py <fifo>
"""

import json
import os
import socket
import struct
import subprocess
import sys
import time

FIFO = sys.argv[1]
LEFT = 0x110  # BTN_LEFT

wire = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
wire.connect(os.path.join(os.environ["XDG_RUNTIME_DIR"], os.environ["WAYLAND_DISPLAY"]))
ids = iter(range(2, 1 << 31))
unread = b""


def text(value):
    raw = value.encode() + b"\0"
    return struct.pack("<I", len(raw)) + raw + b"\0" * (-len(raw) % 4)


def send(obj, opcode, args=b""):
    wire.sendall(struct.pack("<II", obj, ((8 + len(args)) << 16) | opcode) + args)


def until(callback, registry):
    """Every global the registry names, read until the sync `callback` answers."""
    global unread
    names = {}
    while True:
        while len(unread) < 8:
            unread += wire.recv(65536)
        obj, word = struct.unpack("<II", unread[:8])
        size = word >> 16
        while len(unread) < size:
            unread += wire.recv(65536)
        body, unread = unread[8:size], unread[size:]
        if obj == 1 and word & 0xFFFF == 0:
            raise SystemExit(f"the compositor refused: {body!r}")
        if obj == registry and word & 0xFFFF == 0:
            name, length = struct.unpack("<II", body[:8])
            names[body[8 : 8 + length - 1].decode()] = name
        if obj == callback:
            return names


registry = next(ids)
send(1, 1, struct.pack("<I", registry))  # wl_display.get_registry
synced = next(ids)
send(1, 0, struct.pack("<I", synced))  # wl_display.sync
globals_ = until(synced, registry)
if "zwlr_virtual_pointer_manager_v1" not in globals_:
    raise SystemExit("this compositor makes no virtual pointers")
manager = next(ids)
send(
    registry,
    0,
    struct.pack("<I", globals_["zwlr_virtual_pointer_manager_v1"])
    + text("zwlr_virtual_pointer_manager_v1")
    + struct.pack("<II", 1, manager),
)
pointer = next(ids)
send(manager, 0, struct.pack("<II", 0, pointer))  # create_virtual_pointer, the default seat
synced = next(ids)
send(1, 0, struct.pack("<I", synced))
until(synced, registry)
print("a pointer is on the seat", flush=True)


def now():
    return int(time.monotonic() * 1000) & 0xFFFFFFFF


def layout():
    """How far sway's layout reaches, which an absolute motion is a share of."""
    outputs = json.loads(subprocess.check_output(["swaymsg", "-r", "-t", "get_outputs"]))
    return (
        max(one["rect"]["x"] + one["rect"]["width"] for one in outputs),
        max(one["rect"]["y"] + one["rect"]["height"] for one in outputs),
    )


def button(state):
    send(pointer, 2, struct.pack("<III", now(), LEFT, state))
    send(pointer, 4)  # frame


if not os.path.exists(FIFO):
    os.mkfifo(FIFO)
while True:
    with open(FIFO) as said:
        for line in said:
            words = line.split()
            if not words:
                continue
            if words[0] == "move":
                wide, tall = layout()
                x, y = (max(0, round(float(one))) for one in words[1:3])
                send(pointer, 1, struct.pack("<IIIII", now(), x, y, wide, tall))
                send(pointer, 4)
            elif words[0] == "click":
                button(1)
                time.sleep(0.05)
                button(0)
            elif words[0] == "quit":
                sys.exit(0)
