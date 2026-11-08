from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
SHOTS = DRIVE.shots

NOTE = (
    "# Breaking\n\n"
    "A paragraph the writer typed\n"
    "on three lines\n"
    "and meant on three lines.\n\n"
    "A ==plain== one, a ==\U0001F534 red== one, a ==\U0001F7E0 orange== one, a ==\U0001F7E2 green== one,\n"
    "a ==\U0001F535 blue== one and a ==\U0001F7E3 violet== one.\n"
)

SEED = """
async (note) => {
  const ws = window.ordenApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const written = ws.notes.find((one) => one.name.startsWith('Breaking'))
  await ws.openEntry(written.path, { activate: true })
  return written.name
}
"""

OVERRULING = (
    "---\n"
    "export:\n"
    "  paper: Legal\n"
    "  margin: 15mm\n"
    "---\n\n"
    "# Legally\n\n"
    "This one says its own paper.\n"
)

SEED_NAMED = """
async ([note, prefix]) => {
  const ws = window.ordenApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const written = ws.notes.find((one) => one.name.startsWith(prefix))
  await ws.openEntry(written.path, { activate: true })
  return written.name
}
"""

BREAKS = """
() => {
  if (!window.ordenApp.modes.hardBreaks) window.ordenApp.modes.toggleHardBreaks()
  return window.ordenApp.modes.hardBreaks
}
"""

PAGE = """
(patch) => {
  window.ordenApp.settings.setPage(patch)
  return window.ordenApp.settings.page
}
"""

EMOJI = ["\U0001F534", "\U0001F7E0", "\U0001F7E2", "\U0001F535", "\U0001F7E3"]

def is_true(claim: bool, what: str) -> None:
    if not claim:
        wrong(what)

FORMATS = {
    "Export as PNG": "png",
    "Export as JPG": "jpg",
    "Export as SVG": "svg",
    "Export as PDF": "pdf",
    "Export as Plain text": "txt",
    "Export as RTF": "rtf",
    "Export as Word": "docx",
}

def exported(page: Page, row: str, name: str) -> Path:
    go = DRIVE.pick_export(page, FORMATS[row])
    with page.expect_download(timeout=40000) as caught:
        go.click()

    SHOTS.mkdir(parents=True, exist_ok=True)
    where = SHOTS / name
    caught.value.save_as(str(where))
    say(f"[{name}] {where.stat().st_size} bytes")
    return where

def the_plain_text(page: Page) -> None:
    text = exported(page, "Export as Plain text", "exported.txt").read_text(encoding="utf8")
    say(f"[txt] {json.dumps(text[:200])}")

    is_true(
        "A paragraph the writer typed\non three lines\nand meant on three lines." in text,
        "the plain text joined the lines the writer meant to keep",
    )
    for emoji in EMOJI:
        is_true(emoji not in text, f"the plain text carries the {emoji} out of a highlight")

def the_rtf(page: Page) -> Path:
    where = exported(page, "Export as RTF", "exported.rtf")
    rtf = where.read_text(encoding="utf8")

    is_true("typed\\line on three lines" in rtf, "the RTF joined the lines with a space")

    tones = [int(one) for one in re.findall(r"\\highlight(\d+) ", rtf)]
    say(f"[rtf] the highlights it names: {tones}")
    is_true(len(tones) == 6, f"the RTF has {len(tones)} highlights rather than six")
    is_true(len(set(tones)) == 6, "two highlights in the RTF came out the same colour")

    table = re.search(r"\{\\colortbl;([^}]*)\}", rtf)
    said = [one for one in (table.group(1) if table else "").split(";") if one.strip()]
    say(f"[rtf] the colour table holds {len(said)} colours")
    is_true(len(said) == 10, "the RTF colour table has no colour of its own for each tone")
    for emoji in EMOJI:
        is_true(emoji not in rtf, f"the RTF carries the {emoji} out of a highlight")

    return where

def the_word_document(page: Page) -> Path:
    where = exported(page, "Export as Word", "exported.docx")
    with zipfile.ZipFile(where) as package:
        xml = package.read("word/document.xml").decode("utf8")

    is_true("<w:br/>" in xml, "the Word document has no break in it at all")
    is_true("typed on three lines" not in xml, "the Word document joined the lines")

    tones = re.findall(r'<w:highlight w:val="([a-zA-Z]+)"/>', xml)
    say(f"[docx] the highlights it names: {tones}")
    is_true(len(tones) == 6, f"the Word document has {len(tones)} highlights rather than six")
    is_true(len(set(tones)) == 6, "two highlights in the Word document came out the same colour")
    is_true("yellow" in tones, "the plain highlight is no longer Word's yellow")
    for emoji in EMOJI:
        is_true(emoji not in xml, f"the Word document carries the {emoji} out of a highlight")

    return where

def rtf_says(where: Path) -> str:
    return where.read_text(encoding="utf8")

def rtf_page(words: str) -> str:
    said = re.search(r"\\paperw\d+\\paperh\d+(?:\\marg[lrtb]\d+){4}(?:\\landscape)?", words)

    return said.group(0) if said else "nothing at all"

def docx_says(where: Path) -> tuple[str, list[str]]:
    with zipfile.ZipFile(where) as package:
        return package.read("word/document.xml").decode("utf8"), package.namelist()

def docx_page(xml: str) -> dict[str, str]:
    size = re.search(r"<w:pgSz([^>]*)/>", xml)
    margin = re.search(r"<w:pgMar([^>]*)/>", xml)
    found = dict(re.findall(r'w:(\w+)="([^"]+)"', (size.group(1) if size else "")))
    found.update(
        {f"margin-{k}": v for k, v in re.findall(r'w:(\w+)="([^"]+)"', margin.group(1))}
        if margin
        else {}
    )
    return found

def the_paper_the_settings_default_to(rtf: Path, docx: Path) -> None:
    words = rtf_says(rtf)
    say(f"[rtf] the page it names: {rtf_page(words)}")
    is_true("\\paperw11906\\paperh16838" in words, "the RTF did not go out on A4")
    is_true("\\margl1134" in words, "the RTF did not take the 20 mm margin")
    is_true("\\paperw12240\\paperh15840" not in words, "the RTF is still on Letter")
    is_true("\\landscape" not in words, "the RTF turned an upright page on its side")

    xml, parts = docx_says(docx)
    found = docx_page(xml)
    say(f"[docx] the page it names: {found}")
    is_true(found.get("w") == "11906", "the Word document did not go out on A4")
    is_true(found.get("h") == "16838", "the Word document's A4 is the wrong way up")
    is_true(found.get("margin-top") == "1134", "the Word document did not take the margin")
    is_true(
        not [one for one in parts if re.match(r"word/(header|footer)\d*\.xml", one)],
        "the Word document has a running text nobody asked for",
    )

def the_paper_the_settings_ask_for(page: Page) -> None:
    said = page.evaluate(
        PAGE,
        {
            "paper": "A5",
            "orientation": "landscape",
            "margin": "33mm",
            "header": "${title}",
            "footer": "page of ${date}",
        },
    )
    say(f"the settings now say {said}")

    words = rtf_says(exported(page, "Export as RTF", "a5-landscape.rtf"))
    say(f"[rtf] the page it names: {rtf_page(words)}")
    is_true("\\paperw11906\\paperh8391" in words, "the RTF did not go out on A5 on its side")
    is_true("\\landscape" in words, "the RTF did not turn the page")
    is_true("\\margl1871" in words, "the RTF did not take the 33 mm margin")
    is_true("{\\header" in words, "the RTF has no running text across the top")
    is_true("{\\footer" in words, "the RTF has no running text across the foot")
    is_true("Breaking" in words, "the RTF header did not fill in the note's title")
    is_true("${title}" not in words, "the RTF carried the placeholder through unfilled")

    xml, parts = docx_says(exported(page, "Export as Word", "a5-landscape.docx"))
    found = docx_page(xml)
    say(f"[docx] the page it names: {found}")
    is_true(found.get("w") == "11906", "the Word document did not go out on A5 on its side")
    is_true(found.get("h") == "8391", "the Word document's A5 is the wrong way round")
    is_true(found.get("orient") == "landscape", "the Word document did not turn the page")
    is_true(found.get("margin-left") == "1871", "the Word document did not take the margin")
    running = [one for one in parts if re.match(r"word/(header|footer)\d*\.xml", one)]
    say(f"[docx] the parts the running text made: {running}")
    is_true(len(running) >= 2, "the Word document has no header and footer parts")

def the_paper_a_note_asks_for(page: Page) -> None:
    say(f"the space holds {page.evaluate(SEED_NAMED, [OVERRULING, 'Legally'])}")
    wait_for(
        page,
        "window.ordenApp.workspace.active?.note?.name?.startsWith('Legally')",
        "the overruling note to be the one open",
    )
    page.wait_for_timeout(300)

    words = rtf_says(exported(page, "Export as RTF", "legal.rtf"))
    say(f"[rtf] the page it names: {rtf_page(words)}")
    is_true("\\paperw20160\\paperh12240" in words, "the note's own paper was ignored")
    is_true("\\margl850" in words, "the note's own margin was ignored")
    is_true("\\landscape" in words, "the note's paper threw away the settings' orientation")
    is_true("Legally" in words, "the running text still names the note before it")

    xml, _ = docx_says(exported(page, "Export as Word", "legal.docx"))
    found = docx_page(xml)
    say(f"[docx] the page it names: {found}")
    is_true(found.get("w") == "20160", "the Word document ignored the note's own paper")
    is_true(found.get("h") == "12240", "the Word document ignored the note's own paper")
    is_true(found.get("orient") == "landscape", "the Word document dropped the orientation")
    is_true(found.get("margin-top") == "850", "the Word document ignored the note's own margin")

def drive(browser: Browser) -> None:
    context = browser.new_context(
        viewport={"width": 1180, "height": 820},
        color_scheme="light",
        accept_downloads=True,
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "window.ordenApp.workspace.active", "the app to open its own note")
    say(f"the space holds {page.evaluate(SEED, NOTE)}")
    wait_for(
        page,
        "window.orden && document.querySelector('.cm-content')"
        " && window.ordenApp.workspace.active?.note?.name?.startsWith('Breaking')",
        "the note to be the one open",
    )

    say(f"the line-break switch is on: {page.evaluate(BREAKS)}")
    page.wait_for_timeout(400)
    shot(page, "01-written")

    the_plain_text(page)
    rtf = the_rtf(page)
    docx = the_word_document(page)

    the_paper_the_settings_default_to(rtf, docx)
    the_paper_the_settings_ask_for(page)
    the_paper_a_note_asks_for(page)

    context.close()

def main() -> int:
    with DRIVE.session() as browser:
        drive(browser)

    return DRIVE.verdict("the breaks, the six colours and the paper reach every document format")

if __name__ == "__main__":
    raise SystemExit(main())
