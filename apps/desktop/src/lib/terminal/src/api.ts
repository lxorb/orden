import './shell-parts'
import type * as Closing from './closing'
import type * as OnlineOpen from './online/open'
import type * as Previews from './previews'
import type * as RemoteOpen from './remote/open'
import type * as Rename from './rename'
import type * as Sessions from './sessions.svelte'
export { historyOf, moveHistory } from './history'
export { openTerminal, shellRows } from './open'
export { ptyOf, runningTabs, shellRunning } from './running'
export type { Session } from './sessions.svelte'
export { shellName, shells, SIZES } from './shells.svelte'
export { readSpec, writeSpec } from './spec'
export { bothName } from './two-ways'
export type { Listed, Refused } from './online/calls'
export { opens, rowOf } from './online/listing'
export { type Destination, destinationOf, type Host, hostFor, said } from './remote/hosts'

const refused = () => Promise.reject(new Error('no terminal in the Even Realities plugin'))

export const sessions = () => (__EVEN_PLUGIN__ ? refused() : import('./sessions.svelte'))

export const onlineCalls = () => (__EVEN_PLUGIN__ ? refused() : import('./online/calls'))

export const onlineMachine = () => (__EVEN_PLUGIN__ ? refused() : import('./online/machine.svelte'))

export const remoteHosts = () => (__EVEN_PLUGIN__ ? refused() : import('./remote/hosts.svelte'))

export const hostPicking = () => (__EVEN_PLUGIN__ ? refused() : import('./remote/picker.svelte'))

const closing = () => (__EVEN_PLUGIN__ ? refused() : import('./closing'))

const renaming = () => (__EVEN_PLUGIN__ ? refused() : import('./rename'))

const previews = () => (__EVEN_PLUGIN__ ? refused() : import('./previews'))

const onlineOpening = () => (__EVEN_PLUGIN__ ? refused() : import('./online/open'))

const remoteOpening = () => (__EVEN_PLUGIN__ ? refused() : import('./remote/open'))

export const usageOfTab = async (...args: Parameters<typeof Sessions.usageOfTab>) =>
  (await sessions()).usageOfTab(...args)

export const mayEnd = async (...args: Parameters<typeof Closing.mayEnd>) =>
  (await closing()).mayEnd(...args)

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

export const loadTerminalTab = () => (__EVEN_PLUGIN__ ? refused() : import('./TerminalTab.svelte'))

export const loadTerminalMark = () =>
  __EVEN_PLUGIN__ ? refused() : import('./TerminalMark.svelte')

export const loadHostPicker = () =>
  __EVEN_PLUGIN__ ? refused() : import('./remote/HostPicker.svelte')

export const loadOnlinePane = () =>
  __EVEN_PLUGIN__ ? refused() : import('./online/OnlinePane.svelte')

export const loadRemotePane = () =>
  __EVEN_PLUGIN__ ? refused() : import('./remote/RemotePane.svelte')
