import json

from playwright.sync_api import Page

from harness import Drive

DRIVE = Drive(__file__, dev=True)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

NOTE = "# Suggest\n\nThe heron waits by the water.\n\n- a list item\n- another item\n\nThe last line.\n"

AGENT = {"id": "orden-p", "name": "P"}

VIEW = "window.ordenApp.views.of(window.ordenApp.workspace.panes.focusedId)"

START = """
async () => {
  await import('/src/lib/ai-chat/src/review/review.svelte.ts')
  window.__docs = await import('/src/lib/agent-docs/src/index.ts')
}
"""

EDIT = """
async ([agent, quote, words]) => {
  await window.__docs.notes.editNote(agent, { path: 'Suggest.md' }, [{ at: { quote }, replace: words }])
}
"""

def text(page: Page) -> str:
    return page.evaluate(f"() => {VIEW}.state.doc.toString()")

def marks(page: Page) -> int:
    return page.evaluate("() => document.querySelectorAll('.cm-review-added, .cm-review-removed').length")

def press_offer(page: Page, label: str) -> None:
    page.locator(".cm-review-added").first.hover()
    page.wait_for_selector(".cm-review-offer", timeout=5000)
    page.locator(".cm-review-offer button", has_text=label).click()
    page.wait_for_timeout(500)

def where_focus(page: Page) -> str:
    return page.evaluate(
        "() => { const one = document.activeElement; return one ? one.tagName + '.' + one.className : 'none' }"
    )

def step(page: Page, keys: str, scheme: str, wanted: str, what: str) -> None:
    page.keyboard.press(keys)
    page.wait_for_timeout(400)
    if wanted not in text(page):
        wrong(f"[{scheme}] {keys} {what}: {text(page)!r}")

def drive(page: Page, scheme: str) -> None:
    DRIVE.open(page)
    DRIVE.seed(page, NOTE)
    DRIVE.open_note(page, "Suggest")
    page.evaluate(START)
    page.wait_for_timeout(300)

    page.evaluate(EDIT, [AGENT, "heron", "stork"])
    wait_for(page, "document.querySelector('.cm-review-added')", "the suggestion")
    page.wait_for_timeout(400)
    shot(page, f"01-suggestion-{scheme}")

    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    press_offer(page, "Undo")
    say(f"[{scheme}] after Undo: {text(page)!r}, focus {where_focus(page)}")
    if "The heron" not in text(page):
        wrong(f"[{scheme}] Undo did not take the suggestion back")
    if "cm-content" not in where_focus(page):
        wrong(f"[{scheme}] after Undo the keyboard is not in the note but in {where_focus(page)}")
    step(page, "Control+z", scheme, "The stork", "did not bring the rejected suggestion back")
    if not marks(page):
        wrong(f"[{scheme}] the suggestion brought back by Ctrl+Z is not marked")
    step(page, "Control+y", scheme, "The heron", "did not reject it again")

    page.evaluate(EDIT, [AGENT, "water", "sea"])
    wait_for(page, "document.querySelector('.cm-review-added')", "the second suggestion")
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    press_offer(page, "Keep")
    say(f"[{scheme}] after Keep: {text(page)!r}, marks {marks(page)}, focus {where_focus(page)}")
    if "cm-content" not in where_focus(page):
        wrong(f"[{scheme}] after Keep the keyboard is not in the note but in {where_focus(page)}")
    step(page, "Control+z", scheme, "by the water.", "did not take back the kept suggestion")
    step(page, "Control+y", scheme, "by the sea.", "did not bring the kept suggestion again")

    before = text(page)
    page.evaluate(EDIT, [AGENT, "another item", "a third item, rather longer than it was"])
    wait_for(page, "document.querySelector('.cm-review-added')", "the list suggestion")
    page.wait_for_timeout(400)
    shot(page, f"02-list-suggestion-{scheme}")
    page.locator(".cm-review-added").first.hover()
    page.wait_for_timeout(600)
    shot(page, f"03-offer-{scheme}")
    boxes = page.evaluate(
        """() => [...document.querySelectorAll('.cm-review-added, .cm-review-removed')].map((one) => {
          const box = one.getBoundingClientRect()
          const line = one.closest('.cm-line').getBoundingClientRect()
          return { top: Math.round(box.top - line.top), bottom: Math.round(line.bottom - box.bottom) }
        })"""
    )
    say(f"[{scheme}] the marks inside their lines: {json.dumps(boxes)}")
    if any(one["top"] < 0 or one["bottom"] < 0 for one in boxes):
        wrong(f"[{scheme}] a mark spills out of its line: {boxes}")
    if page.evaluate("() => document.querySelector('.cm-review-line')"):
        wrong(f"[{scheme}] a bar over the start of the line still covers the text")
    page.mouse.move(5, 700)
    page.locator(".cm-content").click(position={"x": 5, "y": 5})
    step(page, "Control+z", scheme, "- another item", "did not take back the AI edit nobody answered")
    if text(page) != before:
        wrong(f"[{scheme}] Ctrl+Z did not take back exactly the AI edit: {text(page)!r}")
    step(page, "Control+y", scheme, "a third item", "did not bring the AI edit again")

    page.evaluate(EDIT, [AGENT, "The last line.", "The final line."])
    page.evaluate(
        """async (agent) => window.__docs.notes.undoAgent(agent, { path: 'Suggest.md' })""", AGENT
    )
    page.wait_for_timeout(400)
    say(f"[{scheme}] after undoing all: {text(page)!r}")
    if "The final line." in text(page) or "a third item" in text(page):
        wrong(f"[{scheme}] undoing all the agent's edits left some")
    step(page, "Control+z", scheme, "The final line.", "did not bring back all the rejected edits")
    if "a third item" not in text(page):
        wrong(f"[{scheme}] Ctrl+Z brought back only part of what undoing all took")
    step(page, "Control+y", scheme, "The last line.", "did not reject them all again")

def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            page = DRIVE.page(browser, viewport={"width": 1180, "height": 820}, color_scheme=scheme)
            drive(page, scheme)
            page.context.close()
    return DRIVE.verdict("AI suggestions in a note are undone and redone as one step each")

if __name__ == "__main__":
    raise SystemExit(main())
