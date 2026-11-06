import { termOf } from '@orden/online/term'
import { key, t } from '../i18n.svelte'
import { isOnlineTab } from '../online/path'
import { invoke } from '../tauri'
import type { Tab } from '../workspace.svelte'
import { isUnsaved } from '../workspace/drafts'
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

  const { prompt } = await import('../prompt.svelte')
  const answer = await prompt.choose({
    title:
      loose.length === 1 ? t('End {name}?', { name: one.shown }) : t('End these online terminals?'),
    detail: t('Saved nowhere, a session kept running is found again in Settings, {pane}.', {
      pane: t('Online terminal'),
    }),
    options: [
      { id: 'cancel', label: key('Cancel') },
      { id: 'end', label: key('End'), danger: true },
      { id: 'keep', label: key('Keep running'), primary: true },
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
  const { endSession } = await import('../online/calls')
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

  const { prompt } = await import('../prompt.svelte')
  return prompt.confirm({
    title:
      asking.length === 1
        ? t('Stop what is running in {name}?', { name: only.shown })
        : t('Stop what is running in these terminals?'),
    confirmLabel: key('Stop'),
    danger: true,
  })
}
