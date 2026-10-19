"""Does Settings > Import bring Firefox, Chrome and Safari in as spaces? Windows only.

Issue #377: *"firefox and chrome import (based on tab groups and so on)"*. A profile is
a space; a pinned tab one of the Essentials; a tab group a folder; Firefox's saved
groups a folder of them; the bookmarks a folder called Bookmarks (docs/import.md).

The probe writes browsers of its own - a Firefox with a `profiles.ini`, a session and a
`places.sqlite`, and a Chrome with a `Local State`, a `Bookmarks` file and a session
written command by command the way Chromium writes one, and a Safari: its binary
`Bookmarks.plist` with a Reading List, and a `SafariTabs.db` laid out the way macOS
15's Safari lays it out, which the crate reads wherever a probe puts it although only a
Mac has a Safari of its own - and points the app at them
with `NIB_BROWSERS_DIR`, so nobody's own browser is ever read. Then, in an app started
off the screen through `run_probe`, it opens Settings > Import, presses Firefox,
Chrome and Safari, and asks:

* the rows: Safari, Firefox and Chrome there, and no row for a browser it did not write;
* the spaces: Firefox, Chrome and Safari, each holding its tabs where the browser had them, the
  groups as folders, the bookmarks under Bookmarks, the pinned tab an Essential;
* a second import: nothing written twice.

And pictures of the probe's own window: the Import pane and the Chrome space's list.

    python scripts/browser-import-probe.py --exe path/to/nib.exe \\
        --identifier ch.emilvinu.nib.probe.<name> --shots <folder>

Build the exe as `scripts/probe_app.py` says.
"""

from __future__ import annotations

import argparse
import atexit
import importlib.util
import json
import os
import pathlib
import plistlib
import shutil
import sqlite3
import struct
import sys
import tempfile
import time

from probe_app import close_app

HERE = pathlib.Path(__file__).resolve().parent

#: What the app reads for where the browsers are; see src-tauri/src/firefox_profiles.rs.
BROWSERS_DIR = "NIB_BROWSERS_DIR"


def borrowed(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {file}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


zen = borrowed("zen", "zen-import-probe.py")


def page(url: str, title: str, **more: object) -> dict[str, object]:
    return {"entries": [{"url": url, "title": title}], "index": 1, **more}


#: Firefox's session: a pinned tab, a group of two, a tab on its own, a saved group.
FIREFOX_SESSION = {
    "windows": [
        {
            "tabs": [
                page("https://mail.example.com/", "Mail", pinned=True),
                page("https://docs.example.com/guide", "The guide", groupId="g1"),
                page("https://docs.example.com/api", "API", groupId="g1"),
                page("https://board.example.com/", "Board"),
            ],
            "groups": [{"id": "g1", "name": "Docs", "color": "blue"}],
        }
    ],
    "savedGroups": [
        {"id": "s1", "name": "Trip", "tabs": [{"state": page("https://flights.example.com/", "Flights")}]}
    ],
}


def places(at: pathlib.Path) -> None:
    """A `places.sqlite` as far as the bookmarks go: Work on the toolbar, Recipes in the menu."""

    db = sqlite3.connect(at)
    db.executescript(
        """
        CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR);
        CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER,
          parent INTEGER, position INTEGER, title LONGVARCHAR, dateAdded INTEGER, guid TEXT);
        INSERT INTO moz_places VALUES (1, 'https://wiki.example.com/', 'Wiki'),
          (2, 'https://recipes.example.com/', 'Recipes');
        INSERT INTO moz_bookmarks VALUES
          (1, 2, NULL, 0, 0, '', 1, 'root________'),
          (2, 2, NULL, 1, 0, 'menu', 1, 'menu________'),
          (3, 2, NULL, 1, 1, 'toolbar', 1, 'toolbar_____'),
          (4, 2, NULL, 3, 0, 'Work', 1700000000000000, 'work'),
          (5, 1, 1, 4, 0, 'Wiki', 1700000000000000, 'wiki'),
          (6, 1, 2, 2, 0, 'Recipes', 1700000000000000, 'recipes');
        """
    )
    db.commit()
    db.close()


def snss(tabs: list[tuple[str, str, bool, bytes | None]], groups: dict[bytes, str]) -> bytes:
    """A Chromium session, command by command (session_service_commands.cc): one window
    of `(url, title, pinned, group token)` tabs, and each group's name."""

    def record(command: int, payload: bytes) -> bytes:
        return struct.pack("<HB", len(payload) + 1, command) + payload

    def padded(data: bytes) -> bytes:
        return data + b"\0" * (-len(data) % 4)

    def pickle(body: bytes) -> bytes:
        return struct.pack("<I", len(body)) + body

    window = 1
    out = [b"SNSS" + struct.pack("<i", 3), record(9, struct.pack("<ii", window, 0))]
    for at, (url, title, pinned, group) in enumerate(tabs):
        tab = 100 + at
        out.append(record(0, struct.pack("<ii", window, tab)))
        out.append(record(2, struct.pack("<ii", tab, at)))
        words = title.encode("utf-16-le")
        body = (
            struct.pack("<ii", tab, 0)
            + struct.pack("<i", len(url.encode()))
            + padded(url.encode())
            + struct.pack("<i", len(title))
            + padded(words)
        )
        out.append(record(6, pickle(body)))
        out.append(record(7, struct.pack("<ii", tab, 0)))
        out.append(record(12, struct.pack("<i?3x", tab, pinned)))
        token = group or b"\0" * 16
        out.append(record(25, struct.pack("<i4x", tab) + token + struct.pack("<?7x", group is not None)))
    for token, name in groups.items():
        words = name.encode("utf-16-le")
        out.append(record(27, pickle(token + struct.pack("<i", len(name)) + padded(words) + struct.pack("<ii", 1, 0))))
    return b"".join(out)


DOCS = bytes(range(16))

CHROME_TABS = [
    ("https://mail.example.com/", "Mail", True, None),
    ("https://docs.example.com/guide", "The guide", False, DOCS),
    ("https://docs.example.com/api", "API", False, DOCS),
    ("https://board.example.com/", "Board", False, None),
]

CHROME_BOOKMARKS = {
    "roots": {
        "bookmark_bar": {
            "type": "folder",
            "name": "Bookmarks bar",
            "children": [
                {
                    "type": "folder",
                    "name": "Work",
                    "id": "5",
                    "children": [
                        {"type": "url", "name": "Wiki", "url": "https://wiki.example.com/", "date_added": "13345000000000000"}
                    ],
                }
            ],
        },
        "other": {
            "type": "folder",
            "name": "Other bookmarks",
            "children": [{"type": "url", "name": "Recipes", "url": "https://recipes.example.com/"}],
        },
        "synced": {"type": "folder", "name": "Mobile bookmarks", "children": []},
    },
    "version": 1,
}


def safari_bookmarks() -> dict[str, object]:
    """Bookmarks.plist as Safari writes it: lists and leaves under a root, the Favorites
    bar, the menu and the Reading List among them."""

    def leaf(url: str, title: str, **more: object) -> dict[str, object]:
        return {"WebBookmarkType": "WebBookmarkTypeLeaf", "URLString": url,
                "URIDictionary": {"title": title}, "WebBookmarkUUID": title, **more}

    def folder(title: str, children: list[object]) -> dict[str, object]:
        return {"WebBookmarkType": "WebBookmarkTypeList", "Title": title,
                "WebBookmarkUUID": title or "root", "Children": children}

    return folder("", [
        {"WebBookmarkType": "WebBookmarkTypeProxy", "Title": "History"},
        folder("BookmarksBar", [folder("Work", [leaf("https://wiki.example.com/", "Wiki")])]),
        folder("BookmarksMenu", [leaf("https://recipes.example.com/", "Recipes")]),
        folder("com.apple.ReadingList", [leaf("https://long.example.com/", "A long read")]),
    ])


def safari_tabs(at: pathlib.Path) -> None:
    """SafariTabs.db: a tab group of two, its pinned tab, and the window's own tab."""

    db = sqlite3.connect(at)
    db.executescript(
        """
        CREATE TABLE bookmarks (id INTEGER PRIMARY KEY AUTOINCREMENT,special_id INTEGER DEFAULT 0,
          parent INTEGER, type INTEGER,title TEXT,url TEXT COLLATE NOCASE,num_children INTEGER DEFAULT 0,
          order_index INTEGER NOT NULL,external_uuid TEXT UNIQUE,last_modified REAL DEFAULT NULL,
          deleted INTEGER DEFAULT 0,extra_attributes BLOB DEFAULT NULL,local_attributes BLOB DEFAULT NULL,
          date_closed REAL DEFAULT NULL, subtype INTEGER DEFAULT 0);
        INSERT INTO bookmarks (id, parent, type, title, url, order_index) VALUES
          (1, 0, 1, 'Root', NULL, 0),
          (2, 1, 1, 'Docs', NULL, 0),
          (3, 2, 1, 'TopScopedBookmarkList', NULL, 0),
          (4, 3, 0, 'Mail', 'https://mail.example.com/', 0),
          (5, 2, 0, 'The guide', 'https://docs.example.com/guide', 1),
          (6, 2, 0, 'API', 'https://docs.example.com/api', 2),
          (7, 1, 1, 'Local', NULL, 1),
          (8, 7, 0, 'Board', 'https://board.example.com/', 0);
        """
    )
    db.commit()
    db.close()


def browsers_home() -> pathlib.Path:
    """Browsers of the probe's own, said to the app in `NIB_BROWSERS_DIR`."""

    made = pathlib.Path(tempfile.mkdtemp(prefix="nib-browsers-probe-"))
    firefox = made / "firefox"
    profile = firefox / "Profiles" / "x1.default-release"
    (profile / "sessionstore-backups").mkdir(parents=True)
    (firefox / "profiles.ini").write_text(
        "[Profile0]\r\nName=default-release\r\nIsRelative=1\r\nPath=Profiles/x1.default-release\r\nDefault=1\r\n",
        encoding="utf-8",
    )
    (profile / "sessionstore-backups" / "recovery.jsonlz4").write_bytes(
        zen.moz_lz4(json.dumps(FIREFOX_SESSION).encode())
    )
    places(profile / "places.sqlite")

    chrome = made / "chrome"
    default = chrome / "Default"
    (default / "Sessions").mkdir(parents=True)
    (chrome / "Local State").write_text(
        json.dumps({"profile": {"info_cache": {"Default": {"name": "Person 1"}}}}), encoding="utf-8"
    )
    (default / "Bookmarks").write_text(json.dumps(CHROME_BOOKMARKS), encoding="utf-8")
    (default / "Sessions" / "Session_13436813666016900").write_bytes(snss(CHROME_TABS, {DOCS: "Docs"}))

    safari = made / "safari" / "Library"
    (safari / "Safari").mkdir(parents=True)
    (safari / "Safari" / "Bookmarks.plist").write_bytes(
        plistlib.dumps(safari_bookmarks(), fmt=plistlib.FMT_BINARY)
    )
    container = safari / "Containers" / "com.apple.Safari" / "Data" / "Library" / "Safari"
    container.mkdir(parents=True)
    safari_tabs(container / "SafariTabs.db")

    os.environ[BROWSERS_DIR] = str(made)
    atexit.register(shutil.rmtree, made, ignore_errors=True)
    return made


#: Every file each space should hold, by space.
EXPECTED = {
    "Firefox": [
        "Board.url",
        "Bookmarks/Bookmarks menu/Recipes.url",
        "Bookmarks/Bookmarks toolbar/Work/Wiki.url",
        "Docs/API.url",
        "Docs/The guide.url",
        "Mail.url",
        "Saved groups/Trip/Flights.url",
    ],
    "Chrome": [
        "Board.url",
        "Bookmarks/Bookmarks bar/Work/Wiki.url",
        "Bookmarks/Other bookmarks/Recipes.url",
        "Docs/API.url",
        "Docs/The guide.url",
        "Mail.url",
    ],
    "Safari": [
        "Board.url",
        "Bookmarks/Bookmarks menu/Recipes.url",
        "Bookmarks/Favorites/Work/Wiki.url",
        "Docs/API.url",
        "Docs/The guide.url",
        "Mail.url",
        "Reading List/A long read.url",
    ],
}


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.browser-import")
    parsed.add_argument("--shots", type=pathlib.Path, default=pathlib.Path("."))
    args = parsed.parse_args()

    switch = borrowed("switch", "web-switch-probe.py")
    camera = borrowed("favicon", "favicon-cache-probe.py")
    switch.wipe(args.identifier)
    spaces = switch.spaces_root()
    browsers_home()
    notes = spaces / "Notes"
    notes.mkdir(parents=True)
    (notes / "Idea.md").write_text("# Idea\n", encoding="utf-8")
    args.shots.mkdir(parents=True, exist_ok=True)
    os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = "--remote-debugging-port=0"

    said: dict[str, object] = {}
    running = None
    try:
        running, app, _ = switch.launch(args.exe, args.identifier)
        if not close_app(running):
            running.terminate()
            running.wait(timeout=30)
        switch.allow_eval(args.identifier)
        time.sleep(2)
        running, app, _ = switch.launch(args.exe, args.identifier, unlike=app.port)

        zen.until(app, "nib.workspace.activeSpace?.name ?? null", lambda one: one == "Notes", 60)

        def bring(row: str) -> None:
            app.ask("nib.settings.show('import') || 'shown'")
            zen.until(app, zen.ROWS, lambda one: isinstance(one, list) and row in one)
            said[f"pressed {row}"] = app.ask(zen.PRESS % json.dumps(row))
            zen.until(
                app,
                "JSON.stringify(nib.workspace.spaces.map((one) => one.name))",
                lambda one: isinstance(one, list) and row in one,
                60,
            )
            time.sleep(2)

        app.ask("nib.settings.show('import') || 'shown'")
        said["rows"] = zen.until(app, zen.ROWS, lambda one: isinstance(one, list) and "Chrome" in one)
        said["pane"] = camera.photograph(args.identifier, (args.shots / "browser-import-pane.png").resolve())

        bring("Firefox")
        bring("Chrome")
        bring("Safari")
        said["held"] = held = app.ask(zen.HELD)
        said["files"] = files = {name: zen.files_under(spaces / name) for name in EXPECTED}
        said["chrome"] = camera.photograph(args.identifier, (args.shots / "browser-import-chrome.png").resolve())

        # Again: nothing is written twice.
        bring("Firefox")
        bring("Chrome")
        bring("Safari")
        said["again"] = {name: zen.files_under(spaces / name) for name in EXPECTED}
        said["spaces again"] = app.ask("JSON.stringify(nib.workspace.spaces.map((one) => one.name))")
    finally:
        if running is not None and not close_app(running):
            running.terminate()

    print(json.dumps(said, indent=2))
    rows = said.get("rows")
    good = (
        isinstance(rows, list)
        and "Firefox" in rows
        and "Chrome" in rows
        and "Safari" in rows
        and not any(name in rows for name in ("Edge", "Brave", "Chromium", "Vivaldi"))
        and isinstance(held, dict)
        and held.get("spaces") == ["Notes", "Firefox", "Chrome", "Safari"]
        and files == EXPECTED
        and "Mail.url" in json.dumps(held.get("bookmarks"))
        and said.get("again") == files
        and said.get("spaces again") == ["Notes", "Firefox", "Chrome", "Safari"]
    )
    print("PASS" if good else "FAIL")
    return 0 if good else 1


if __name__ == "__main__":
    raise SystemExit(main())
