import argparse
import datetime
import hashlib
import io
import os
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

SPOOLED = 64 * 1024 * 1024
HTTP = ("ContentType", "CacheControl", "ContentDisposition", "ContentEncoding", "ContentLanguage")
@dataclass(frozen=True)
class Held:
    size: int
    etag: str
    at: datetime.datetime
def endpoint(account: str, jurisdiction: str) -> str:
    middle = f".{jurisdiction}" if jurisdiction else ""
    return f"https://{account}{middle}.r2.cloudflarestorage.com"
def client(account: str, jurisdiction: str, side: str):
    import boto3
    from botocore.config import Config

    key = os.environ.get(f"R2_{side}_ACCESS_KEY_ID") or os.environ.get("R2_ACCESS_KEY_ID")
    secret = os.environ.get(f"R2_{side}_SECRET_ACCESS_KEY") or os.environ.get("R2_SECRET_ACCESS_KEY")
    if not key or not secret:
        raise SystemExit(f"set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (or the R2_{side}_ pair)")
    return boto3.client(
        "s3",
        endpoint_url=endpoint(account, jurisdiction),
        aws_access_key_id=key,
        aws_secret_access_key=secret,
        region_name="auto",
        config=Config(retries={"max_attempts": 8, "mode": "adaptive"}, max_pool_connections=64),
    )
def listed(s3, bucket: str, prefix: str) -> dict[str, Held]:
    found: dict[str, Held] = {}
    token = None
    while True:
        asked = {"Bucket": bucket, "Prefix": prefix, "MaxKeys": 1000}
        if token:
            asked["ContinuationToken"] = token
        page = s3.list_objects_v2(**asked)
        for one in page.get("Contents", []):
            found[one["Key"]] = Held(one["Size"], one["ETag"].strip('"'), one["LastModified"])
        if not page.get("IsTruncated"):
            return found
        token = page["NextContinuationToken"]
def described(head: dict) -> dict:
    said = {name: head[name] for name in HTTP if head.get(name)}
    said["Metadata"] = dict(sorted((head.get("Metadata") or {}).items()))
    return said
def copied(source, target, old: str, new: str, key: str) -> str | None:
    got = source.get_object(Bucket=old, Key=key)
    digest = hashlib.md5()
    with tempfile.SpooledTemporaryFile(max_size=SPOOLED) as kept:
        for chunk in iter(lambda: got["Body"].read(1024 * 1024), b""):
            digest.update(chunk)
            kept.write(chunk)
        size = kept.tell()
        if size != got["ContentLength"]:
            return f"{key}: read {size} of {got['ContentLength']} bytes"
        kept.seek(0)
        said = described(got)
        put = target.put_object(Bucket=new, Key=key, Body=kept, ContentLength=size, **said)
    if put["ETag"].strip('"') != digest.hexdigest():
        return f"{key}: the new bucket holds other bytes than were read"
    return None
def differs(old: Held, new: Held | None) -> bool:
    return new is None or new.size != old.size or new.etag != old.etag
def each(workers: int, work, keys: list[str]) -> list[str]:
    wrong: list[str] = []
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for said in pool.map(work, keys):
            done += 1
            if said:
                wrong.append(said)
                print(f"  WRONG {said}", flush=True)
            if done % 1000 == 0:
                print(f"  {done} of {len(keys)}", flush=True)
    return wrong
def attempt(work, key: str) -> str | None:
    try:
        return work(key)
    except Exception as error:  # noqa: BLE001 - one object failing is a line in the report, not the end of the run
        return f"{key}: {type(error).__name__}: {error}"
def copy(source, target, args) -> int:
    old = listed(source, args.old, args.prefix)
    new = listed(target, args.new, args.prefix)
    owed = sorted(key for key, one in old.items() if differs(one, new.get(key)))
    extra = sorted(key for key in new if key not in old)
    print(f"{args.old}: {len(old)} objects, {sum(one.size for one in old.values())} bytes")
    print(f"{args.new}: {len(new)} objects; {len(owed)} to copy, {len(extra)} only in the new bucket")
    if args.dry_run:
        for key in owed[:50]:
            print(f"  would copy {key}")
        for key in extra[:50]:
            print(f"  only in the new bucket: {key}")
        return 0
    wrong = each(args.workers, lambda key: attempt(lambda one: copied(source, target, args.old, args.new, one), key), owed)
    if args.prune:
        wrong += each(
            args.workers,
            lambda key: attempt(lambda one: target.delete_object(Bucket=args.new, Key=one) and None, key),
            extra,
        )
        print(f"removed {len(extra)} objects the old bucket no longer holds")
    print(f"copied {len(owed) - len(wrong)} of {len(owed)}; {len(wrong)} failed")
    return 1 if wrong else 0
def same_words(source, target, args, key: str) -> str | None:
    one = described(source.head_object(Bucket=args.old, Key=key))
    other = described(target.head_object(Bucket=args.new, Key=key))
    return None if one == other else f"{key}: {one} became {other}"
def same_bytes(source, target, args, key: str) -> str | None:
    sums = []
    for s3, bucket in ((source, args.old), (target, args.new)):
        digest = hashlib.sha256()
        body = s3.get_object(Bucket=bucket, Key=key)["Body"]
        for chunk in iter(lambda: body.read(1024 * 1024), b""):
            digest.update(chunk)
        sums.append(digest.hexdigest())
    return None if sums[0] == sums[1] else f"{key}: the bytes differ"
def verify(source, target, args) -> int:
    old = listed(source, args.old, args.prefix)
    new = listed(target, args.new, args.prefix)
    missing = sorted(key for key in old if key not in new)
    extra = sorted(key for key in new if key not in old)
    multipart = sorted(key for key, one in old.items() if "-" in one.etag and key in new and new[key].size == one.size)
    unlike = sorted(key for key, one in old.items() if key in new and key not in multipart and differs(one, new[key]))
    print(f"{args.old}: {len(old)} objects, {sum(one.size for one in old.values())} bytes")
    print(f"{args.new}: {len(new)} objects, {sum(one.size for one in new.values())} bytes")
    for name, keys in (("missing from the new bucket", missing), ("only in the new bucket", extra), ("size or etag differs", unlike)):
        print(f"{name}: {len(keys)}")
        for key in keys[:100]:
            print(f"  {key}")
    both = sorted(key for key in old if key in new and key not in unlike)
    wrong: list[str] = []
    if not args.no_head:
        print(f"comparing the content type and metadata of {len(both)} objects")
        wrong += each(args.workers, lambda key: attempt(lambda one: same_words(source, target, args, one), key), both)
    deep = sorted({*both, *multipart}) if args.deep else multipart
    if deep:
        print(f"comparing the bytes of {len(deep)} objects")
        wrong += each(args.workers, lambda key: attempt(lambda one: same_bytes(source, target, args, one), key), deep)
    failed = bool(missing or extra or unlike or wrong)
    print("RESULT: DIFFERENT" if failed else "RESULT: SAME")
    return 1 if failed else 0
def moment(said: str) -> datetime.datetime:
    at = datetime.datetime.fromisoformat(said.replace("Z", "+00:00"))
    return at if at.tzinfo else at.replace(tzinfo=datetime.timezone.utc)
def after_switch(source, target, args) -> int:
    switched = moment(args.switched_at)
    last = moment(args.last_copy)
    old = listed(source, args.old, args.prefix)
    new = listed(target, args.new, args.prefix)
    late: list[str] = []
    clash: list[str] = []
    for key, one in sorted(old.items()):
        other = new.get(key)
        if one.at < last or not differs(one, other):
            continue
        if other is not None and other.at >= switched:
            clash.append(key)
        else:
            late.append(key)
    print(f"written to the old bucket and not in the new one as it was before the switch: {len(late)}")
    print(f"written to both buckets around the switch (left alone, look at each): {len(clash)}")
    for key in clash[:200]:
        print(f"  CLASH {key} old {old[key].at.isoformat()} new {new[key].at.isoformat()}")
    if args.dry_run:
        for key in late[:200]:
            print(f"  would copy {key}")
        return 1 if clash else 0
    wrong = each(args.workers, lambda key: attempt(lambda one: copied(source, target, args.old, args.new, one), key), late)
    print(f"copied {len(late) - len(wrong)} of {len(late)}; {len(wrong)} failed")
    return 1 if wrong or clash else 0
class Fake:
    def __init__(self) -> None:
        self.held: dict[str, dict] = {}
        self.clock = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)
    def write(self, key: str, body: bytes, kind: str = "text/markdown", meta: dict | None = None, etag: str | None = None):
        self.clock += datetime.timedelta(minutes=1)
        self.held[key] = {
            "Body": body,
            "ETag": f'"{etag or hashlib.md5(body).hexdigest()}"',
            "LastModified": self.clock,
            "ContentType": kind,
            "Metadata": meta or {},
        }
    def list_objects_v2(self, Bucket, Prefix, MaxKeys, ContinuationToken=None):
        keys = sorted(key for key in self.held if key.startswith(Prefix))
        start = int(ContinuationToken or 0)
        page = keys[start : start + 2]
        more = start + 2 < len(keys)
        return {
            "Contents": [
                {"Key": key, "Size": len(self.held[key]["Body"]), "ETag": self.held[key]["ETag"], "LastModified": self.held[key]["LastModified"]}
                for key in page
            ],
            "IsTruncated": more,
            **({"NextContinuationToken": str(start + 2)} if more else {}),
        }
    def get_object(self, Bucket, Key):
        one = self.held[Key]
        return {**one, "Body": io.BytesIO(one["Body"]), "ContentLength": len(one["Body"])}
    def head_object(self, Bucket, Key):
        return self.held[Key]
    def put_object(self, Bucket, Key, Body, ContentLength, **said):
        body = Body.read()
        assert len(body) == ContentLength
        self.write(Key, body, said.get("ContentType", ""), said.get("Metadata"))
        return {"ETag": self.held[Key]["ETag"]}
    def delete_object(self, Bucket, Key):
        del self.held[Key]
        return {}
def selftest() -> int:
    def told(**more):
        base = {"old": "a", "new": "b", "prefix": "", "workers": 4, "dry_run": False, "prune": False, "no_head": False, "deep": False, "switched_at": "", "last_copy": ""}
        return argparse.Namespace(**{**base, **more})
    source, target = Fake(), Fake()
    for at in range(5):
        source.write(f"spaces/s/{at}", f"note {at}".encode(), meta={"seq": str(at), "epoch": "1"})
    source.write("blobs/h", b"\x89PNG", "image/png")
    assert verify(source, target, told()) == 1
    assert copy(source, target, told(dry_run=True)) == 0 and not target.held
    assert copy(source, target, told()) == 0
    assert verify(source, target, told(deep=True)) == 0
    assert target.held["spaces/s/3"]["Metadata"] == {"epoch": "1", "seq": "3"}
    assert target.held["blobs/h"]["ContentType"] == "image/png"
    source.write("spaces/s/1", b"changed")
    source.delete_object("a", "spaces/s/0")
    assert verify(source, target, told()) == 1
    assert copy(source, target, told(prune=True)) == 0
    assert verify(source, target, told()) == 0
    target.held["blobs/h"]["ContentType"] = "image/jpeg"
    assert verify(source, target, told()) == 1
    assert verify(source, target, told(no_head=True)) == 0
    target.held["blobs/h"]["ContentType"] = "image/png"
    source.write("blobs/big", b"parts", etag="abc-2")
    assert copy(source, target, told()) == 0
    assert verify(source, target, told()) == 0
    target.held["blobs/big"]["Body"] = b"other"
    assert verify(source, target, told()) == 1
    del source.held["blobs/big"], target.held["blobs/big"]
    target.clock = source.clock = max(source.clock, target.clock) + datetime.timedelta(hours=2)
    last = source.clock.isoformat()
    switched = (source.clock + datetime.timedelta(seconds=30)).isoformat()
    target.clock += datetime.timedelta(minutes=5)
    target.delete_object("b", "spaces/s/3")
    source.write("spaces/s/2", b"a straggler in the old bucket")
    source.write("spaces/s/new", b"made in the old bucket during the switch")
    source.write("spaces/s/4", b"old side of a clash")
    target.clock += datetime.timedelta(minutes=10)
    target.write("spaces/s/4", b"new side of a clash")
    target.write("spaces/s/after", b"made after the switch")
    assert after_switch(source, target, told(switched_at=switched, last_copy=last, dry_run=True)) == 1
    assert target.held["spaces/s/2"]["Body"] == b"note 2"
    assert after_switch(source, target, told(switched_at=switched, last_copy=last)) == 1
    assert target.held["spaces/s/2"]["Body"] == b"a straggler in the old bucket"
    assert target.held["spaces/s/new"]["Body"] == b"made in the old bucket during the switch"
    assert target.held["spaces/s/4"]["Body"] == b"new side of a clash"
    assert target.held["spaces/s/after"]["Body"] == b"made after the switch"
    assert source.held["spaces/s/4"]["Body"] == b"old side of a clash"
    assert "spaces/s/3" not in target.held and "spaces/s/3" in source.held
    assert endpoint("acct", "eu") == "https://acct.eu.r2.cloudflarestorage.com"
    assert endpoint("acct", "") == "https://acct.r2.cloudflarestorage.com"
    print("selftest: ok")
    return 0
def main() -> int:
    parser = argparse.ArgumentParser(description="Copy an R2 bucket into one in another jurisdiction, and check the copy object by object.")
    parser.add_argument("what", choices=["copy", "verify", "after-switch", "selftest"])
    parser.add_argument("--old", default="orden-notes")
    parser.add_argument("--new", default="orden-notes-eu")
    parser.add_argument("--old-jurisdiction", default="")
    parser.add_argument("--new-jurisdiction", default="eu")
    parser.add_argument("--account", default=os.environ.get("R2_ACCOUNT_ID", ""))
    parser.add_argument("--prefix", default="")
    parser.add_argument("--workers", type=int, default=16)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--prune", action="store_true", help="copy: also remove from the new bucket what the old one no longer holds; never after the switch")
    parser.add_argument("--no-head", action="store_true", help="verify: skip the content type and metadata of each object")
    parser.add_argument("--deep", action="store_true", help="verify: also read and hash every object on both sides")
    parser.add_argument("--switched-at", default="", help="after-switch: when the Worker began to use the new bucket, ISO 8601 UTC")
    parser.add_argument("--last-copy", default="", help="after-switch: when the last copy before the switch began, ISO 8601 UTC")
    args = parser.parse_args()
    if args.what == "selftest":
        return selftest()
    if not args.account:
        raise SystemExit("set R2_ACCOUNT_ID or pass --account")
    if args.what == "after-switch" and not (args.switched_at and args.last_copy):
        raise SystemExit("after-switch needs --switched-at and --last-copy")
    if args.what == "after-switch" and args.prune:
        raise SystemExit("--prune is for before the switch only")
    source = client(args.account, args.old_jurisdiction, "OLD")
    target = client(args.account, args.new_jurisdiction, "NEW")
    return {"copy": copy, "verify": verify, "after-switch": after_switch}[args.what](source, target, args)
if __name__ == "__main__":
    sys.exit(main())
