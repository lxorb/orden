import json
import sys
import time

pid = int(sys.argv[1])
WANT = {"host": "gate host field", "page": "gate page field"}
found = {"host": None, "page": None}


def linux():
    import gi

    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi

    found["api"] = "AT-SPI"
    desktop = Atspi.get_desktop(0)
    app = None
    for i in range(desktop.get_child_count()):
        one = desktop.get_child_at_index(i)
        try:
            if one and one.get_process_id() == pid:
                app = one
                break
        except Exception:
            pass
    if app is None:
        found["error"] = "the app is not on the accessibility bus"
        return

    def walk(node, depth):
        if depth > 40 or node is None:
            return
        try:
            name = node.get_name()
            for key, want in WANT.items():
                if name == want and found[key] is None:
                    found[key] = node.get_role_name()
            for i in range(min(node.get_child_count(), 200)):
                walk(node.get_child_at_index(i), depth + 1)
        except Exception:
            pass

    for _ in range(3):
        walk(app, 0)
        if found["host"] and found["page"]:
            break
        time.sleep(2)


def macos():
    import ApplicationServices as AS

    found["api"] = "NSAccessibility"
    found["trusted"] = bool(AS.AXIsProcessTrusted())
    app = AS.AXUIElementCreateApplication(pid)
    AS.AXUIElementSetAttributeValue(app, "AXManualAccessibility", True)

    def attr(node, name):
        err, value = AS.AXUIElementCopyAttributeValue(node, name, None)
        return value if err == 0 else None

    def walk(node, depth):
        if depth > 40:
            return
        for label in ("AXDescription", "AXTitle"):
            name = attr(node, label)
            for key, want in WANT.items():
                if name == want and found[key] is None:
                    found[key] = str(attr(node, "AXRole"))
        for child in list(attr(node, "AXChildren") or [])[:200]:
            walk(child, depth + 1)

    for _ in range(3):
        walk(app, 0)
        if found["host"] and found["page"]:
            break
        time.sleep(2)


try:
    macos() if sys.platform == "darwin" else linux()
except Exception as error:
    found["error"] = str(error)[:300]
print(json.dumps(found))
