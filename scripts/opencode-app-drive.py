from __future__ import annotations
import argparse
import json
import os
import pathlib
import secrets
import signal
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from fresh_app import ended, fresh
import crash_told
from native_app import App, config_of, failed

INVOKE = "const i = window.__TAURI_INTERNALS__;"
START = INVOKE + "return await i.invoke('opencode_start', { config: { enabled_providers: [] }, preset: 'approve' })"
STATUS = INVOKE + "const s = await i.invoke('opencode_status'); return s.state === 'ready' ? s : null"
HEALTH = INVOKE + "return await i.invoke('opencode_call', { method: 'GET', path: '/global/health' })"
MCP = INVOKE + "return await i.invoke('opencode_call', { method: 'GET', path: '/mcp' })"
STOP = INVOKE + "return await i.invoke('opencode_stop')"
ENGINE = INVOKE + "return await i.invoke('opencode_engine')"
CONSENT = INVOKE + "await i.invoke('opencode_background', { on: true }); return true"
KICK = INVOKE + "try { await i.invoke('opencode_start', { config: { enabled_providers: [] }, preset: 'approve' }); return 'started' } catch (why) { return why }"
LANDED = INVOKE + "const e = await i.invoke('opencode_engine'); return e.installed ? e : null"
TAIL = 80
def reached(config: pathlib.Path, secret: str, process: subprocess.Popen[bytes], seconds: float = 120) -> App | None:
    path = config / "automation.json"
    stop = time.monotonic() + seconds
    while time.monotonic() < stop and process.poll() is None:
        try:
            said = json.loads(path.read_text(encoding="utf-8-sig"))
            if said.get("port") and said.get("pid"):
                crash_told.told(int(said["port"]), secret)
                return App(int(said["port"]), secret, 90)
        except (OSError, ValueError):
            pass
        time.sleep(0.25)
    return None
def tail(log: pathlib.Path) -> str:
    try:
        lines = log.read_bytes().decode("utf-8", "replace").splitlines()
    except OSError as why:
        return f"(no output: {why})"
    return "\n".join(lines[-TAIL:]) or "(no output)"
def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True)
    parser.add_argument("--identifier", required=True)
    args, rest = parser.parse_known_args()
    if "probe" not in args.identifier and os.environ.get("GITHUB_ACTIONS") != "true":
        raise SystemExit(f"{args.identifier} is not a probe identifier")
    config = config_of(args.identifier)
    fresh(config)
    secret = secrets.token_hex(32)
    (config / "automation.json").write_text(json.dumps({"port": 0, "secret": secret, "eval": True}), encoding="utf-8")
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="orden-opencode-spaces-"))
    env = {key: value for key, value in os.environ.items() if key != "ORDEN_OPENCODE_BIN"}
    env["ORDEN_SPACES_DIR"] = str(spaces)
    alone = {} if sys.platform == "win32" else {"start_new_session": True}
    log = pathlib.Path(tempfile.mkdtemp(prefix="orden-opencode-app-")) / "app.log"
    with log.open("wb") as said:
        process = subprocess.Popen(
            [args.exe, *rest], env=env, cwd=str(pathlib.Path(args.exe).parent), stdout=said, stderr=subprocess.STDOUT, **alone
        )
    wrong: list[str] = []
    code: int | None = None
    try:
        app = reached(config, secret, process)
        if app is None:
            code = process.poll()
            how = "still running" if code is None else f"ended with {code}"
            wrong.append(f"the app never wrote {config / 'automation.json'} ({how})")
        else:
            engine = app.until(ENGINE, 90, 1)
            print(f"opencode_engine said {json.dumps(engine)}", flush=True)
            if isinstance(engine, dict) and not engine.get("installed"):
                app.eval(CONSENT, 30)
                print(f"opencode_start before the download said {json.dumps(app.eval(KICK, 30))}", flush=True)
                landed = app.until(LANDED, 900, 2)
                print(f"after the download opencode_engine said {json.dumps(landed)}", flush=True)
                if failed(landed):
                    wrong.append(f"the app did not download OpenCode {engine.get('version')} from {engine.get('source')}")
            started = app.until(START, 90, 1)
            print(f"opencode_start said {json.dumps(started)}", flush=True)
            ready = app.until(STATUS, 60, 0.5)
            if failed(ready):
                wrong.append(f"the app's engine did not get ready: {json.dumps(started)}")
            else:
                health = app.eval(HEALTH, 30)
                print(f"the engine's health: {json.dumps(health)}", flush=True)
                if not (isinstance(health, dict) and health.get("status") == 200 and (health.get("body") or {}).get("healthy") is True):
                    wrong.append(f"the app's engine is not healthy: {json.dumps(health)}")
                mcp = app.eval(MCP, 30)
                print(f"the engine's MCP servers: {json.dumps(mcp)}", flush=True)
                if not (isinstance(mcp, dict) and ((mcp.get("body") or {}).get("orden") or {}).get("status") == "connected"):
                    wrong.append(f"Orden's own tools did not reach the engine: {json.dumps(mcp)}")
            app.eval(STOP, 30)
            code = process.poll()
    finally:
        ended(process)
        if sys.platform != "win32":
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except OSError:
                pass
    return finish(wrong, code, log)
def finish(wrong: list[str], code: int | None, log: pathlib.Path) -> int:
    if wrong:
        print(f"::group::the app ({'still running' if code is None else f'ended with {code}'}), its last {TAIL} lines", flush=True)
        print(tail(log), flush=True)
        print("::endgroup::", flush=True)
    for one in wrong:
        print(f"::error::{one}", flush=True)
    return 1 if wrong else 0
if __name__ == "__main__":
    raise SystemExit(main())
