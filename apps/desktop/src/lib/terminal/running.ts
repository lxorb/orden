/** Which shell each terminal tab is running right now, by the tab's id.
 *
 *  A registry of its own, and nothing else, so the question asked before a tab closes
 *  (closing.ts) can find a tab's shell without fetching xterm.js to do it: a terminal
 *  restored after a restart and never looked at has no shell yet, and closing it
 *  should cost nothing. The sessions write it; see sessions.svelte.ts. The question before
 *  the app quits reads it too, so a window with no shell running asks nothing and fetches
 *  nothing; see lib/quitting. */

import { runs } from '../parting'

const running = new Map<string, string>()
runs(() => running.size > 0)

/** The session a tab's shell runs under, or undefined for a tab running none. */
export function ptyOf(tabId: string): string | undefined {
  return running.get(tabId)
}

/** The tabs whose shell is running, by id. */
export function runningTabs(): string[] {
  return [...running.keys()]
}

export function setPty(tabId: string, pty: string | null): void {
  if (pty === null) running.delete(tabId)
  else running.set(tabId, pty)
}

/** The online terminals whose session is on screen as it is now, by the tab's id: a
 *  registry apart from the shells', since an online session is never this window's to
 *  end and nothing asks before it goes. */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a registry; nothing renders from it
const live = new Set<string>()

export function setLive(tabId: string, on: boolean): void {
  if (on) live.add(tabId)
  else live.delete(tabId)
}

/** Whether a terminal tab has a shell to read and type into now: its own shell, or an
 *  online terminal's session, live. What every agent's tool asks (#1125), so a terminal
 *  is one thing to them wherever its shell runs. */
export function shellRunning(tabId: string): boolean {
  return running.has(tabId) || live.has(tabId)
}
