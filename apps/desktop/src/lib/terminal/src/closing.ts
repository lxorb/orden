import { termOf } from '@orden/online/term'
import { isOnlineTab } from '../../online-terms/src/api'
import { invoke } from '../../platform/src/api'
import type { Tab } from '../../workspace.svelte'
import { isUnsaved } from '../../workspace/drafts'
import { ptyOf } from './running'

export async function mayEnd(
  closing: readonly Tab[],
  every: readonly Tab[] = closing,
): Promise<boolean> {
  if (!(await mayStop(closing))) return false
  if (__EVEN_PLUGIN__) return true

  const loose = unkeptOnline(closing, every)
  const [one] = loose
  if (!one) return true

  const { prompt } = await import('../../ui-kit/src/api')
  const answer = await prompt.choose({
    title: loose.length === 1 ? `End ${one.shown}?` : 'End these online terminals?',
    detail: `Saved nowhere, a session kept running is found again in Settings, Online terminal.`,
    options: [
      { id: 'cancel', label: 'Cancel' },
      { id: 'end', label: 'End', danger: true },
      { id: 'keep', label: 'Keep running', primary: true },
    ],
  })
  if (answer !== 'keep' && answer !== 'end') return false
  if (answer === 'end') void endSessions(loose)
  return true
}

function unkeptOnline(closing: readonly Tab[], every: readonly Tab[]): Tab[] {
  const going = new Set(closing.map((one) => one.id))
  return closing.filter(
    (tab) =>
      isOnlineTab(tab) &&
      isUnsaved(tab.note) &&
      !every.some((other) => !going.has(other.id) && other.note === tab.note),
  )
}

async function endSessions(tabs: readonly Tab[]): Promise<void> {
  const { endSession } = await import('./online/calls')
  const sessions = tabs.flatMap((tab) => termOf(tab.doc)?.session ?? [])
  await Promise.all(sessions.map((one) => endSession(one).catch(() => undefined)))
}

async function mayStop(closing: readonly Tab[]): Promise<boolean> {
  const shells = closing.filter((tab) => tab.kind === 'terminal')
  const busy = await Promise.all(
    shells.map(async (tab) => {
      const id = ptyOf(tab.id)
      if (id === undefined) return null
      const running = await invoke<boolean>('pty_busy', { id }).catch(() => false)
      return running ? tab : null
    }),
  )

  const asking = busy.filter((tab): tab is Tab => tab !== null)
  const [only] = asking
  if (!only) return true

  const { prompt } = await import('../../ui-kit/src/api')
  return prompt.confirm({
    title:
      asking.length === 1
        ? `Stop what is running in ${only.shown}?`
        : 'Stop what is running in these terminals?',
    confirmLabel: 'Stop',
    danger: true,
  })
}
