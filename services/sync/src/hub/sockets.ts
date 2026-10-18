/** The hub's sockets, and what each one is known by across a sleep.
 *
 *  The hub hibernates, so nothing about a socket lives in a field: what the door
 *  decided about it and what its device has said since are kept on the socket
 *  itself, and the runtime hands them back after a sleep. Tagged with the device's
 *  id, so the hub can find a device's socket without walking all of them.
 *
 *  A device beats every ten seconds with the bare frame `beat`, which the runtime
 *  answers `ok` without waking the hub. Until #393 the hub read when it last did so,
 *  to tell whether a web login's holder was alive; nothing asks that any more. */

/** What a hub socket carries. `who` is the account (or the guest) the hub is, as
 *  the door read it off the session; `session` is that session's id, which a
 *  device is bound to. */
export interface Attached {
  device: string
  who: string
  session: string
  guest: boolean
  /** Whether somebody is using this device, as it last said. A device that has
   *  just connected is taken to be in use, because connecting is something a
   *  person did; one that is not says `idle` straight after `hello`. */
  active: boolean
  hello: boolean
}

/** WebSocket.OPEN, which the runtime's type does not name as a constant. */
const OPEN = 1

export function attachedTo(socket: WebSocket): Attached | null {
  const held: unknown = socket.deserializeAttachment()
  if (typeof held !== 'object' || held === null) return null

  const one = held as Partial<Attached>
  if (typeof one.device !== 'string' || typeof one.who !== 'string') return null

  return {
    device: one.device,
    who: one.who,
    session: typeof one.session === 'string' ? one.session : '',
    guest: one.guest === true,
    active: one.active !== false,
    hello: one.hello === true,
  }
}

export function attach(socket: WebSocket, attached: Attached): void {
  socket.serializeAttachment(attached)
}

/** The runtime's half of a hub, as much of it as finding a socket needs. */
export interface Runtime {
  getWebSockets(tag?: string): WebSocket[]
}

/** The open sockets of one device, newest last. `except` is a socket that is
 *  closing and must not count, which a close handler is still holding. */
function socketsOf(runtime: Runtime, device: string, except?: WebSocket): WebSocket[] {
  return runtime
    .getWebSockets(device)
    .filter((one) => one !== except && one.readyState === OPEN && attachedTo(one) !== null)
}

/** The device's socket, if it has one open. A device has one socket: a second one
 *  replaces the first at the door. */
export function socketOf(runtime: Runtime, device: string, except?: WebSocket): WebSocket | null {
  return socketsOf(runtime, device, except).at(-1) ?? null
}

/** Every open socket, with what it carries. */
export function everySocket(
  runtime: Runtime,
  except?: WebSocket,
): { socket: WebSocket; attached: Attached }[] {
  return runtime.getWebSockets().flatMap((socket) => {
    const attached = attachedTo(socket)
    return socket !== except && socket.readyState === OPEN && attached ? [{ socket, attached }] : []
  })
}
