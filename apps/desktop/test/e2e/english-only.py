from __future__ import annotations

from harness import Drive
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

GERMAN = ["Einstellungen", "Neue Notiz", "Suchen", "Aussehen", "Allgemein", "Sprache"]

READ = """
() => ({
  dir: document.documentElement.dir,
  lang: document.documentElement.lang,
  kept: localStorage.getItem('orden:language'),
  text: document.body.innerText,
})
"""


def look(browser, locale: str, timezone: str) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820}, locale=locale, timezone_id=timezone)
    page.context.add_init_script("try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('orden:language', 'ar'); sessionStorage.setItem('seeded', '1') } } catch (_) {}")
    DRIVE.open(page)
    page.evaluate("() => window.ordenApp.settings.show('general')")
    wait_for(page, "() => document.body.innerText.includes('Appearance')", "the settings")
    quiet(page)
    page.wait_for_timeout(300)
    shot(page, f"settings-{locale}")
    read = page.evaluate(READ)
    say(f"{locale}: dir={read['dir']!r} lang={read['lang']!r} stored={read['kept']!r}")
    if read["dir"] == "rtl":
        wrong(f"{locale}: the page turned right to left")
    if read["kept"] is not None:
        wrong(f"{locale}: the old language choice is still stored")
    german = [one for one in GERMAN if one in read["text"]]
    if german:
        wrong(f"{locale}: German words on screen: {german}")
    for one in ["General", "Appearance"]:
        if one not in read["text"]:
            wrong(f"{locale}: {one!r} is not on screen")
    if "Language" in read["text"].split("\n"):
        wrong(f"{locale}: a language setting is still offered")
    clock = page.evaluate("() => new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle")
    say(f"{locale}: the system clock runs {clock}")
    page.context.close()


def main() -> int:
    with DRIVE.session() as browser:
        look(browser, "de-DE", "Europe/Zurich")
        look(browser, "ar-EG", "Africa/Cairo")
        look(browser, "en-US", "America/New_York")
    return DRIVE.verdict("the app is in English, left to right, whatever the system speaks")


if __name__ == "__main__":
    raise SystemExit(main())
