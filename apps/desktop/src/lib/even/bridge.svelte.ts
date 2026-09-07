/** What ties the plugin's own tab strip to the glasses.
 *
 *  The whole of the app is here already: the same stores, the same notes, the
 *  same account, the same sync. So this is small on purpose. It watches the
 *  active tab and the note's revision, hands the words to the session, and hands
 *  the session the gestures that come back. Nothing goes over the network: the
 *  note is in memory, and the glasses are on the other end of a link the phone
 *  owns.
 *
 *  None of it runs in the plain web build, because nothing in the plain web
 *  build imports it. */

import { CODE_PALETTES, type CodePalette } from '@nib/editor'
import { type Look, Sheets } from '@nib/glasses'
import { mathCss } from '../math-fonts'
import { modes } from '../modes.svelte'
import { notePicture } from '../note-images'
import { Panel } from './screen'
import { connectGlasses, type Glasses, type Input } from './sdk'
import { type OpenNote, Session, type Showing } from './session'
import { workspace } from '../workspace.svelte'

/** How long after a keystroke the glasses are brought up to date.
 *
 *  Far longer than the editor's own idle: a page on the glasses costs the best
 *  part of a second over the radio, so the last thing anybody wants is one send
 *  per word. Short enough that putting the phone down and looking up shows the
 *  sentence just typed. */
const SETTLE = 700

/** The palette an unknown code theme falls back to.
 *
 *  The editor's list is a constant whose first entry is the one that follows the
 *  app's own theme, so the assertion stands on the shape of that constant rather
 *  than on hope; see code-theme.ts. */
const FOLLOW: CodePalette = CODE_PALETTES[0]!

class Bridge {
  /** What the glasses are showing, so the plugin can say so in a corner. Null
   *  while there is no pair in front of us, which is every browser. */
  showing = $state<Showing | null>(null)
  /** True when the last thing asked of the glasses did not happen. The plugin
   *  dims its corner rather than putting a sentence up: nobody writing a note
   *  wants a dialog about a radio. */
  stalled = $state(false)

  private session: Session | null = null
  private timer: ReturnType<typeof setTimeout> | undefined

  /** Brings the glasses up and starts following the active tab. Answers with a
   *  teardown either way, so the entry hands it to `onDestroy` without asking
   *  whether anything happened. */
  start(): () => void {
    let stop: (() => void) | undefined
    // A pair of glasses that cannot be reached leaves the plugin a working
    // editor, which is the whole of what to do about it.
    void this.connect().then(
      (teardown) => {
        stop = teardown
      },
      () => {
        this.stalled = true
      },
    )

    return () => {
      clearTimeout(this.timer)
      stop?.()
    }
  }

  private async connect(): Promise<(() => void) | undefined> {
    const glasses = await connectGlasses()
    if (!glasses) return undefined

    const sheets = new Sheets({
      // KaTeX's own stylesheet with its faces inside it, which is what lets a
      // formula be drawn as a picture rather than read as its source.
      mathStyles: (html) => mathCss(html),
      resolvePicture: (source) =>
        notePicture(source, workspace.active?.path ?? null, workspace.active?.doc ?? ''),
    })

    const panel = new Panel(glasses, sheets)
    if (!(await panel.open())) {
      this.stalled = true
      return undefined
    }

    const session = new Session((text) => sheets.pages(text, this.look()), panel)
    this.session = session

    const listening = glasses.listen((input) => this.heard(glasses, input))
    const watching = this.watch()

    return () => {
      listening()
      watching()
    }
  }

  /** Every reason to redraw, in one value: which note is active, how many times
   *  it has changed, and the two settings that decide how it is set. Derived
   *  rather than read one at a time inside the effect, so that the effect depends
   *  on all of it and the timer below sees one thing rather than four.
   *
   *  `revision` is what makes a keystroke reach here, whichever pane it was
   *  typed in; see NoteDoc in workspace/documents.svelte.ts. */
  private readonly wanted = $derived.by(() => {
    const tab = workspace.active
    const note = tab?.kind === 'note' ? tab.note : null
    if (!note) return null

    const chosen = CODE_PALETTES.find((one) => one.id === modes.codeTheme)
    return {
      note,
      revision: note.revision,
      look: { scope: modes.ligatures, palette: chosen ?? FOLLOW },
    }
  })

  private look(): Look {
    return this.wanted?.look ?? { scope: 'off', palette: FOLLOW }
  }

  private watch(): () => void {
    return $effect.root(() => {
      $effect(() => {
        const wanted = this.wanted
        // No note active: the glasses keep the one they have. That is the rule
        // about closing a note, and it needs nothing done to hold.
        if (!wanted) return

        const { note } = wanted
        clearTimeout(this.timer)
        this.timer = setTimeout(() => {
          note.flush()
          void this.follow({ key: note.key, name: note.name, text: note.text })
        }, SETTLE)
      })
    })
  }

  private async follow(note: OpenNote): Promise<void> {
    const session = this.session
    if (!session) return

    try {
      await session.follow(note)
      this.stalled = false
    } catch {
      // The plugin is an editor first. A page that did not reach the glasses
      // dims the corner and nothing else.
      this.stalled = true
    }
    this.showing = session.showing
  }

  private heard(glasses: Glasses, input: Input): void {
    const session = this.session
    if (!session) return

    if (input.kind === 'life') {
      // The host clears the page when it puts a layer of its own up, so coming
      // back to the front means drawing what is there again.
      if (input.life === 'foreground') void this.settle(session.repaint())
      return
    }

    // A double press is the way out of the app, and the glasses put their own
    // question up rather than this deciding for anybody. Required of every app
    // on its own root page.
    if (input.gesture === 'double') {
      void this.settle(glasses.leave())
      return
    }

    const by = input.gesture === 'up' ? -1 : input.gesture === 'down' ? 1 : 0
    if (!by) return

    void this.settle(session.turn(by))
  }

  /** Runs one thing asked of the glasses, and says in the corner whether it
   *  happened. The one place a failure out here is dealt with. */
  private async settle(work: Promise<void>): Promise<void> {
    try {
      await work
      this.stalled = false
    } catch {
      this.stalled = true
    }
    this.showing = this.session?.showing ?? null
  }
}

export const bridge = new Bridge()
