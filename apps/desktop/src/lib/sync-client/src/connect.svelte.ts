import { startHere } from '../../people/here'
import { hub } from './hub.svelte'

let connected = false

export function connect(): void {
  if (connected) return
  connected = true
  hub.start()
  startHere()
}
