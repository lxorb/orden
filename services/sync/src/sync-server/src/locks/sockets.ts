import { HOLD_GRACE, HOLD_QUIET } from '@orden/online/wire'
import { note } from '../failed'
import { claimed, type Hold, holdKey, holdOf, standing } from './holding'

const OPEN = 1

export interface Holder {
  session: string
  device: string
  who: string
  name?: string
  seen: number
  parked?: boolean
  lost?: boolean
}

type LockFrame = { t: 'held'; by: string; since: number; taken: boolean } | { t: 'hold' }

export interface LockHost<V extends Holder> {
  ctx: DurableObjectState
  viewerOf(socket: WebSocket): V | null
  drives(viewer: V): boolean
  say(socket: WebSocket, frame: LockFrame): void
  parked?(socket: WebSocket): void
  handed?(session: string): void
}

export class SocketLock<V extends Holder> {
  private holding: Promise<unknown> = Promise.resolve()
  private readonly heardAt = new WeakMap<WebSocket, number>()
  private readonly freeing = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly host: LockHost<V>) {}

  heard(socket: WebSocket): void {
    this.heardAt.set(socket, Date.now())
  }

  inTurn<T>(work: () => Promise<T>): Promise<T> {
    const turn = this.holding.then(work)
    this.holding = turn.catch(() => undefined)
    return turn
  }

  private present(session: string, device: string, except?: WebSocket): boolean {
    const now = Date.now()
    let found = false
    for (const socket of this.host.ctx.getWebSockets(session)) {
      const viewer = this.host.viewerOf(socket)
      if (socket === except || socket.readyState !== OPEN || !viewer) continue
      if (!this.host.drives(viewer) || viewer.parked || viewer.device !== device) continue
      if (now - this.lastHeard(socket, viewer) > HOLD_QUIET) {
        socket.close(4408, 'went quiet')
        continue
      }
      found = true
    }
    return found
  }

  private lastHeard(socket: WebSocket, viewer: V): number {
    const beat = this.host.ctx.getWebSocketAutoResponseTimestamp(socket)?.getTime() ?? 0
    return Math.max(this.heardAt.get(socket) ?? 0, beat, viewer.seen)
  }

  claim(socket: WebSocket, take: boolean): Promise<boolean> {
    return this.inTurn(async () => {
      const viewer = this.host.viewerOf(socket)
      if (!viewer || socket.readyState !== OPEN) return false
      const key = holdKey(viewer.session)
      const before = holdOf(await this.host.ctx.storage.get(key))
      const now = Date.now()
      const present = before ? this.present(viewer.session, before.device, socket) : false
      const { hold, granted } = claimed(
        before,
        { device: viewer.device, who: viewer.who, name: viewer.name ?? '', take },
        present,
        now,
      )
      await this.host.ctx.storage.put(key, hold)
      if (!granted) {
        this.park(socket, viewer, hold, viewer.lost === true)
        this.freeLater(viewer.session, hold)
        return false
      }
      socket.serializeAttachment({ ...viewer, parked: false, lost: false })
      this.handed(viewer.session, hold, socket)
      return true
    })
  }

  private handed(session: string, hold: Hold, except?: WebSocket): void {
    for (const other of this.host.ctx.getWebSockets(session)) {
      const viewer = this.host.viewerOf(other)
      if (other === except || !viewer || !this.host.drives(viewer)) continue
      if (viewer.device === hold.device) {
        if (viewer.parked) {
          other.serializeAttachment({ ...viewer, parked: false, lost: false })
          this.host.say(other, { t: 'hold' })
        }
        continue
      }
      this.park(other, viewer, hold, viewer.parked ? viewer.lost === true : true)
    }
    this.host.handed?.(session)
  }

  private park(socket: WebSocket, viewer: V, hold: Hold, lost: boolean): void {
    socket.serializeAttachment({ ...viewer, parked: true, lost })
    this.host.parked?.(socket)
    this.host.say(socket, { t: 'held', by: hold.name, since: hold.since, taken: lost })
  }

  leave(socket: WebSocket): Promise<void> {
    return this.inTurn(async () => {
      const viewer = this.host.viewerOf(socket)
      if (!viewer || !this.host.drives(viewer)) return
      socket.serializeAttachment({ ...viewer, parked: true, lost: false })
      const key = holdKey(viewer.session)
      const hold = holdOf(await this.host.ctx.storage.get(key))
      if (hold?.device !== viewer.device || this.present(viewer.session, hold.device, socket))
        return
      await this.host.ctx.storage.delete(key)
      await this.handOn(viewer.session, socket)
    })
  }

  settle(session: string, gone?: WebSocket): Promise<void> {
    return this.inTurn(async () => {
      const key = holdKey(session)
      const before = holdOf(await this.host.ctx.storage.get(key))
      if (!before) {
        await this.handOn(session)
        return
      }
      const hold = standing(before, this.present(session, before.device, gone), Date.now())
      if (hold) {
        if (hold.left !== before.left) await this.host.ctx.storage.put(key, hold)
        this.freeLater(session, hold)
        return
      }
      await this.host.ctx.storage.delete(key)
      await this.handOn(session)
    })
  }

  drop(session: string): Promise<boolean> {
    return this.inTurn(() => this.host.ctx.storage.delete(holdKey(session)))
  }

  async holder(session: string): Promise<Hold | null> {
    return holdOf(await this.host.ctx.storage.get(holdKey(session)))
  }

  private async handOn(session: string, except?: WebSocket): Promise<void> {
    const waiting = this.host.ctx.getWebSockets(session).flatMap((socket) => {
      const viewer = this.host.viewerOf(socket)
      if (socket === except || !viewer?.parked || socket.readyState !== OPEN) return []
      if (!this.host.drives(viewer)) return []
      return Date.now() - this.lastHeard(socket, viewer) > HOLD_QUIET ? [] : [{ socket, viewer }]
    })
    const next = waiting.sort(
      (a, b) => this.lastHeard(b.socket, b.viewer) - this.lastHeard(a.socket, a.viewer),
    )[0]
    if (!next) return
    const hold: Hold = {
      device: next.viewer.device,
      who: next.viewer.who,
      name: next.viewer.name ?? '',
      since: Date.now(),
      left: null,
    }
    await this.host.ctx.storage.put(holdKey(session), hold)
    this.handed(session, hold)
  }

  private freeLater(session: string, hold: Hold): void {
    if (hold.left === null || this.freeing.has(session)) return
    const timer = setTimeout(
      () => {
        this.freeing.delete(session)
        this.settle(session).catch((error: unknown) => {
          note('lock settle', error, null)
        })
      },
      Math.max(0, hold.left + HOLD_GRACE - Date.now()) + 10,
    )
    this.freeing.set(session, timer)
  }
}
