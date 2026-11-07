import { invoke, isDesktop } from './tauri'

const PRESSED = 'orden://notice'

const KEPT = 64

export interface Notice {
  title: string
  body: string
  tag?: string
  from?: string
  silent?: boolean
  opened?: () => void
  reply?: { placeholder: string; send: string; replied: (text: string) => void }
}

const answering = new Map<string, Notice>()
const showing = new Map<string, string>()
const up = new Map<string, Notification>()
let listening: Promise<unknown> | null = null

export function notify(title: string, body: string, tag?: string, opened?: () => void): void {
  show({ title, body, ...(tag ? { tag } : {}), ...(opened ? { opened } : {}) })
}

export function show(one: Notice): void {
  if (isDesktop) {
    shownByTheCrate(one)
    return
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return

  const options: NotificationOptions = {
    body: one.from ? `${one.body}\n${one.from}` : one.body,
    ...(one.tag ? { tag: one.tag } : {}),
    ...(one.silent ? { silent: true } : {}),
  }
  let shown: Notification
  try {
    shown = new Notification(one.title, options)
  } catch {
    shownByTheWorker(one, options)
    return
  }
  shown.onclick = () => {
    window.focus()
    one.opened?.()
    shown.close()
  }
  if (one.tag) up.set(one.tag, shown)
}

export function askToShow(): void {
  if (isDesktop || typeof Notification === 'undefined') return
  if (Notification.permission === 'default') void Notification.requestPermission()
}

export function unshow(tag: string): void {
  up.get(tag)?.close()
  up.delete(tag)
  if (byWorker.delete(tag)) closeByTheWorker(tag)
  const id = showing.get(tag)
  if (id === undefined) return
  showing.delete(tag)
  answering.delete(id)
  if (isDesktop) void invoke('notice_clear', { tag: plainTag(tag) }).catch(() => undefined)
}

const byWorker = new Map<string, Notice>()
let hearingTheWorker = false

function worker(): ServiceWorkerContainer | null {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    ? navigator.serviceWorker
    : null
}

function shownByTheWorker(one: Notice, options: NotificationOptions): void {
  const workers = worker()
  if (!workers) return

  const tag = one.tag ?? fresh()
  byWorker.delete(tag)
  byWorker.set(tag, one)
  for (const old of byWorker.keys()) {
    if (byWorker.size <= KEPT) break
    byWorker.delete(old)
  }

  if (!hearingTheWorker) {
    hearingTheWorker = true
    workers.addEventListener('message', (event: MessageEvent) => {
      const said: unknown = event.data
      const pressed =
        typeof said === 'object' && said !== null
          ? (said as { nibNotice?: unknown }).nibNotice
          : null
      if (typeof pressed === 'string') byWorker.get(pressed)?.opened?.()
    })
    workers.startMessages()
  }

  void workers.ready
    .then((held) => held.showNotification(one.title, { ...options, tag, data: { nibNotice: tag } }))
    .catch(() => undefined)
}

function closeByTheWorker(tag: string): void {
  void worker()
    ?.getRegistration()
    .then((held) => held?.getNotifications({ tag }))
    .then((shown) => shown?.forEach((one) => one.close()))
    .catch(() => undefined)
}

const LONGEST_TAG = 64

function plainTag(tag: string): string {
  if (tag.length <= LONGEST_TAG && /^[A-Za-z0-9_-]+$/.test(tag)) return tag
  let value = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(tag)) {
    value ^= BigInt(byte)
    value = (value * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return `tag-${value.toString(16).padStart(16, '0')}`
}

function shownByTheCrate(one: Notice): void {
  listening ??= import('./own-window').then(({ hearHere }) =>
    hearHere<unknown>(PRESSED, (event) => pressed(event.payload)),
  )

  const id = fresh()
  if (one.tag) {
    const before = showing.get(one.tag)
    if (before !== undefined) answering.delete(before)
    showing.set(one.tag, id)
  }
  answering.set(id, one)
  for (const old of answering.keys()) {
    if (answering.size <= KEPT) break
    answering.delete(old)
  }

  void invoke('notice_show', {
    notice: {
      id,
      tag: one.tag === undefined ? id : plainTag(one.tag),
      title: one.title,
      body: one.body,
      from: one.from ?? '',
      silent: one.silent === true,
      reply: one.reply ? { placeholder: one.reply.placeholder, send: one.reply.send } : null,
    },
  }).catch(() => undefined)
}

function pressed(said: unknown): void {
  if (typeof said !== 'object' || said === null) return
  const { id, act, text } = said as Record<string, unknown>
  const one = typeof id === 'string' ? answering.get(id) : undefined
  if (!one) return
  if (act === 'reply' && typeof text === 'string' && text.trim()) one.reply?.replied(text)
  else if (act === 'open') one.opened?.()
}

function fresh(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
