import { identifier, invoke, isNumber, isRecord, isString } from '../../../platform/src/api'
import { workspace } from '../../../workspace/src/api'
import type { Tab } from '../../../documents/src/api'
import { hostIdOf, readSpec, writeSpec } from '../spec'

export interface HeldRow {
  key: string
  shell: string
  name: string | null
  folder: string | null
  host: string | null
  program: string | null
  last: number
  open: boolean
  watched: boolean
  ended: boolean
}

interface TmuxRow {
  name: string
  attached: boolean
  last: number
  program: string | null
  folder: string | null
}

const IDLE_FOR = 7 * 24 * 60 * 60 * 1000
const text = (value: unknown): string | null => (isString(value) && value ? value : null)

function heldOf(value: unknown): HeldRow | null {
  if (!isRecord(value) || !isString(value.key) || !isRecord(value.label)) return null
  const shell = text(value.label.shell)
  if (shell === null) return null
  return {
    key: value.key,
    shell,
    name: text(value.label.name),
    folder: text(value.label.folder),
    host: hostIdOf(shell),
    program: text(value.program),
    last: isNumber(value.last) ? value.last : 0,
    open: value.open === true,
    watched: isNumber(value.clients) && value.clients > 0,
    ended: isNumber(value.exit),
  }
}

function tmuxOf(value: unknown): TmuxRow | null {
  if (!isRecord(value) || !isString(value.name) || !value.name) return null
  return {
    name: value.name,
    attached: value.attached === true,
    last: isNumber(value.last) ? value.last : 0,
    program: text(value.program),
    folder: text(value.folder),
  }
}

function listOf<T>(value: unknown, of: (one: unknown) => T | null): T[] {
  return Array.isArray(value) ? value.flatMap((one) => of(one) ?? []) : []
}

function tabOf(key: string): Tab | undefined {
  return workspace.tabs.find((tab) => tab.kind === 'terminal' && readSpec(tab.doc)?.key === key)
}

class HeldSessions {
  list = $state.raw<HeldRow[]>([])
  tmux = $state.raw<TmuxRow[]>([])

  async refresh(): Promise<void> {
    const [held, tmux] = await Promise.all([
      invoke<unknown>('terminal_sessions').catch(() => []),
      invoke<unknown>('terminal_tmux').catch(() => []),
    ])
    this.list = listOf(held, heldOf).sort((a, b) => b.last - a.last)
    this.tmux = listOf(tmux, tmuxOf).sort((a, b) => b.last - a.last)
  }

  open(row: HeldRow, activate = true): string {
    const here = tabOf(row.key)
    if (here) {
      if (activate) workspace.activeTabId = here.id
      return here.id
    }
    const spec = { shell: row.shell, folder: row.folder, key: row.key, name: row.name }
    const name = row.name ?? 'Terminal'
    return workspace.openUnsaved('terminal', writeSpec(spec), name, null, activate).id
  }

  adopt(row: TmuxRow): string {
    const spec = {
      shell: `tmux:${row.name}`,
      folder: row.folder,
      key: identifier(),
      name: row.name,
    }
    return workspace.openUnsaved('terminal', writeSpec(spec), row.name).id
  }

  async rename(row: HeldRow, typed: string): Promise<void> {
    const here = tabOf(row.key)
    if (here) {
      const { renameTerminal } = await import('../rename')
      await renameTerminal(here, typed)
    } else {
      await invoke('pty_name', { key: row.key, name: typed.trim() }).catch(() => undefined)
    }
    await this.refresh()
  }

  idle(now = Date.now()): HeldRow[] {
    return this.list.filter((row) => !row.open && !row.watched && now - row.last > IDLE_FOR)
  }

  async endIdle(): Promise<void> {
    const idle = this.idle()
    for (const row of idle) await invoke('pty_end', { key: row.key }).catch(() => undefined)
    if (idle.length) await this.refresh()
  }

  async end(row: HeldRow): Promise<void> {
    this.list = this.list.filter((one) => one.key !== row.key)
    const here = tabOf(row.key)
    if (here) workspace.close(here.id, false)
    else await invoke('pty_end', { key: row.key }).catch(() => undefined)
    await this.refresh()
  }
}

export const held = new HeldSessions()
