import { needPort, portOf } from '@orden/contracts'

const host = () => needPort('sync.host')
const storage = () => needPort('sync.storage')
export const account = () => needPort('sync.account')
export const remote = () => needPort('sync.api')
export const isDesktop = () => host().isDesktop
export const platform = () => host().platform()
export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return host().invoke<T>(command, args)
}
export const storedText = (key: string) => storage().text(key)
export const keepText = (key: string, value: string) => storage().keepText(key, value)
export const forget = (key: string) => storage().forget(key)
export function engine() {
  const port = portOf('hub.device')
  return port.ok ? port.value : null
}
