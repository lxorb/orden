/** What the glasses are showing, and what a gesture does to it.
 *
 *  The G2 gives an app five gestures and nothing else: a tap, a double tap, a
 *  hold, and a scroll each way, off either temple or off the ring. There is no
 *  pointer, no rotation and no delta; see docs/even.md. So every screen the
 *  plugin has has to be reachable with those five, and this is the whole of how:
 *
 *  | Gesture | Where | What |
 *  | --- | --- | --- |
 *  | tap | the note | open the sidebar |
 *  | tap | a list | open the row under the cursor |
 *  | hold | anywhere | open the modal |
 *  | double tap | the note | the system's own leave-this-app question |
 *  | double tap | anything else | close it, one level |
 *  | scroll | the note | a page each way |
 *  | scroll | a list | the cursor, a row each way |
 *  | scroll | an answer | a line each way |
 *
 *  A stack rather than a mode, because the modal opens over the note and the note
 *  picker opens over the modal, and a double tap has to close exactly one of them.
 *  The note is the floor of the stack and is never popped: a double tap there is
 *  the one gesture the platform reserves, and every app is checked for raising the
 *  exit dialogue on its root page.
 *
 *  Nothing here knows about Svelte, a radio or a workspace. The lists come from a
 *  `World` handed in and the words from a `Words` handed in, which is what makes
 *  the table above a test rather than a hope. */

import { BODY_INNER, BODY_ROWS, fit, pageOfLine, ruleOf, wrap } from '@nib/glasses'
import type { Session } from './session'

/** One row of a list on the glasses. */
export interface Row {
  /** What it is called. Cut to the panel by the view, not here. */
  label: string
  /** How far in it sits, in steps. */
  depth: number
  /** True when choosing it opens or shuts it rather than going into it. */
  folder: boolean
  /** True when it is a folder that is open. */
  open: boolean
  /** What the world calls it: a path, a space id, a choice. */
  id: string
}

/** Everything the shell cannot work out for itself.
 *
 *  Read afresh every time a screen is drawn rather than held, because the space's
 *  contents change under us: a note arriving through a room, a folder renamed on
 *  the desktop. A list on the glasses is never a stale list. */
export interface World {
  /** The name of the space the reader is in. */
  space: () => string
  /** Everything in the space with every folder open, canvases never among them.
   *  What a single tap puts up. */
  contents: () => Row[]
  /** The spaces, to switch between. */
  spaces: () => Row[]
  /** The same tree, but with folders that open and shut. */
  tree: () => Row[]
  /** Opens a note. Canvases cannot be opened in the plugin at all, so nothing
   *  here ever names one. */
  open: (id: string) => void
  /** Opens or shuts a folder in the tree. */
  fold: (id: string) => void
  /** Switches space. */
  enter: (id: string) => void
  /** Turns the microphone on or off. */
  listen: (on: boolean) => void
  /** Whether it is on now. */
  listening: () => boolean
}

/** The handful of words the glasses say for themselves, already translated.
 *
 *  Handed in so that this file has no locale in it and the four dictionaries have
 *  one entry each; see i18n.svelte.ts. */
export interface Words {
  spaces: string
  notes: string
  switchSpace: string
  changeNote: string
  voiceOn: string
  voiceOff: string
  thinking: string
  nothingHere: string
  noAnswer: string
}

/** What the reader is looking at. */
export type Screen =
  | { kind: 'note' }
  | { kind: 'sidebar'; at: number }
  | { kind: 'modal'; at: number }
  | { kind: 'spaces'; at: number }
  | { kind: 'tree'; at: number }
  | { kind: 'asking'; question: string }
  | { kind: 'answer'; question: string; rows: readonly string[]; at: number }

/** The five bands of the panel, filled. What the app writes to the glasses; see
 *  `panel.ts` in @nib/glasses for where each one sits. */
export interface View {
  head: string
  rule: string
  body: string
  nums: string
  foot: string
  mic: string
}

/** The three choices the hold gesture puts up. In this order, because the first is
 *  the one somebody holding the temple most often wants. */
const CHOICES = ['space', 'note', 'voice'] as const
type Choice = (typeof CHOICES)[number]

/** What a gesture is, once `sdk.ts` has read it off the wire. */
export type Gesture = 'tap' | 'double' | 'hold' | 'up' | 'down'

/** What the shell wants done outside itself, having handled a gesture.
 *
 *  Answered rather than done, because leaving the app is the platform's own
 *  business and a page is the radio's: both belong to the caller, and a shell that
 *  did them itself could not be tested without either. */
export type Wish = 'none' | 'leave' | 'draw'

const CURSOR = '▶ '
const NOWHERE = '  '
const OPEN = '▼ '
const SHUT = '▶ '
const STEP = '  '

/** How many rows of a list are shown at once. The body's own seven. */
const SHOWN = BODY_ROWS

/** A window of `SHOWN` rows that keeps the cursor inside it.
 *
 *  Scrolled rather than paged: the cursor moves a row at a time and the window
 *  follows it only when it would leave, which is how a list feels on anything
 *  else with a cursor in it. */
function windowOf(at: number, count: number): number {
  if (count <= SHOWN) return 0
  return Math.min(Math.max(0, at - Math.floor(SHOWN / 2)), count - SHOWN)
}

function clamp(at: number, count: number): number {
  return Math.min(Math.max(0, at), Math.max(0, count - 1))
}

export class Shell {
  /** The note is the floor and is never popped. */
  private stack: Screen[] = [{ kind: 'note' }]
  /** What the foot says for a moment instead of what it usually says: a command
   *  just heard, or a word about what went wrong. Cleared by the caller's timer. */
  private flashed = ''

  constructor(
    private readonly world: World,
    private readonly words: Words,
    private readonly session: Session,
  ) {}

  get screen(): Screen {
    return this.stack.at(-1) ?? { kind: 'note' }
  }

  /** True when anything at all is open over the note. What a spoken "close" and
   *  the back gesture both ask. */
  get open(): boolean {
    return this.stack.length > 1
  }

  /** One gesture off a temple or off the ring. */
  handle(gesture: Gesture): Wish {
    switch (gesture) {
      case 'hold':
        // From anywhere, including from inside another screen: a hold is the way
        // to the modal and never has to be reached for twice.
        this.stack = [{ kind: 'note' }, { kind: 'modal', at: 0 }]
        return 'draw'

      case 'double':
        return this.back()

      case 'tap':
        return this.choose()

      case 'up':
        return this.move(-1)

      case 'down':
        return this.move(1)
    }
  }

  /** Closes one level, or asks to leave the app when there is nothing to close.
   *
   *  This is the whole of item four's back gesture: the plugin consumes the double
   *  tap while anything is open, and hands it back to the system only on the root
   *  page, which is where a review expects the exit dialogue. */
  back(): Wish {
    if (this.stack.length > 1) {
      this.stack.pop()
      return 'draw'
    }

    return 'leave'
  }

  /** Puts a screen up by name. What a spoken command asks for. */
  show(kind: 'sidebar' | 'modal' | 'spaces' | 'tree'): Wish {
    this.stack = [{ kind: 'note' }, { kind, at: 0 }]
    return 'draw'
  }

  /** Back to the note, whatever was over it. */
  close(): Wish {
    this.stack = [{ kind: 'note' }]
    return 'draw'
  }

  /** A question on its way to the model, and then its answer. */
  asking(question: string): Wish {
    this.stack = [{ kind: 'note' }, { kind: 'asking', question }]
    return 'draw'
  }

  answered(question: string, answer: string): Wish {
    // Wrapped here rather than by the container, so that the rows the reader
    // scrolls through are the rows the firmware will draw, one for one.
    const rows = answer
      .split('\n')
      .flatMap((line) => (line === '' ? [''] : [...wrap(line, BODY_INNER)]))
    const said = answer.trim() === '' ? [this.words.noAnswer] : rows

    this.stack = [{ kind: 'note' }, { kind: 'answer', question, rows: said, at: 0 }]
    return 'draw'
  }

  /** A word in the foot for a moment: a command heard, a name not found. */
  flash(said: string): void {
    this.flashed = said
  }

  clearFlash(): void {
    this.flashed = ''
  }

  /** The page of the note the reader is on, by whichever route they asked.
   *
   *  Here rather than on the session because a page turn means nothing while a
   *  list is up: the scroll belongs to whatever is in front of the reader. */
  turn(by: number): Wish {
    this.session.turn(by)
    return 'draw'
  }

  /** Straight to a page, for "open page 4". */
  goToPage(page: number): Wish {
    this.session.goTo(page - 1)
    return 'draw'
  }

  /** Straight to a line of the note, for "go to line 40". */
  goToLine(line: number): Wish {
    const pages = this.session.pages
    if (!pages.length) return 'none'

    this.session.goTo(pageOfLine(pages, line))
    return 'draw'
  }

  /** The cursor, or the page, or a line of an answer: whatever the screen in front
   *  of the reader scrolls. */
  private move(by: number): Wish {
    const screen = this.screen
    switch (screen.kind) {
      case 'note':
        return this.turn(by)

      case 'sidebar':
        return this.step(screen, by, this.world.contents().length)

      case 'spaces':
        return this.step(screen, by, this.world.spaces().length)

      case 'tree':
        return this.step(screen, by, this.world.tree().length)

      case 'modal':
        return this.step(screen, by, CHOICES.length)

      case 'answer': {
        const most = Math.max(0, screen.rows.length - SHOWN)
        const at = Math.min(Math.max(0, screen.at + by), most)
        if (at === screen.at) return 'none'

        screen.at = at
        return 'draw'
      }

      case 'asking':
        // Nothing to scroll, and nothing to be confused about: the model is
        // working and the panel says so.
        return 'none'
    }
  }

  private step(screen: { at: number }, by: number, count: number): Wish {
    const at = clamp(screen.at + by, count)
    if (at === screen.at) return 'none'

    screen.at = at
    return 'draw'
  }

  /** A tap: into the row under the cursor, or into the sidebar from the note. */
  private choose(): Wish {
    const screen = this.screen
    switch (screen.kind) {
      case 'note':
        return this.show('sidebar')

      case 'sidebar': {
        const row = this.world.contents()[screen.at]
        if (!row) return 'none'

        this.world.open(row.id)
        return this.close()
      }

      case 'spaces': {
        const row = this.world.spaces()[screen.at]
        if (!row) return 'none'

        this.world.enter(row.id)
        return this.close()
      }

      case 'tree': {
        const row = this.world.tree()[screen.at]
        if (!row) return 'none'

        // A folder opens where it stands and the reader keeps their place; a note
        // opens and the tree goes away, because they asked for the note.
        if (row.folder) {
          this.world.fold(row.id)
          return 'draw'
        }

        this.world.open(row.id)
        return this.close()
      }

      case 'modal':
        return this.take(CHOICES[screen.at] ?? 'space')

      case 'answer':
      case 'asking':
        return 'none'
    }
  }

  private take(choice: Choice): Wish {
    switch (choice) {
      case 'space':
        this.stack.push({ kind: 'spaces', at: 0 })
        return 'draw'

      case 'note':
        this.stack.push({ kind: 'tree', at: 0 })
        return 'draw'

      case 'voice': {
        // Answered on the panel rather than silently: the microphone is the one
        // thing on these glasses with no light of its own.
        const on = !this.world.listening()
        this.world.listen(on)
        this.flash(on ? this.words.voiceOn : this.words.voiceOff)
        return this.close()
      }
    }
  }

  /** The five bands, filled for whatever is in front of the reader.
   *
   *  One function for every screen, so that they cannot drift apart: the sidebar
   *  and the note picker are the same seven rows in the same band with the same
   *  cursor, which is the whole of why they feel like one design. */
  view(): View {
    const mic = this.world.listening() ? '●' : ' '
    const screen = this.screen

    switch (screen.kind) {
      case 'note':
        return { ...this.note(), mic }

      case 'sidebar':
        return { ...this.list(this.world.space(), this.world.contents(), screen.at), mic }

      case 'spaces':
        return { ...this.list(this.words.spaces, this.world.spaces(), screen.at), mic }

      case 'tree':
        return { ...this.list(this.words.notes, this.world.tree(), screen.at), mic }

      case 'modal':
        return { ...this.modal(screen.at), mic }

      case 'asking':
        return {
          head: fit(screen.question, BODY_INNER),
          rule: ruleOf('─', BODY_INNER),
          body: '',
          nums: '',
          foot: this.words.thinking,
          mic,
        }

      case 'answer': {
        const from = Math.min(screen.at, Math.max(0, screen.rows.length - SHOWN))
        const shown = screen.rows.slice(from, from + SHOWN)
        const more = screen.rows.length > SHOWN
        return {
          head: fit(screen.question, BODY_INNER),
          rule: ruleOf('─', BODY_INNER),
          body: shown.join('\n'),
          nums: '',
          foot: more ? `${String(from + shown.length)}/${String(screen.rows.length)}` : '',
          mic,
        }
      }
    }
  }

  /** The note itself: the section in the head, seven lines in the body, the note's
   *  own name and which page of how many in the foot. */
  private note(): Omit<View, 'mic'> {
    const page = this.session.page
    const showing = this.session.showing
    if (!page || !showing) {
      return { head: '', rule: '', body: '', nums: '', foot: this.flashed, mic: '' }
    }

    // The section the reader is in, or the note's own name at the top of a note
    // that opens without a heading. Either way the head answers "where am I".
    const head = page.section === '' ? showing.name : page.section
    return {
      head: fit(head, BODY_INNER),
      rule: ruleOf(page.rule, BODY_INNER),
      body: page.words,
      nums: page.numbers,
      foot: this.flashed || fit(showing.name, 300),
      mic: '',
    }
  }

  /** A list: its name over a rule, seven rows of it, and where in it the cursor is.
   *
   *  The window follows the cursor rather than paging, and the cursor is a triangle
   *  in a column of its own so that every row's words start at the same pixel
   *  whether it is the chosen one or not. */
  private list(title: string, rows: readonly Row[], at: number): Omit<View, 'mic'> {
    const from = windowOf(at, rows.length)
    const shown = rows.slice(from, from + SHOWN)
    const body = shown.map((row, index) => {
      const mark = from + index === at ? CURSOR : NOWHERE
      const lead = row.folder ? (row.open ? OPEN : SHUT) : ''
      return fit(`${mark}${STEP.repeat(row.depth)}${lead}${row.label}`, BODY_INNER)
    })

    return {
      head: fit(title, BODY_INNER),
      rule: ruleOf('─', BODY_INNER),
      body: (rows.length ? body : [this.words.nothingHere]).join('\n'),
      nums: '',
      foot: rows.length ? `${String(at + 1)}/${String(rows.length)}` : '',
      mic: '',
    }
  }

  /** The three choices a hold puts up. Deliberately the same shape as a list, so a
   *  reader who has used one has used the other. */
  private modal(at: number): Omit<View, 'mic'> {
    const said: Record<Choice, string> = {
      space: this.words.switchSpace,
      note: this.words.changeNote,
      voice: this.world.listening() ? this.words.voiceOff : this.words.voiceOn,
    }

    const rows: Row[] = CHOICES.map((choice) => ({
      label: said[choice],
      depth: 0,
      folder: false,
      open: false,
      id: choice,
    }))

    return this.list(this.world.space(), rows, at)
  }
}
