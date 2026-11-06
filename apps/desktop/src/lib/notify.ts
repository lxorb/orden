import { invoke, isDesktop } from './tauri'

const PRESSED = 'nib://notice'

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

  const shown = new Notification(one.title, {
    body: one.from ? `${one.body}\n${one.from}` : one.body,
    ...(one.tag ? { tag: one.tag } : {}),
    ...(one.silent ? { silent: true } : {}),
  })
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
  const id = showing.get(tag)
  if (id === undefined) return
  showing.delete(tag)
  answering.delete(id)
  if (isDesktop) void invoke('notice_clear', { tag }).catch(() => undefined)
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
      tag: one.tag ?? id,
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
