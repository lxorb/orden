"""The Apple Notes database the crate's tests read, built from the documented
schema.

A real `NoteStore.sqlite` is somebody's notes, so none is committed and none could
be: the fixture is written here instead, from what the format is known to be -
Core Data's own `Z_PRIMARYKEY` and `ZICCLOUDSYNCINGOBJECT` tables, one row per
account, folder, note and attachment, and the note's own words as a gzipped
protobuf in `ZICNOTEDATA.ZDATA`.

What it holds is one of each thing the reader has to get right: a note in the
folder Notes starts with, a note in a folder somebody named, a note two folders
deep, a note behind a password, a note in the bin, a picture, and a link from one
note to another.

Run it from the repository root after changing what the reader expects:

    python scripts/apple-notes-fixture.py

It writes apps/desktop/src-tauri/tests/apple-notes, which is committed, so the
macOS runner proves the reader without a Mac's own notes anywhere near it."""

import gzip
import pathlib
import sqlite3
import struct
import sys
import zlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "apps" / "desktop" / "src-tauri" / "tests" / "apple-notes"

# Apple counts seconds from 2001 where everything else counts from 1970.
FROM_2001 = 978_307_200

# 2026-09-04 and 2026-09-05, as seconds since 1970. The reader shifts them back,
# and apple_notes.rs asserts the first of these.
MADE = 1_788_480_000
EDITED = 1_788_566_400

ACCOUNT = "ACCT-0001-0002-0003"
NOTE_ONE = "11111111-2222-3333-4444-555555555555"

# Where an attachment sits in a note's words.
OBJECT = "￼"

# Which kind each row is. The numbers are a database's own, which is why the
# reader reads them out of `Z_PRIMARYKEY` rather than knowing them.
KINDS = {"ICAccount": 7, "ICAttachment": 9, "ICFolder": 12, "ICMedia": 14, "ICNote": 16}

# What `styleType` calls each paragraph.
TITLE = 0
CHECKBOX = 103


def varint(value: int) -> bytes:
    """A number, as protobuf writes one."""
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
    """A `ParagraphStyle`: which paragraph this is, how deep, and whether its box
    is ticked."""
    out = number(1, kind)
    if indent:
        out += number(4, indent)
    if done is not None:
        out += block(5, number(2, 1 if done else 0))

    return out


def run(text: str, parts: bytes = b"") -> bytes:
    """One `AttributeRun` over as many UTF-16 units as the text takes, which is
    how Notes counts: an emoji is two."""
    units = sum(2 if ord(one) > 0xFFFF else 1 for one in text)
    return block(5, number(1, units) + parts)


def attachment(identifier: str, uti: str) -> bytes:
    """An `AttachmentInfo`, which says which attachment sits here."""
    return block(12, block(1, identifier.encode()) + block(2, uti.encode()))


def note_data(text: str, runs: list[bytes]) -> bytes:
    """A whole note's `ZDATA`: a `NoteStoreProto` holding a `Document` holding a
    `Note`, gzipped, which is the shape Notes writes on the row."""
    inner = block(2, text.encode()) + b"".join(runs)
    # mtime zero, so the same notes give the same bytes every run and the
    # committed fixture only changes when what it says changes.
    return gzip.compress(block(2, block(3, inner)), mtime=0)


def png() -> bytes:
    """A real one-pixel PNG, so what the reader hands over is a picture."""

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


# Every column the reader asks for. A real database has some hundreds of them and
# one table for all of it, which is Core Data's own shape rather than Notes'.
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

    # The folder Notes starts with says so in its identifier, and its notes go
    # straight into the import rather than into a folder called Notes.
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
    # A smart folder holds no notes of its own, and the reader leaves it alone.
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
    """One row of the one table Core Data keeps everything in."""
    values = {"Z_PK": pk, "Z_ENT": KINDS[kind], **values}
    names = ", ".join(values)
    marks = ", ".join("?" for _ in values)
    db.execute(
        f"INSERT INTO ZICCLOUDSYNCINGOBJECT ({names}) VALUES ({marks})",
        tuple(values.values()),
    )


def notes(db: sqlite3.Connection) -> None:
    """The five notes, and the words of the three that come over."""
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

    # A picture and a link to the note above, both of which Notes stores as an
    # attachment sitting at an object character in the words.
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

    # A note behind a password: its row is there and its words are not.
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
    """One note: its row, and the body on the row beside it."""
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
    """The picture and the link, and the file the picture is."""
    row(db, 20, "ICMedia", ZIDENTIFIER="media-photo", ZFILENAME="photo.png", ZGENERATION1=None)
    row(db, 21, "ICAttachment", ZIDENTIFIER="att-photo", ZMEDIA=20)
    row(
        db,
        22,
        "ICAttachment",
        ZIDENTIFIER="att-link",
        ZTOKENCONTENTIDENTIFIER=f"applenotes:note/{NOTE_ONE.lower()}",
    )

    where = OUT / "Accounts" / ACCOUNT / "Media" / "media-photo"
    where.mkdir(parents=True, exist_ok=True)
    (where / "photo.png").write_bytes(png())


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
