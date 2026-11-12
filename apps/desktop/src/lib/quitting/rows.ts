import { invoke } from '../tauri'
import { ptyOf, runningTabs } from '../terminal/running'
import type { Warning } from '../terminal/shells.svelte'
import { type Tab, workspace } from '../workspace.svelte'

export type Why = 'quit' | 'window' | 'restart'

export interface Row {
  window: string
  kind: 'terminal' | 'thread'
  id: string
  name: string
  busy: boolean
  doc?: string
  running?: Tab['running']
}

export function asks(warning: Warning, rows: readonly Row[]): boolean {
  if (warning === 'never') return false
  return warning === 'always' ? rows.length > 0 : rows.some((row) => row.busy)
}

export async function rowsHere(window: string, idle: boolean): Promise<Row[]> {
  const [terminals, threads] = await Promise.all([terminalRows(window, idle), threadRows(window)])
  return [...terminals, ...threads]
}

async function terminalRows(window: string, idle: boolean): Promise<Row[]> {
  const live = new Set(runningTabs())
  const tabs = workspace.tabs.filter((tab) => tab.kind === 'terminal' && live.has(tab.id))

  const rows = await Promise.all(
    tabs.map(async (tab): Promise<Row | null> => {
      const id = ptyOf(tab.id)
      if (id === undefined) return null
      const busy = await invoke<boolean>('pty_busy', { id }).catch(() => false)
      if (!busy && !idle) return null
      return {
        window,
        kind: 'terminal',
        id: tab.id,
        name: tab.shown,
        busy,
        doc: tab.doc,
        running: tab.running ? { ...tab.running } : null,
      }
    }),
  )
  return rows.filter((row) => row !== null)
}

async function threadRows(window: string): Promise<Row[]> {
  const { answering } = await import('../ai/chat/sends')
  const threads = answering()
  if (!threads.length) return []

  const { ai } = await import('../ai/store.svelte')
  return threads.map((thread) => {
    const kind = ai.provider(thread.provider)?.kind
    const program = kind === 'claude-code' ? 'claude' : kind === 'codex' ? 'codex' : null
    return {
      window,
      kind: 'thread',
      id: thread.id,
      name: thread.title || 'Untitled',
      busy: true,
      ...(program ? { doc: '', running: { name: null, program, host: null, colour: null } } : {}),
    }
  })
}
