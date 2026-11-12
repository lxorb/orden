export interface Attached {
  device: string
  who: string
  session: string
  guest: boolean
  active: boolean
  hello: boolean
}

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

export interface Runtime {
  getWebSockets(tag?: string): WebSocket[]
}

function socketsOf(runtime: Runtime, device: string, except?: WebSocket): WebSocket[] {
  return runtime
    .getWebSockets(device)
    .filter((one) => one !== except && one.readyState === OPEN && attachedTo(one) !== null)
}

export function socketOf(runtime: Runtime, device: string, except?: WebSocket): WebSocket | null {
  return socketsOf(runtime, device, except).at(-1) ?? null
}

export function everySocket(
  runtime: Runtime,
  except?: WebSocket,
): { socket: WebSocket; attached: Attached }[] {
  return runtime.getWebSockets().flatMap((socket) => {
    const attached = attachedTo(socket)
    return socket !== except && socket.readyState === OPEN && attached ? [{ socket, attached }] : []
  })
}
