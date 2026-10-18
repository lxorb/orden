/** What sync v2 starts once the first paint is on screen: the socket to the account's
 *  hub, for anybody signed in, and whether somebody is at this device.
 *
 *  Nothing of this is in front of the first paint (docs/sync-v2.md 9.3): start.ts
 *  fetches it at the launch's `rooms` turn, beside the sockets the open notes join.
 *
 *  Web logins once travelled from here too, where the account said so. They were taken
 *  out (#393): Google binds its sessions to the device they were made on, so a login
 *  carried to another computer stopped working there within minutes. */

import { startHere } from '../people/here'
import { hub } from './hub.svelte'

let connected = false

/** Starts the hub and whether somebody is at this device (people/here.ts). Once. */
export function connect(): void {
  if (connected) return
  connected = true
  hub.start()
  startHere()
}
