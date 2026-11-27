import http.server
import json
import subprocess
import sys
import time
from typing import Any
import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say, wrong = DRIVE.say, DRIVE.wrong
OWNER, MEMBER, OTHER = "emil@example.com", "lucile@example.com", "mia@example.com"
NAMES = {OWNER: "Emil", MEMBER: "Lucile", OTHER: "Mia"}
SENT: list[dict[str, Any]] = []
TOKENS_ASKED: list[str] = []
QUIET = 3.0
class Fcm(http.server.BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802 - the handler's name
        body = self.rfile.read(int(self.headers.get("content-length") or 0))
        if self.path == "/token":
            TOKENS_ASKED.append(body.decode("utf-8", errors="replace"))
            answer: dict[str, Any] = {"access_token": "drive-access", "expires_in": 3600}
        else:
            SENT.append(
                {
                    "path": self.path,
                    "authorization": self.headers.get("authorization"),
                    "message": json.loads(body)["message"],
                }
            )
            answer = {"name": "projects/orden-drive/messages/1"}
        raw = json.dumps(answer).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)
    def log_message(self, *_args: object) -> None:
        return
def service_account(fcm: str) -> str:
    made = subprocess.run(
        ["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048"],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.dumps(
        {
            "client_email": "drive@orden-drive.iam.gserviceaccount.com",
            "private_key": made.stdout,
            "project_id": "orden-drive",
            "token_uri": f"{fcm}/token",
        }
    )
COUNT = 0
def post(body: str, **extra: Any) -> dict[str, Any]:
    global COUNT  # noqa: PLW0603 - ids of this run
    COUNT += 2
    return {
        "kind": "post",
        "id": f"01PVSH{COUNT:020d}",
        "message": f"01PVSH{COUNT + 1:020d}",
        "body": body,
        **extra,
    }
def pushed_after(worker: harness.Worker, token: str, chat: str, event: dict[str, Any], many: int) -> list[dict[str, Any]]:
    before = len(SENT)
    answer = worker.request(f"/v2/chats/{chat}/events", token, {"events": [event]})
    result = (answer.get("results") or [{}])[0]
    if "refused" in result:
        wrong(f"the account refused the post: {result}")
    until = time.monotonic() + 20
    while time.monotonic() < until and len(SENT) - before < many:
        time.sleep(0.1)
    time.sleep(QUIET)
    return SENT[before:]
def main() -> int:
    with DRIVE.session(browser=False):
        fcm = DRIVE.side(Fcm)
        worker = harness.Worker(DRIVE, {"FCM_SERVICE_ACCOUNT": service_account(fcm), "FCM_ORIGIN": fcm})
        worker.start()
        tokens = {email: worker.account(email) for email in NAMES}
        ids = {}
        for email, name in NAMES.items():
            worker.request("/v1/me", tokens[email], {"name": name}, method="PATCH")
            ids[email] = worker.request("/v1/me", tokens[email])["user"]["id"]
        space = worker.request("/v1/spaces", tokens[OWNER], {"name": "Team"})["space"]
        for email in (MEMBER, OTHER):
            worker.request(f"/v1/spaces/{space['id']}/share/invite", tokens[OWNER], {"email": email, "role": "write"})
            link = worker.waits_for_mail(email, r"/join/([a-f0-9]+)", f"{email}'s invitation").group(1)
            worker.request(f"/v1/join/{link}", tokens[email], {})
        chat = worker.request("/v2/chats", tokens[OWNER], {"space": space["id"]})["chat"]
        say(f"Team holds {chat}, shared with Lucile and Mia")
        key = worker.request("/v2/push/key", tokens[MEMBER])
        if key.get("fcm") is not True:
            wrong(f"the Worker says its push services are {key}")
        for email, name, app in (
            (MEMBER, "lucile-chat", "chat"),
            (MEMBER, "lucile-orden", None),
            (MEMBER, "lucile-notes", "notes"),
            (OTHER, "mia-chat", "chat"),
            (OWNER, "emil-chat", "chat"),
        ):
            body = {"kind": "fcm", "token": name, **({"app": app} if app else {})}
            worker.request("/v2/push/targets", tokens[email], body)
        rows = worker.query("select token, app from push_targets order by token")
        say(f"the targets are {[(one['token'], one['app']) for one in rows]}")
        mention = post("Lucile, the draft is up", mentions=[f"user:{ids[MEMBER]}"])
        got = pushed_after(worker, tokens[OWNER], chat, mention, 1)
        if [one["message"]["token"] for one in got] != ["lucile-chat"]:
            wrong(f"a mention of Lucile was pushed to {[one['message'].get('token') for one in got]}")
        else:
            sent = got[0]
            data = sent["message"]["data"]
            want = {
                "kind": "chat",
                "v": "1",
                "chat": chat,
                "space": space["id"],
                "message": mention["message"],
                "id": mention["message"],
                "from": f"user:{ids[OWNER]}",
                "reason": "mention",
                "title": "Emil",
                "body": "Lucile, the draft is up",
                "text": "yes",
            }
            off = {key: (data.get(key), value) for key, value in want.items() if data.get(key) != value}
            if off:
                wrong(f"the push's data is off (got, wanted): {off}")
            if sent["authorization"] != "Bearer drive-access" or sent["path"] != "/v1/projects/orden-drive/messages:send":
                wrong(f"the push was sent as {sent['authorization']} to {sent['path']}")
            if "notification" in sent["message"]:
                wrong("the push carries a notification of the server's making, not data alone")
            say(f"one mention made one push, to Lucile's Chat app alone: {json.dumps(data)}")
        if len(TOKENS_ASKED) != 1:
            wrong(f"the service was asked for an access token {len(TOKENS_ASKED)} times")
        plain = pushed_after(worker, tokens[OWNER], chat, post("Morning all"), 0)
        if plain:
            wrong(f"a message that names nobody was pushed to {[one['message']['token'] for one in plain]}")
        worker.request(
            f"/v2/chats/{chat}/me", tokens[MEMBER], {"mutedUntil": int(time.time() * 1000) + 3_600_000}, method="PUT"
        )
        hushed = pushed_after(worker, tokens[OWNER], chat, post("Lucile?", mentions=[f"user:{ids[MEMBER]}"]), 0)
        if hushed:
            wrong(f"a mention in a muted chat was pushed to {[one['message']['token'] for one in hushed]}")
        else:
            say("a muted chat pushes nothing")
        everyone = pushed_after(worker, tokens[MEMBER], chat, post("All hands", mentions=["everyone"]), 2)
        if sorted(one["message"]["token"] for one in everyone) != ["emil-chat", "mia-chat"]:
            wrong(f"a mention of everyone by Lucile was pushed to {[one['message']['token'] for one in everyone]}")
        else:
            say("a mention of everyone reaches the others' Chat apps and not its author")
    return DRIVE.verdict("a mention makes one push, to the Chat app alone, through a stand-in for FCM")
sys.exit(main())
