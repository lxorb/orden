import type { SlideShape } from '@orden/markdown/slides'
import type { Scheme } from '../theme.svelte'
import { invoke, isDesktop } from '../tauri'

export interface Stage {
  slide: string
  next: string
  shape: SlideShape
  nextShape: SlideShape
  notes: string
  at: number
  count: number
  started: number
  scheme: Scheme
}

export type Message =
  | { kind: 'stage'; stage: Stage }
  | { kind: 'move'; by: number }
  | { kind: 'here' }
  | { kind: 'gone' }

const CHANNEL = 'orden:presenter'
const LABEL = 'nib-presenter'

function messageOf(value: unknown): Message | null {
  if (typeof value !== 'object' || value === null) return null
  const said = value as Record<string, unknown>

  if (said.kind === 'gone') return { kind: 'gone' }
  if (said.kind === 'here') return { kind: 'here' }
  if (said.kind === 'move' && typeof said.by === 'number') return { kind: 'move', by: said.by }
  if (said.kind !== 'stage') return null

  const stage = said.stage
  if (typeof stage !== 'object' || stage === null) return null
  const one = stage as Record<string, unknown>

  if (typeof one.slide !== 'string' || typeof one.next !== 'string') return null
  if (typeof one.notes !== 'string' || typeof one.at !== 'number') return null
  if (typeof one.count !== 'number' || typeof one.started !== 'number') return null
  if (one.scheme !== 'dark' && one.scheme !== 'light') return null

  const shape = shapeOf(one.shape)
  const nextShape = shapeOf(one.nextShape)
  if (!shape || !nextShape) return null

  return {
    kind: 'stage',
    stage: {
      slide: one.slide,
      next: one.next,
      shape,
      nextShape,
      notes: one.notes,
      at: one.at,
      count: one.count,
      started: one.started,
      scheme: one.scheme,
    },
  }
}

const SHAPES: readonly SlideShape[] = ['title', 'picture', 'prose']

function shapeOf(value: unknown): SlideShape | null {
  return SHAPES.find((one) => one === value) ?? null
}

export interface Channel {
  send(message: Message): void
  close(): void
}

export function presenterChannel(heard: (message: Message) => void): Channel {
  if (typeof BroadcastChannel === 'undefined') {
    return { send: () => undefined, close: () => undefined }
  }

  const channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = messageOf(event.data)
    if (message) heard(message)
  }

  return {
    send: (message) => channel.postMessage(message),
    close: () => channel.close(),
  }
}

const WIDTH = 1100
const HEIGHT = 680

export async function secondScreen(): Promise<boolean> {
  if (!isDesktop) return false

  try {
    const { availableMonitors } = await import('@tauri-apps/api/window')
    return (await availableMonitors()).length > 1
  } catch {
    return false
  }
}

export async function openPresenter(): Promise<boolean> {
  if (!isDesktop) return openTab()

  try {
    const [{ WebviewWindow }, { availableMonitors, currentMonitor }] = await Promise.all([
      import('@tauri-apps/api/webviewWindow'),
      import('@tauri-apps/api/window'),
    ])

    const standing = await WebviewWindow.getByLabel(LABEL)
    if (standing) {
      await invoke('raise_window', { label: LABEL })
      return true
    }

    const [here, screens] = await Promise.all([
      currentMonitor().catch(() => null),
      availableMonitors().catch(() => []),
    ])
    const other = screens.find((screen) => screen.name !== here?.name) ?? here

    await invoke('presenter_open', {
      x: other ? other.position.x + 40 : null,
      y: other ? other.position.y + 40 : null,
    })
    return true
  } catch {
    return false
  }
}

function openTab(): boolean {
  const opened = window.open('presenter.html', LABEL, `width=${WIDTH},height=${HEIGHT}`)
  return opened !== null
}

export async function closePresenter(): Promise<void> {
  if (!isDesktop) return

  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    const standing = await WebviewWindow.getByLabel(LABEL)
    await standing?.close()
  } catch {
    // A window that cannot be closed from here closes when the app does.
  }
}
