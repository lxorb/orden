import { err, failure, ok, type Result } from './result'
import type { AgentPorts } from './agents'
import type { AccountPorts } from './user'
import type { BackendPorts } from './backend'
import type { ChatPorts } from './chats'
import type { FilePorts } from './files'
import type { ImportPorts } from './import'
import type { PreviewPorts } from './previews'
import type { QuittingPorts, StopAskingPort, StopReason } from './quitting'
import type { SettingsPorts, SettingsWindowPort } from './settings'
import type { SharingPorts } from './sharing'
import type {
  QuickAddPort,
  QuickAddPrefill,
  SearchPort,
  ShellFocusPort,
  SheetId,
  SheetsPort,
  SurfacePorts,
} from './surfaces'
import type { SyncStorePort, SyncPorts } from './sync-client'
import type { TerminalPorts } from './terminal'
import type { ThemePorts } from './theme'
import type { VoicePorts } from './voice'
import { NO_WEB_PAGES, type WebPagesPort, type WebPorts } from './web'
import {
  NO_WORKSPACE_NOTES,
  NO_WORKSPACE_VIEW,
  type WorkspaceNotesPort,
  type WorkspacePorts,
  type WorkspaceViewPort,
} from './workspace'

export type PortMap = AccountPorts &
  AgentPorts &
  BackendPorts &
  ChatPorts &
  FilePorts &
  ImportPorts &
  PreviewPorts &
  QuittingPorts &
  SettingsPorts &
  SharingPorts &
  SurfacePorts &
  SyncPorts &
  TerminalPorts &
  ThemePorts &
  VoicePorts &
  WebPorts &
  WorkspacePorts

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

export function needPort<Name extends PortName>(name: Name): PortMap[Name] {
  const found = portOf(name)
  if (!found.ok) throw new Error(found.error.message)
  return found.value
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

const heldEdits = new Set<() => void>()

export function holdEdits(flush: () => void): () => void {
  const held = () => flush()
  heldEdits.add(held)
  return () => {
    heldEdits.delete(held)
  }
}

export function flushHeldEdits(): void {
  for (const flush of [...heldEdits]) flush()
}

export function mayStop(why: StopReason): Promise<boolean> {
  const port = provided.get('quit.ask') as StopAskingPort | undefined
  return port ? port.mayStop(why) : Promise.resolve(true)
}

export function syncStore(): SyncStorePort | null {
  return (provided.get('sync.store') as SyncStorePort | undefined) ?? null
}

export function searching(): SearchPort | null {
  return (provided.get('search') as SearchPort | undefined) ?? null
}

export function webPages(): WebPagesPort {
  return (provided.get('web.pages') as WebPagesPort | undefined) ?? NO_WEB_PAGES
}

export function workspaceNotes(): WorkspaceNotesPort {
  return (provided.get('workspace.notes') as WorkspaceNotesPort | undefined) ?? NO_WORKSPACE_NOTES
}

export function workspaceView(): WorkspaceViewPort {
  return (provided.get('workspace.view') as WorkspaceViewPort | undefined) ?? NO_WORKSPACE_VIEW
}

export function settingsWindow(): SettingsWindowPort {
  return (
    (provided.get('settings.window') as SettingsWindowPort | undefined) ?? {
      open: false,
      error: null,
      at: null,
      historyOpen: false,
      show: () => undefined,
    }
  )
}

export function askSheet(id: SheetId): Promise<void> {
  const port = provided.get('shell.sheets') as SheetsPort | undefined
  return port ? port.ask(id) : Promise.resolve()
}

export function showQuickAdd(prefill?: QuickAddPrefill): void {
  ;(provided.get('quick-add.show') as QuickAddPort | undefined)?.show(prefill)
}

export function focusEditorRegion(): boolean {
  return (provided.get('shell.focus') as ShellFocusPort | undefined)?.editor() ?? false
}
