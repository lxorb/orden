import gzip
import pathlib
import sqlite3
import struct
import sys
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "apps" / "desktop" / "src-tauri" / "tests" / "apple-notes"

FROM_2001 = 978_307_200

MADE = 1_788_480_000
EDITED = 1_788_566_400

ACCOUNT = "ACCT-0001-0002-0003"
NOTE_ONE = "11111111-2222-3333-4444-555555555555"

OBJECT = "￼"

KINDS = {"ICAccount": 7, "ICAttachment": 9, "ICFolder": 12, "ICMedia": 14, "ICNote": 16}

TITLE = 0
CHECKBOX = 103

def varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)

def number(field: int, value: int) -> bytes:
    return varint(field << 3) + varint(value)

def block(field: int, value: bytes) -> bytes:
    return varint((field << 3) | 2) + varint(len(value)) + value

def style(kind: int, indent: int = 0, done: bool | None = None) -> bytes:
    out = number(1, kind)
    if indent:
        out += number(4, indent)
    if done is not None:
        out += block(5, number(2, 1 if done else 0))

    return out

def run(text: str, parts: bytes = b"") -> bytes:
    units = sum(2 if ord(one) > 0xFFFF else 1 for one in text)
    return block(5, number(1, units) + parts)

def attachment(identifier: str, uti: str) -> bytes:
    return block(12, block(1, identifier.encode()) + block(2, uti.encode()))

def note_data(text: str, runs: list[bytes]) -> bytes:
    inner = block(2, text.encode()) + b"".join(runs)
    return gzip.compress(block(2, block(3, inner)), mtime=0)

def object_id(*, index: int | None = None, count: int | None = None, text: str | None = None) -> bytes:
    out = b""
    if count is not None:
        out += number(2, count)
    if text is not None:
        out += block(4, text.encode())
    if index is not None:
        out += number(6, index)
    return out

def custom_map(kind: int, entries: list[tuple[int, bytes]]) -> bytes:
    inner = number(1, kind)
    for key, value in entries:
        inner += block(3, number(1, key) + block(2, value))
    return block(13, inner)

def dictionary(pairs: list[tuple[int, int]]) -> bytes:
    inner = b"".join(
        block(1, block(1, object_id(index=key)) + block(2, object_id(index=value)))
        for key, value in pairs
    )
    return block(6, inner)

def ordered(uuids: list[bytes], pairs: list[tuple[int, int]]) -> bytes:
    array = b"".join(
        block(2, number(1, at) + block(2, uuid)) for at, uuid in enumerate(uuids)
    )
    contents = b"".join(
        block(1, block(1, object_id(index=key)) + block(2, object_id(index=value)))
        for key, value in pairs
    )
    return block(16, block(1, block(1, array) + block(2, contents)))

def cell(text: str) -> bytes:
    return block(10, block(2, text.encode()) + run(text))

def mergeable(objects: list[bytes], keys: list[str], types: list[str], uuids: list[bytes]) -> bytes:
    data = b"".join(block(3, one) for one in objects)
    data += b"".join(block(4, one.encode()) for one in keys)
    data += b"".join(block(5, one.encode()) for one in types)
    data += b"".join(block(6, one) for one in uuids)
    return gzip.compress(block(2, block(3, data)), mtime=0)

def table() -> bytes:
    rows = [b"row-0-uuid-00000", b"row-1-uuid-00000"]
    columns = [b"col-0-uuid-00000", b"col-1-uuid-00000"]

    def uuid(at: int) -> bytes:
        return custom_map(1, [(3, object_id(count=at))])

    objects = [
        custom_map(0, [(0, object_id(index=1)), (1, object_id(index=2)), (2, object_id(index=3))]),
        ordered(rows, [(4, 4), (5, 5)]),
        ordered([columns[1], columns[0]], [(6, 6), (7, 7)]),
        dictionary([(6, 8), (7, 9)]),
        uuid(0),
        uuid(1),
        uuid(2),
        uuid(3),
        dictionary([(4, 10), (5, 11)]),
        dictionary([(4, 12), (5, 13)]),
        cell("Item"),
        cell("Milk"),
        cell("How much"),
        cell("2 litres"),
    ]
    return mergeable(
        objects,
        ["crRows", "crColumns", "cellColumns", "UUIDIndex"],
        ["com.apple.notes.ICTable", "com.apple.CRDT.NSUUID"],
        rows + columns,
    )

def gallery(pages: list[str]) -> bytes:
    objects = [custom_map(0, [(0, object_id(text=page))]) for page in pages]
    return mergeable(objects, ["self"], ["com.apple.notes.gallery"], [])

def png() -> bytes:

    def chunk(kind: bytes, body: bytes) -> bytes:
        return (
            struct.pack(">I", len(body))
            + kind
            + body
            + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"\x00\x28\x64\xc8"))
        + chunk(b"IEND", b"")
    )

OBJECT_COLUMNS = [
    "Z_PK INTEGER PRIMARY KEY",
    "Z_ENT INTEGER",
    "ZNAME TEXT",
    "ZTITLE TEXT",
    "ZTITLE1 TEXT",
    "ZTITLE2 TEXT",
    "ZIDENTIFIER TEXT",
    "ZPARENT INTEGER",
    "ZFOLDER INTEGER",
    "ZFOLDERTYPE INTEGER",
    "ZOWNER INTEGER",
    "ZCREATIONDATE1 REAL",
    "ZCREATIONDATE2 REAL",
    "ZCREATIONDATE3 REAL",
    "ZMODIFICATIONDATE1 REAL",
    "ZISPASSWORDPROTECTED INTEGER",
    "ZISPINNED INTEGER",
    "ZALTTEXT TEXT",
    "ZTOKENCONTENTIDENTIFIER TEXT",
    "ZURLSTRING TEXT",
    "ZMEDIA INTEGER",
    "ZFILENAME TEXT",
    "ZGENERATION1 TEXT",
    "ZMERGEABLEDATA1 BLOB",
    "ZFALLBACKIMAGEGENERATION TEXT",
    "ZFALLBACKPDFGENERATION TEXT",
    "ZSIZEWIDTH REAL",
    "ZSIZEHEIGHT REAL",
]

def build(db: sqlite3.Connection) -> None:
    db.execute("CREATE TABLE Z_PRIMARYKEY (Z_ENT INTEGER, Z_NAME TEXT)")
    db.execute(f"CREATE TABLE ZICCLOUDSYNCINGOBJECT ({', '.join(OBJECT_COLUMNS)})")
    db.execute(
        "CREATE TABLE ZICNOTEDATA (Z_PK INTEGER PRIMARY KEY, ZNOTE INTEGER, ZDATA BLOB)"
    )

    for name, ent in KINDS.items():
        db.execute("INSERT INTO Z_PRIMARYKEY (Z_ENT, Z_NAME) VALUES (?, ?)", (ent, name))

    row(db, 1, "ICAccount", ZNAME="iCloud", ZIDENTIFIER=ACCOUNT)

    row(db, 2, "ICFolder", ZTITLE2="Notes", ZIDENTIFIER="DefaultFolder-CloudKit", ZOWNER=1)
    row(db, 3, "ICFolder", ZTITLE2="Work", ZIDENTIFIER="folder-work", ZOWNER=1)
    row(db, 4, "ICFolder", ZTITLE2="Deeper", ZIDENTIFIER="folder-deep", ZPARENT=3, ZOWNER=1)
    row(
        db,
        5,
        "ICFolder",
        ZTITLE2="Recently Deleted",
        ZIDENTIFIER="folder-bin",
        ZFOLDERTYPE=1,
        ZOWNER=1,
    )
    row(
        db,
        6,
        "ICFolder",
        ZTITLE2="Anything with milk in it",
        ZIDENTIFIER="folder-smart",
        ZFOLDERTYPE=3,
        ZOWNER=1,
    )

    notes(db)
    attachments(db)

def row(db: sqlite3.Connection, pk: int, kind: str, **values: object) -> None:
    values = {"Z_PK": pk, "Z_ENT": KINDS[kind], **values}
    names = ", ".join(values)
    marks = ", ".join("?" for _ in values)
    db.execute(
        f"INSERT INTO ZICCLOUDSYNCINGOBJECT ({names}) VALUES ({marks})",
        tuple(values.values()),
    )

def notes(db: sqlite3.Connection) -> None:
    groceries = "Groceries\nMilk\nEggs\n"
    made(
        db,
        10,
        NOTE_ONE,
        folder=2,
        title="Groceries",
        data=note_data(
            groceries,
            [
                run("Groceries\n", block(2, style(TITLE))),
                run("Milk\n", block(2, style(CHECKBOX, done=True))),
                run("Eggs\n", block(2, style(CHECKBOX, done=False))),
            ],
        ),
    )

    ideas = f"Ideas\nSee {OBJECT} and {OBJECT}\n"
    made(
        db,
        11,
        "22222222-2222-3333-4444-555555555555",
        folder=3,
        title="Ideas",
        data=note_data(
            ideas,
            [
                run("Ideas\n", block(2, style(TITLE))),
                run("See "),
                run(OBJECT, attachment("att-photo", "public.png")),
                run(" and "),
                run(
                    OBJECT,
                    attachment("att-link", "com.apple.notes.inlinetextattachment.link"),
                ),
                run("\n"),
            ],
        ),
    )

    kinds = [
        ("Table", "att-table", "com.apple.notes.table"),
        ("Sketch", "att-drawing", "com.apple.paper"),
        ("Scan", "att-scan", "com.apple.notes.gallery"),
        ("Marked", "att-marked", "com.apple.paper.doc.scan"),
        ("Lost", "att-lost", "com.apple.drawing.2"),
    ]
    plans = "Plans\n" + "".join(f"{word} {OBJECT}\n" for word, _, _ in kinds)
    parts = [run("Plans\n", block(2, style(TITLE)))]
    for word, identifier, uti in kinds:
        parts += [run(f"{word} "), run(OBJECT, attachment(identifier, uti)), run("\n")]
    made(
        db,
        15,
        "66666666-2222-3333-4444-555555555555",
        folder=3,
        title="Plans",
        data=note_data(plans, parts),
    )

    sums = f"Sums\n2 + 2 {OBJECT}\nSee {OBJECT}\n"
    made(
        db,
        16,
        "77777777-2222-3333-4444-555555555555",
        folder=3,
        title="Sums",
        data=note_data(
            sums,
            [
                run("Sums\n", block(2, style(TITLE))),
                run("2 + 2 "),
                run(
                    OBJECT,
                    attachment("att-sum", "com.apple.notes.inlinetextattachment.calculateresult"),
                ),
                run("\nSee "),
                run(
                    OBJECT,
                    attachment("att-locked-link", "com.apple.notes.inlinetextattachment.link"),
                ),
                run("\n"),
            ],
        ),
    )

    made(
        db,
        12,
        "33333333-2222-3333-4444-555555555555",
        folder=4,
        title="Nested",
        data=note_data(
            "Nested\nWords\n",
            [run("Nested\n", block(2, style(TITLE))), run("Words\n")],
        ),
    )

    made(db, 13, "44444444-2222-3333-4444-555555555555", folder=3, title="Locked", locked=True)

    made(
        db,
        14,
        "55555555-2222-3333-4444-555555555555",
        folder=5,
        title="Binned",
        data=note_data("Binned\n", [run("Binned\n", block(2, style(TITLE)))]),
    )

def made(
    db: sqlite3.Connection,
    pk: int,
    identifier: str,
    *,
    folder: int,
    title: str,
    data: bytes | None = None,
    locked: bool = False,
) -> None:
    row(
        db,
        pk,
        "ICNote",
        ZTITLE1=title,
        ZIDENTIFIER=identifier,
        ZFOLDER=folder,
        ZCREATIONDATE1=float(MADE - FROM_2001),
        ZMODIFICATIONDATE1=float(EDITED - FROM_2001),
        ZISPASSWORDPROTECTED=1 if locked else 0,
    )
    db.execute(
        "INSERT INTO ZICNOTEDATA (ZNOTE, ZDATA) VALUES (?, ?)",
        (pk, None if data is None else sqlite3.Binary(data)),
    )

def attachments(db: sqlite3.Connection) -> None:
    row(db, 20, "ICMedia", ZIDENTIFIER="media-photo", ZFILENAME="photo.png", ZGENERATION1=None)
    row(db, 21, "ICAttachment", ZIDENTIFIER="att-photo", ZMEDIA=20)
    row(
        db,
        22,
        "ICAttachment",
        ZIDENTIFIER="att-link",
        ZTOKENCONTENTIDENTIFIER=f"applenotes:note/{NOTE_ONE.lower()}",
    )

    row(db, 23, "ICAttachment", ZIDENTIFIER="att-sum", ZALTTEXT="= 4")
    row(
        db,
        24,
        "ICAttachment",
        ZIDENTIFIER="att-locked-link",
        ZALTTEXT="Locked",
        ZTOKENCONTENTIDENTIFIER="applenotes:note/44444444-2222-3333-4444-555555555555",
    )

    where = OUT / "Accounts" / ACCOUNT / "Media" / "media-photo"
    where.mkdir(parents=True, exist_ok=True)
    (where / "photo.png").write_bytes(png())

    drawn(db)

def drawn(db: sqlite3.Connection) -> None:
    row(db, 30, "ICAttachment", ZIDENTIFIER="att-table", ZMERGEABLEDATA1=table())
    row(db, 31, "ICAttachment", ZIDENTIFIER="att-drawing", ZFALLBACKIMAGEGENERATION="gen-1")
    row(db, 32, "ICAttachment", ZIDENTIFIER="att-scan", ZMERGEABLEDATA1=gallery(["page-one", "page-two"]))
    row(db, 33, "ICAttachment", ZIDENTIFIER="page-one", ZSIZEWIDTH=1536.0, ZSIZEHEIGHT=2048.0)
    row(db, 34, "ICMedia", ZIDENTIFIER="media-page-two", ZFILENAME="page-two.png")
    row(db, 35, "ICAttachment", ZIDENTIFIER="page-two", ZMEDIA=34)
    row(db, 36, "ICAttachment", ZIDENTIFIER="att-marked", ZFALLBACKPDFGENERATION="gen-2")
    row(db, 37, "ICAttachment", ZIDENTIFIER="att-lost", ZFALLBACKIMAGEGENERATION="gen-9")

    account = OUT / "Accounts" / ACCOUNT
    files = {
        account / "FallbackImages" / "att-drawing" / "gen-1" / "FallbackImage.png": png(),
        account / "Previews" / "page-one-1-1536x2048-0.jpeg": png(),
        account / "Media" / "media-page-two" / "page-two.png": png(),
        account / "FallbackPDFs" / "att-marked" / "gen-2" / "FallbackPDF.pdf": b"%PDF-1.4\n%%EOF\n",
    }
    for path, body in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)

def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    database = OUT / "NoteStore.sqlite"
    database.unlink(missing_ok=True)

    db = sqlite3.connect(database)
    try:
        build(db)
        db.commit()
    finally:
        db.close()

    print(f"wrote {database.relative_to(ROOT)} ({database.stat().st_size} bytes)")
    print(f"and   {(OUT / 'Accounts').relative_to(ROOT)}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
