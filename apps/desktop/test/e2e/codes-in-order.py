from __future__ import annotations

import re

from playwright.sync_api import Browser

import harness
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PASSWORD = "tulip ladder seven"
SECRET = "JBSWY3DPEHPK3PXP"

IN_ORDER = """(selector) => [...document.querySelectorAll(selector)]
  .filter((one) => one.checkVisibility())
  .map((one) => {
    const node = [...one.childNodes].find((each) => each.nodeType === 3 && each.textContent.trim())
    if (!node) return 'no words'
    const pieces = [...node.textContent.matchAll(/[^\\s-]+/g)]
    const boxes = pieces.map((piece) => {
      const range = document.createRange()
      range.setStart(node, piece.index)
      range.setEnd(node, piece.index + piece[0].length)
      return range.getBoundingClientRect()
    })
    for (let at = 1; at < boxes.length; at++) {
      const before = boxes[at - 1]
      const after = boxes[at]
      if (Math.abs(before.top - after.top) < 2 && after.left < before.left) return `${pieces[at - 1][0]} after ${pieces[at][0]}`
    }
    return pieces.length > 1 ? 'in order' : 'one piece'
  })"""


def words(language: str):
    if language == "en":
        return lambda english: english
    source = (harness.APP / "src" / "locales" / f"{language}.ts").read_text(encoding="utf-8")

    def said(english: str) -> str:
        key = re.escape(english)
        found = re.search(rf"^  (?:'{key}'|{key}):\s*'((?:[^'\\]|\\.)*)',", source, re.M)
        return found.group(1).replace("\\'", "'") if found else english

    return said


def reads(page, selector: str, where: str) -> None:
    seen = page.evaluate(IN_ORDER, selector)
    say(f"{where}: {seen}")
    if not seen or any(one not in ("in order", "one piece") for one in seen):
        wrong(f"{where} reads back to front: {seen}")
        shot(page, where.replace(" ", "-"))


def drive(browser: Browser) -> None:
    for language in ("ar", "en"):
        said = words(language)
        context = browser.new_context(viewport={"width": 1100, "height": 760}, reduced_motion="reduce")
        context.add_init_script(
            "localStorage.setItem('orden:hidden-kinds', JSON.stringify(['experimental', 'experimental-pass']));"
            f" localStorage.setItem('orden:language', {language!r})"
        )
        page = context.new_page()
        page.on("pageerror", lambda error: wrong(f"page error: {error}"))
        DRIVE.open(page)
        page.keyboard.press("Control+Alt+v")
        wait_for(page, "document.querySelector('.pass input[type=password]')", f"[{language}] the setup screen", 60)
        fields = page.locator(".pass input[type=password]")
        fields.nth(0).fill(PASSWORD)
        fields.nth(1).fill(PASSWORD)
        page.get_by_role("button", name=said("Continue"), exact=True).click()
        wait_for(page, "document.querySelector('.pass .code')", f"[{language}] the recovery key", 180)
        reads(page, ".pass output.code", f"{language} recovery key")
        page.get_by_role("button", name=said("I saved it"), exact=True).click()
        wait_for(page, "document.querySelector('.pass .column.list')?.checkVisibility()", f"[{language}] the list")
        page.get_by_role("button", name=said("New login"), exact=True).click()
        page.get_by_label(said("Title"), exact=True).fill("Bank")
        page.get_by_label(said("2FA secret key (TOTP)"), exact=True).fill(SECRET)
        page.get_by_role("button", name=said("Create"), exact=True).click()
        wait_for(page, "/\\d/.test(document.querySelector('.pass .totp .value')?.textContent ?? '')", f"[{language}] the 2FA code")
        reads(page, ".pass .totp .value", f"{language} 2FA code")
        context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "codes and keys read left to right in a right-to-left language"))
