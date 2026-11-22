import './shell-parts'
import { openTerminal } from './open'
import type * as Closing from './closing'
import type * as OnlineOpen from './online/open'
import type * as Previews from './previews'
import type * as RemoteOpen from './remote/open'
import type * as Rename from './rename'
import type * as Sessions from './sessions.svelte'
export { historyOf, moveHistory } from './history'
export { setTerminalIcon } from './icon'
export { openTerminal }
export { shellRows } from './open'
export { ptyOf, runningTabs, shellRunning } from './running'
export type { Session } from './sessions.svelte'
export { shells } from './shells.svelte'
export { readSpec, writeSpec } from './spec'
export type { Listed, Refused } from './online/calls'
export { opens, rowOf } from './online/listing'
export { type Destination, destinationOf, type Host, hostFor, said } from './remote/hosts'
export const programJudge = () => import('./agent/free')
export const sessions = () => import('./sessions.svelte')
const onlineMachine = () => import('./online/machine.svelte')
export const hostPicking = () => import('./remote/picker.svelte')
const closing = () => import('./closing')
const renaming = () => import('./rename')
const previews = () => import('./previews')
const onlineOpening = () => import('./online/open')
const remoteOpening = () => import('./remote/open')
export const usageOfTab = async (...args: Parameters<typeof Sessions.usageOfTab>) =>
  (await sessions()).usageOfTab(...args)
export const mayEnd = async (...args: Parameters<typeof Closing.mayEnd>) => (await closing()).mayEnd(...args)
export const renameTerminal = async (...args: Parameters<typeof Rename.renameTerminal>) =>
  (await renaming()).renameTerminal(...args)
export const scrollbackOf = async (...args: Parameters<typeof Previews.scrollbackOf>) =>
  (await previews()).scrollbackOf(...args)
export const openOnline = async (...args: Parameters<typeof OnlineOpen.openOnline>) =>
  (await onlineOpening()).openOnline(...args)
export const madeOnline = async (...args: Parameters<typeof OnlineOpen.madeOnline>) =>
  (await onlineOpening()).madeOnline(...args)
export const openTerm = async (...args: Parameters<typeof OnlineOpen.openTerm>) =>
  (await onlineOpening()).openTerm(...args)
export const openRemote = async (...args: Parameters<typeof RemoteOpen.openRemote>) =>
  (await remoteOpening()).openRemote(...args)
export const openAll = async (...args: Parameters<typeof RemoteOpen.openAll>) =>
  (await remoteOpening()).openAll(...args)
export const connectTo = async (...args: Parameters<typeof RemoteOpen.connectTo>) =>
  (await remoteOpening()).connectTo(...args)
export const terminalGoing = () => import('./sessions.svelte').then((one) => one.goTo)
export const terminalAgent = () => import('./agent/verbs')
export const terminalTabKind = () => import('./tab-kind').then((one) => one.terminalTabKind)
export const loadTerminalTab = () => import('./TerminalTab.svelte')
export const loadTerminalMark = () => import('./TerminalMark.svelte')
export const loadHostPicker = () => import('./remote/HostPicker.svelte')
async function pickHost() {
  const { hostPicker } = await hostPicking()
  hostPicker.toggle()
}
async function machineTo(on: boolean) {
  const { machine } = await onlineMachine()
  await machine.startStop(on)
}
export const terminalCommands = {
  'terminal.new': () => void openTerminal(),
  'terminal.turn': () => void import('./turn').then((one) => one.turnActive()),
  'terminal.remote': () => void pickHost(),
  'terminal.online': () => void openOnline(),
  'terminal.machine-start': () => void machineTo(true),
  'terminal.machine-stop': () => void machineTo(false),
}
