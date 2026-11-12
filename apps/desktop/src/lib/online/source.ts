import { termOf } from '@orden/online/term'
import {
  IMAGE_PART,
  type ImageKind,
  inputChunks,
  MOST_INPUT,
  INPUT_RATE,
  type ServerFrame,
} from '@orden/online/wire'
import { account } from '../account.svelte'
import { ApiError, BASE } from '../api'
import { toBase64 } from '../bytes'
import type { Said, Source } from '../terminal/source'
import { isDesktop, isNative } from '../tauri'
import { viewport } from '../viewport.svelte'
import { writeFile } from '../workspace/write-file'
import { refusedOf, termSession } from './calls'
import { Link, pageWorld } from './link'
import { machine } from './machine.svelte'
import { type Build, Opener } from './opening.svelte'
import { namedSession, ownSession, wordsFor } from './own'
import { refusalWords } from './words'

const WAIT = 20_000
const LOOK_EVERY = 100
const PASS_AT_MOST = 3_000
const ASK_EVERY = 250

const pause = (ms: number) => new Promise((settle) => setTimeout(settle, ms))

async function termIdOf(path: string, until: number): Promise<string | null> {
  const { runner } = await import('../sync-client/src/api')
  for (;;) {
    const found = await runner.idAt(path)
    const id = 'id' in found ? found.id : null
    if (id || Date.now() >= until) return id
    await pause(LOOK_EVERY)
  }
}

async function sessionOf(id: string, path: string, until: number): Promise<string | null> {
  const { runner } = await import('../sync-client/src/api')
  const { invoke } = await import('../tauri')
  const words = await invoke<string>('read_note', { path }).catch(() => null)
  for (;;) {
    try {
      const text = wordsFor(words, await termSession(id, namedSession(words)))
      if (text !== null) {
        await writeFile(path, text)
        void runner.wrote(path, text)
      }
      return null
    } catch (error) {
      if (error instanceof ApiError && error.status === 404 && Date.now() < until) {
        const asked = Date.now()
        await Promise.race([runner.passNow(), pause(PASS_AT_MOST)])
        await pause(Math.max(0, asked + ASK_EVERY - Date.now()))
        continue
      }
      return refusalOf(error)
    }
  }
}

function refusalOf(error: unknown): string | null {
  const why = refusedOf(error)
  return why === 'list' || why === 'sessions' || why === 'signed-out' ? refusalWords(why) : null
}

async function socketName(
  path: string,
  until: number,
): Promise<{ name: string } | { refused: string }> {
  const { sync } = await import('../sync.svelte')
  if (sync.version === 1) {
    const { invoke } = await import('../tauri')
    try {
      const name = await ownSession({
        read: () => invoke<string>('read_note', { path }).catch(() => null),
        write: (text) => writeFile(path, text),
        make: () => termSession(null),
      })
      return { name }
    } catch (error) {
      return { refused: refusalWords(refusedOf(error)) ?? refusalWords('other') ?? '' }
    }
  }
  const id = await termIdOf(path, until)
  if (id === null) return { refused: refusalWords('other') ?? '' }
  const refused = await sessionOf(id, path, until)
  return refused === null ? { name: id } : { refused }
}

export interface Place {
  tab: () => string
  front: () => boolean
  offer: (url: string) => void
}

const FRAMES_A_SECOND = INPUT_RATE / 2

const LANDS_WITHIN = 20_000

export class OnlineSource implements Source {
  readonly remote = true
  private link: Link | null = null
  private ended = false
  private readonly opener: Opener
  private sent = { second: 0, count: 0 }
  private diskSaid = false
  private readonly pictures = new Map<string, (path: string | null) => void>()

  constructor(
    private readonly path: () => string | null,
    private readonly words: () => string,
    private readonly device: () => Promise<string>,
    private readonly place: Place,
    build: Build,
  ) {
    this.opener = new Opener(
      place.tab,
      build,
      (url) => this.link?.say({ t: 'callback', url }),
      place.offer,
    )
  }

  async start(cols: number, rows: number, said: (what: Said) => void): Promise<void> {
    if (!account.accountToken) {
      said({ refused: refusalWords('signed-out') ?? '' })
      return
    }
    const path = this.path()
    const unsaved = path === null ? termOf(this.words()) : null
    if (path === null && !unsaved) {
      said({ refused: refusalWords('other') ?? '' })
      return
    }
    const found = unsaved
      ? { name: unsaved.session }
      : await socketName(path ?? '', Date.now() + WAIT)
    if ('refused' in found) {
      said({ refused: found.refused })
      return
    }
    if (this.ended) return

    this.link = new Link(
      found.name,
      pageWorld(BASE, () => account.accountToken, this.device),
      (heard) => {
        if (heard.t === 'out') said({ out: heard.data })
        else if (heard.t === 'open') {
          said({ connected: true })
          if (!machine.known) void machine.refresh()
        } else if (heard.t === 'dropped') said({ connected: false })
        else this.heard(heard, said)
      },
      cols,
      rows,
    )
    this.link.open()
  }

  private heard(frame: ServerFrame, said: (what: Said) => void): void {
    switch (frame.t) {
      case 'screen':
        said({
          screen: frame.data,
          cols: frame.cols,
          rows: frame.rows,
          restored: frame.restored ?? null,
        })
        return
      case 'size':
        said({ size: { cols: frame.cols, rows: frame.rows } })
        return
      case 'program':
        said({ program: frame.name, title: frame.title })
        return
      case 'machine':
        machine.heard(frame.state)
        said({
          machine: frame.state === 'awake' && machine.near ? 'near' : frame.state,
          ...(frame.reason ? { reason: frame.reason } : {}),
        })
        return
      case 'link':
        said({ link: frame.up })
        return
      case 'role':
        said({ typing: frame.type })
        return
      case 'ended':
        said({ exit: frame.code })
        return
      case 'refused': {
        if (frame.error === 'role') said({ typing: false })
        const words = refusalWords(frame.error)
        if (words)
          said(frame.error === 'gone' ? { refused: words, gone: true } : { refused: words })
        return
      }
      case 'browse':
        this.opener.open(frame.url, this.place.front())
        return
      case 'called':
        this.opener.called(frame.url, frame.status)
        return
      case 'image':
        this.pictures.get(frame.id)?.(frame.path)
        return
      case 'note':
        if (frame.note === 'restore') said({ note: 'Your home folder could not be restored' })
        else if (!this.diskSaid) {
          this.diskSaid = true
          said({ note: 'Your machine’s disk is almost full' })
        }
        return
      case 'held':
        said({ held: { by: frame.by, since: frame.since, taken: frame.taken } })
        return
      case 'hold':
        said({ held: null })
        return
      case 'people':
      case 'typed':
        return
    }
  }

  async write(data: string, binary: boolean): Promise<void> {
    if (binary) {
      const bytes = Uint8Array.from(data, (char) => char.charCodeAt(0) & 0xff)
      for (let at = 0; at < bytes.length || at === 0; at += MOST_INPUT) {
        await this.paced()
        this.link?.sayBytes(bytes.subarray(at, at + MOST_INPUT))
      }
      return
    }
    for (const chunk of inputChunks(data)) {
      await this.paced()
      this.link?.say({ t: 'in', data: chunk })
    }
  }

  async image(bytes: Uint8Array, kind: ImageKind): Promise<string> {
    const id = crypto.randomUUID().replace(/-/g, '')
    const landed = new Promise<string | null>((settle) => this.pictures.set(id, settle))
    try {
      for (let at = 0; ; at += IMAGE_PART) {
        const last = at + IMAGE_PART >= bytes.length
        await this.paced()
        const part = toBase64(bytes.subarray(at, at + IMAGE_PART))
        if (!this.link?.say({ t: 'image', id, kind, part, last })) throw new Error('not connected')
        if (last) break
      }
      const quiet = new Promise<null>((settle) => setTimeout(() => settle(null), LANDS_WITHIN))
      const path = await Promise.race([landed, quiet])
      if (path === null) throw new Error('the machine did not take the picture')
      return path
    } finally {
      this.pictures.delete(id)
    }
  }

  private async paced(): Promise<void> {
    const now = Date.now()
    const second = Math.floor(now / 1000)
    if (second !== this.sent.second) this.sent = { second, count: 0 }
    if (this.sent.count >= FRAMES_A_SECOND) {
      await new Promise((settle) => setTimeout(settle, (second + 1) * 1000 - now))
      this.sent = { second: second + 1, count: 0 }
    }
    this.sent.count += 1
  }

  resize(cols: number, rows: number): void {
    this.link?.resize(cols, rows)
  }

  seen(): void {
    // Nothing to acknowledge: the socket is the back pressure (MOST_BEHIND in the wire).
  }

  again(): void {
    this.link?.say({ t: 'start' })
  }

  take(): void {
    this.link?.take()
  }

  end(): void {
    this.ended = true
    for (const settle of this.pictures.values()) settle(null)
    this.opener.end()
    this.link?.close()
    this.link = null
  }
}

export function onlineSource(
  path: () => string | null,
  words: () => string,
  place: Place,
): OnlineSource {
  return new OnlineSource(
    path,
    words,
    async () => (await import('../sync-client/src/api')).deviceId(),
    place,
    { pages: isDesktop && viewport.device !== 'phone', native: isNative },
  )
}

export async function cacheKey(words: string, path: string | null): Promise<string> {
  let term = termOf(words)
  if (!term && path !== null) {
    const { invoke } = await import('../tauri')
    const read = await invoke<string>('read_note', { path }).catch(() => null)
    term = read === null ? null : termOf(read)
  }
  return term ? `online-${term.session}` : ''
}
