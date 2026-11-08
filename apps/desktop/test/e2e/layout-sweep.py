from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time
from typing import Any

from urllib.parse import urlsplit

from harness import ENGINE, LAUNCHED, Drive, harmless

DRIVE = Drive(__file__)
say, wrong = DRIVE.say, DRIVE.wrong

SHOTS_TOO = "--shots" in sys.argv

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)
PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)

DESKTOP_WIDTHS = (1280, 960, 720, 520)
DESKTOP_HEIGHT = 800
PHONE = {"width": 390, "height": 844}
SCHEMES = ("light", "dark")

PATIENCE = 30

NOW = int(time.time() * 1000)
USER = {
    "id": "sweep",
    "email": "someone.with.a.longer.address@example.com",
    "name": "Someone",
    "pronouns": None,
    "bio": None,
    "status": None,
    "accent": None,
    "avatar": None,
    "hidden": False,
    "syncVersion": 1,
}
ACCOUNT: dict[str, Any] = {
    "/v1/me": {"user": USER},
    "/v1/spaces": {"spaces": [], "deleted": []},
    "/v1/usage": {"used": 3_400_000, "limit": 1_000_000_000},
    "/v1/second": {"on": False, "since": None, "codesLeft": 0, "possible": True},
    "/v1/sessions": {
        "sessions": [
            {"id": "a", "name": "Chrome on Windows", "createdAt": NOW - 86_400_000, "lastUsedAt": NOW, "current": True},
            {"id": "b", "name": "Orden on an Android phone", "createdAt": NOW - 9 * 86_400_000, "lastUsedAt": NOW - 3_600_000, "current": False},
        ]
    },
    "/v1/settings": {"settings": {}, "key": {"set": False, "tail": None}},
    "/v1/trash": {"spaces": [], "notes": []},
    "/v1/shared": {"shared": []},
}

SEED = """
async () => {
  const ws = window.ordenApp.workspace
  const root = ws.activeSpace.root
  await ws.noteFrom('# Plan\\n\\nWe meet at noon on Friday, at the old station.\\n\\n- [ ] Book the room\\n- [ ] Write to everybody\\n', root)
  await ws.noteFrom('# A note with a name long enough to be cut somewhere in a narrow list\\n\\nWords.\\n', root)
  await ws.noteFrom('# Groceries\\n\\nBread, milk.\\n', root)
  await ws.loadTree()
  const note = ws.notes.find((one) => one.name === 'Plan.md')
  await ws.openEntry(note.path, { activate: true })
  return note.path
}
"""

CHECK = r"""
(scope) => {
  const roots = scope ? [...document.querySelectorAll(scope)] : [document.body]
  const said = []
  const say = (text) => { if (!said.includes(text)) said.push(text) }
  const vw = document.documentElement.clientWidth
  const vh = innerHeight
  const styles = new Map()
  const css = (el) => {
    let s = styles.get(el)
    if (!s) { s = getComputedStyle(el); styles.set(el, s) }
    return s
  }

  // What a person reads in, and what is somebody's own writing: the note, a
  // drawing, a picture. Their layout is the note's, not the app's.
  const OWN = '.cm-editor, #write, .orden-write, canvas, svg, iframe, video, img, [aria-hidden="true"], [inert], .orden-scrim, .sr-only'
  const own = (el) => !!el.closest(OWN)

  // Where an element is a person can see: its box, cut by every ancestor that clips
  // what is outside it, up to the window's edge or to a fixed layer.
  const clipped = (el, withWindow = true) => {
    const r = el.getBoundingClientRect()
    let box = { l: r.left, t: r.top, r: r.right, b: r.bottom }
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const s = css(a)
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.contain.includes('paint')) {
        const q = a.getBoundingClientRect()
        if (s.overflowX !== 'visible') { box.l = Math.max(box.l, q.left); box.r = Math.min(box.r, q.right) }
        if (s.overflowY !== 'visible') { box.t = Math.max(box.t, q.top); box.b = Math.min(box.b, q.bottom) }
      }
      if (s.position === 'fixed') break
    }
    if (withWindow) box = { l: Math.max(box.l, 0), t: Math.max(box.t, 0), r: Math.min(box.r, vw), b: Math.min(box.b, vh) }
    return box
  }

  // Drawn and somewhere a person could see it. A box squeezed to no width at all is
  // still drawn - its words spill out of it a letter to a line, which is the very
  // thing this drive is for - so it counts as shown when its edge is in view, and not
  // only when it has an area there.
  const shown = (el) => {
    if (own(el)) return false
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false
    const r = el.getBoundingClientRect()
    if (r.width < 1 && r.height < 1) return false
    const box = clipped(el)
    return box.r >= box.l && box.b >= box.t && (box.r > box.l || box.b > box.t)
  }

  // A name for an element a person can find: what it is, its classes without the
  // ones the compiler adds, its first words, and the two boxes it sits in.
  const named = (el) => {
    const one = (e) => {
      const classes = [...e.classList].filter((c) => !c.startsWith('svelte-')).slice(0, 3)
      const role = e.getAttribute('role')
      return e.tagName.toLowerCase() + classes.map((c) => '.' + c).join('') + (role && !classes.length ? `[role=${role}]` : '')
    }
    const trail = [one(el)]
    for (let a = el.parentElement, n = 0; a && n < 2 && a !== document.body; a = a.parentElement, n++) trail.push(one(a))
    const words = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 32)
    return `${trail.join(' < ')}${words ? ` "${words}"` : ''}`
  }
  const px = (n) => `${Math.round(n)}px`

  const elements = []
  for (const root of roots) {
    if (!root.checkVisibility()) continue
    elements.push(root, ...root.querySelectorAll('*'))
  }
  const visible = elements.filter(shown)
  const isShown = new Set(visible)

  // ── The page itself never scrolls sideways ─────────────────────────────
  const page = document.scrollingElement
  if (page.scrollWidth > page.clientWidth + 1)
    say(`the page scrolls sideways: ${page.scrollWidth}px of content in ${page.clientWidth}px`)

  // ── No word is broken across lines ─────────────────────────────────────
  // Word by word, off the boxes the browser drew each one in: a word on two tops is a
  // word split. Short words only - an address or a path longer than a line is allowed
  // to be broken where it has to be, and is not what this is about.
  const WORD = /[\p{L}\p{N}]{2,24}/gu
  for (const el of visible) {
    for (const node of el.childNodes) {
      if (node.nodeType !== 3 || !node.textContent.trim()) continue
      const text = node.textContent
      const range = document.createRange()
      for (const m of text.matchAll(WORD)) {
        range.setStart(node, m.index)
        range.setEnd(node, m.index + m[0].length)
        const tops = []
        for (const rect of range.getClientRects()) {
          if (rect.width < 0.5 || rect.height < 1) continue
          if (!tops.some((top) => Math.abs(top - rect.top) < rect.height / 2)) tops.push(rect.top)
        }
        if (tops.length > 1) {
          say(`"${m[0]}" is broken across ${tops.length} lines in ${named(el)} (${px(el.getBoundingClientRect().width)} wide)`)
          break
        }
      }
    }
  }

  // ── Nothing reaches past the window, spills out of its box, or is cut off ──
  const flagged = new Set()
  const inFlow = (el) => {
    const s = css(el)
    return (s.position === 'static' || s.position === 'relative') && s.transform === 'none' && s.display !== 'contents'
  }
  for (const el of visible) {
    if (el === document.body) continue
    const r = el.getBoundingClientRect()
    const box = clipped(el, false)
    if (box.r - box.l < 1 || box.b - box.t < 1) continue
    const ancestorFlagged = (() => {
      for (let a = el.parentElement; a; a = a.parentElement) if (flagged.has(a)) return true
      return false
    })()

    // Past the window's edge, partly: wholly outside is a drawer parked out of sight.
    if (!ancestorFlagged && ((box.r > vw + 1 && box.l < vw - 1) || (box.l < -1 && box.r > 1))) {
      flagged.add(el)
      say(`${named(el)} reaches past the window's edge (${px(box.l)} to ${px(box.r)} of ${vw}px)`)
      continue
    }

    // Out of the box it is in, sideways, where that box shows what spills.
    const parent = el.parentElement
    if (!ancestorFlagged && parent && isShown.has(parent) && inFlow(el) && parent !== document.body) {
      const p = parent.getBoundingClientRect()
      const ps = css(parent)
      const s = css(el)
      const inner = { l: p.left + parseFloat(ps.borderLeftWidth), r: p.right - parseFloat(ps.borderRightWidth) }
      const bleeds = parseFloat(s.marginLeft) < 0 || parseFloat(s.marginRight) < 0
      if (!bleeds && ps.overflowX === 'visible' && ps.display !== 'inline' && (r.right > inner.r + 2 || r.left < inner.l - 2)) {
        flagged.add(el)
        say(`${named(el)} spills out of ${named(parent).split(' < ')[0]} by ${px(Math.max(r.right - inner.r, inner.l - r.left))}`)
        continue
      }
    }

    // Words cut off at the edge of a box that hides what does not fit, with nothing to
    // say there is more: an ellipsis says it, a bare edge does not.
    const s = css(el)
    const ownWords = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    // A fade says it too: a tab's name runs out under a mask rather than a full stop.
    const faded = (() => {
      for (let a = el, n = 0; a && n < 3; a = a.parentElement, n++) {
        const m = css(a).maskImage || css(a).webkitMaskImage
        if (m && m !== 'none') return true
      }
      return false
    })()
    if (ownWords && !faded && s.overflowX !== 'visible' && s.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
      say(`the words of ${named(el)} are cut off (${el.scrollWidth}px in ${el.clientWidth}px)`)
    }
  }

  // ── No two things in a row are drawn over each other ───────────────────
  for (const el of visible) {
    const s = css(el)
    if (!s.display.includes('flex') || s.flexDirection.startsWith('column')) continue
    const kids = [...el.children].filter((k) => isShown.has(k) && inFlow(k) && parseFloat(css(k).marginLeft) >= 0 && parseFloat(css(k).marginRight) >= 0)
    for (let i = 0; i < kids.length; i++) {
      const a = kids[i].getBoundingClientRect()
      if (a.width < 1 || a.height < 1) continue
      for (let j = i + 1; j < kids.length; j++) {
        const b = kids[j].getBoundingClientRect()
        if (b.width < 1 || b.height < 1) continue
        const across = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (across > 2 && down > 2) say(`${named(kids[i])} and ${named(kids[j])} overlap by ${px(across)} in ${named(el).split(' < ')[0]}`)
      }
    }
  }

  // ── Every control has a size, and an empty field can be seen ───────────
  const CONTROLS = 'input:not([type="hidden"]), select, textarea, button, [role="switch"], [role="slider"], [role="checkbox"], [role="radio"], [role="combobox"], [contenteditable="true"]'
  const clear = (colour) => colour === 'transparent' || /rgba?\([^)]*,\s*0\)$/.test(colour) || /\/\s*0\)$/.test(colour)
  for (const el of visible) {
    if (!el.matches(CONTROLS)) continue
    const r = el.getBoundingClientRect()
    // A control hidden on purpose for a reader that cannot see - a pixel square cut by
    // a clip - is not one drawn at no size.
    if (r.width <= 1 && r.height <= 1) continue
    if (r.width < 6 || r.height < 6) {
      say(`${named(el)} is drawn at ${px(r.width)} by ${px(r.height)}`)
      continue
    }
    const typed = el.matches('textarea, input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="password"], input[type="number"]')
    if (typed && document.activeElement !== el && !el.value && !el.placeholder) {
      const s = css(el)
      const edged = ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(s[`border${side}Width`]) > 0 && !clear(s[`border${side}Color`]))
      const ground = !clear(s.backgroundColor) && s.backgroundColor !== css(el.parentElement).backgroundColor
      if (!edged && !ground && s.boxShadow === 'none')
        say(`${named(el)} is an empty field with nothing to show where it is`)
    }
  }

  // ── A box to tick is a box, and its words one line beside it ───────────
  // The question Ctrl+N raises in a terminal drew "Always ask" as an empty pill the
  // width of a field, its two words wrapped under each other (#317): a rule for the
  // sheet's text field that caught its checkbox too.
  for (const el of visible) {
    if (!el.matches('input[type="checkbox"]')) continue
    const r = el.getBoundingClientRect()
    if (r.width <= 1 && r.height <= 1) continue
    if (r.width > 2 * r.height || r.width > 32)
      say(`${named(el)} is a box to tick drawn ${px(r.width)} by ${px(r.height)}`)
    const label = el.closest('label')
    if (!label || label.querySelector('input, select, textarea, button') !== el) continue
    const words = [...label.childNodes].filter((one) => one !== el).map((one) => one.textContent).join(' ').trim()
    if (!words || words.length > 40) continue
    // The lines its words are drawn on, off each text's own boxes: two tops more than a
    // few pixels apart are two lines.
    const tops = []
    const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const one of range.getClientRects()) {
        if (one.width > 1 && !tops.some((top) => Math.abs(top - one.top) < 4)) tops.push(one.top)
      }
    }
    if (tops.length > 1) say(`the words "${words}" beside a box to tick wrap over ${tops.length} lines in ${named(label)}`)
  }

  // ── A box inset in a layer is inset at its foot too ────────────────────
  // The quick question (#360) held its field a space in from the top and the sides of
  // its sheet and set it on the sheet's bottom edge. A layer's first thing standing
  // clear of the top is the layer's inset, and its last thing keeps at least half of
  // it below; a layer that starts on its own edge - a list, a bar - is not asked.
  for (const sheet of visible) {
    if (!sheet.classList.contains('orden-screen')) continue
    const kids = [...sheet.children].filter((k) => isShown.has(k) && inFlow(k))
    if (!kids.length) continue
    const s = css(sheet)
    const box = sheet.getBoundingClientRect()
    // From the sheet's border to what is drawn in its first and last box: the sheet's
    // padding, a margin and the box's own padding are all the one inset.
    const inner = { t: box.top + parseFloat(s.borderTopWidth), b: box.bottom - parseFloat(s.borderBottomWidth) }
    const first = kids[0]
    const last = kids[kids.length - 1]
    const top = first.getBoundingClientRect().top + parseFloat(css(first).borderTopWidth) + parseFloat(css(first).paddingTop) - inner.t
    const foot = inner.b - (last.getBoundingClientRect().bottom - parseFloat(css(last).borderBottomWidth) - parseFloat(css(last).paddingBottom))
    // A layer that scrolls is cut at its foot by its height, and its last thing is
    // wherever the scroll left it.
    if (sheet.scrollHeight > sheet.clientHeight + 1) continue
    if (top >= 8 && foot < top / 2)
      say(`${named(kids[kids.length - 1])} stands ${px(foot)} from the foot of ${named(sheet).split(' < ')[0]}, whose top is ${px(top)} in`)
  }

  // ── The tab in front stays in sight in its strip ─────────────────────────
  // Both sidebars open on a window 520px wide squeezed the one tab to 14px under the
  // buttons that sit over the strip, and the plus scrolled half out beside it (#1572).
  for (const lane of visible) {
    if (lane.dataset.region !== 'tabs') continue
    const front = lane.querySelector('.tab.active')
    if (!front || !front.checkVisibility()) continue
    const box = clipped(front)
    const width = front.getBoundingClientRect().width
    if (box.r - box.l < Math.min(width, 38) - 1)
      say(`the tab in front is left ${px(Math.max(0, box.r - box.l))} of its ${px(width)} in ${named(lane)}`)
    const plus = lane.querySelector('.new')
    if (plus && plus.checkVisibility() && lane.scrollWidth <= lane.clientWidth + 1) {
      const seen = clipped(plus)
      const cut = seen.r - seen.l
      if (cut > 1 && cut < plus.getBoundingClientRect().width - 1)
        say(`the plus is cut to ${px(cut)} at the edge of ${named(lane)}`)
    }
  }

  // ── A row of settings keeps a name a person can read ───────────────────
  for (const row of visible) {
    if (!row.classList.contains('orden-setting')) continue
    const name = row.querySelector(':scope > .name')
    if (!name || !isShown.has(name)) continue
    const width = name.getBoundingClientRect().width
    const em = parseFloat(css(name).fontSize)
    const words = name.textContent.trim()
    if (words && width < Math.min(4 * em, words.length * em * 0.5))
      say(`the name "${words.slice(0, 32)}" of a row of settings is left ${px(width)}`)
  }

  return said
}
"""

PANES = """
() => [...document.querySelectorAll('[role="region"][aria-label="Settings"] nav .item')]
  .map((one) => one.textContent.trim()).filter(Boolean)
"""

SETTINGS = '[role="region"][aria-label="Settings"]'
PALETTE = '[role="dialog"]:has(input[role="combobox"])'

class Browser:

    def __init__(self, kind: str, signed_in: bool) -> None:
        self.kind = kind
        self.signed_in = signed_in
        self.label = f"{kind}, {'signed in' if signed_in else 'signed out'}"
        self.found: list[str] = []
        self.surfaces = 0
        self.errors: list[str] = []
        self.at = "the launch"

    async def open(self, browser: Any) -> Any:
        phone = self.kind == "phone"
        context = await browser.new_context(
            viewport=PHONE if phone else {"width": DESKTOP_WIDTHS[0], "height": DESKTOP_HEIGHT},
            user_agent=PHONE_AGENT if phone else DESKTOP_AGENT,
            has_touch=phone,
            is_mobile=phone,
            device_scale_factor=2 if phone else 1,
            color_scheme="light",
            reduced_motion="reduce",
            service_workers="block" if ENGINE == "webkit" else "allow",
        )
        if self.signed_in:
            await context.add_init_script("try { localStorage.setItem('orden:session', 'sweep') } catch {}")
        own = re.escape(urlsplit(DRIVE.origin).netloc)
        await context.route(re.compile(rf"^https?://(?!{own}/)"), self.answer)
        with_sockets = getattr(context, "route_web_socket", None)
        if with_sockets:
            await with_sockets(re.compile(r"^wss?://"), lambda socket: None)
        page = await context.new_page()
        page.set_default_timeout(PATIENCE * 1000)
        page.on("pageerror", self.threw)
        await page.goto(DRIVE.origin, wait_until="domcontentloaded")
        for expression in (
            "window.ordenApp",
            "window.ordenApp.workspace.activeSpace",
            f"performance.getEntriesByName({json.dumps(LAUNCHED)}).length > 0",
            "window.ordenApp.themeStore",
            "window.ordenApp.workspace.active",
        ):
            await page.wait_for_function(expression, polling=50)
        if self.signed_in:
            await page.wait_for_function("window.ordenApp.account.user", polling=50)
        self.path = await page.evaluate(SEED)
        await settle(page)
        return page

    def threw(self, error: Any) -> None:
        if harmless(error):
            return
        self.errors.append(f"{error} (after {self.at})")
        if os.environ.get("SWEEP_TRACE"):
            say(f"  {self.label} threw after {self.at}: {(error.stack or '')[:2500]}")

    async def answer(self, route: Any) -> None:
        url = route.request.url
        path = re.sub(r"^https?://[^/]+", "", url).split("?", 1)[0]
        if self.signed_in and path in ACCOUNT:
            await route.fulfill(status=200, content_type="application/json", body=json.dumps(ACCOUNT[path]))
        elif "nibeditor.com" in url and path.startswith("/v1/"):
            await route.fulfill(status=503, content_type="application/json", body='{"error":"not in a sweep"}')
        else:
            await route.abort()

    async def check(self, page: Any, surface: str, width: int, scheme: str, scope: str | None = None) -> None:
        await settle(page)
        self.surfaces += 1
        self.at = f"{surface} at {width} {scheme}"
        if os.environ.get("SWEEP_TRACE"):
            say(f"  {self.label}: {self.at} {await page.evaluate('() => [location.href, history.length]')}")
        where = f"[{self.kind} {width} {scheme}, {'signed in' if self.signed_in else 'signed out'}] {surface}"
        said = await page.evaluate(CHECK, scope)
        for one in said:
            self.found.append(f"{where}: {one}")
        if SHOTS_TOO or said:
            await self.photograph(page, f"{width}-{scheme}-{surface}")

    async def through(self, page: Any, surface: str, width: int, scheme: str, scope: str, scroller: str) -> None:
        await self.check(page, surface, width, scheme, scope)
        for _ in range(12):
            moved = await page.evaluate(
                """(scroller) => {
                  const box = document.querySelector(scroller)
                  if (!box || box.scrollTop + box.clientHeight >= box.scrollHeight - 1) return false
                  box.scrollTop += Math.max(100, box.clientHeight * 0.85)
                  return true
                }""",
                scroller,
            )
            if not moved:
                return
            await self.check(page, surface, width, scheme, scope)

    async def photograph(self, page: Any, name: str) -> None:
        slug = re.sub(r"[^a-z0-9]+", "-", f"{self.kind}-{'in' if self.signed_in else 'out'}-{name}".lower())
        DRIVE.shots.mkdir(parents=True, exist_ok=True)
        await page.screenshot(path=str(DRIVE.shots / f"{slug.strip('-')}.png"))

async def given_back(page: Any) -> None:
    await page.wait_for_timeout(150)

async def settle(page: Any) -> None:
    await page.evaluate(
        """() => new Promise((go) => {
          setTimeout(go, 200)
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(go, 30)))
        })"""
    )

async def scheme_of(page: Any, scheme: str) -> None:
    await page.evaluate("(scheme) => window.ordenApp.theme.setScheme(scheme)", scheme)
    await settle(page)

async def settings(one: Browser, page: Any, width: int, scheme: str) -> None:
    phone = one.kind == "phone"
    await page.evaluate("() => window.ordenApp.settings.show('general')")
    await page.wait_for_selector(SETTINGS)
    if phone:
        await page.evaluate("() => { window.ordenApp.settings.listing = true }")
        await one.check(page, "settings", width, scheme, SETTINGS)
    for pane in await page.evaluate(PANES):
        await page.evaluate("() => { window.ordenApp.settings.listing = true }")
        await settle(page)
        await page.locator(f"{SETTINGS} nav .item", has_text=pane).first.click()
        await one.through(page, f"settings/{pane}", width, scheme, SETTINGS, f"{SETTINGS} .body")
    await page.evaluate("() => { window.ordenApp.settings.open = false }")
    await page.wait_for_selector(SETTINGS, state="detached")

async def layer(one: Browser, page: Any, surface: str, width: int, scheme: str, opened: str, selector: str, closed: str) -> None:
    try:
        await page.evaluate(opened)
        await page.wait_for_selector(selector, timeout=8000)
    except Exception as error:  # noqa: BLE001 - a surface that did not come up is said, not raised
        one.found.append(f"[{one.kind} {width} {scheme}] {surface}: did not come up ({type(error).__name__})")
        await one.photograph(page, f"missing-{width}-{scheme}-{surface}")
        return
    await one.check(page, surface, width, scheme, selector)
    await page.evaluate(closed)
    await page.wait_for_selector(selector, state="detached", timeout=8000)
    await given_back(page)

async def palette(one: Browser, page: Any, width: int, scheme: str, typed: str = "") -> None:
    await page.keyboard.press("Control+Shift+P")
    await page.wait_for_selector(PALETTE)
    if typed:
        await page.keyboard.type(typed)
    await one.check(page, f"palette{' / ' + typed if typed else ''}", width, scheme, PALETTE)
    await shut(page, PALETTE)

async def shut(page: Any, selector: str) -> None:
    for _ in range(3):
        await page.keyboard.press("Escape")
        try:
            await page.wait_for_selector(selector, state="detached", timeout=1500)
            await given_back(page)
            return
        except Exception:  # noqa: BLE001 - one more press
            continue
    raise RuntimeError(f"{selector} did not close")

async def through_palette(one: Browser, page: Any, command: str, surface: str, selector: str, width: int, scheme: str) -> None:
    await page.keyboard.press("Control+Shift+P")
    await page.wait_for_selector(PALETTE)
    await page.keyboard.type(command)
    await page.wait_for_timeout(120)
    await page.keyboard.press("Enter")
    try:
        await page.wait_for_selector(selector, timeout=8000)
    except Exception:  # noqa: BLE001
        one.found.append(f"[{one.kind} {width} {scheme}] {surface}: did not come up through the palette")
        await page.keyboard.press("Escape")
        return
    await one.check(page, surface, width, scheme, selector)
    await shut(page, selector)

PANELS = ("tree", "outline", "search", "tasks", "chats", "links", "ask")

async def panels(one: Browser, page: Any, width: int, scheme: str) -> None:
    for panel in PANELS:
        try:
            await page.evaluate("(panel) => window.ordenApp.workspace.showPanel(panel)", panel)
        except Exception:  # noqa: BLE001 - a panel this build does not have
            continue
        await page.wait_for_timeout(60)
        await one.check(page, f"panel/{panel}", width, scheme)
    await page.evaluate("() => window.ordenApp.workspace.showPanel('tree')")

MENU = """
(selector) => {
  const row = [...document.querySelectorAll(selector)].find((one) => one.checkVisibility())
  if (!row) return false
  const r = row.getBoundingClientRect()
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + r.height / 2, button: 2 }))
  return true
}
"""

async def menus(one: Browser, page: Any, width: int, scheme: str) -> None:
    for surface, selector in (("menu/file", ".orden-row:has(.orden-row-label)"), ("menu/tab", '[role="tab"]')):
        if not await page.evaluate(MENU, selector):
            continue
        try:
            await page.wait_for_selector('[role="menu"]', timeout=4000)
        except Exception:  # noqa: BLE001 - a row with no menu on this device
            continue
        await one.check(page, surface, width, scheme, '[role="menu"]')
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(80)

HOLD = """
(path) => {
  const now = Date.now()
  const side = (who, at, text) => ({ device: who === 'mine' ? 'Laptop' : 'Pixel 9', at: now - at * 3600000, excerpt: { text, marks: [] } })
  window.__held = window.ordenApp.sync2.connectFake([{
    id: 'held', path, name: 'Plan.md',
    mine: side('mine', 2, 'We meet at noon on Friday, at the old station.'),
    theirs: side('theirs', 1, 'We meet at one on Saturday, at the new station by the river.'),
  }])
}
"""

STEP = 45

async def step(one: Browser, page: Any, name: str, width: int, scheme: str, work: Any) -> None:
    try:
        await asyncio.wait_for(work, STEP)
    except Exception as error:  # noqa: BLE001 - said, and the walk goes on
        words = str(error).splitlines()[0] if str(error) else type(error).__name__
        one.found.append(f"[{one.kind} {width} {scheme}] {name}: could not be walked: {words}")
        await one.photograph(page, f"stalled-{width}-{scheme}-{name}")
        for _ in range(3):
            await page.keyboard.press("Escape")
        await page.evaluate(
            "() => { const app = window.ordenApp; app.settings.open = false; app.account.open = false;"
            " if (app.themeStore) app.themeStore.open = false; app.iconChoice.close?.() }"
        )
        await settle(page)

async def new_tab(one: Browser, page: Any, width: int, scheme: str) -> None:
    before = await page.evaluate("() => { const ws = window.ordenApp.workspace; const was = ws.active?.id; ws.newTab(); return was }")
    await page.wait_for_timeout(120)
    await one.check(page, "new tab", width, scheme)
    await page.evaluate(
        """(before) => {
          const ws = window.ordenApp.workspace
          const made = ws.active?.id
          if (made && made !== before) ws.close(made, false)
          if (before) ws.activate(before)
          document.activeElement?.blur?.()
        }""",
        before,
    )
    await page.wait_for_timeout(60)

async def sync_question(one: Browser, page: Any, width: int, scheme: str) -> None:
    if one.kind == "phone":
        await page.evaluate("() => window.ordenApp.workspace.closePanel('left')")
        await given_back(page)
        await page.evaluate("() => window.ordenApp.workspace.closePanel('right')")
        await given_back(page)
    await layer(
        one, page, "sync question", width, scheme,
        f"() => {{ ({HOLD})({json.dumps(one.path)}) }}",
        '[role="dialog"][aria-label="Plan.md"]',
        "() => { window.__held?.stop() }",
    )

PROVIDER = """
() => {
  const ai = window.ordenApp.ai
  if (ai.providers.some((one) => one.name === 'Sweep')) return
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'Sweep', baseUrl: 'http://layout-sweep.localhost:9', model: 'sweep' })
  ai.setDefault(made.id)
}
"""

QUICK = '[role="dialog"][aria-label="Quick question"]'

async def quick_question(one: Browser, page: Any, width: int, scheme: str) -> None:
    await page.evaluate(PROVIDER)
    await page.keyboard.press("Control+Shift+P")
    await page.wait_for_selector(PALETTE)
    await page.keyboard.type("Quick question")
    await page.wait_for_timeout(120)
    await page.keyboard.press("Enter")
    await page.wait_for_selector(f"{QUICK} textarea", timeout=8000)
    await one.check(page, "quick question", width, scheme, QUICK)
    drop = page.locator(f"{QUICK} .drop")
    if await drop.count():
        await drop.click()
        await page.wait_for_selector(f"{QUICK} .chips", state="detached", timeout=4000)
        await one.check(page, "quick question / alone", width, scheme, QUICK)
    await shut(page, QUICK)

SIDES = """
(want) => {
  const ws = window.ordenApp.workspace
  for (const side of ['left', 'right']) if (!!ws.openOn(side) !== want) ws.toggleSidebar(side)
}
"""

async def both_sides(one: Browser, page: Any, width: int, scheme: str) -> None:
    if one.kind == "phone":
        return
    was = await page.evaluate("() => ({ left: window.ordenApp.workspace.openOn('left'), right: window.ordenApp.workspace.openOn('right') })")
    await page.evaluate(SIDES, True)
    await page.wait_for_timeout(400)
    try:
        await one.check(page, "both sidebars", width, scheme, "header")
    finally:
        await page.evaluate(
            """(was) => { const ws = window.ordenApp.workspace
              for (const side of ['left', 'right']) if (!!ws.openOn(side) !== was[side]) ws.toggleSidebar(side) }""",
            was,
        )
        await page.wait_for_timeout(400)

async def surfaces(one: Browser, page: Any, width: int, scheme: str) -> None:
    walks = [
        ("the window", one.check(page, "the window", width, scheme)),
        ("both sidebars", both_sides(one, page, width, scheme)),
        ("panels", panels(one, page, width, scheme)),
        ("menus", menus(one, page, width, scheme)),
        ("palette", palette(one, page, width, scheme)),
        ("palette / theme", palette(one, page, width, scheme, "theme")),
        ("theme picker", through_palette(one, page, "Switch theme", "theme picker", '[role="dialog"][aria-label="Themes"]', width, scheme)),
        ("question", through_palette(one, page, "Convert syntax", "question", '[role="dialog"]:has(form)', width, scheme)),
        ("theme store", layer(
            one, page, "theme store", width, scheme,
            "() => { window.ordenApp.settings.show('appearance'); window.ordenApp.themeStore.open = true }",
            '[role="dialog"][aria-label="Themes"]',
            "() => { window.ordenApp.themeStore.open = false; window.ordenApp.settings.open = false }",
        )),
        ("icon picker", layer(
            one, page, "icon picker", width, scheme,
            f"() => {{ window.ordenApp.iconChoice.file({json.dumps(one.path)}) }}",
            '[role="dialog"][aria-label="Choose an icon"]',
            "() => { window.ordenApp.iconChoice.close() }",
        )),
        ("sync question", sync_question(one, page, width, scheme)),
        ("terminal question", layer(
            one, page, "terminal question", width, scheme,
            "() => { void window.ordenApp.prompt.chooseTicking({ title: 'Ctrl+N in a terminal',"
            " options: [{ id: 'shell', label: 'Terminal' }, { id: 'app', label: 'Scratchpad', primary: true }],"
            " tick: 'Always ask' }) }",
            '[role="dialog"]:has(.tick)',
            "() => { window.ordenApp.prompt.dismiss() }",
        )),
        ("quick question", quick_question(one, page, width, scheme)),
        ("new tab", new_tab(one, page, width, scheme)),
    ]
    if not one.signed_in:
        walks.append(("sign in", layer(
            one, page, "sign in", width, scheme,
            "() => { window.ordenApp.account.open = true }",
            '[role="dialog"]:has(input[type="email"])',
            "() => { window.ordenApp.account.open = false }",
        )))
    for name, work in walks:
        await step(one, page, name, width, scheme, work)

async def empty(one: Browser, page: Any, width: int, scheme: str) -> None:
    made = await page.evaluate(
        """async () => {
          const ws = window.ordenApp.workspace
          try { await ws.addSpace('Empty') } catch { return false }
          await ws.loadTree()
          return ws.activeSpace?.name === 'Empty'
        }"""
    )
    if not made:
        return
    await page.wait_for_timeout(200)
    await one.check(page, "an empty space", width, scheme)

async def sweep_one(one: Browser, browser: Any) -> None:
    page = await one.open(browser)
    widths = (PHONE["width"],) if one.kind == "phone" else DESKTOP_WIDTHS
    if "--widths" in sys.argv and one.kind != "phone":
        widths = tuple(int(w) for w in sys.argv[sys.argv.index("--widths") + 1].split(","))
    for width in widths:
        if one.kind != "phone":
            await page.set_viewport_size({"width": width, "height": DESKTOP_HEIGHT})
        for scheme in SCHEMES:
            say(f"{one.label}: {width} {scheme}, {one.surfaces} surfaces so far")
            await scheme_of(page, scheme)
            await step(one, page, "settings", width, scheme, settings(one, page, width, scheme))
            await surfaces(one, page, width, scheme)
    await empty(one, page, widths[-1], SCHEMES[-1])
    await page.context.close()

async def sweep() -> list[Browser]:
    from playwright.async_api import async_playwright

    kinds = [Browser(kind, signed_in) for kind in ("desktop", "phone") for signed_in in (False, True)]
    if "--only" in sys.argv:
        wanted = sys.argv[sys.argv.index("--only") + 1].split(",")
        kinds = [one for one in kinds if f"{one.kind}-{'in' if one.signed_in else 'out'}" in wanted]
    async with async_playwright() as play:
        if ENGINE == "webkit":
            browser = await play.webkit.launch()
        else:
            browser = await play.chromium.launch(channel=os.environ.get("ORDEN_BROWSER", "chromium"))
        try:
            results = await asyncio.gather(*(sweep_one(one, browser) for one in kinds), return_exceptions=True)
        finally:
            await browser.close()
    for one, result in zip(kinds, results, strict=True):
        if isinstance(result, BaseException):
            wrong(f"[{one.label}] the sweep stopped after {one.at}: {type(result).__name__}: {str(result).splitlines()[0]}")
    return kinds

def main() -> int:
    started = time.monotonic()
    with DRIVE.session(browser=False):
        kinds = asyncio.run(sweep())

    for one in kinds:
        say(f"{one.label}: {one.surfaces} surfaces, {len(one.found)} faults")
        for error in dict.fromkeys(one.errors):
            if one.signed_in:
                say(f"  page error (stand-in service): {error.splitlines()[0]}")
            else:
                wrong(f"[{one.label}] page error: {error.splitlines()[0]}")
        for fault in dict.fromkeys(one.found):
            wrong(fault)
    say(f"swept in {time.monotonic() - started:.0f}s")
    return DRIVE.verdict()

if __name__ == "__main__":
    raise SystemExit(main())
