import json
import subprocess
import sys
import time

PLATFORM = {"win32": "windows", "darwin": "macos"}.get(sys.platform, "linux")

if PLATFORM == "windows":
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    try:
        user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except Exception:
        pass
    VK = {"tab": 0x09, "ctrl": 0x11, "shift": 0x10, "alt": 0x12, "enter": 0x0D, "escape": 0x1B}

    class KI(ctypes.Structure):
        _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_void_p)]

    class MI(ctypes.Structure):
        _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD), ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_void_p)]

    class U(ctypes.Union):
        _fields_ = [("ki", KI), ("mi", MI)]

    class INPUT(ctypes.Structure):
        _fields_ = [("type", wintypes.DWORD), ("u", U)]

    def send(one):
        user32.SendInput(1, ctypes.byref(one), ctypes.sizeof(INPUT))

    def vk(code, up):
        send(INPUT(1, U(ki=KI(code, 0, 2 if up else 0, 0, None))))

    def move(x, y):
        user32.SetCursorPos(round(x), round(y))
        send(INPUT(0, U(mi=MI(0, 0, 0, 0x0001, 0, None))))

    def button(down):
        send(INPUT(0, U(mi=MI(0, 0, 0, 0x0002 if down else 0x0004, 0, None))))

    def text(s):
        for ch in s:
            for flags in (4, 6):
                send(INPUT(1, U(ki=KI(0, ord(ch), flags, 0, None))))
            time.sleep(0.04)

    def key(combo):
        parts = combo.lower().split("+")
        codes = [VK.get(p) or ord(p.upper()) for p in parts]
        for c in codes:
            vk(c, False)
            time.sleep(0.02)
        for c in reversed(codes):
            vk(c, True)
            time.sleep(0.02)

elif PLATFORM == "macos":
    import Quartz

    KEYCODE = {"j": 38, "p": 35, "z": 6, "tab": 48, "k": 40, "enter": 36, "escape": 53, "a": 0, "b": 11}
    FLAG = {"ctrl": Quartz.kCGEventFlagMaskControl, "shift": Quartz.kCGEventFlagMaskShift, "alt": Quartz.kCGEventFlagMaskAlternate, "cmd": Quartz.kCGEventFlagMaskCommand}
    held = {"down": False, "at": (0, 0)}

    def post(event):
        Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)

    def move(x, y):
        kind = Quartz.kCGEventLeftMouseDragged if held["down"] else Quartz.kCGEventMouseMoved
        post(Quartz.CGEventCreateMouseEvent(None, kind, (x, y), Quartz.kCGMouseButtonLeft))
        held["at"] = (x, y)

    def button(down):
        kind = Quartz.kCGEventLeftMouseDown if down else Quartz.kCGEventLeftMouseUp
        post(Quartz.CGEventCreateMouseEvent(None, kind, held["at"], Quartz.kCGMouseButtonLeft))
        held["down"] = down

    def text(s):
        for ch in s:
            for down in (True, False):
                event = Quartz.CGEventCreateKeyboardEvent(None, 0, down)
                Quartz.CGEventKeyboardSetUnicodeString(event, 1, ch)
                Quartz.CGEventSetFlags(event, 0)
                post(event)
            time.sleep(0.04)

    def key(combo):
        parts = combo.lower().split("+")
        flags = 0
        for p in parts[:-1]:
            flags |= FLAG[p]
        code = KEYCODE[parts[-1]]
        for down in (True, False):
            event = Quartz.CGEventCreateKeyboardEvent(None, code, down)
            Quartz.CGEventSetFlags(event, flags)
            post(event)
            time.sleep(0.03)

else:
    def xdo(*a):
        subprocess.run(["xdotool", *[str(x) for x in a]], check=True)

    def move(x, y):
        xdo("mousemove", round(x), round(y))

    def button(down):
        xdo("mousedown" if down else "mouseup", 1)

    def text(s):
        xdo("type", "--delay", 40, s)

    def key(combo):
        xdo("key", combo.replace("tab", "Tab").replace("escape", "Escape").replace("cmd", "super"))


def click(x, y):
    move(x, y)
    time.sleep(0.1)
    button(True)
    time.sleep(0.05)
    button(False)


def drag(x1, y1, x2, y2):
    move(x1, y1)
    time.sleep(0.3)
    button(True)
    time.sleep(0.4)
    for i in range(1, 9):
        move(x1 + i * 2, y1 + i)
        time.sleep(0.08)
    time.sleep(0.5)
    steps = 40
    for i in range(1, steps + 1):
        move(x1 + 16 + (x2 - x1 - 16) * i / steps, y1 + 8 + (y2 - y1 - 8) * i / steps)
        time.sleep(0.05)
    for _ in range(6):
        move(x2 + 2, y2 + 1)
        time.sleep(0.08)
        move(x2, y2)
        time.sleep(0.08)
    time.sleep(0.4)
    button(False)


def grab(out):
    import mss
    import mss.tools

    grabber = getattr(mss, "MSS", None) or mss.mss
    with grabber() as s:
        shot = s.grab(s.monitors[1])
        mss.tools.to_png(shot.rgb, shot.size, output=out)
        print(json.dumps({"width": shot.size[0], "height": shot.size[1]}))


def film(out, y, seconds):
    import mss

    grabber = getattr(mss, "MSS", None) or mss.mss
    with grabber() as s:
        mon = s.monitors[1]
        box = {"left": mon["left"], "top": mon["top"] + int(y), "width": mon["width"], "height": 1}
        end = time.time() + float(seconds)
        n = 0
        with open(out, "wb") as f:
            while time.time() < end:
                f.write(s.grab(box).rgb)
                n += 1
        print(json.dumps({"frames": n, "width": mon["width"]}))


def main():
    cmd, *a = sys.argv[1:]
    if cmd == "click":
        click(float(a[0]), float(a[1]))
    elif cmd == "type":
        text(a[0])
    elif cmd == "key":
        key(a[0])
    elif cmd == "drag":
        drag(*[float(x) for x in a[:4]])
    elif cmd == "grab":
        grab(a[0])
    elif cmd == "film":
        film(a[0], a[1], a[2])
    elif cmd == "probe":
        print(PLATFORM)


main()
