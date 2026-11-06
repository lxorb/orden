import { fileBytes } from './bytes'
import { carriedNothing, carryOutside } from './drag-paths'
import { mimeOfPath, UNKNOWN_TYPE } from './mime'
import { nameOf } from './space-paths'

export interface Said {
  paths?: string[] | null
  position?: { x: number; y: number } | null
}

interface Held {
  paths: readonly string[]
  target: Element | null
  x: number
  y: number
  taken: boolean
  timer: ReturnType<typeof setInterval>
}

const AT_REST = 350

export interface Engine {
  read: (path: string) => Promise<Uint8Array>
  ratio: () => number
}

const engine: Engine = { read: fileBytes, ratio: () => window.devicePixelRatio || 1 }

function typeOf(path: string): string {
  return mimeOfPath(path) ?? UNKNOWN_TYPE
}

type Holding = 'hover' | 'paths' | readonly File[]

function holding(
  paths: readonly string[],
  what: Holding,
  effect: DataTransfer['dropEffect'] = 'none',
): DataTransfer {
  const transfer = new DataTransfer()
  let allowed: DataTransfer['effectAllowed'] = 'copy'
  let wanted = effect
  Object.defineProperties(transfer, {
    effectAllowed: {
      get: () => allowed,
      set: (value: DataTransfer['effectAllowed']) => {
        allowed = value
      },
    },
    dropEffect: {
      get: () => wanted,
      set: (value: DataTransfer['dropEffect']) => {
        wanted = value
      },
    },
  })
  if (typeof what === 'string') carryOutside(transfer, paths)
  if (what === 'hover') {
    for (const path of paths) {
      transfer.items.add(new File([], nameOf(path), { type: typeOf(path) }))
    }
  }
  if (typeof what !== 'string') for (const one of what) transfer.items.add(one)
  return transfer
}

function said(
  type: string,
  target: Element,
  transfer: DataTransfer,
  at: { x: number; y: number },
  related: Element | null = null,
): boolean {
  return target.dispatchEvent(
    new DragEvent(type, {
      bubbles: true,
      cancelable: type !== 'dragleave',
      composed: true,
      view: window,
      dataTransfer: transfer,
      relatedTarget: related,
      clientX: at.x,
      clientY: at.y,
      screenX: at.x + window.screenX,
      screenY: at.y + window.screenY,
    }),
  )
}

export class OutsideDrops {
  private held: Held | null = null
  private readonly engine: Engine

  constructor(using: Engine = engine) {
    this.engine = using
  }

  entered(event: Said) {
    this.left()
    const paths = (event.paths ?? []).filter((one) => one.length > 0)
    if (!paths.length) return

    this.held = {
      paths,
      target: null,
      x: 0,
      y: 0,
      taken: false,
      timer: setInterval(() => this.step(), AT_REST),
    }
    this.moved(event)
  }

  moved(event: Said) {
    const held = this.held
    if (!held) return

    if (event.position) {
      const ratio = this.engine.ratio()
      held.x = event.position.x / ratio
      held.y = event.position.y / ratio
    }
    this.step()
  }

  left() {
    const held = this.held
    if (!held) return

    this.held = null
    clearInterval(held.timer)
    if (held.target) said('dragleave', held.target, holding(held.paths, 'hover'), held)
    carriedNothing()
  }

  async dropped(event: Said): Promise<void> {
    if (!this.held && event.paths?.length) this.entered(event)
    else this.moved(event)
    const held = this.held
    if (!held) return

    this.held = null
    clearInterval(held.timer)
    const { target, paths } = held
    try {
      if (!target) return
      if (!held.taken) {
        said('dragleave', target, holding(paths, 'hover'), held)
        return
      }
      if (!said('drop', target, holding(paths, 'paths'), held)) return

      const files = await this.files(paths)
      if (files.length && target.isConnected) said('drop', target, holding(paths, files), held)
    } finally {
      carriedNothing()
    }
  }

  private step() {
    const held = this.held
    if (!held) return

    const under = document.elementFromPoint(held.x, held.y)
    const transfer = holding(held.paths, 'hover')
    if (under !== held.target) {
      const was = held.target
      if (under) said('dragenter', under, transfer, held, was)
      if (was) said('dragleave', was, transfer, held, under)
      held.target = under
    }
    if (!under) {
      held.taken = false
      return
    }
    const over = holding(held.paths, 'hover', 'copy')
    held.taken = !said('dragover', under, over, held) && over.dropEffect !== 'none'
  }

  private async files(paths: readonly string[]): Promise<File[]> {
    const read = await Promise.all(
      paths.map(async (path) => {
        const bytes = await this.engine.read(path).catch(() => null)
        return bytes
          ? new File([bytes as Uint8Array<ArrayBuffer>], nameOf(path), { type: typeOf(path) })
          : null
      }),
    )
    return read.filter((one): one is File => one !== null)
  }
}

export async function hearOutsideDrops(): Promise<() => void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const here = getCurrentWindow()
  const drops = new OutsideDrops()
  const stops = await Promise.all([
    here.listen<Said>('tauri://drag-enter', (event) => drops.entered(event.payload)),
    here.listen<Said>('tauri://drag-over', (event) => drops.moved(event.payload)),
    here.listen<Said>('tauri://drag-drop', (event) => void drops.dropped(event.payload)),
    here.listen('tauri://drag-leave', () => drops.left()),
  ])
  return () => {
    drops.left()
    for (const stop of stops) stop()
  }
}
