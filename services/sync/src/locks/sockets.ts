/** A session's lock among an object's sockets (issue 1055): who of them holds it, who is
 *  held off, and every change to it in one queue. The rules are holding.ts's; this is
 *  where they meet the sockets - an online terminal's `Machine`, and an application's
 *  `AppRelay` (issue 1063) - so both hand a session on the same way.
 *
 *  A socket takes part where its object says it `drives`. Each one carries, on its
 *  attachment, the session it is on, its device and that device's name, and whether it
 *  is held off (`parked`) and had the session taken from it (`lost`). Held off, it is told
 *  `held` and sent nothing of the session until it takes it over; handed it, it is told
 *  `hold` and says hello again. A holder present is a socket of its device that is open
 *  and was heard from - a frame, or the runtime-answered beat - within `HOLD_QUIET`. */

import { HOLD_GRACE, HOLD_QUIET } from '@orden/online/wire'
import { note } from '../failed'
import { claimed, type Hold, holdKey, holdOf, standing } from './holding'

const OPEN = 1

/** What a socket's attachment says, as far as the lock reads it. */
export interface Holder {
  session: string
  device: string
  who: string
  /** The name the device gave itself, which another device is told it by. */
  name?: string
  /** When the person last said hello or typed, by the object's clock. */
  seen: number
  parked?: boolean
  lost?: boolean
}

/** What the lock is said with: the two frames of the app's socket that are its own. */
type LockFrame = { t: 'held'; by: string; since: number; taken: boolean } | { t: 'hold' }

/** What the object the lock is in gives it. */
export interface LockHost<V extends Holder> {
  ctx: DurableObjectState
  viewerOf(socket: WebSocket): V | null
  /** Whether a socket takes part in the lock. */
  drives(viewer: V): boolean
  say(socket: WebSocket, frame: LockFrame): void
  /** A socket held off just now: whatever the object was sending it stops. */
  parked?(socket: WebSocket): void
  /** The session changed hands. */
  handed?(session: string): void
}

export class SocketLock<V extends Holder> {
  /** Every change to a lock, one after another: two Take overs at once are two turns of
   *  this, and the second one's device holds the session. */
  private holding: Promise<unknown> = Promise.resolve()
  /** When each socket last said anything, and the timers that free a lock whose holder
   *  went once its grace is over. In memory: the runtime's own beat time is asked too. */
  private readonly heardAt = new WeakMap<WebSocket, number>()
  private readonly freeing = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly host: LockHost<V>) {}

  /** A socket said something. */
  heard(socket: WebSocket): void {
    this.heardAt.set(socket, Date.now())
  }

  /** `work` in the lock's queue, after every change before it. */
  inTurn<T>(work: () => Promise<T>): Promise<T> {
    const turn = this.holding.then(work)
    this.holding = turn.catch(() => undefined)
    return turn
  }

  /** Whether a socket of `device` other than `except` is on the session and holding it.
   *  One that went quiet is a device that crashed or lost its network without the socket
   *  closing, and is closed, so it never holds the session for ever. */
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

  /** A socket asking for its session, by opening it or with Take over: it holds it, and
   *  every other device's socket is told it no longer does; or it is told who does, and
   *  sent nothing until it takes it over. Answers whether it holds it. */
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

  /** The session is `hold`'s device's now: every socket of another device that drives it
   *  is told so, the one that had it as taken from it. */
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

  /** A socket held off the session, and told by whom. */
  private park(socket: WebSocket, viewer: V, hold: Hold, lost: boolean): void {
    socket.serializeAttachment({ ...viewer, parked: true, lost })
    this.host.parked?.(socket)
    this.host.say(socket, { t: 'held', by: hold.name, since: hold.since, taken: lost })
  }

  /** The tab closed: its device lets go of the session at once, and a device waiting
   *  for it has it. */
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

  /** The lock looked at again: its holder gone with `gone` (a socket closing), a timer
   *  for the end of its grace, or the object's own minute. Free once the grace is over,
   *  and then the device waiting for it that was heard from last has it. */
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

  /** The session ended: its lock goes with it. */
  drop(session: string): Promise<boolean> {
    return this.inTurn(() => this.host.ctx.storage.delete(holdKey(session)))
  }

  /** The device holding the session, if one does. */
  async holder(session: string): Promise<Hold | null> {
    return holdOf(await this.host.ctx.storage.get(holdKey(session)))
  }

  /** A free session to the socket waiting for it that was heard from last, never
   *  `except`, which is leaving. In the lock's turn already. */
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

  /** The lock looked at again once a holder that went has had its grace. */
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
