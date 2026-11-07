from __future__ import annotations

import argparse
import json
import os
import pathlib
import secrets
import shutil
import subprocess
import sys
import time
import urllib.request

from probe_app import identifier_of, run_probe

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
WORK = ROOT / "target" / "recorder-e2e"
SPACES = WORK / "spaces"
SHOTS = WORK / "shots"

failures: list[str] = []

def say(what: str) -> None:
    print(f"  {what}", flush=True)

def wrong(what: str) -> None:
    failures.append(what)
    print(f"  FAIL {what}", flush=True)

def endpoint_of(identifier: str) -> pathlib.Path:
    return pathlib.Path(os.environ["APPDATA"]) / identifier / "automation.json"

def profile_of(identifier: str) -> pathlib.Path:
    return pathlib.Path(os.environ["LOCALAPPDATA"]) / identifier

def allow_eval(path: pathlib.Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"port": 0, "secret": secrets.token_hex(32), "eval": True}),
        encoding="utf-8",
    )

def started(app: pathlib.Path) -> subprocess.Popen[bytes]:
    SPACES.mkdir(parents=True, exist_ok=True)
    return run_probe(
        app,
        env={**os.environ, "ORDEN_SPACES_DIR": str(SPACES), "ORDEN_TRACE_STARTUP": "1"},
    )

def trace_of(identifier: str) -> list[str]:
    path = pathlib.Path(os.environ["LOCALAPPDATA"]) / identifier / "logs" / "startup-trace.log"
    if not path.exists():
        return []

    return [
        line.strip()
        for line in path.read_text(encoding="utf-8", errors="replace").split("\n")
        if "microphone" in line
    ]

def waited_for(path: pathlib.Path, patience: float = 90) -> dict:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        try:
            held = json.loads(path.read_text(encoding="utf-8"))
            if held.get("port") and held.get("secret"):
                return held
        except (OSError, ValueError):
            pass
        time.sleep(0.4)

    raise SystemExit(f"no endpoint at {path} after {patience:.0f}s")

def asked(held: dict, verb: str, args: dict) -> dict:
    body = json.dumps({"verb": verb, "args": args, "rest": []}).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{held['port']}/",
        data=body,
        headers={"authorization": f"Bearer {held['secret']}", "content-type": "application/json"},
    )

    with urllib.request.urlopen(request, timeout=60) as answer:
        return json.loads(answer.read().decode())

def ran(held: dict, code: str) -> object:
    answer = asked(held, "eval", {"code": code, "yes": True})
    if not answer.get("ok"):
        wrong(f"the window would not run {code!r}: {answer.get('error')}")
        return None

    return answer.get("value")

def shot(pid: int, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            shutil.which("powershell") or "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(HERE / "capture-window.ps1"),
            "-ProcessId",
            str(pid),
            "-Out",
            str(SHOTS / f"{name}.png"),
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    say(f"photographed {name}.png")

HAS_INPUT = """
navigator.mediaDevices.enumerateDevices().then((all) => JSON.stringify({
  inputs: all.filter((one) => one.kind === 'audioinput').length,
  // A microphone is only reachable from a secure context, and the app is served from a
  // host the engine has to count as one. If this ever says false, nothing else here can
  // work and the reason is the address rather than the permission.
  secure: isSecureContext,
  origin: location.origin,
}))
"""

OPENS = """
(async () => {
  const began = Date.now()
  try {
    const stream = await Promise.race([
      navigator.mediaDevices.getUserMedia({ audio: true }),
      new Promise((_ok, no) => setTimeout(() => no(new Error('never answered')), 25000)),
    ])
    const tracks = stream.getAudioTracks().map((one) => one.label || 'an input')
    for (const track of stream.getTracks()) track.stop()
    return { ms: Date.now() - began, tracks }
  } catch (error) {
    return { ms: Date.now() - began, refused: String(error && error.message ? error.message : error) }
  }
})()
"""

def drive(app: pathlib.Path, given: str | None) -> None:
    identifier = identifier_of(app, given)
    endpoint = endpoint_of(identifier)
    shutil.rmtree(profile_of(identifier), ignore_errors=True)
    allow_eval(endpoint)

    process = started(app)
    try:
        held = waited_for(endpoint)
        say(f"{identifier} is up on port {held['port']}, pid {held.get('pid')}")
        time.sleep(4.0)

        listed = ran(held, HAS_INPUT)
        say(f"the page says {listed}")
        inputs = json.loads(str(listed)).get("inputs", 0) if listed else 0

        for line in trace_of(identifier):
            say(f"trace: {line}")

        opened = ran(held, OPENS)
        if not isinstance(opened, dict):
            wrong(f"the window said nothing about the microphone: {opened!r}")
            return

        if "refused" in opened:
            say(f"the microphone was refused in {opened['ms']}ms: {opened['refused']!r}")
            for line in trace_of(identifier):
                say(f"trace: {line}")
            if opened["ms"] > 24000:
                wrong(f"the microphone request never settled: {opened}")
            else:
                say("it settled, which is the whole of what used to be broken")
            if not inputs:
                say("and this machine lists no input, so a refusal is the right answer")
            shot(process.pid, "01-refused")
            return

        say(f"the microphone opened in {opened['ms']}ms: {opened['tracks']}")
        if opened["ms"] > 20000:
            wrong(f"opening the microphone took {opened['ms']}ms, which is a reader waiting")

        space = ran(
            held,
            "nib.workspace.activeSpace"
            " ? orden.workspace.activeSpace.name"
            " : orden.workspace.addSpace('Recordings').then(() => orden.workspace.activeSpace?.name ?? null)",
        )
        say(f"the space is {space!r}")
        if not space:
            wrong("no space could be made, so there is nowhere to record into")
            return

        note = ran(held, "nib.workspace.createNote().then(() => orden.workspace.active?.path ?? null)")
        say(f"recording into {note!r}")

        answer = asked(held, "commands.run", {"id": "record"})
        if not answer.get("ok"):
            wrong(f"the Record command would not run: {answer}")
            return
        say(f"Record pressed: {answer.get('value')}")

        time.sleep(4.0)
        pill = ran(
            held,
            "(() => { const one = document.querySelector('.recording'); return one ? one.textContent.trim() : null })()",
        )
        say(f"the pill says {pill!r}")
        if not pill:
            wrong("nothing is recording: there is no pill on the page")
        elif "0:00" in str(pill):
            wrong(f"the clock never moved: {pill!r}")

        shot(process.pid, "02-recording")

        answer = asked(held, "commands.run", {"id": "record"})
        if not answer.get("ok"):
            wrong(f"the Record command would not stop it: {answer}")
        time.sleep(4.0)

        text = ran(held, "nib.workspace.active?.doc ?? ''")
        say(f"the note now says {str(text)[:120]!r}")
        if "![[recording-" not in str(text):
            wrong("the note holds no embed, so nothing was written")

        shot(process.pid, "03-written")

        sounds = sorted(SPACES.rglob("recording-*.*"))
        if not sounds:
            wrong(f"no recording was written under {SPACES}")
        else:
            for one in sounds:
                size = one.stat().st_size
                say(f"{one.relative_to(SPACES)} is {size} bytes")
                if size < 2000:
                    wrong(f"{one.name} is {size} bytes, which is a header and no sound")
                if one.suffix not in {".weba", ".m4a"}:
                    wrong(f"{one.name} is not a sound file")

    finally:
        process.terminate()
        time.sleep(1.5)

def main() -> int:
    if sys.platform != "win32":
        print("this drive is about the WebView2 permission request", flush=True)
        return 0

    parser = argparse.ArgumentParser()
    parser.add_argument("--app", required=True, type=pathlib.Path)
    parser.add_argument("--identifier")
    said = parser.parse_args()

    shutil.rmtree(WORK, ignore_errors=True)
    drive(said.app.resolve(), said.identifier)

    if failures:
        print("\n%d thing(s) wrong:" % len(failures))
        for one in failures:
            print(f"  - {one}")
        return 1

    print("\nthe microphone answers in the app, and what it heard is a file in the space")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
