import { err, failure, ok, type Result } from './result'
import type { ChatPorts } from './chats'
import type { PreviewPorts } from './previews'
import type { QuittingPorts } from './quitting'
import type { SharingPorts } from './sharing'
import type { SyncPorts } from './sync-client'
import type { ThemePorts } from './theme'
import type { VoicePorts } from './voice'
import { NO_WEB_PAGES, type WebPagesPort, type WebPorts } from './web'

export type PortMap = ChatPorts &
  PreviewPorts &
  QuittingPorts &
  SharingPorts &
  SyncPorts &
  ThemePorts &
  VoicePorts &
  WebPorts

export type PortName = keyof PortMap

const provided = new Map<PortName, unknown>()

const waiting = new Map<PortName, ((port: unknown) => void)[]>()

export function providePort<Name extends PortName>(name: Name, port: PortMap[Name]): () => void {
  provided.set(name, port)
  const uses = waiting.get(name) ?? []
  waiting.delete(name)
  for (const use of uses) use(port)
  return () => {
    if (provided.get(name) === port) provided.delete(name)
  }
}

export function portOf<Name extends PortName>(name: Name): Result<PortMap[Name]> {
  const port = provided.get(name) as PortMap[Name] | undefined
  if (port === undefined) {
    return err(failure('contracts', 'missing', `no module has provided the port '${name}' yet`))
  }
  return ok(port)
}

export function portProvided(name: PortName): boolean {
  return provided.has(name)
}

export function whenPortProvided<Name extends PortName>(
  name: Name,
  use: (port: PortMap[Name]) => void,
): void {
  const port = provided.get(name) as PortMap[Name] | undefined
  if (port !== undefined) {
    use(port)
    return
  }
  const uses = waiting.get(name) ?? []
  uses.push(use as (port: unknown) => void)
  waiting.set(name, uses)
}

export function webPages(): WebPagesPort {
  return (provided.get('web.pages') as WebPagesPort | undefined) ?? NO_WEB_PAGES
}
