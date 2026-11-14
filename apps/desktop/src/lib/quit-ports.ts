import { providePort, type Stopping } from '@orden/contracts'
import { invoke } from './platform/src/api'
import { ptyOf, runningTabs } from './terminal/src/api'
import { workspace } from './workspace.svelte'

providePort('quit.terminal', {
  rows: async (window, idle) => {
    const live = new Set(runningTabs())
    const tabs = workspace.tabs.filter((tab) => tab.kind === 'terminal' && live.has(tab.id))

    const rows = await Promise.all(
      tabs.map(async (tab): Promise<Stopping | null> => {
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
  },
  show: (row) => {
    workspace.activeTabId = row.id
    return Promise.resolve()
  },
})

providePort('quit.thread', {
  rows: async (window) => {
    const { answering } = await import('./ai/chat/sends')
    const threads = answering()
    if (!threads.length) return []

    const { ai } = await import('./ai/store.svelte')
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
  },
  show: async (row) => {
    workspace.showPanel('ask')
    const { chat } = await import('./ai/sidebar/chat.svelte')
    await chat.openThread(row.id)
  },
})

export { answerQuitting, mayStop, quitAsked } from './quitting/src/api'
