from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.request
import uuid

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
SHOTS = DRIVE.shots
ORIGIN = harness.worker_origin()

EMAIL = "tints-drive@example.com"

DRESSED = {"Work": "Briefcase", "Work/Ideas": "folder-open"}
PAINTED = {"Work": "violet", "Work/Ideas": "teal"}

failures: list[str] = []

def shows(what: str, saw: object, wanted: object) -> None:
    if saw == wanted:
        say(f"ok   {what}: {saw!r}")
        return

    failures.append(what)
    say(f"NOT  {what}: {saw!r}, wanted {wanted!r}")

def request(path: str, token: str | None = None, body: object = None, method: str | None = None):
    data = None if body is None else json.dumps(body).encode()
    ask = urllib.request.Request(f"{ORIGIN}{path}", data=data, method=method)
    if token:
        ask.add_header("authorization", f"Bearer {token}")
    if data is not None:
        ask.add_header("content-type", "application/json")

    try:
        with urllib.request.urlopen(ask, timeout=30) as answer:
            said = answer.read().decode()
            return json.loads(said) if said else {}
    except urllib.error.HTTPError as refused:
        said = refused.read().decode()
        return {"status": refused.code, **(json.loads(said) if said else {})}

class Worker(harness.Worker):

    def __init__(self) -> None:
        super().__init__(DRIVE)

    def account(self) -> str:  # type: ignore[override]
        now = int(time.time() * 1000)
        user = str(uuid.uuid4())
        self.sql(f"insert into users (id, email, created_at) values ('{user}', '{EMAIL}', {now});")

        return user

    def device(self, user: str, name: str) -> str:
        token = uuid.uuid4().hex + uuid.uuid4().hex
        digest = hashlib.sha256(token.encode()).hexdigest()
        now = int(time.time() * 1000)

        self.sql(
            "insert into sessions (token_hash, user_id, created_at, expires_at, id, name,"
            f" last_used_at) values ('{digest}', '{user}', {now}, {now + 86400000},"
            f" '{uuid.uuid4().hex[:16]}', '{name}', {now});"
        )

        return token

def listed(token: str, space: str) -> dict:
    for one in request("/v1/spaces", token).get("spaces", []):
        if one.get("id") == space:
            return one

    raise SystemExit(f"the listing has no space {space}")

def drive() -> None:
    worker = Worker()

    with DRIVE.session(browser=False):
        worker.start()
        user = worker.account()
        here = worker.device(user, "the desktop")
        there = worker.device(user, "the phone")
        say("one account, two devices signed in")

        space = request("/v1/spaces", here, {"name": "Notes"})["space"]["id"]

        dressed = request(
            f"/v1/spaces/{space}", here, {"icon": "Briefcase", "tint": "violet"}, method="PATCH"
        )
        shows("the desktop dresses the space", dressed["space"]["tint"], "violet")
        shows("the phone reads that colour", listed(there, space)["tint"], "violet")

        painted = request(
            f"/v1/spaces/{space}/icons", here, {"icons": DRESSED, "tints": PAINTED}, method="PUT"
        )
        shows("both maps come back from the one request", painted["tints"], PAINTED)

        phone = listed(there, space)
        shows("the phone reads the icons", phone["icons"], DRESSED)
        shows("and the colour of each", phone["tints"], PAINTED)

        old = request(
            f"/v1/spaces/{space}/icons",
            there,
            {"icons": {**DRESSED, "Travel": "Plane"}},
            method="PUT",
        )
        shows("an older app leaves the colours as they were", old["tints"], PAINTED)
        shows("while its own icon arrives", listed(here, space)["icons"].get("Travel"), "Plane")

        request(
            f"/v1/spaces/{space}/icons",
            there,
            {"icons": DRESSED, "tints": {"Work": "violet"}},
            method="PUT",
        )
        shows("a colour taken off on the phone", listed(here, space)["tints"], {"Work": "violet"})

        bare = request(f"/v1/spaces/{space}", there, {"tint": None}, method="PATCH")
        shows("and the space's own, taken off", bare["space"]["tint"], None)
        shows("with its icon left where it was", bare["space"]["icon"], "Briefcase")

        request(
            f"/v1/spaces/{space}/icons",
            here,
            {
                "icons": {"Studio": "Briefcase", "Studio/Ideas": "folder-open"},
                "tints": {"Studio": "violet", "Studio/Ideas": "teal"},
            },
            method="PUT",
        )
        moved = listed(there, space)
        shows("a renamed folder keeps its icon", moved["icons"].get("Studio"), "Briefcase")
        shows("and its colour, under the new key", moved["tints"].get("Studio"), "violet")
        shows("with nothing left under the old one", moved["tints"].get("Work"), None)

        junk = request(
            f"/v1/spaces/{space}/icons",
            here,
            {
                "icons": {"Studio": "Briefcase"},
                "tints": {"Studio": "#7c6bf5", "Elsewhere": "../../etc"},
            },
            method="PUT",
        )
        shows("a hex and a path are dropped", junk["tints"], {})

        request(f"/v1/spaces/{space}", here, {"icon": "Briefcase", "tint": "teal"}, method="PATCH")
        for bad in ("#7c6bf5", "Violet", "rgb(1, 2, 3)"):
            refused = request(f"/v1/spaces/{space}", here, {"tint": bad}, method="PATCH")
            shows(f"{bad!r} leaves the colour as it was", refused["space"]["tint"], "teal")

        ahead = request(f"/v1/spaces/{space}", here, {"tint": "oxblood"}, method="PATCH")
        shows("but a colour a newer app named is carried", ahead["space"]["tint"], "oxblood")
        shows("and the other device reads it", listed(there, space)["tint"], "oxblood")

        columns = worker.sql(
            "select name from pragma_table_info('spaces') where name in ('tint', 'tints');"
        )
        shows("0036 added tint", "tint" in columns, True)
        shows("and tints", "tints" in columns, True)

    if failures:
        raise SystemExit(f"{len(failures)} of them did not: {', '.join(failures)}")

    say("every colour crossed")

if __name__ == "__main__":
    drive()
