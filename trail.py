"""Per-tab back and forward: the trail on a tab, and the two steps along it."""

import pathlib


def edit(path: str, pairs: list[tuple[str, str]]) -> None:
    file = pathlib.Path(path)
    text = file.read_text(encoding="utf-8")
    for old, new in pairs:
        assert old in text, f"{path}: {old[:60]}"
        text = text.replace(old, new, 1)
    file.write_text(text, encoding="utf-8", newline="\n")
    print(path, "ok")


edit(
    "apps/desktop/src/lib/workspace/documents.svelte.ts",
    [
        (
            """  /** Whether this tab is held at the front of the strip.""",
            """  /** The notes this tab has shown, oldest first, and where along them it is.
   *
   *  A tab that moves on from one note to another - which is what the tab being
   *  previewed in does all day - leaves a trail, and going back along it shows
   *  the note that was there before. Paths and nothing else: where the caret and
   *  the scroll were is kept per note already, so arriving back at a note arrives
   *  where it was left; see positions.ts.
   *
   *  For the sitting only. A trail is where you have been this afternoon, and a
   *  note in it may not be there tomorrow. */
  trail = $state<readonly string[]>([])
  at = $state(0)

  /** Whether there is anywhere to step, either way. */
  get canGoBack(): boolean {
    return this.at > 0
  }

  get canGoForward(): boolean {
    return this.at < this.trail.length - 1
  }

  /** Whether this tab is held at the front of the strip.""",
        )
    ],
)

edit(
    "apps/desktop/src/lib/workspace.svelte.ts",
    [
        # A new tab starts a trail; a preview tab adds to one.
        (
            """    if (reusable) {
      reusable.note.adopt({ path, name: basename(path), text: doc })
      this.placeAt(reusable, path)""",
            """    if (reusable) {
      reusable.note.adopt({ path, name: basename(path), text: doc })
      this.walked(reusable, path)
      this.placeAt(reusable, path)""",
        ),
        (
            """    const note = this.document({ kind: 'note', path, name: basename(path), text: doc, dirty: false })
    const tab = new Tab(note, this.panes.focusedId)
    this.placeAt(tab, path)""",
            """    const note = this.document({ kind: 'note', path, name: basename(path), text: doc, dirty: false })
    const tab = new Tab(note, this.panes.focusedId)
    this.walked(tab, path)
    this.placeAt(tab, path)""",
        ),
        # The trail itself, and the two steps along it.
        (
            """  /** Holds a tab at the front of its strip, or lets it go again.""",
            """  /** Writes a note down as where this tab now is.
   *
   *  What was ahead of it is dropped, the way it is in anything that goes back
   *  and forward: arriving somewhere new from halfway along a trail makes the
   *  rest of that trail a road not taken. Arriving where it already is changes
   *  nothing, so opening the same note twice does not fill the trail with it. */
  private walked(tab: Tab, path: string) {
    if (tab.trail[tab.at] === path) return

    const behind = tab.trail.slice(0, tab.at + 1)
    tab.trail = [...behind, path].slice(-TRAIL)
    tab.at = tab.trail.length - 1
  }

  /** Shows the note this tab was on before this one, or the one it came back
   *  from. `to` is where along the trail to land, which the two steps and the
   *  list behind the back arrow all say for themselves.
   *
   *  The note is taken on by the document the tab already holds, the way the
   *  preview tab takes one on: every pane showing this tab keeps its place, the
   *  editor keeps its own state per note, and the caret lands where it was left
   *  in the note being returned to. A note that has gone from the disk is
   *  dropped from the trail rather than reported: it is a road that is no longer
   *  there. */
  async walk(to: number, id: string | null = this.activeTabId) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab || to < 0 || to >= tab.trail.length || to === tab.at) return

    const path = tab.trail[to]
    if (path === undefined) return

    this.flush()
    const doc = await invoke<string>('read_note', { path }).catch(() => null)
    if (doc === null) {
      tab.trail = tab.trail.filter((one) => one !== path)
      tab.at = Math.min(tab.at, Math.max(tab.trail.length - 1, 0))
      return
    }

    tab.note.adopt({ path, name: basename(path), text: doc })
    tab.at = to
    this.placeAt(tab, path)
    tab.reading = false
    this.keep(tab.id)

    this.activeTabId = tab.id
    this.showNote()
    this.remember(path)
    this.persist()
  }

  /** One step back, and one step on. */
  goBack(id: string | null = this.activeTabId) {
    const tab = this.tabs.find((one) => one.id === id)
    if (tab) void this.walk(tab.at - 1, tab.id)
  }

  goForward(id: string | null = this.activeTabId) {
    const tab = this.tabs.find((one) => one.id === id)
    if (tab) void this.walk(tab.at + 1, tab.id)
  }

  /** Holds a tab at the front of its strip, or lets it go again.""",
        ),
        # The bound.
        (
            """const SESSION_DELAY = 400""",
            """const SESSION_DELAY = 400
/** How far back one tab remembers. Longer than anybody follows a link in one
 *  sitting, short enough that a trail is never what a session is made of. */
const TRAIL = 30""",
        ),
    ],
)
