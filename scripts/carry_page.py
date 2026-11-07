from __future__ import annotations

import json
import time
from collections.abc import Callable
from typing import Any

NOTE = "Carried note.md"
WORDS = "# Carried note\n\nWords the page should read back, äöü.\n"

PAGE = b"""<!doctype html><title>carry</title>
<style>
html,body{margin:0;height:100%;background:#ff00ff;font:16px sans-serif}
#zone{position:fixed;left:0;top:0;right:0;height:48%;background:#00ffff}
#field{position:fixed;left:35%;top:52%;width:30%;height:12%;font-size:16px}
</style>
<div id=zone></div><textarea id=field aria-label="the field"></textarea>
<script>
const said = { entered: null, files: null, field: '' }
const tell = () => { document.title = 'carried ' + JSON.stringify(said) }
const zone = document.getElementById('zone')
zone.addEventListener('dragenter', (e) => { said.entered = [...e.dataTransfer.types]; tell() })
zone.addEventListener('dragover', (e) => e.preventDefault())
zone.addEventListener('drop', async (e) => {
  e.preventDefault()
  said.trusted = e.isTrusted
  said.types = [...e.dataTransfer.types]
  said.plain = e.dataTransfer.getData('text/plain')
  const files = [...e.dataTransfer.files]
  said.files = await Promise.all(files.map(async (f) => ({ name: f.name, size: f.size, text: await f.text() })))
  tell()
})
const field = document.getElementById('field')
field.addEventListener('input', () => { said.field = field.value; tell() })
tell()
</script>"""

TITLES = "nib.pages.each().map(([, one]) => one.title).find((one) => (one || '').startsWith('carried ')) || ''"

MIDWAY = (
    "return { dragging: nib.workspace.panes.dragging, landing: nib.workspace.panes.landing,"
    " pages: nib.pages.each().map(([id, one]) => [id, one.layering, one.live, one.sent && one.sent.visible,"
    " one.sent && JSON.stringify(one.sent.cut)]),"
    " zones: [...document.querySelectorAll('.zone')].map((one) => one.className + ':' + one.hasAttribute('data-covers')),"
    " sides: !!document.querySelector('.zones.sides') }"
)

def zone_of(pane: dict[str, float]) -> tuple[float, float]:
    return pane["x"] + pane["width"] / 2, pane["y"] + pane["height"] * 0.38

def field_of(pane: dict[str, float]) -> tuple[float, float]:
    return pane["x"] + pane["width"] / 2, pane["y"] + pane["height"] * 0.58

def heard(title: Any) -> dict[str, Any]:
    try:
        return json.loads(str(title)[len("carried ") :])
    except ValueError:
        return {}

def row_box(path: str) -> str:
    return (
        "(() => { const row = document.querySelector('.row[data-path=\"' + CSS.escape(%s) + '\"]');"
        " if (!row) return null; row.scrollIntoView({ block: 'center' }); const r = row.getBoundingClientRect();"
        " if (r.width <= 0 || r.height <= 0) return null;"
        " for (let tries = 0; tries < 6; tries++) {"
        "   const on = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);"
        "   if (!on || row.contains(on)) break;"
        "   let over = on; while (over.parentElement && !['fixed', 'absolute'].includes(getComputedStyle(over).position)) over = over.parentElement;"
        "   over.style.visibility = 'hidden' }"
        " const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);"
        " return hit && row.contains(hit) ? { x: r.x, y: r.y, width: r.width, height: r.height } : null })()"
        % json.dumps(path)
    )

PANE = (
    "(() => { const all = nib.pages.each().map(([, one]) => one.sent)"
    ".filter((one) => one && one.visible); return all[0] ? all[0].pane : null })()"
)

def put_note(ask: Callable[[str], Any], root: str) -> Any:
    there = root.rstrip("/\\") + ("\\" if "\\" in root else "/") + NOTE
    return ask(
        f"return nib.workspace.entryAt({json.dumps(there)}) ? {json.dumps(there)}"
        f" : await nib.workspace.noteFrom({json.dumps(WORDS)}, {json.dumps(root)})"
    )

def where(note: str, root: str) -> str:
    return (
        "const crate = window.__TAURI_INTERNALS__.invoke; const note = %s, root = %s;"
        " const cut = root.replace(/[\\\\/]+$/, ''); const at = Math.max(cut.lastIndexOf('/'), cut.lastIndexOf('\\\\'));"
        " const sep = cut.includes('\\\\') ? '\\\\' : '/';"
        " const work = cut.slice(0, at) + sep + '.work' + sep + cut.slice(at + 1) + note.slice(cut.length);"
        " const asked = async (path) => crate('path_taken', { path }).then((one) => String(one), (e) => 'error ' + e);"
        " const carried = await crate('page_carry', { files: nib.workspace.dragPayload(note), addresses: [] }).then((one) => 'carried ' + one, (e) => 'refused ' + e);"
        " await crate('page_carry_end').catch(() => undefined);"
        " return { note: await asked(note), work, worked: await asked(work), payload: nib.workspace.dragPayload(note), carried }"
        % (json.dumps(note), json.dumps(root))
    )

def wrong_drop(said: dict[str, Any]) -> list[str]:
    files = said.get("files")
    if not isinstance(files, list) or not files:
        return [f"the page was handed no file: {said}"]
    wrong = []
    first = files[0]
    if first.get("name") != NOTE:
        wrong.append(f"the file the page was handed is not named {NOTE!r}: {first.get('name')!r}")
    if first.get("text") != WORDS:
        wrong.append(f"the file the page was handed does not hold the note's words: {first.get('text')!r}")
    if "Files" not in (said.get("entered") or []):
        wrong.append(f"the page was not told of a file as the drag entered it: {said.get('entered')}")
    return wrong

def into_field(said: dict[str, Any]) -> str:
    return "the note's words" if WORDS.strip() in str(said.get("field") or "") else repr(said.get("field"))

def carried(
    ask: Callable[[str], Any],
    screen: Callable[[float, float], tuple[float, float]],
    dragged: Callable[..., None],
    url: str,
    name: str,
) -> tuple[list[str], list[str]]:
    wrong: list[str] = []
    unverified: list[str] = []

    def until(code: str, seconds: float = 30) -> Any:
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            said = ask(code)
            if said and not (isinstance(said, dict) and said.get("error")):
                return said
            time.sleep(0.25)
        return None

    root = until("nib.workspace.activeSpace && nib.workspace.activeSpace.root")
    if not isinstance(root, str):
        return [f"[carry {name}] no space is open: {root}"], unverified
    note = put_note(ask, root)
    if not isinstance(note, str):
        return [f"[carry {name}] the app put no note in the space: {note}"], unverified
    if not until(f"void nib.workspace.loadTree(); return !!nib.workspace.entryAt({json.dumps(note)})"):
        return [f"[carry {name}] the file list never showed the note put in the space"], unverified
    ask(f"nib.workspace.openPage({json.dumps(url)}); return true")
    if not until(f"return ({TITLES}) !== ''", 40):
        seen = ask("return nib.pages.each().map(([id, one]) => [id, one.url, one.title, one.live])")
        return [f"[carry {name}] the page never loaded: {seen}"], unverified
    time.sleep(2)
    pane = until(f"return {PANE}")
    row = until(f"return {row_box(note)}")
    if not isinstance(pane, dict) or not isinstance(row, dict):
        rows = ask("return [...document.querySelectorAll('.row[data-path]')].map((one) => [one.dataset.path, JSON.stringify(one.getBoundingClientRect())])")
        return [f"[carry {name}] no page or no row to drag: page {pane}, row {row}, rows {rows}"], unverified
    print(f"[carry {name}] the row at {row}, the page at {pane}", flush=True)
    start = screen(row["x"] + row["width"] / 2, row["y"] + row["height"] / 2)

    def midway() -> None:
        print(f"[carry {name}] midway: {ask(MIDWAY)}", flush=True)

    dragged(start, screen(*zone_of(pane)), midway)
    said = heard(until(f"return {TITLES}", 10))
    print(f"[carry {name}] the page heard {said}", flush=True)
    missed = wrong_drop(said)
    wrong += [f"[carry {name}] {one}" for one in missed]
    if missed:
        print(f"[carry {name}] where the note is: {ask(where(note, root))}", flush=True)

    dragged(start, screen(*field_of(pane)))
    said = heard(until(f"return {TITLES}", 10))
    print(f"[carry {name}] a field that takes words only got {into_field(said)}", flush=True)
    if WORDS.strip() not in str(said.get("field") or ""):
        unverified.append(f"[carry {name}] a field with no drop of its own was not given the note's words")
    ask("for (const [id, one] of nib.pages.each()) if ((one.url || '').includes('/carry')) nib.workspace.close(id); return true")
    time.sleep(2)
    return wrong, unverified
