from __future__ import annotations

import json

from playwright.sync_api import Browser, ConsoleMessage, Frame, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
failures = DRIVE.failures
ORIGIN = DRIVE.origin

YOUTUBE = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
VIMEO = "https://vimeo.com/76979871"
CODEPEN = "https://codepen.io/chriscoyier/pen/gfdDu"
PLAIN = "https://example.com/"

NOTE = f"""# Embeds, sandboxed

![]({YOUTUBE})

![]({VIMEO})

![]({CODEPEN})

<iframe src="{PLAIN}" height="240"></iframe>
"""

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith('Embeds'))
  await ws.openEntry(found.path, { activate: true })
  return found.name
}
"""

WITHOUT_SAME_ORIGIN = """
(() => {
  const drop = (value) =>
    String(value)
      .split(/\\s+/)
      .filter((one) => one && one !== 'allow-same-origin')
      .join(' ')

  const setAttribute = Element.prototype.setAttribute
  Element.prototype.setAttribute = function (name, value) {
    if (this instanceof HTMLIFrameElement && String(name).toLowerCase() === 'sandbox') {
      return setAttribute.call(this, name, drop(value))
    }
    return setAttribute.call(this, name, value)
  }

  const add = DOMTokenList.prototype.add
  DOMTokenList.prototype.add = function (...tokens) {
    return add.apply(
      this,
      tokens.filter((one) => one !== 'allow-same-origin'),
    )
  }

  const sandbox = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'sandbox')
  if (sandbox?.set) {
    Object.defineProperty(HTMLIFrameElement.prototype, 'sandbox', {
      ...sandbox,
      set(value) {
        sandbox.set.call(this, drop(value))
      },
    })
  }
})()
"""

INSIDE = """
() => {
  const video = document.querySelector('video')
  const words = (document.body?.innerText ?? '').trim().replace(/\\s+/g, ' ')

  // What the token actually buys the frame, asked directly. With it the frame has
  // its own origin and its own storage; without it the origin is opaque and the
  // first line of somebody's player bundle throws.
  const reaching = (read) => {
    try {
      read()
      return 'ok'
    } catch (error) {
      return error instanceof Error ? error.name : 'threw'
    }
  }

  return {
    title: document.title,
    words: words.slice(0, 200),
    storage: reaching(() => localStorage.length),
    cookies: reaching(() => document.cookie),
    video: !!video,
    ready: video?.readyState ?? null,
    time: video ? Math.round(video.currentTime * 100) / 100 : null,
    paused: video?.paused ?? null,
    duration: video && Number.isFinite(video.duration) ? Math.round(video.duration) : null,
    // What a player puts where the video should be when it will not play.
    broken: [
      ...document.querySelectorAll('.ytp-error, .vp-sidedock .error, [class*="error-message"]'),
    ]
      .map((one) => one.textContent?.trim().slice(0, 120))
      .filter(Boolean),
  }
}
"""

SUBJECTS = [
    ("youtube", "YouTube", ".ytp-large-play-button, .ytp-play-button, button.ytp-cued-thumbnail-overlay-image"),
    ("vimeo", "Vimeo", "button[data-play-button], .vp-controls .play, button[aria-label*='Play']"),
    ("codepen", "CodePen", None),
    ("page", "a plain iframe", None),
]

def opened(browser: Browser, same_origin: bool, logs: list[str]) -> Page:
    context = browser.new_context(viewport={"width": 1180, "height": 900}, color_scheme="light")
    page = context.new_page()

    def heard(message: ConsoleMessage) -> None:
        where = message.location.get("url", "") or ""
        if ORIGIN in where:
            return
        logs.append(f"[{message.type}] {message.text[:180]}")

    page.on("console", heard)
    if not same_origin:
        page.add_init_script(WITHOUT_SAME_ORIGIN)

    DRIVE.open(page)
    page.evaluate(SEED, NOTE)
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(1200)
    return page

def frame_of(page: Page, provider: str) -> Frame | None:
    handle = page.query_selector(f'.embed-web[data-provider="{provider}"] iframe')
    return handle.content_frame() if handle else None

def measure(page: Page, provider: str, name: str, play: str | None, logs: list[str]) -> dict:
    card = f'.embed-web[data-provider="{provider}"]'
    if not page.query_selector(card):
        wrong(f"{name}: the note has no card for it")
        return {"provider": provider, "card": False}

    page.eval_on_selector(card, "(one) => one.scrollIntoView({ block: 'center' })")
    page.click(card)
    page.wait_for_timeout(1500)

    said = page.eval_on_selector(
        card,
        """(one) => {
          const frame = one.querySelector('iframe')
          return frame
            ? {
                src: frame.getAttribute('src'),
                sandbox: frame.getAttribute('sandbox'),
                asked: one.dataset.sandbox ?? '',
              }
            : null
        }""",
    )
    if not said:
        wrong(f"{name}: a click on the card loaded no frame")
        return {"provider": provider, "card": True, "frame": False}

    out: dict = {
        "provider": provider,
        "card": True,
        "frame": True,
        "src": said["src"],
        "sandbox": said["sandbox"],
        "asked": said["asked"],
    }

    inner = frame_of(page, provider)
    if inner is None:
        out["loaded"] = False
        return out

    try:
        inner.wait_for_load_state("domcontentloaded", timeout=20000)
    except Exception as error:  # noqa: BLE001 - what is wanted is the reason, as words
        out["load_error"] = str(error)[:160]

    before = len(logs)
    if play:
        try:
            inner.wait_for_selector(play, timeout=15000, state="visible")
            inner.click(play, timeout=5000)
        except Exception as error:  # noqa: BLE001
            out["play_error"] = str(error)[:160]

        page.wait_for_timeout(6000)
    else:
        page.wait_for_timeout(4000)

    try:
        out.update(inner.evaluate(INSIDE))
    except Exception as error:  # noqa: BLE001
        out["inside_error"] = str(error)[:160]

    out["said"] = logs[before:][:6]
    return out

def pass_over(browser: Browser, same_origin: bool) -> list[dict]:
    logs: list[str] = []
    page = opened(browser, same_origin, logs)
    which = "as it ships" if same_origin else "without allow-same-origin"
    say(f"--- {which} ---")

    found: list[dict] = []
    for provider, name, play in SUBJECTS:
        seen = measure(page, provider, name, play, logs)
        found.append(seen)

        if seen.get("sandbox") is not None:
            asked = (seen.get("asked") or "").split()
            want = asked if same_origin else [one for one in asked if one != "allow-same-origin"]
            if (seen["sandbox"] or "").split() != want:
                wrong(
                    f"{name}: the frame's sandbox is {seen['sandbox']!r} where the card asked"
                    f" for {seen.get('asked')!r} - this pass wanted {' '.join(want)!r}"
                )

        say(f"{name}: {json.dumps({k: v for k, v in seen.items() if k != 'said'})}")
        for line in seen.get("said", []):
            say(f"    {line}")

    shot(page, "shipped" if same_origin else "without")
    page.context.close()
    return found

def plays(seen: dict) -> str:
    if not seen.get("frame"):
        return "no frame"
    if not seen.get("title") and not seen.get("words"):
        return "nothing loaded"
    if seen.get("broken"):
        return f"refused: {seen['broken'][0]}"

    store = f"storage {seen.get('storage')}"
    if seen.get("video"):
        moving = (seen.get("time") or 0) > 0 and seen.get("paused") is False
        if moving:
            return f"a player, playing ({seen['time']}s in), {store}"
        return f"a player, not playing (readyState {seen.get('ready')}), {store}"

    if not (seen.get("words") or "").strip():
        return f"the document, no player built, {store}"

    return f"loaded: {(seen.get('title') or '')[:40]}, {store}"

def main() -> int:
    with DRIVE.session(channel="chrome") as browser:
        shipped = pass_over(browser, same_origin=True)
        without = pass_over(browser, same_origin=False)

    print("\n  what each embed did:")
    print(f"    {'':<16}{'as it ships':<56}without allow-same-origin")
    for (provider, name, _), left, right in zip(SUBJECTS, shipped, without, strict=True):
        print(f"    {name:<16}{plays(left):<56}{plays(right)}")

    if failures:
        print(f"\n  {len(failures)} thing(s) the drive itself could not do:")
        for one in failures:
            print(f"    - {one}")

    print(
        "\n  This drive reports; it decides nothing. Whether the token comes off the"
        "\n  provider table is Emil's, and the cheaper half of the same question -"
        "\n  refusing a frame whose origin is the app's own - costs no provider"
        "\n  anything at all."
    )
    return 1 if failures else 0

if __name__ == "__main__":
    raise SystemExit(main())
