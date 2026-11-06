from __future__ import annotations

import json
import sys
import urllib.request

import harness
from harness import Drive

DRIVE = Drive(__file__)
say = DRIVE.say
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots
APP = harness.APP

REGISTRY = "https://orden.so/themes"

WORN = ["github", "newsprint"]

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

SEED = """
async () => {
  const ws = window.nibApp.workspace
  await ws.noteFrom('# Kestrel notes\\n\\nA kestrel hangs on the wind.\\n\\n| Platform | Sync |\\n| --- | --- |\\n| Desktop | yes |\\n| Phone | yes |\\n')
  await ws.noteFrom('# Reading list\\n\\nA paper about ink.')
  await ws.loadTree()
  const first = ws.notes.find((one) => one.name.startsWith('Kestrel'))
  if (first) await ws.openEntry(first.path, { activate: true })
  return ws.files.length
}
"""

def fetch(url: str) -> str:
    ask = urllib.request.Request(url, headers={"user-agent": DESKTOP_AGENT})
    with urllib.request.urlopen(ask, timeout=30) as answer:
        return answer.read().decode("utf8")

def main() -> int:
    try:
        index = json.loads(fetch(f"{REGISTRY}/index.json"))
    except Exception as why:  # noqa: BLE001 - a scratch drive says what it could not reach
        say(f"the catalogue could not be read: {why}")
        return 1

    themes = index.get("themes", index if isinstance(index, list) else [])
    say(f"the catalogue holds {len(themes)}: {', '.join(one['id'] for one in themes)}")

    sheets: dict[str, str] = {}
    for one in WORN:
        sheets[one] = fetch(f"{REGISTRY}/{one}/theme.css")
        say(f"{one}: {len(sheets[one])} bytes of stylesheet")

    with DRIVE.session() as browser:
        for name, sheet in sheets.items():
            for scheme in ("light", "dark"):
                context = browser.new_context(
                    viewport={"width": 1280, "height": 820},
                    user_agent=DESKTOP_AGENT,
                    color_scheme=scheme,
                    device_scale_factor=2,
                )
                page = context.new_page()
                page.on("pageerror", lambda error: say(f"page error: {error}"))
                DRIVE.open(page)
                page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
                page.evaluate(SEED)
                page.evaluate("() => window.nibApp.workspace.showPanel('tree')")

                page.add_style_tag(content=sheet)
                page.wait_for_timeout(900)

                page.screenshot(path=str(SHOTS / f"{name}-{scheme}.png"))
                say(f"shot {name}-{scheme}.png")
                context.close()

    return DRIVE.verdict()

if __name__ == "__main__":
    sys.exit(main())
