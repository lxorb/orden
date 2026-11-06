import type { Usage } from '@orden/online/apps'
import { FitAddon } from '@xterm/addon-fit'
import { type ISearchOptions, SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { type ITheme, Terminal } from '@xterm/xterm'
import { chrome } from '../glass/chrome.svelte'
import '@xterm/xterm/css/xterm.css'
import { untrack } from 'svelte'
import { copyText } from '../clipboard'
import { dragged, isExplorerDrag, isFileDrop, isTreeDrag, outsideRows } from '../drag-paths'
import { i18n, key, plural, t } from '../i18n.svelte'
import { identifier } from '../identifier'
import { notify } from '../notify'
import { showCombination } from '../keys'
import { DIVIDER, menu, type MenuEntry } from '../menu.svelte'
import { tabAsk } from '../new-tab'
import { owes } from '../parting'
import { SHORTCUTS, shortcuts } from '../shortcuts.svelte'
import { remote } from '../remote/hosts.svelte'
import { madeNow, markMade } from '../remote/open'
import { platform } from '../tauri'
import { isMadeName, isOnlineTab, termName } from '../online/path'
import { Arrival, type Status } from '../online/arrival.svelte'
import { LocalEcho } from '../online/echo-view'
import { marks } from '../online/marks.svelte'
import { resumeCommand } from '../online/resume'
import { type Tab, workspace } from '../workspace.svelte'
import {
  dropHistory,
  fitted,
  type History,
  historyOf,
  keepHistory,
  moveLegacy,
  type Place,
  restoredAbove,
  restoredLine,
} from './history'
import type { Picture } from './images'
import { imageKey, imageKeyTyped, type Route, routeKey, typedBy } from './keys'
import { findColours, monospace, terminalContrast, terminalGround, terminalTheme } from './look'
import { type Left, pastesItself, promptEnd, reporting, tidied } from './modes'
import { Front, terminalName } from './naming'
import { AddressLinks, chosenText } from './links'
import { asksFirst, imageIn, imageKindAt, imageKindOf, linesIn, pasted, spokenPath } from './paste'
import { setLive, setPty } from './running'
import { clipboardWrite, type Notice, osc777Notice, osc9Notice } from './signals'
import { shellName, shells, SIZES } from './shells.svelte'
import { type Machine, PtySource, type Said, type Source } from './source'
import { hostIdOf, readSpec, reportedFolder, type Spec, writeSpec } from './spec'

const SCROLLBACK = 5000

const QUIET = 2000

const FLOOD = 10_000

const RESTING = 300

const KERNEL_SAYS = ['linux', 'macos']

const AFTER_ENTER = 500

const ASK_AFTER = 300

const ASK_EVERY = 1000

const NOTICE_EVERY = 4000

const OFFERED_FOR = 60_000

const RELINK_GRACE = 5000

function windowsPty(): { backend: 'conpty'; buildNumber: number } | undefined {
  if (platform() !== 'windows') return undefined

  const os = (window as { __TAURI_OS_PLUGIN_INTERNALS__?: { version?: string } })
    .__TAURI_OS_PLUGIN_INTERNALS__
  const build = Number(os?.version?.split('.')[2])
  return { backend: 'conpty', buildNumber: Number.isFinite(build) ? build : 22000 }
}

function commandOf(event: KeyboardEvent): string | null {
  const chord = event.ctrlKey || event.metaKey || event.altKey || /^F\d+$/.test(event.key)
  if (!chord) return null

  const found = SHORTCUTS.find(
    (entry) => entry.scope === 'app' && entry.run && shortcuts.pressed(entry.id, event),
  )
  return found?.id ?? null
}

async function typeReady(): Promise<void> {
  await Promise.race([
    document.fonts.load(`${shells.size}px ${monospace()}`).catch(() => undefined),
    new Promise((settle) => setTimeout(settle, 1000)),
  ])
}

class Session {
  readonly host = document.createElement('div')
  readonly term: Terminal
  private readonly fitting = new FitAddon()
  private readonly searching = new SearchAddon()
  private readonly serializing = new SerializeAddon()

  private pty: string | null = null
  private source: Source | null = null
  readonly online: boolean
  private onlineKey = ''
  private screened = false
  private readonly notes: string[] = []
  private mayType = true
  private applying = false
  private relinking = false
  private relinkSlow: ReturnType<typeof setTimeout> | undefined

  live = $state(true)
  machine = $state<Machine | null>(null)
  readonly arrival = new Arrival()
  resumable = $state<string | null>(null)
  private readonly echo: LocalEcho | null
  offered = $state<string | null>(null)
  private offerGoes: ReturnType<typeof setTimeout> | undefined
  private lastNotice = -Infinity
  private started = 0
  private opened = false
  private exited: number | null = null
  private fellBack = false
  private outgoing: { data: string; binary: boolean }[] = []
  private sending = false
  private spawning: Promise<unknown> = Promise.resolve()
  private resting: ReturnType<typeof setTimeout> | undefined
  private changed = false
  private since = 0
  private drawn = false
  private coming: Promise<History | null> | null = null
  private replaying = false
  private behind: [Uint8Array, () => void][] | null = null
  private marks = false
  private waitingIdle: ReturnType<typeof setTimeout> | undefined
  private front = new Front(false)
  private asking: ReturnType<typeof setTimeout> | undefined
  private asked = 0
  private readonly unwatch: () => void
  private readonly watching = new ResizeObserver(() => requestAnimationFrame(() => this.fit()))

  offline = $state(false)

  get status(): Status | null {
    return this.online && !this.live && !this.offline ? this.arrival.status : null
  }

  finding = $state(false)
  query = $state('')
  found = $state({ count: 0, at: -1 })

  constructor(readonly tab: Tab) {
    this.online = isOnlineTab(tab)
    this.live = !this.online
    this.host.className = 'nib-terminal'
    const conpty = windowsPty()
    this.term = new Terminal({
      allowProposedApi: true,
      scrollback: SCROLLBACK,
      fontFamily: monospace(),
      fontSize: shells.size,
      lineHeight: 1.15,
      cursorStyle: 'bar',
      cursorWidth: 2,
      cursorInactiveStyle: 'outline',
      minimumContrastRatio: terminalContrast(),
      rightClickSelectsWord: false,
      theme: laid(terminalTheme(document.documentElement, !shells.themed)),
      linkHandler: {
        activate: () => undefined,
        hover: (_event, uri) => (this.pointed = uri),
        leave: () => (this.pointed = null),
      },
      ...(conpty ? { windowsPty: conpty } : {}),
    })

    this.echo = this.online
      ? new LocalEcho(
          this.term,
          () =>
            this.live &&
            this.mayType &&
            this.front.program === null &&
            this.exited === null &&
            this.resumable === null,
        )
      : null

    this.term.loadAddon(this.fitting)
    this.term.loadAddon(this.searching)
    this.term.loadAddon(this.serializing)
    this.term.loadAddon(new Unicode11Addon())
    this.term.unicode.activeVersion = '11'
    this.term.registerLinkProvider(new AddressLinks(this.term, (uri) => (this.pointed = uri)))

    this.term.onData((data) => this.typed(data, false))
    this.term.onBinary((data) => this.typed(data, true))
    this.term.onResize(({ cols, rows }) => this.sized(cols, rows))
    this.term.attachCustomKeyEventHandler((event) => this.pressed(event))
    this.term.parser.registerOscHandler(7, (data) => this.reported(7, data))
    this.term.parser.registerOscHandler(9, (data) =>
      data.startsWith('9;') ? this.reported(9, data) : this.noticed(osc9Notice(data)),
    )
    this.term.parser.registerOscHandler(777, (data) => this.noticed(osc777Notice(data)))
    this.term.parser.registerOscHandler(52, (data) => this.clipboard(data))
    this.term.onBell(() => this.noticed({ title: null, body: '' }))
    this.term.onTitleChange((title) => this.titled(title))
    this.searching.onDidChangeResults(({ resultIndex, resultCount }) => {
      this.found = { count: resultCount, at: resultIndex }
    })

    this.host.addEventListener('paste', (event) => this.pasting(event), true)
    this.host.addEventListener('mouseup', () => this.copyChosen())
    this.host.addEventListener('dragover', (event) => {
      if (!takesDrop(event.dataTransfer)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    })
    this.host.addEventListener('drop', (event) => this.dropped(event))
    this.host.addEventListener(
      'mousedown',
      (event) => {
        if (event.button === 2) event.stopPropagation()
      },
      true,
    )
    this.host.addEventListener('mousedown', (event) => this.pressLink(event), true)
    this.host.addEventListener('mouseup', (event) => this.releaseLink(event), true)
    for (const name of ['click', 'auxclick'] as const) {
      this.host.addEventListener(name, (event) => this.spentLink(event), true)
    }
    this.host.addEventListener(
      'contextmenu',
      (event) => {
        event.stopPropagation()
        this.showMenu(event)
      },
      true,
    )
    this.watching.observe(this.host)

    this.unwatch = $effect.root(() => {
      $effect(() => {
        const on = this.online && this.live
        untrack(() => setLive(this.tab.id, on))
      })
      $effect(() => {
        const spec = this.spec()
        const shell = this.tab.name
        const host = hostIdOf(spec.shell)
        if (host !== null) remote.byId(host)
        untrack(() => this.named(spec, shell))
      })
    })
  }

  private named(spec = this.spec(), shell = this.tab.name) {
    if (this.online) {
      const file = termName(shell)
      const name = isMadeName(file)
        ? terminalName({
            given: null,
            title: this.front.title,
            program: this.front.program,
            shell: file,
            folder: null,
          })
        : file
      this.running(name, this.front.program, null, null)
      marks.set(this.tab.id, this.machine)
      return
    }

    const host = hostIdOf(spec.shell)
    if (host !== null) {
      const about = remote.byId(host)
      this.running(spec.name ? null : (about?.name ?? shell), null, host, about?.colour ?? null)
      return
    }

    const program = this.front.program
    const name = spec.name
      ? null
      : terminalName({
          given: null,
          title: this.front.title,
          program,
          shell,
          folder: spec.folder,
        })
    this.running(name, program, null, null)
  }

  private running(
    name: string | null,
    program: string | null,
    host: string | null,
    colour: string | null,
  ) {
    const now = this.tab.running
    const same =
      now?.name === name && now.program === program && now.host === host && now.colour === colour
    if (!same) this.tab.running = { name, program, host, colour }
  }

  private get remote(): boolean {
    return this.online || hostIdOf(this.spec().shell) !== null
  }

  private titled(title: string) {
    if (this.online) return
    if (this.front.titled(title)) this.askSoon()
    this.named()
  }

  private askSoon(after = ASK_AFTER) {
    if (this.asking !== undefined || this.spec().shell.startsWith('wsl:') || this.remote) return

    const wait = Math.max(after, this.asked + ASK_EVERY - Date.now())
    this.asking = setTimeout(() => {
      this.asking = undefined
      void this.askFront()
    }, wait)
  }

  private async askFront() {
    const pty = this.pty
    const source = this.source
    if (pty === null || !(source instanceof PtySource)) return

    this.asked = Date.now()
    const found = await source.program()
    if (pty !== this.pty || found === undefined) return

    this.front.looked(found)
    this.named()
  }

  private spec(): Spec {
    return (
      readSpec(this.tab.doc) ?? {
        shell: shells.chosen?.id ?? '',
        folder: null,
        key: '',
        name: null,
      }
    )
  }

  private respec(spec: Spec) {
    this.tab.note.replace(writeSpec(spec), false)
    workspace.scheduleSession()
  }

  private place(): Place {
    return this.online ? { space: null, key: this.onlineKey } : placeOf(this.tab)
  }

  async attach(place: HTMLElement, focus: boolean): Promise<void> {
    place.append(this.host)

    if (!this.opened) {
      this.opened = true
      this.coming ??= this.lastScreen()
      const [history] = await Promise.all([this.coming, typeReady()])
      if (!this.host.isConnected) {
        this.opened = false
        return
      }

      this.coming = null
      this.term.open(this.host)
      this.drawn = true
      this.replay(history)
    } else {
      this.fit()
    }

    if (focus) this.focus()
  }

  private async lastScreen(): Promise<History | null> {
    if (this.online) {
      const { cacheKey } = await import('../online/source')
      this.onlineKey = await cacheKey(this.tab.doc, this.tab.path)
      return this.onlineKey && shells.restoring ? historyOf(this.place()) : null
    }

    const spec = this.spec()
    const twin = [...sessions.values()].some(
      (other) => other !== this && other.opened && other.spec().key === spec.key,
    )
    if (twin || !spec.key) {
      const key = identifier()
      if (this.remote) markMade(key)
      this.respec({ ...spec, key })
      return null
    }

    return shells.restoring ? historyOf(this.place()) : null
  }

  private replay(history: History | null) {
    const fitted = () => {
      this.replaying = false
      this.fit()
    }
    if (!history) {
      fitted()
      this.begin()
      return
    }

    this.replaying = true
    const { cols, rows } = history
    if (cols >= 2 && cols <= 1000 && rows >= 1 && rows <= 500) this.term.resize(cols, rows)

    if (this.online) {
      this.term.write(history.text, () => {
        fitted()
        this.begin()
      })
      return
    }

    const when = i18n.when(history.at, { dateStyle: 'medium', timeStyle: 'short' })
    const words = t('Restored {time}', { time: when })

    this.term.write(history.text, () => {
      const off = tidied(this.left(), false)
      fitted()
      const under =
        platform() === 'windows' ? restoredAbove(words, this.term.rows) : restoredLine(words)
      this.term.write(off + under, () => this.begin())
    })
  }

  private begin() {
    if (this.online) void this.start()
    else if (this.remote && !madeNow(this.spec().key)) this.wait()
    else void this.start()
  }

  private wait() {
    this.exited = -1
    this.offline = true
  }

  reconnect() {
    if (this.online) {
      if (!this.drawn) return
      this.source?.end()
      this.source = null
      void this.start()
      this.focus()
      return
    }
    if (this.pty !== null || !this.drawn) return
    const host = hostIdOf(this.spec().shell)
    if (host !== null) remote.connected(host)

    this.term.write(`${tidied(this.left(), false)}\r\n`)
    void this.start()
    this.focus()
  }

  async usage(): Promise<Usage | null> {
    return (await this.source?.usage?.()) ?? null
  }

  retry() {
    if (this.arrival.holder !== null) {
      this.source?.take?.()
      return
    }
    if (!this.arrival.gone) {
      this.reconnect()
      return
    }
    workspace.activeTabId = this.tab.id
    void import('../online/open').then(async ({ openOnline }) => {
      if (await openOnline(true)) workspace.close(this.tab.id, false)
    })
  }

  private left(): Left {
    return { modes: this.term.modes, alternate: this.term.buffer.active.type === 'alternate' }
  }

  agentBlocked(): { why: string; lasting: boolean } | null {
    if (!this.online) {
      return this.pty === null ? { why: 'its shell is not running', lasting: false } : null
    }
    const holder = this.arrival.holder
    if (holder !== null) {
      const by = holder.by || 'another device'
      return {
        why: `${by} holds this session: the reader takes it back with Take over`,
        lasting: true,
      }
    }
    if (this.arrival.failure !== null) return { why: this.arrival.failure, lasting: true }
    if (this.offline || !this.live || this.relinking) {
      return { why: 'it is not connected to its machine', lasting: false }
    }
    if (this.exited !== null) return { why: 'its shell ended', lasting: false }
    if (!this.mayType) {
      return { why: "its machine's owner keeps typing in it to themselves", lasting: true }
    }
    return null
  }

  get current(): boolean {
    return this.online ? this.live : this.pty !== null
  }

  get agentHeld(): boolean {
    return this.arrival.holder !== null
  }

  get ended(): boolean {
    return this.exited !== null && !this.offline
  }

  agentTyped(data: string): string | null {
    const blocked = this.agentBlocked()
    if (blocked !== null) return blocked.why
    if (!this.online) {
      this.typed(data, false)
      return null
    }
    this.resumable = null
    this.echo?.typed(data)
    this.outgoing.push({ data, binary: false })
    void this.send()
    return null
  }

  startAgain(): void {
    if (this.exited === null || this.offline) return
    if (this.online) {
      this.exited = null
      this.term.write('\r\n')
      this.source?.again?.()
      return
    }
    this.typed('\r', false)
  }

  detach() {
    this.remember()
    this.host.remove()
  }

  focus() {
    if (this.drawn) this.term.focus()
  }

  fit() {
    if (!this.drawn || this.replaying || !this.host.isConnected) return
    this.fitting.fit()
  }

  size(pixels: number) {
    this.term.options.fontSize = pixels
    this.fit()
  }

  repaint(theme: ITheme, family: string, contrast: number) {
    this.term.options.theme = theme
    if (this.term.options.minimumContrastRatio !== contrast) {
      this.term.options.minimumContrastRatio = contrast
    }
    if (this.term.options.fontFamily !== family) {
      this.term.options.fontFamily = family
      this.fit()
    }
  }

  end() {
    clearTimeout(this.relinkSlow)
    clearTimeout(this.resting)
    clearTimeout(this.waitingIdle)
    clearTimeout(this.asking)
    clearTimeout(this.offerGoes)
    this.unwatch()
    const place = this.place()
    if (this.online) {
      this.remember()
    } else if (this.drawn || !shells.restoring) {
      dropHistory(place, shells.restoring ? this.snapshot() : null)
    } else {
      void (this.coming ?? historyOf(place)).then((last) => dropHistory(place, last))
    }

    this.source?.end()
    this.source = null
    this.pty = null
    this.arrival.stop()
    setPty(this.tab.id, null)
    setLive(this.tab.id, false)
    marks.delete(this.tab.id)
    clearTimeout(this.resting)
    this.watching.disconnect()
    this.echo?.dispose()
    this.term.dispose()
    this.host.remove()
  }

  remember() {
    clearTimeout(this.resting)
    this.resting = undefined
    if (!this.changed || !shells.restoring) return

    const history = this.snapshot()
    if (!history) return
    this.changed = false
    this.since = 0
    keepHistory(this.place(), history)
  }

  private snapshot(): History | null {
    if (!this.drawn) return null
    const text = fitted((lines) =>
      this.serializing.serialize({ scrollback: lines, excludeModes: true, excludeAltBuffer: true }),
    )
    return text ? { cols: this.term.cols, rows: this.term.rows, at: Date.now(), text } : null
  }

  private printed() {
    this.changed = true
    const now = Date.now()
    this.since ||= now
    clearTimeout(this.resting)
    this.resting = setTimeout(() => this.remember(), Math.min(QUIET, this.since + FLOOD - now))
  }

  private async start(): Promise<void> {
    const spec = this.spec()
    this.started += 1
    const id = `${this.tab.id}-${this.started}`
    this.pty = id
    this.exited = null
    this.offline = false
    if (this.online) this.arrival.begin()
    if (!this.online) setPty(this.tab.id, id)
    this.front = new Front(spec.shell.startsWith('wsl:'))
    this.named()

    const source = this.online
      ? (await import('../online/source')).onlineSource(
          () => this.tab.path,
          () => this.tab.doc,
          {
            tab: () => this.tab.id,
            front: () => this.inFront && workspace.activeTabId === this.tab.id,
            offer: (url) => this.offer(url),
          },
        )
      : new PtySource(id, spec.shell, spec.folder, this.remote)
    if (this.pty !== id) {
      source.end()
      return
    }
    this.source = source

    const { cols, rows } = this.term
    this.spawning = source.start(cols, rows, (what) => this.heard(id, what))

    try {
      await this.spawning
    } catch {
      if (this.pty === id) await this.failed(spec)
      return
    }

    if (this.term.cols !== cols || this.term.rows !== rows)
      this.sized(this.term.cols, this.term.rows)
  }

  private async failed(spec: Spec) {
    this.pty = null
    this.source = null
    setPty(this.tab.id, null)

    if (this.remote) {
      this.say(t('Could not connect to {host}', { host: this.tab.shown }))
      this.wait()
      return
    }

    await shells.ask()
    const instead = shells.chosen
    if (!this.fellBack && instead && instead.id !== spec.shell) {
      this.fellBack = true
      this.respec({ ...spec, shell: instead.id })
      if (!spec.name) this.tab.name = shellName(instead)
      void this.start()
      return
    }

    this.exited = -1
    this.say(t('Could not start {shell}', { shell: this.tab.shown }))
  }

  private heard(id: string, what: Said) {
    if (id !== this.pty) return
    if (this.online) this.arrival.heard()

    if ('out' in what) {
      const bytes = what.out
      if (this.online && !this.live) this.landed()
      this.through(bytes, () => this.source?.seen(bytes.length))
      this.printed()
      clearTimeout(this.waitingIdle)
      this.waitingIdle = setTimeout(() => void this.idle(), RESTING)
    } else if ('exit' in what) this.exitedWith(what.exit ?? -1)
    else if ('screen' in what) this.screen(what)
    else if ('size' in what) this.applied(what.size.cols, what.size.rows)
    else if ('program' in what) {
      this.front.told(what.program, what.title)
      this.named()
    } else if ('machine' in what) {
      this.machine = what.machine
      if (this.online) {
        if (what.machine === 'starting' && this.live) this.linkDown(true)
        else {
          if (what.machine !== 'starting') this.linkUp()
          this.arrival.machine(what.machine, what.reason)
        }
      }
      this.named()
    } else if ('link' in what) {
      if (what.link) this.linkUp()
      else this.linkDown(false)
    } else if ('connected' in what) {
      this.arrival.linkedNow(what.connected)
      if (what.connected && this.screened) this.landed()
      else this.live = false
    } else if ('typing' in what) this.mayType = what.typing
    else if ('held' in what) {
      if (what.held) {
        this.live = false
        this.arrival.held(what.held)
      } else this.arrival.unheld()
    } else if ('note' in what) {
      if (this.live) this.say(what.note)
      else this.notes.push(what.note)
    } else if (this.online && (!this.live || what.gone === true)) {
      this.live = false
      this.arrival.fail(what.refused, what.gone === true)
    } else {
      this.say(what.refused)
      this.wait()
    }
  }

  private linkDown(starting: boolean) {
    this.relinking = true
    if (!this.live) {
      if (starting) this.arrival.machine('starting')
      else this.arrival.relink(true)
      return
    }
    clearTimeout(this.relinkSlow)
    this.relinkSlow = setTimeout(() => {
      if (!this.relinking || !this.live) return
      this.live = false
      this.arrival.lost()
      if (starting) this.arrival.machine('starting')
      else this.arrival.relink(true)
    }, RELINK_GRACE)
  }

  private linkUp() {
    clearTimeout(this.relinkSlow)
    this.arrival.relink(false)
    if (!this.relinking) return
    this.relinking = false
    void this.send()
  }

  private landed() {
    this.linkUp()
    this.screened = true
    this.live = true
    this.arrival.arrived()
    for (const note of this.notes.splice(0)) this.say(note)
  }

  private screen(screen: Extract<Said, { screen: string }>) {
    this.echo?.reset()
    this.term.reset()
    this.applied(screen.cols, screen.rows)
    this.term.write(screen.screen, () => {
      this.landed()
      this.printed()
      this.fit()
      if (screen.restored) this.resumable = resumeCommand(screen.restored.program)
    })
  }

  private applied(cols: number, rows: number) {
    if (cols === this.term.cols && rows === this.term.rows) return
    this.applying = true
    try {
      this.term.resize(cols, rows)
    } finally {
      this.applying = false
    }
  }

  resume() {
    const command = this.resumable
    this.resumable = null
    if (command === null) return
    this.outgoing.push({ data: `${command}\r`, binary: false })
    void this.send()
    this.focus()
  }

  private through(bytes: Uint8Array, drawn: () => void) {
    if (this.behind) {
      this.behind.push([bytes, drawn])
      return
    }

    const end = promptEnd(bytes)
    if (end < 0) {
      this.term.write(bytes, drawn)
      return
    }

    this.marks = true
    this.front.prompted()
    this.named()
    this.behind = []
    this.term.write(bytes.subarray(0, end), () => {
      const off = tidied(this.left(), pastesItself(this.spec().shell))
      if (off) this.term.write(off)

      const waiting = this.behind ?? []
      this.behind = null
      const rest = bytes.subarray(end)
      if (rest.length) this.through(rest, drawn)
      else drawn()
      for (const [one, done] of waiting) this.through(one, done)
    })
  }

  private async idle() {
    if (this.front.worthLooking) this.askSoon(0)

    const pty = this.pty
    const source = this.source
    if (this.marks || pty === null || this.spec().shell.startsWith('wsl:') || this.remote) return
    if (!(source instanceof PtySource) || !reporting(this.left())) return

    const busy = await source.busy()
    if (busy || pty !== this.pty || !reporting(this.left())) return
    this.term.write(tidied(this.left(), true, false))
  }

  private exitedWith(code: number) {
    if (this.online) {
      this.front = new Front(false)
      this.named()
      this.exited = code
      this.say(t('Exited with code {code}', { code }))
      return
    }

    this.pty = null
    setPty(this.tab.id, null)
    this.front = new Front(false)
    this.named()

    if (code === 0 && workspace.tabs.some((one) => one.id === this.tab.id)) {
      workspace.close(this.tab.id)
      return
    }

    if (this.remote) {
      this.wait()
      return
    }

    this.exited = code
    this.say(t('Exited with code {code}', { code }))
  }

  private say(words: string) {
    this.term.write(`\r\n\x1b[2m${words}\x1b[22m\r\n`)
  }

  private typed(data: string, binary: boolean) {
    if (this.online) {
      this.typedOnline(data, binary)
      return
    }
    if (this.pty === null) {
      if (this.offline && data === '\r') this.reconnect()
      else if (this.exited !== null && data === '\r') {
        this.term.write('\r\n')
        void this.start()
      }
      return
    }

    this.outgoing.push({ data, binary })
    void this.send()

    if (binary || !data.includes('\r') || this.remote) return
    this.front.entered()
    this.askSoon()
    if (KERNEL_SAYS.includes(platform())) setTimeout(() => void this.lookWhere(), AFTER_ENTER)
  }

  private typedOnline(data: string, binary: boolean) {
    if (this.offline || this.arrival.failure !== null || this.arrival.holder !== null) {
      if (data === '\r') this.retry()
      return
    }
    if (this.resumable !== null && data === '\r') {
      this.resume()
      return
    }
    this.resumable = null
    if (this.exited !== null) {
      if (data !== '\r') return
      this.exited = null
      this.term.write('\r\n')
      this.source?.again?.()
      return
    }
    if (!this.mayType) return

    this.echo?.typed(binary ? '' : data)
    this.outgoing.push({ data, binary })
    void this.send()
  }

  private async send() {
    if (this.sending) return
    this.sending = true

    await this.spawning.catch(() => undefined)

    while (this.outgoing.length && this.pty !== null && this.source && !this.relinking) {
      const binary = this.outgoing[0]?.binary ?? false
      let data = ''
      while (this.outgoing[0]?.binary === binary) data += this.outgoing.shift()?.data ?? ''

      await this.source.write(data, binary)
    }

    if (!this.relinking) this.outgoing = []
    this.sending = false
  }

  private sized(cols: number, rows: number) {
    if (this.applying) return
    if (this.pty !== null) this.source?.resize(cols, rows)
  }

  private async lookWhere() {
    const source = this.source
    if (this.pty === null || !(source instanceof PtySource)) return

    const folder = await source.where()
    const spec = this.spec()
    if (folder && folder !== spec.folder) {
      this.respec({ ...spec, folder })
    }
  }

  private reported(code: 7 | 9, data: string): boolean {
    if (code === 9 && !data.startsWith('9;')) return false
    if (this.remote) return true

    const spec = this.spec()
    const folder = reportedFolder(
      code,
      data,
      platform() === 'windows',
      spec.shell.startsWith('wsl:'),
    )
    if (folder && folder !== spec.folder) this.respec({ ...spec, folder })
    return true
  }

  private get inFront(): boolean {
    return this.drawn && this.host.isConnected && document.hasFocus()
  }

  private clipboard(data: string): boolean {
    const text = clipboardWrite(data)
    if (text !== null && this.inFront && (!this.online || this.mayType)) void copyText(text)
    return true
  }

  private noticed(notice: Notice | null): boolean {
    if (!notice) return false
    const now = Date.now()
    if (this.inFront || now - this.lastNotice < NOTICE_EVERY) return true
    this.lastNotice = now
    const name = this.tab.running?.name ?? this.tab.shown
    notify(notice.title ?? name, notice.body, `terminal-${this.tab.id}`, () => {
      workspace.activeTabId = this.tab.id
    })
    return true
  }

  private offer(url: string) {
    clearTimeout(this.offerGoes)
    this.offered = url
    this.offerGoes = setTimeout(() => (this.offered = null), OFFERED_FOR)
  }

  openOffered() {
    const url = this.offered
    clearTimeout(this.offerGoes)
    this.offered = null
    if (url) window.open(url, '_blank', 'noopener')
    this.focus()
  }

  private pointed: string | null = null
  private pressing: string | null = null
  private spending = false

  private pressLink(event: MouseEvent) {
    this.spending = false
    const uri = this.pointed
    if (uri === null || tabAsk(event) === 'plain') return
    event.preventDefault()
    event.stopPropagation()
    this.pressing = uri
  }

  private releaseLink(event: MouseEvent) {
    const uri = this.pressing
    if (uri === null) return
    this.pressing = null
    this.spending = true
    event.preventDefault()
    event.stopPropagation()
    if (this.pointed === uri) workspace.openPage(uri, tabAsk(event), this.tab.id)
  }

  private spentLink(event: MouseEvent) {
    if (!this.spending) return
    this.spending = false
    event.preventDefault()
    event.stopPropagation()
  }

  private pressed(event: KeyboardEvent): boolean {
    if (event.type !== 'keydown') return true

    const command = commandOf(event)
    let route = routeKey(event, shortcuts.platform, command, shortcuts.pressed('edit.find', event))

    if (route === 'ask') {
      const way = command === null ? 'shell' : shells.ways[command]
      if (way === undefined) {
        event.preventDefault()
        event.stopPropagation()
        if (command !== null) void this.askWhich(command, event)
        return false
      }
      route = way
    }

    if (route === 'shell' && this.remote && imageKey(event, shortcuts.platform)) {
      event.preventDefault()
      event.stopPropagation()
      void this.pictureOrKey(imageKeyTyped(event))
      return false
    }

    if (route === 'shell') {
      event.stopPropagation()
      return true
    }
    if (route === 'app' || route === 'paste') return false

    event.preventDefault()
    this.act(route)
    return false
  }

  private async askWhich(command: string, event: KeyboardEvent) {
    const pressed = {
      key: event.key,
      code: event.code,
      ctrl: event.ctrlKey,
      shift: event.shiftKey,
      alt: event.altKey,
      repeat: false,
      down: true,
    }
    const { whichWay } = await import('./two-ways')
    const way = await whichWay(command)
    if (way === 'app') (await import('../web-tab/keys')).replay(pressed)
    else if (way === 'shell') {
      this.focus()
      const typed = typedBy({
        key: pressed.key,
        ctrlKey: pressed.ctrl,
        metaKey: false,
        altKey: pressed.alt,
        shiftKey: pressed.shift,
      })
      if (typed !== null) this.term.input(typed, true)
    }
  }

  private act(route: Exclude<Route, 'shell' | 'app' | 'paste' | 'ask'>) {
    switch (route) {
      case 'copy':
        this.copyChosen()
        return
      case 'find':
        this.finding = true
        return
      case 'select-all':
        this.term.selectAll()
        return
      case 'clear':
        this.term.clear()
        return
      case 'zoom-in':
        shells.setSize(shells.size + 1)
        return
      case 'zoom-out':
        shells.setSize(shells.size - 1)
        return
      case 'zoom-reset':
        shells.setSize(SIZES.initial)
        return
    }
  }

  private copyChosen() {
    const chosen = chosenText(this.term)
    if (chosen) void copyText(chosen)
  }

  private pasting(event: ClipboardEvent) {
    event.preventDefault()
    event.stopImmediatePropagation()
    const image = imageIn(event.clipboardData)
    if (image) void import('./images').then(({ pictureOf }) => this.carry([pictureOf(image)]))
    else void this.paste(event.clipboardData?.getData('text/plain') ?? '')
  }

  private async pasteFromMenu() {
    const text = await navigator.clipboard.readText().catch(() => '')
    if (text) await this.paste(text)
    else await this.pictureOrKey('')
  }

  private async pictureOrKey(key: string) {
    const { clipboardPicture } = await import('./images')
    const picture = await clipboardPicture()
    if (picture) await this.carry([picture])
    else if (key) this.term.input(key, true)
  }

  private async carry(pictures: (Picture | null)[]) {
    const source = this.source
    const some = pictures.filter((one) => one !== null)
    if (source === null || !some.length || (this.online && !this.mayType)) return

    const { carried } = await import('./images')
    const paths = await carried(source, some, this.remote ? '/bin/sh' : this.spec().shell)
    if (paths !== null && this.source === source) this.term.paste(paths)
    this.focus()
  }

  async paste(text: string) {
    if (!text || this.pty === null) return

    if (asksFirst(text, this.term.modes.bracketedPasteMode)) {
      const { prompt } = await import('../prompt.svelte')
      const lines = linesIn(text)
      const sure = await prompt.confirm({
        title: plural(lines, { one: 'Paste {count} line?', other: 'Paste {count} lines?' }),
        confirmLabel: key('Paste'),
      })
      this.focus()
      if (!sure) return
    }

    this.term.paste(pasted(text))
  }

  private dropped(event: DragEvent) {
    const transfer = event.dataTransfer
    if (this.pty === null || !takesDrop(transfer)) return

    event.preventDefault()
    const rows = isTreeDrag(transfer)
      ? dragged(transfer)
      : isExplorerDrag(transfer)
        ? outsideRows(transfer)
        : null
    if (rows !== null) {
      this.droppedRows(rows)
      return
    }

    const files = [...(transfer?.files ?? [])]
    const pictures = this.remote ? files.filter((file) => imageKindOf(file.type) !== null) : []
    if (pictures.length) {
      void import('./images').then(({ pictureOf }) => this.carry(pictures.map(pictureOf)))
      return
    }
    if (this.online || !files.length) return

    void import('../dropped-paths').then(async ({ droppedPaths }) =>
      this.speak(await droppedPaths(files)),
    )
  }

  private droppedRows(paths: readonly string[]) {
    const pictures = this.remote ? paths.filter((path) => imageKindAt(path) !== null) : []
    if (pictures.length) {
      void import('./images').then(({ pictureAt }) => this.carry(pictures.map(pictureAt)))
      return
    }
    if (!this.online) this.speak(paths)
  }

  private speak(paths: readonly string[]) {
    if (!paths.length || this.pty === null) return

    const shell = this.spec().shell
    this.term.paste(paths.map((path) => spokenPath(path, shell)).join(' '))
    this.focus()
  }

  private showMenu(event: MouseEvent) {
    const mac = shortcuts.platform === 'mac'
    const hint = (win: string, macKey: string) =>
      showCombination(mac ? macKey : win, shortcuts.platform)

    const rows: MenuEntry[] = [
      {
        label: t('Copy'),
        hint: hint('Ctrl-Shift-c', 'Mod-c'),
        disabled: !this.term.hasSelection(),
        run: () => this.copyChosen(),
      },
      {
        label: t('Paste'),
        hint: hint('Ctrl-Shift-v', 'Mod-v'),
        run: () => void this.pasteFromMenu(),
      },
      DIVIDER,
      { label: t('Select all'), run: () => this.term.selectAll() },
      { label: t('Find'), hint: shortcuts.hint('edit.find'), run: () => (this.finding = true) },
      { label: t('Clear'), run: () => this.term.clear() },
    ]

    menu.show(event, rows)
  }

  look(query: string, back = false) {
    this.query = query
    if (!query) {
      this.searching.clearDecorations()
      this.found = { count: 0, at: -1 }
      return
    }

    if (back) this.searching.findPrevious(query, searchOptions(false))
    else this.searching.findNext(query, searchOptions(true))
  }

  step(by: number) {
    if (!this.query) return
    if (by < 0) this.searching.findPrevious(this.query, searchOptions(false))
    else this.searching.findNext(this.query, searchOptions(false))
  }

  closeFind() {
    this.finding = false
    this.searching.clearDecorations()
    this.term.clearSelection()
    this.focus()
  }
}

function searchOptions(incremental: boolean): ISearchOptions {
  const colours = findColours()
  return {
    incremental,
    decorations: {
      matchBackground: colours.match,
      activeMatchBackground: colours.here,
      matchOverviewRuler: colours.match,
      activeMatchColorOverviewRuler: colours.here,
    },
  }
}

function placeOf(tab: Tab): Place {
  const home = (tab.note as { home?: string | null }).home ?? null
  return { space: home, key: readSpec(tab.doc)?.key ?? '' }
}

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a registry of screens; nothing renders from it
const sessions = new Map<string, Session>()

export async function usageOfTab(tab: Tab): Promise<Usage | null> {
  return (await sessions.get(tab.id)?.usage()) ?? null
}

export function sessionOf(tab: Tab): Session {
  let one = sessions.get(tab.id)
  if (!one) {
    one = new Session(tab)
    sessions.set(tab.id, one)
  }
  return one
}

export type { Session }

function watch() {
  $effect.root(() => {
    $effect(() => {
      const open = new Set(workspace.tabs.map((tab) => tab.id))
      untrack(() => {
        for (const [id, one] of sessions) {
          if (open.has(id)) continue
          sessions.delete(id)
          one.end()
        }
      })
    })

    $effect(() => {
      const pixels = shells.size
      untrack(() => {
        for (const one of sessions.values()) one.size(pixels)
      })
    })
  })

  let frame = 0
  let painted = ''
  const repaint = (themed = shells.themed) => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const theme = laid(terminalTheme(document.documentElement, !themed))
      const family = monospace()
      const contrast = terminalContrast()
      const now = JSON.stringify([theme, family, contrast])
      if (now === painted) return
      painted = now
      for (const one of sessions.values()) one.repaint(theme, family, contrast)
    })
  }
  let themedWas = shells.themed
  $effect.root(() => {
    $effect(() => {
      const themed = shells.themed
      if (themed === themedWas) return
      themedWas = themed
      untrack(() => repaint(themed))
    })
  })
  const page = new MutationObserver(() => repaint())
  page.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'style', 'class'],
  })
  page.observe(document.head, { childList: true, subtree: true, characterData: true })

  owes(() => {
    for (const one of sessions.values()) one.remember()
  })

  moveLegacy(
    workspace.tabs.filter((tab) => tab.kind === 'terminal' && !isOnlineTab(tab)).map(placeOf),
  )
}

watch()

function laid(theme: ITheme): ITheme {
  chrome.terminal = terminalGround(theme)
  return theme
}

function takesDrop(transfer: DataTransfer | null): boolean {
  return isTreeDrag(transfer) || isExplorerDrag(transfer) || isFileDrop(transfer)
}
