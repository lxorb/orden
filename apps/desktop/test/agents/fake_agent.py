from __future__ import annotations

import json
import queue
import subprocess
import threading
import time
import urllib.error
import urllib.request
from typing import Any

Answer = dict[str, Any]

ANSWER_META = "ch.emilvinu.nib/answer"

NO_VERB = "there is no verb called"

def answer(status: str, ms: float, **rest: Any) -> Answer:

    return {"status": status, "ms": round(ms, 1), **rest}

def from_contract(said: Any, ms: float) -> Answer:

    if not isinstance(said, dict):
        return answer("error", ms, code="unreadable", message=str(said))
    if said.get("status") in ("ok", "needs_approval", "error"):
        return {**said, "ms": round(ms, 1)}
    if said.get("ok") is True:
        return answer("ok", ms, result=said.get("value"))
    error = str(said.get("error", ""))
    if error.startswith(NO_VERB):
        return answer("missing", ms, message=error)
    return answer("error", ms, code="window", message=error)

class Endpoint:

    name = "endpoint"

    def __init__(self, port: int, token: str) -> None:
        self.port = port
        self.token = token
        self.known: dict[str, bool] = {}

    def call(self, verb: str, args: dict[str, Any], seconds: float = 60) -> Answer:
        body = json.dumps({"verb": verb, "args": args, "rest": []}).encode()
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/",
            data=body,
            headers={"authorization": f"Bearer {self.token}", "content-type": "application/json"},
        )
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(request, timeout=seconds) as said:
                text = said.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as refused:
            ms = (time.perf_counter() - started) * 1000
            text = refused.read().decode("utf-8", "replace")
            status = "missing" if refused.code == 401 else "error"
            return answer(status, ms, code=f"http {refused.code}", message=text)
        except Exception as error:  # noqa: BLE001 - a wedged app fails in its own ways
            return answer("error", (time.perf_counter() - started) * 1000, code="no answer", message=str(error))
        ms = (time.perf_counter() - started) * 1000
        try:
            return from_contract(json.loads(text), ms)
        except ValueError:
            return answer("error", ms, code="unreadable", message=text[:400])

    def has(self, verb: str) -> bool:

        if verb not in self.known:
            self.known[verb] = self.call(verb, {"harness": "is this verb here"}, seconds=10)["status"] != "missing"
        return self.known[verb]

    def close(self) -> None:
        return

class Mcp:

    name = "mcp"

    PROTOCOL = "2025-06-18"

    CLIENT = "orden-agent-harness"

    def __init__(self, process: subprocess.Popen[bytes]) -> None:
        self.process = process
        self.lines: queue.Queue[dict[str, Any]] = queue.Queue()
        self.next = 0
        self.tools: set[str] = set()
        threading.Thread(target=self._read, name="mcp reader", daemon=True).start()
        opened = self.request(
            "initialize",
            {
                "protocolVersion": self.PROTOCOL,
                "capabilities": {},
                "clientInfo": {"name": self.CLIENT, "version": "1"},
            },
        )
        self.instructions = str((opened.get("result") or {}).get("instructions", ""))
        self.absent = str(opened["error"].get("message")) if "error" in opened else ""
        if not self.absent:
            self.notify("notifications/initialized", {})
            listed = self.request("tools/list", {})
            self.tools = {str(one.get("name")) for one in (listed.get("result") or {}).get("tools", [])}

    def _read(self) -> None:
        assert self.process.stdout is not None
        for raw in self.process.stdout:
            try:
                said = json.loads(raw.decode("utf-8", "replace"))
            except ValueError:
                said = {"jsonrpc": "2.0", "id": None, "stray": raw[:200].decode("utf-8", "replace")}
            if isinstance(said, dict):
                self.lines.put(said)

    def send(self, message: dict[str, Any]) -> None:
        assert self.process.stdin is not None
        self.process.stdin.write((json.dumps(message) + "\n").encode())
        self.process.stdin.flush()

    def notify(self, method: str, params: dict[str, Any]) -> None:
        self.send({"jsonrpc": "2.0", "method": method, "params": params})

    def request(self, method: str, params: dict[str, Any], seconds: float = 60) -> dict[str, Any]:
        self.next += 1
        wanted = self.next
        self.send({"jsonrpc": "2.0", "id": wanted, "method": method, "params": params})
        until = time.perf_counter() + seconds
        while time.perf_counter() < until:
            try:
                said = self.lines.get(timeout=0.2)
            except queue.Empty:
                if self.process.poll() is not None:
                    return {"error": {"message": f"nib mcp ended with {self.process.returncode} before it answered {method}"}}
                continue
            if "stray" in said:
                return {"error": {"message": f"not JSON-RPC on stdout: {said['stray']}"}}
            if said.get("id") == wanted:
                return said
        return {"error": {"message": f"{method}: no answer in {seconds:.0f} s"}}

    def call(self, verb: str, args: dict[str, Any], seconds: float = 60) -> Answer:
        started = time.perf_counter()
        if verb not in self.tools:
            why = f"agent-mcp: {self.absent}" if self.absent else f"nib mcp lists no tool called {verb}"
            return answer("missing", 0, message=why)
        said = self.request("tools/call", {"name": verb, "arguments": args}, seconds)
        ms = (time.perf_counter() - started) * 1000
        if "error" in said:
            return answer("error", ms, code="rpc", message=str(said["error"].get("message")))
        result = said.get("result") or {}
        text = "\n".join(str(one.get("text", "")) for one in result.get("content", []) if one.get("type") == "text")
        pictures = [one for one in result.get("content", []) if one.get("type") == "image"]
        untrusted = marked_source(text)
        said = (result.get("_meta") or {}).get(ANSWER_META)
        if isinstance(said, dict) and said.get("status") in ("ok", "needs_approval", "error"):
            return {**said, "ms": round(ms, 1), "text": text, "pictures": len(pictures),
                    "untrusted": said.get("untrusted") or untrusted}
        status = "error" if result.get("isError") else "ok"
        return answer(status, ms, text=text, message=text if status == "error" else None,
                      untrusted=untrusted, pictures=len(pictures), result=None)

    def has(self, verb: str) -> bool:
        return verb in self.tools

    def close(self) -> None:
        if self.process.stdin is not None:
            self.process.stdin.close()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill()

def marked_source(text: str) -> str | None:

    at = text.find("<untrusted")
    if at < 0:
        return None
    start = text.find('source="', at)
    if start < 0:
        return ""
    start += len('source="')
    return text[start : text.find('"', start)]
