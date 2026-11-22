import argparse
import json
import os
import pathlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from fresh_app import ended, fresh
from native_app import INNER, config_of, endpoint, forward

ROWS = """return [...document.querySelectorAll('aside [data-panel] .orden-row:not(.is-on)')].filter((one) => one.getBoundingClientRect().height > 0 && one.innerText.trim()).slice(0, 4).map((one) => { const b = one.getBoundingClientRect(); return { text: one.innerText.trim().slice(0, 24), x: b.x, y: b.y, h: b.height } })"""
def at(x: float, y: float) -> str:
    return f"return (() => {{ const e = document.elementFromPoint({x}, {y}); const r = e && e.closest('.orden-row'); return r ? {{ bg: getComputedStyle(r).backgroundColor, hover: r.matches(':hover') }} : null }})()"
def moved(inner: dict, x: float, y: float) -> None:
    import ctypes
    ctypes.WinDLL("user32", use_last_error=True).SetCursorPos(round(inner["x"] + x * inner["ratio"]), round(inner["y"] + y * inner["ratio"]))
def main() -> int:
    if sys.platform != "win32":
        raise SystemExit("this drive moves the pointer on Windows")
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    args = parser.parse_args()
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-sidebar-hover-"))
    (spaces / "Notes").mkdir()
    for name in ("Alpha", "Beta", "Gamma"):
        (spaces / "Notes" / f"{name}.md").write_text(f"# {name}\n\nWords.\n", encoding="utf-8")
    process = subprocess.Popen([str(args.exe)], env={**os.environ, "ORDEN_SPACES_DIR": str(spaces)}, cwd=str(args.exe.parent))
    wrong: list[str] = []
    try:
        app = endpoint(config, process.pid, secret)
        app.until("window.ordenApp && orden.workspace.activeSpace ? true : null", 120)
        time.sleep(2)
        app.eval(
            "const app = window.ordenApp; const kinds = app.hiddenKinds;"
            " kinds.hidden = [...new Set([...kinds.hidden, 'experimental', 'experimental-chats'])];"
            " app.account.user = { id: 'u1', email: 'wren@example.com', name: 'Wren' }; app.account.token = 'drive';"
            " localStorage.setItem('orden:space-chats', JSON.stringify({ [orden.workspace.activeSpace.root]: true }));"
            " dispatchEvent(new StorageEvent('storage', { key: 'orden:space-chats' })); return true"
        )
        forward(app, process.pid)
        time.sleep(2)
        inner = app.eval(INNER)
        for panel in ("tree", "chats"):
            app.eval(f"orden.workspace.showPanel('{panel}'); return true")
            time.sleep(2)
            rows = app.eval(ROWS) or []
            print(f"{panel}: rows {[one['text'] for one in rows]}", flush=True)
            if not rows:
                wrong.append(f"the {panel} panel showed no row")
            for row in rows:
                x, y = row["x"] + 40, row["y"] + row["h"] / 2
                moved(inner, 900, 500)
                time.sleep(0.3)
                before = app.eval(at(x, y))
                moved(inner, x, y)
                time.sleep(0.6)
                after = app.eval(at(x, y))
                print(f"{panel} {row['text']!r}: {before} -> {after}", flush=True)
                if not after or not after["hover"] or (before and after["bg"] == before["bg"]):
                    wrong.append(f"the {panel} row {row['text']!r} did not light under the pointer")
    finally:
        ended(process)
        shutil.rmtree(spaces, ignore_errors=True)
    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0
if __name__ == "__main__":
    raise SystemExit(main())
