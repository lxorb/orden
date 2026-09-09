/** What ties the plugin's own editor to the glasses.
 *
 *  The whole of the app is already here: the same stores, the same notes, the same
 *  account, the same sync, the same rooms. So this is small on purpose. It watches
 *  the active note and the reader's own settings, hands the words to the session,
 *  hands the session's page to the panel, and hands the gestures and the words it
 *  hears back to the shell.
 *
 *  Four things live here because they are the four that need the app:
 *
 *  - **the world**, which is the space's own contents as rows on the glasses;
 *  - **the binding**, which keeps the phone's scroll and the page on the panel the
 *    same place in the note, in both directions;
 *  - **the voice**, which is a microphone, a grammar and a model;
 *  - **the settle**, which is the 700 ms that keeps a keystroke off the radio.
 *
 *  None of it runs in the plain web build, because nothing in the plain web build
 *  imports it. */

import { BODY_INNER, BODY_ROWS, GUTTER, type Page } from '@nib/glasses'
import { askAbout, type Found, TRANSCRIBERS, transcribeWith } from './ask'
import { bestOf, type Command, commandIn } from './commands'
import { fileMark } from '../file-mark'
import { t } from '../i18n.svelte'
import { modes } from '../modes.svelte'
import { Panel } from './screen'
import { parseQuery } from '../search/query'
import { fuzzyTerms } from '../search/fuzzy'
import { searchSpace } from '../search/space'
import { connectGlasses, type Glasses, type Input } from './sdk'
import { type OpenNote, Session } from './session'
import { type Row, Shell, type Wish, type Words, type World } from './shell'
import { Voice } from './voice'
import { type Entry, workspace } from '../workspace.svelte'

/** How long after a keystroke the glasses are brought up to date.
 *
 *  Far longer than the editor's own idle. A band on the panel costs about 83 ms of
 *  radio, so the last thing anybody wants is one send per word; short enough that
 *  putting the phone down and looking up shows the sentence just typed. */
const SETTLE = 700

/** How long an edit arriving from somebody else waits.
 *
 *  Much shorter, because it is not this reader's typing: a collaborator's paragraph
 *  should appear, and it does not arrive one character at a time. Long enough to
 *  fold a burst of them into one send. See docs/collaboration.md. */
const ARRIVAL = 80

/** How long a word heard, or a word about what went wrong, stays in the foot. */
const FLASH = 1400

/** How long after a page turn a scroll on the phone is the plugin's own doing.
 *
 *  The plugin scrolls the phone to the page it just turned to, and the scroll that
 *  causes is read a fifth of a second later; see Glasses.svelte. Anything inside
 *  this window is that scroll coming back, and acting on it is the two ends of the
 *  binding chasing each other round the note. */
const STEERING = 500

/** How many notes a search hands the model at once. */
const HITS = 20

/** Whatever was thrown, in as few words as carry the reason. */
function why(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** How the bridge is getting on, in one word.
 *
 *  `alone` is every browser: no phone app behind the page, so there is nothing to
 *  show and nothing to say. The others are only ever reached on a phone. */
type Health = 'alone' | 'reaching' | 'live' | 'stalled' | 'failed'

/** The rows of a space, as the glasses list them.
 *
 *  Folders and notes. Canvases are never listed, which is Emil's rule and also the
 *  only sane one: a canvas cannot be set in one font on seven lines. PDFs and
 *  pictures go the same way for the same reason, and the deviation is written down
 *  in docs/even.md rather than left to be discovered.
 *
 *  `expanded` decides whether a folder's children are listed at all: the sidebar
 *  shows everything open, the note picker follows the folds the reader has made. */
function rowsOf(entry: Entry | null, expanded: (path: string) => boolean, depth = 0): Row[] {
  if (!entry) return []

  const out: Row[] = []
  for (const child of entry.children) {
    if (child.is_dir) {
      const open = expanded(child.path)
      // A folder in a list where everything is open has nothing a tap could do, so
      // the cursor steps over it and its name is a label. See `Row.pick`.
      out.push({
        label: child.name,
        depth,
        folder: true,
        open,
        pick: !alwaysOpen(expanded),
        id: child.path,
      })
      if (open) out.push(...rowsOf(child, expanded, depth + 1))
      continue
    }

    if (fileMark(child.name) !== 'note') continue

    out.push({
      label: child.name.replace(/\.md$/i, ''),
      depth,
      folder: false,
      open: false,
      pick: true,
      id: child.path,
    })
  }

  return out
}

/** The sidebar's own answer to "is this folder open": always. Told apart from the
 *  picker's by identity, which is what lets one walk serve both. */
const OPEN_ALL = (): boolean => true
function alwaysOpen(expanded: (path: string) => boolean): boolean {
  return expanded === OPEN_ALL
}

class Bridge {
  /** What the glasses are showing, so the plugin can draw a frame around it. Null
   *  while there is no pair in front of us, which is every browser. */
  showing = $state<{ from: number; to: number; page: number; count: number } | null>(null)
  /** How it is getting on. The plugin shows nothing about this unless it is
   *  wrong: nobody writing a note wants a dialog about a radio. */
  health = $state<Health>('reaching')
  /** How long the plugin itself took over the last command it heard, from the end
   *  of the speech to the panel being asked to change.
   *
   *  Ours, and not the recogniser's: what it took to hear the words is the
   *  recogniser's own and is not ours to measure. Kept rather than logged so that a
   *  test and a screenshot can both read it. */
  latency = $state(0)
  /** What the reader is being asked or told, for the phone to show too: the
   *  question that went to the model, and whether the microphone is open. */
  asked = $state('')
  answer = $state('')
  listening = $state(false)

  private glasses: Glasses | null = null
  private panel: Panel | null = null
  private shell: Shell | null = null
  private voice: Voice | null = null
  private readonly session = new Session()
  private timer: ReturnType<typeof setTimeout> | undefined
  private flashing: ReturnType<typeof setTimeout> | undefined
  /** One draw at a time. A burst of scrolls moves the target and nothing else; see
   *  `pump`. */
  private drawing: Promise<void> | null = null
  private wanted = false
  /** Until when a scroll on the phone is this plugin's own doing rather than the
   *  reader's.
   *
   *  A page turn scrolls the phone, and the scroll that causes arrives a moment
   *  later and would turn the page again. A flag cleared on the next turn of the
   *  loop is not enough: the plugin reads the scroller after a pause, so the window
   *  has to outlast that pause. Long enough to cover it, short enough that a reader
   *  who turns a page and then scrolls is not ignored. */
  private steerUntil = 0

  /** Brings the glasses up and starts following the active note. Answers with a
   *  teardown either way, so the entry hands it to `onDestroy` without asking
   *  whether anything happened. */
  start(): () => void {
    let stop: (() => void) | undefined
    void this.connect().then(
      (teardown) => {
        stop = teardown
      },
      (error: unknown) => {
        this.health = 'failed'
        console.warn('nib for g2:', why(error))
      },
    )

    return () => {
      clearTimeout(this.timer)
      clearTimeout(this.flashing)
      void this.voice?.stop()
      stop?.()
    }
  }

  private async connect(): Promise<(() => void) | undefined> {
    const glasses = await connectGlasses()
    if (!glasses) {
      // No phone app behind this page. Every browser ends here, and the plugin is
      // then simply the editor.
      this.health = 'alone'
      return undefined
    }

    this.glasses = glasses
    const panel = new Panel(glasses, modes.glassesLineNumbers)
    const made = await panel.open()
    if (made !== 'made') {
      // The page is asked for exactly once a launch, so there is nothing to try
      // again: whatever the host answered is the answer for this sitting.
      this.health = 'failed'
      console.warn('nib for g2: the page was not made:', made)
      return undefined
    }

    this.panel = panel
    this.shell = new Shell(this.world(), this.words(), this.session)
    this.voice = new Voice({
      microphone: (open) => glasses.microphone(open),
      transcribe: modes.glassesKey ? (wav) => this.transcribe(wav) : null,
      heard: (heard) => this.heard(heard.said, heard.ended),
      failed: (said) => this.flash(said),
    })
    this.health = 'live'

    const listening = glasses.listen((input) => this.input(input))
    const watching = this.watch()
    if (modes.glassesVoice) void this.listen(true)

    return () => {
      listening()
      watching()
    }
  }

  /** The space's own contents, and what the glasses may do to them. */
  private world(): World {
    return {
      space: () => workspace.activeSpace?.name ?? t('Notes'),
      contents: () => rowsOf(workspace.tree, OPEN_ALL),
      spaces: () =>
        workspace.spaces.map((one) => ({
          label: one.name,
          depth: 0,
          folder: false,
          open: false,
          pick: true,
          id: one.id,
        })),
      tree: () => rowsOf(workspace.tree, (path) => workspace.isExpanded(path)),
      open: (id) => {
        // Notes only. A canvas is never in a list the glasses show, and this is the
        // second lock on the same door.
        if (fileMark(id.split(/[\\/]/).at(-1) ?? '') !== 'note') return
        void workspace.openEntry(id)
      },
      fold: (id) => workspace.toggleFolder(id),
      enter: (id) => void workspace.showSpace(id),
      listen: (on) => void this.listen(on),
      listening: () => this.listening,
      pageNumber: () => modes.glassesPageNumber,
    }
  }

  /** The words the glasses say for themselves, translated once. */
  private words(): Words {
    return {
      spaces: t('Spaces'),
      notes: t('Notes'),
      switchSpace: t('Switch space'),
      changeNote: t('Change note'),
      voiceOn: t('Voice on'),
      voiceOff: t('Voice off'),
      thinking: t('Thinking'),
      nothingHere: t('Nothing here'),
      noAnswer: t('No answer'),
    }
  }

  /** How the reader wants a note paged, as the pager takes it.
   *
   *  The body is the whole width on every screen; the line numbers are a column laid
   *  over its left, and the note's own rows carry a constant indent to clear it. See
   *  panel.ts in @nib/glasses for why that is the shape. */
  private paging() {
    return {
      breakAt: modes.glassesBreak,
      gutter: modes.glassesLineNumbers ? GUTTER : 0,
      inner: BODY_INNER,
      rows: BODY_ROWS,
    }
  }

  /** Everything that decides what the glasses show, in one value.
   *
   *  Derived rather than read one at a time inside the effect, so the effect depends
   *  on all of it and the timer below sees one thing rather than seven. `revision`
   *  is what makes a keystroke reach here, and what makes an edit arriving through a
   *  room reach here too: a room writes into the same document. */
  private readonly reading = $derived.by(() => {
    const tab = workspace.active
    const note = tab?.kind === 'note' ? tab.note : null
    if (!note) return null

    return {
      note,
      revision: note.revision,
      arrivals: note.arrivals,
      breakAt: modes.glassesBreak,
      lineNumbers: modes.glassesLineNumbers,
      pageNumber: modes.glassesPageNumber,
    }
  })

  private watch(): () => void {
    return $effect.root(() => {
      $effect(() => {
        const reading = this.reading
        if (!reading) return

        const { note } = reading
        clearTimeout(this.timer)

        // Only this reader's typing waits the full pause. A switch to another note
        // and the first page of a sitting are somebody asking for a note and then
        // watching the glass; an edit arriving from a collaborator is a paragraph
        // appearing, and neither should sit behind three quarters of a second.
        const switching = this.session.showing?.key !== note.key
        const arriving = reading.arrivals > this.arrived
        this.arrived = reading.arrivals
        const wait = switching ? 0 : arriving ? ARRIVAL : SETTLE

        this.timer = setTimeout(() => {
          note.flush()
          // Without the extension: on a panel of seven lines `.md` is four
          // characters of nothing, and the reader knows what their notes are.
          const name = note.name.replace(/\.md$/iu, '')
          this.follow({ key: note.key, name, text: note.text })
        }, wait)
      })

      // The line numbers move the body, and geometry is fixed when the page is
      // made, so this is the one setting that rebuilds it.
      $effect(() => {
        const numbered = modes.glassesLineNumbers
        const panel = this.panel
        if (!panel) return

        void panel.renumber(numbered).then(() => {
          this.follow(null)
        })
      })
    })
  }

  /** How many arrivals from other people this note had last time round. */
  private arrived = 0

  /** The note, paged, and the panel brought up to date if anything moved. */
  private follow(note: OpenNote | null): void {
    this.session.follow(note, this.paging())
    this.showing = this.session.showing
      ? {
          from: this.session.showing.from,
          to: this.session.showing.to,
          page: this.session.showing.page,
          count: this.session.showing.count,
        }
      : null

    // Nothing the reader can see has moved, so nothing is sent. This is the whole
    // of what keeps a keystroke off the radio.
    if (!this.session.moved && this.shell?.screen.kind === 'note') return

    this.draw()
  }

  /** One gesture, one frame of sound, or one lifecycle event. */
  private input(input: Input): void {
    if (input.kind === 'audio') {
      this.voice?.frame(input.pcm)
      return
    }

    if (input.kind === 'life') {
      // The host clears the page when it puts a layer of its own up, so coming
      // back to the front means drawing all of it again.
      if (input.life === 'foreground') {
        this.panel?.forget()
        this.draw()
      }
      return
    }

    this.act(this.shell?.handle(input.gesture) ?? 'none')
  }

  /** What the shell asked for, done. */
  private act(wish: Wish): void {
    if (wish === 'leave') {
      // The system's own leave-this-app question, which every app is checked for on
      // its root page.
      void this.glasses?.leave()
      return
    }

    if (wish === 'draw') {
      this.showing = this.session.showing
        ? {
            from: this.session.showing.from,
            to: this.session.showing.to,
            page: this.session.showing.page,
            count: this.session.showing.count,
          }
        : null
      // A page turned on the glasses scrolls the phone to the same words. The other
      // half of the binding; the flag is what stops the two chasing each other.
      this.steer()
      this.draw()
    }
  }

  /** The phone, scrolled to where the glasses are.
   *
   *  Half of item three's binding. `goto` is the app's own way of saying "open this
   *  note at this line", which the pane reads and clears; see workspace.svelte.ts. */
  private steer(): void {
    const showing = this.session.showing
    const path = workspace.active?.path
    if (!showing || !path || this.shell?.screen.kind !== 'note') return

    this.steerUntil = performance.now() + STEERING
    workspace.goto = { path, line: showing.firstLine }
  }

  /** The glasses, taken to where the phone is.
   *
   *  The other half. Called by the plugin's own editor as it scrolls, with the
   *  offset of the first character on screen. Most of a scroll is inside the page
   *  that is already up and means nothing at all, which is what `holds` is for.
   *
   *  Ignored while the phone is being scrolled *because* of a page turn, or the two
   *  would chase each other round the note. */
  scrolled(offset: number): void {
    if (performance.now() < this.steerUntil || !this.panel) return
    if (this.shell?.screen.kind !== 'note') return
    if (this.session.holds(offset)) return

    this.session.goToOffset(offset)
    this.showing = this.session.showing
      ? {
          from: this.session.showing.from,
          to: this.session.showing.to,
          page: this.session.showing.page,
          count: this.session.showing.count,
        }
      : null
    this.draw()
  }

  /** Draws, once, and again if something changed while it was drawing.
   *
   *  A band costs about 83 ms over the radio, so five flicks of the ring used to
   *  start five sends that queued behind each other: the reader asked to be on page
   *  six and watched pages two to five go by. The target moves; the draw catches up.
   *  Concurrent sends are also the documented way to wedge the host's channel. */
  private draw(): void {
    this.wanted = true
    if (this.drawing) return

    this.drawing = this.pump()
    void this.drawing.finally(() => {
      this.drawing = null
      if (this.wanted) this.draw()
    })
  }

  private async pump(): Promise<void> {
    const panel = this.panel
    const shell = this.shell
    if (!panel || !shell) return

    while (this.wanted) {
      this.wanted = false
      try {
        await panel.show(shell.view())
        if (shell.screen.kind === 'note') this.session.drew()
        this.health = 'live'
      } catch (error) {
        // The plugin is an editor first. A page that did not reach the glasses
        // says so here and nowhere else.
        this.health = 'stalled'
        console.warn('nib for g2:', why(error))
        return
      }
    }
  }

  /** A word in the foot of the panel for a moment: a command heard, or a reason. */
  private flash(said: string): void {
    this.shell?.flash(said)
    this.draw()
    clearTimeout(this.flashing)
    this.flashing = setTimeout(() => {
      this.shell?.clearFlash()
      this.draw()
    }, FLASH)
  }

  /** The microphone, on or off. Kept on the account, so it is on next launch. */
  private async listen(on: boolean): Promise<void> {
    const voice = this.voice
    if (!voice) return

    if (on) {
      const opened = await voice.start()
      this.listening = opened
    } else {
      await voice.stop()
      this.listening = false
    }

    modes.setGlassesVoice(this.listening)
    this.draw()
  }

  /** One utterance, as words. Only reached where the WebView has no recogniser. */
  private async transcribe(wav: Uint8Array<ArrayBuffer>): Promise<string | null> {
    for (const model of TRANSCRIBERS) {
      const said = await transcribeWith(wav, modes.glassesKey, model)
      if (said !== null) return said
    }

    return null
  }

  /** Something was said. What it means, and how long it took to mean it.
   *
   *  `ended` is when the reader stopped talking, which is the only honest place to
   *  measure a command's latency from; see voice.ts. */
  private heard(said: string, ended: number): void {
    const command = commandIn(said)
    if (!command) return

    this.flash(said.slice(0, 40))
    this.obey(command)
    // The plugin's own share of the latency, from the end of the speech to the
    // panel being asked to change. What the recogniser took before that is the
    // recogniser's, and is not ours to measure.
    this.latency = performance.now() - ended
  }

  private obey(command: Command): void {
    const shell = this.shell
    if (!shell) return

    switch (command.kind) {
      case 'next':
        this.act(shell.handle('down'))
        return

      case 'back':
        // One page back, or out of whatever is open: the same word for the same
        // idea, which is what the gesture does too.
        this.act(shell.open ? shell.back() : shell.handle('up'))
        return

      case 'close':
        this.act(shell.close())
        return

      case 'spaces':
        this.act(shell.show('spaces'))
        return

      case 'notes':
        this.act(shell.show('tree'))
        return

      case 'switchSpace': {
        const spaces = workspace.spaces
        const name = bestOf(
          command.name,
          spaces.map((one) => one.name),
        )
        const found = spaces.find((one) => one.name === name)
        if (!found) {
          // The picker rather than nothing: they asked to change space, and the
          // name did not land.
          this.act(shell.show('spaces'))
          return
        }

        void workspace.showSpace(found.id)
        this.act(shell.close())
        return
      }

      case 'switchNote': {
        const notes = workspace.notes
        const name = bestOf(
          command.name,
          notes.map((one) => one.name.replace(/\.md$/i, '')),
        )
        const found = notes.find((one) => one.name.replace(/\.md$/i, '') === name)
        if (!found) {
          this.act(shell.show('tree'))
          return
        }

        void workspace.openEntry(found.path)
        this.act(shell.close())
        return
      }

      case 'page':
        this.act(shell.goToPage(command.number))
        return

      case 'line':
        this.act(shell.goToLine(command.number))
        return

      case 'voice':
        void this.listen(command.on)
        return

      case 'question':
        void this.ask(command.asked)
        return
    }
  }

  /** A question, asked of the model and answered on the glasses. */
  private async ask(question: string): Promise<void> {
    const shell = this.shell
    if (!shell) return

    this.asked = question
    this.answer = ''
    this.act(shell.asking(question))

    try {
      const answer = await askAbout(question, {
        key: modes.glassesKey,
        model: modes.glassesModel,
        effort: modes.glassesEffort,
        notes: {
          search: (query) => this.searchNotes(query),
          read: (name) => this.readNote(name),
        },
      })
      this.answer = answer
      this.act(shell.answered(question, answer))
    } catch (error) {
      this.answer = ''
      this.act(shell.answered(question, why(error)))
    }
  }

  /** Every note in the account whose words match, across every space.
   *
   *  Every space, because a question is about what the person knows rather than
   *  about which folder they happen to have open. The app's own search does one
   *  space at a time, so this asks each of them. */
  private async searchNotes(query: string): Promise<Found[]> {
    const parsed = parseQuery(query)
    const terms = fuzzyTerms(parsed)
    const out: Found[] = []

    for (const space of workspace.spaces) {
      if (out.length >= HITS) break

      await searchSpace(space.root, parsed, terms, HITS, ({ hits }) => {
        for (const hit of hits) {
          out.push({ note: hit.name.replace(/\.md$/i, ''), line: hit.line, text: hit.text })
        }
      })
    }

    return out.slice(0, HITS)
  }

  /** One note by name, out of any space the account has. */
  private async readNote(name: string): Promise<string | null> {
    const wanted = name.replace(/\.md$/i, '').toLowerCase()
    const found = workspace.notes.find(
      (one) => one.name.replace(/\.md$/i, '').toLowerCase() === wanted,
    )
    if (!found) return null

    return workspace.noteText(found.path)
  }

  /** The page the glasses are on, for the frame the plugin draws. Null when there
   *  is nothing on them. */
  get page(): Page | null {
    return this.session.page
  }
}

export const bridge = new Bridge()
