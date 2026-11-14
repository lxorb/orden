import { untrack } from 'svelte'
import { BODY_INNER, BODY_ROWS, GUTTER, type Page, type Paging } from '@orden/glasses'
import { account } from '../account.svelte'
import { api } from '../api'
import { bestOf, type Command, commandIn, commandWords, settled } from './commands'
import type { Field } from '../preferences'
import { fileMark } from '../file-mark'
import { modes } from '../modes.svelte'
import { shownName } from '../note-name'
import { quietFor, waitFor } from './pace'
import { Panel } from './screen'
import { connectGlasses, type Glasses, type Input } from './sdk'
import { type OpenNote, Session } from './session'
import { glassesSettings, glassesStamp, resetGlasses } from './settings'
import { type Row, type Settings, Shell, type Wish, type Words, type World } from './shell'
import { spokenTask, Today } from './today'
import { type Listening, Voice } from './voice'
import { rooms } from '../collab/src/api'
import { type Entry, workspace } from '../workspace.svelte'

const SETTLE = 700

const SHARED = 80

const FLASH = 1400

const STEERING = 500

type Folds = ((path: string) => boolean) | null

function saying(field: Field): string {
  if (field.kind === 'switch') return field.get() ? 'On' : 'Off'
  if (field.kind === 'slider') return `${String(field.get())}${field.unit ?? ''}`
  if (field.kind === 'text') return field.get() || field.placeholder
  if (field.kind === 'value') return field.get()
  if (field.kind === 'picture') return ''

  const value = field.get()
  return field.options.find((one) => one.value === value)?.label ?? value
}

function why(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type Health = 'alone' | 'reaching' | 'live' | 'stalled' | 'failed'

function rowsOf(entry: Entry | null, folds: Folds, depth = 0): Row[] {
  if (!entry) return []

  const out: Row[] = []
  for (const child of entry.children) {
    if (workspace.archive.has(child.path) || workspace.instructionsAt(child.path)) continue

    if (child.is_dir) {
      const open = folds === null || folds(child.path)
      out.push({
        label: child.name,
        depth,
        folder: true,
        open,
        pick: folds !== null,
        id: child.path,
      })
      if (open) out.push(...rowsOf(child, folds, depth + 1))
      continue
    }

    if (fileMark(child.name) !== 'note') continue

    out.push({
      label: shownName(child.name),
      depth,
      folder: false,
      open: false,
      pick: true,
      id: child.path,
    })
  }

  return out
}

class Bridge {
  showing = $state<{ from: number; to: number; page: number; count: number } | null>(null)
  health = $state<Health>('reaching')
  latency = $state(0)
  asked = $state('')
  answer = $state('')
  listening = $state(false)
  voiceState = $state<Listening>({
    on: false,
    path: 'none',
    frames: 0,
    heard: '',
    nothing: false,
    trouble: '',
    detail: '',
    took: null,
  })

  private glasses: Glasses | null = null
  private panel: Panel | null = null
  private shell: Shell | null = null
  private readonly todayList = new Today({
    load: async () => (await import('./today-tasks')).todayHere(),
    tick: async (at, space, done) => (await import('../task-actions')).tickTask(at, space, done),
    redraw: () => this.act('draw'),
  })
  private voice: Voice | null = null
  private readonly session = new Session()
  private timer: ReturnType<typeof setTimeout> | undefined
  private flashing: ReturnType<typeof setTimeout> | undefined
  private drawing: Promise<void> | null = null
  private wanted = false
  private steerUntil = 0
  private since: number | null = null
  private cost = 0

  startWhile(wanted: () => boolean): () => void {
    let stop: (() => void) | null = null
    const end = $effect.root(() => {
      $effect(() => {
        const on = wanted()
        untrack(() => {
          if (on && !stop) stop = this.start()
          if (!on && stop) {
            stop()
            stop = null
          }
        })
      })
    })
    return () => {
      end()
      stop?.()
    }
  }

  start(): () => void {
    let stop: (() => void) | undefined
    void this.connect().then(
      (teardown) => {
        stop = teardown
      },
      (error: unknown) => {
        this.health = 'failed'
        console.warn('Orden for g2:', why(error))
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
      this.health = 'alone'
      return undefined
    }

    this.glasses = glasses
    modes.sawGlasses()

    const panel = new Panel(glasses, modes.glassesLineNumbers)
    const made = await panel.open()
    if (made !== 'made') {
      this.health = 'failed'
      console.warn('Orden for g2: the page was not made:', made)
      return undefined
    }

    this.panel = panel
    this.shell = new Shell(this.world(), () => this.words(), this.session, this.settings())
    this.voice = new Voice({
      microphone: (open) => glasses.microphone(open),
      canTranscribe: () => !!account.accountToken,
      settled: (said) => settled(said, modes.glassesWords),
      warm: () => void api.warm(),
      transcribe: (wav) => this.transcribe(wav),
      heard: (heard) => this.heard(heard.said, heard.ended),
      failed: (said) => this.flash(said),
      said: (state) => {
        this.voiceState = state
      },
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

  private world(): World {
    return {
      space: () => workspace.activeSpace?.name ?? 'Notes',
      contents: () => rowsOf(workspace.tree, null),
      spaces: () =>
        workspace.shownSpaces.map((one) => ({
          label: one.name,
          depth: 0,
          folder: false,
          open: false,
          pick: true,
          id: one.id,
        })),
      tree: () => rowsOf(workspace.tree, (path) => workspace.isExpanded(path)),
      open: (id) => {
        if (fileMark(id.split(/[\\/]/).at(-1) ?? '') !== 'note') return
        void workspace.openEntry(id)
      },
      fold: (id) => workspace.toggleFolder(id),
      enter: (id) => void workspace.showSpace(id),
      listen: (on) => void this.listen(on),
      listening: () => this.listening,
      atSpace: () => workspace.activeSpace?.id ?? '',
      atNote: () => workspace.active?.path ?? '',
      today: () => this.todayList.rows(),
      freshToday: () => this.todayList.fresh(),
      tick: (id) => {
        this.todayList.tick(id)
      },
    }
  }

  private words(): Words {
    return {
      spaces: 'Spaces',
      notes: 'Notes',
      switchSpace: 'Switch space',
      changeNote: 'Change note',
      voiceOn: 'Voice on',
      voiceOff: 'Voice off',
      thinking: 'Thinking',
      nothingHere: 'Nothing here',
      noAnswer: 'No answer',
      settings: 'Settings',
      reset: 'Reset glasses settings',
      done: 'Done',
      today: 'Today',
    }
  }

  private settings(): Settings {
    const found = (id: string) => glassesSettings().find((one) => one.id === id)

    return {
      rows: () =>
        glassesSettings()
          .filter((one) => one.onGlasses)
          .map((one) => ({ id: one.id, label: one.field.label, value: saying(one.field) })),

      tap: (id) => {
        const field = found(id)?.field
        if (!field) return null

        if (field.kind === 'switch') {
          field.set(!field.get())
          return null
        }

        if (field.kind === 'select') return field.options

        if (field.kind === 'slider') {
          const next = field.get() + field.step
          field.set(next > field.max ? field.min : next)
        }

        return null
      },

      pick: (id, value) => {
        const field = found(id)?.field
        if (field?.kind === 'select') field.set(value)
      },

      reset: () => resetGlasses(),
    }
  }

  private paging(): Paging {
    return {
      breakAt: modes.glassesBreak,
      gutter: modes.glassesLineNumbers ? GUTTER : 0,
      inner: BODY_INNER,
      rows: BODY_ROWS,
      marks: modes.glassesMarks,
      compaction: modes.glassesCompaction,
    }
  }

  private readonly reading = $derived.by(() => {
    const tab = workspace.active
    const note = tab?.kind === 'note' ? tab.note : null
    if (!note) return null

    return {
      note,
      revision: note.revision,
      shared: (rooms.present[note.key] ?? 0) > 0,
    }
  })

  private watch(): () => void {
    return $effect.root(() => {
      $effect(() => {
        const reading = this.reading
        if (!reading) return

        const { note } = reading
        clearTimeout(this.timer)

        const switching = this.session.showing?.key !== note.key
        const now = performance.now()
        this.since = switching ? now : (this.since ?? now)
        const quiet = switching ? 0 : quietFor(reading.shared ? SHARED : SETTLE, this.cost)

        this.timer = setTimeout(
          () => {
            this.since = null
            note.flush()
            const name = shownName(note.name)
            const started = performance.now()
            this.follow({ key: note.key, name, text: note.text })
            this.cost = performance.now() - started
          },
          waitFor(quiet, this.since, now),
        )
      })

      $effect(() => {
        const numbered = modes.glassesLineNumbers
        const panel = this.panel
        if (!panel) return

        void panel.renumber(numbered).then(() => {
          this.again()
        })
      })

      $effect(() => {
        const stamp = glassesStamp()
        if (!this.panel || !stamp) return

        this.again()
      })
    })
  }

  private again(): void {
    const reading = this.reading
    if (reading) {
      const name = shownName(reading.note.name)
      this.session.follow({ key: reading.note.key, name, text: reading.note.text }, this.paging())
    }

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

    if (!this.session.moved && this.shell?.screen.kind === 'note') return

    this.draw()
  }

  private input(input: Input): void {
    if (input.kind === 'audio') {
      this.voice?.frame(input.pcm)
      return
    }

    if (input.kind === 'life') {
      if (input.life === 'foreground') {
        this.panel?.forget()
        this.draw()
      }
      return
    }

    this.act(this.shell?.handle(input.gesture) ?? 'none')
  }

  private act(wish: Wish): void {
    if (wish === 'leave') {
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
      this.steer()
      this.draw()
    }
  }

  private steer(): void {
    const showing = this.session.showing
    const path = workspace.active?.path
    if (!showing || !path || this.shell?.screen.kind !== 'note') return

    this.steerUntil = performance.now() + STEERING
    workspace.goto = { path, line: showing.firstLine }
  }

  get steering(): boolean {
    return performance.now() < this.steerUntil
  }

  regionAt(offset: number): { from: number; to: number; page: number; count: number } | null {
    const where = this.session.regionAt(offset)
    if (!where) return null

    return { from: where.from, to: where.to, page: where.page, count: where.count }
  }

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
        this.health = 'stalled'
        console.warn('Orden for g2:', why(error))
        return
      }
    }
  }

  private flash(said: string): void {
    this.shell?.flash(said)
    this.draw()
    clearTimeout(this.flashing)
    this.flashing = setTimeout(() => {
      this.shell?.clearFlash()
      this.draw()
    }, FLASH)
  }

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

  private async transcribe(wav: Uint8Array<ArrayBuffer>): Promise<string | null> {
    const token = account.accountToken
    if (!token) throw new Error('sign in first')

    return (await api.askHeard(token, wav, this.vocabulary())).said
  }

  private vocabulary(): string {
    return commandWords()
      .map((one) => modes.glassesWords[one.id] ?? one.said)
      .join(', ')
  }

  private heard(said: string, ended: number): void {
    const command = commandIn(said, modes.glassesWords)
    if (!command) return

    this.flash(said.slice(0, 40))
    this.obey(command, said)
    this.latency = performance.now() - ended
  }

  private obey(command: Command, said = ''): void {
    const shell = this.shell
    if (!shell) return

    switch (command.kind) {
      case 'next':
        this.act(shell.handle('down'))
        return

      case 'back':
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
        const spaces = workspace.shownSpaces
        const name = bestOf(
          command.name,
          spaces.map((one) => one.name),
        )
        const found = spaces.find((one) => one.name === name)
        if (!found) {
          this.act(shell.show('spaces'))
          return
        }

        void workspace.showSpace(found.id)
        this.act(shell.close())
        return
      }

      case 'switchNote': {
        const notes = workspace.notes.filter((one) => !workspace.archive.has(one.path))
        const name = bestOf(
          command.name,
          notes.map((one) => shownName(one.name)),
        )
        const found = notes.find((one) => shownName(one.name) === name)
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

      case 'task':
        void this.addSpoken(spokenTask(said) || command.said)
        return
    }
  }

  private async addSpoken(words: string): Promise<void> {
    const { addTask } = await import('../task-actions')
    const added = await addTask(words).catch(() => null)
    if (added) this.flash('Done')
  }

  private async ask(question: string): Promise<void> {
    const shell = this.shell
    if (!shell) return

    this.asked = question
    this.answer = ''
    this.act(shell.asking(question))

    const token = account.accountToken
    if (!token) {
      this.act(shell.answered(question, 'Sign in to ask a question.'))
      return
    }

    try {
      const { answer } = await api.ask(token, question, modes.glassesModel, modes.glassesEffort)
      this.answer = answer
      this.act(shell.answered(question, answer))
    } catch (error) {
      this.answer = ''
      this.act(shell.answered(question, why(error)))
    }
  }

  get page(): Page | null {
    return this.session.page
  }
}

export const bridge = new Bridge()
