/** The question before a terminal tab closes on something running.
 *
 *  VS Code's rule, and iTerm2's: a shell waiting at its prompt closes without a word, and
 *  one running anything else - a build, a server, an editor - asks first, once, however
 *  many of the tabs going are busy. What counts as running is the crate's answer; see
 *  src-tauri/src/terminal/process.rs.
 *
 *  The window closing and the app quitting ask one question for all of them instead; see
 *  lib/quitting. Settings' Warn before quitting is that question's, and this one asks
 *  whatever it says: closing a tab is always one tab's program stopped on purpose or by
 *  a slip, which VS Code's `confirmOnKill` asks about by default too.
 *
 *  And an online terminal saved nowhere (#1110): its session runs on the account's
 *  machine whatever happens to its tab, and with no file in the sidebar to open it from
 *  again, a tab closed is a session nobody can find but in Settings. So closing one asks
 *  whether to end its session or keep it running - once for every such tab a gesture
 *  closes - and Cancel keeps the tabs. One saved in the sidebar closes without a word:
 *  its file opens it again (#1055). Every close somebody asks for comes here: the cross,
 *  a middle click, Ctrl+W, Close others, a pane or a space closed, the tab overview's
 *  cross (`mayClose` in workspace.svelte.ts). The window closing asks nothing of them,
 *  since the next launch puts their tabs back on their sessions (workspace/session.ts). */

import { termOf } from '@orden/online/term'
import { key, t } from '../i18n.svelte'
import { isOnlineTab } from '../online/path'
import { invoke } from '../tauri'
import type { Tab } from '../workspace.svelte'
import { isUnsaved } from '../workspace/drafts'
import { ptyOf } from './running'

/** Whether the terminals among `closing` may go: what runs in them asked about, then the
 *  sessions of the online ones saved nowhere, ended or kept as the answer says. `every`
 *  is every tab there is, so an online terminal still open in a tab that stays is not
 *  asked about. */
export async function mayEnd(
  closing: readonly Tab[],
  every: readonly Tab[] = closing,
): Promise<boolean> {
  if (!(await mayStop(closing))) return false
  // The glasses' plugin has no online terminal; see `isOnlineTab`.
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

/** The online terminals among `closing` that are saved nowhere - no file, nobody's share
 *  - and held by no tab that stays. */
function unkeptOnline(closing: readonly Tab[], every: readonly Tab[]): Tab[] {
  const going = new Set(closing.map((one) => one.id))
  return closing.filter(
    (tab) =>
      isOnlineTab(tab) &&
      isUnsaved(tab.note) &&
      !every.some((other) => !going.has(other.id) && other.note === tab.note),
  )
}

/** Their sessions ended on the machine, as Settings' End ends one. */
async function endSessions(tabs: readonly Tab[]): Promise<void> {
  const { endSession } = await import('../online/calls')
  const sessions = tabs.flatMap((tab) => termOf(tab.doc)?.session ?? [])
  await Promise.all(sessions.map((one) => endSession(one).catch(() => undefined)))
}

/** Whether what runs in the local terminals among `closing` may stop. */
async function mayStop(closing: readonly Tab[]): Promise<boolean> {
  // Another machine's terminal counts as busy while it is connected, as macOS Terminal
  // and iTerm2 count an `ssh`: what runs there cannot be seen from here, and closing it
  // ends it. The crate says so; see `Held::busy` in src-tauri/src/terminal.rs.
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
