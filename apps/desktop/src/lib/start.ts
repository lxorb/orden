/** What the app does on the way up, and what it has to do before it goes down.
 *
 *  Every store restores itself; the order here is the one they depend on. It
 *  lives outside the root component because none of it is about markup, and
 *  because a launch that has to be read in order should be readable in one
 *  place. */

import { account } from './account.svelte'
import { i18n, t } from './i18n.svelte'
import { collectErrors } from './log'
import { modes } from './modes.svelte'
import { prompt } from './prompt.svelte'
import { recovery } from './recovery.svelte'
import { settings } from './settings.svelte'
import { shortcuts } from './shortcuts.svelte'
import { currentWindow, invoke, isDesktop } from './tauri'
import { theme } from './theme.svelte'
import { trash } from './trash.svelte'
import { installStaged, ready } from './updater'
import { updates } from './updates.svelte'
import { viewport } from './viewport.svelte'
import { workspace } from './workspace.svelte'

const DAY = 24 * 60 * 60 * 1000

/** Brings everything up. Answers the teardown for what it started, so the root
 *  component can hand it to `onDestroy`. */
export function start(): () => void {
  collectErrors()
  viewport.start()
  i18n.restore()
  theme.init()
  modes.restore()
  shortcuts.restore()
  settings.restore()
  recovery.restore()

  void workspace
    .restore()
    .then(openLaunchFiles)
    // Nothing else can put this right, and the strip is already showing
    // whatever did come back; the log is where a launch failure belongs.
    .catch(() => undefined)

  // Recently deleted on this device is swept at start and once a day after;
  // the account's is swept on the server.
  void trash.sweep()
  const sweeper = setInterval(() => void trash.sweep(), DAY)

  // The versions kept for recovery: one timer for the app that keeps whatever
  // is being written in, and a sweep on the same daily rhythm as the trash.
  const stopRecovery = recovery.start()

  void guardClose()
  void updates.check()
  void account.restore()

  return () => {
    clearInterval(sweeper)
    stopRecovery()
  }
}

/** Files named on the command line, and any handed over by a second launch. */
async function openLaunchFiles() {
  if (!isDesktop) return

  for (const path of await invoke<string[]>('take_startup_files').catch(() => [])) {
    await workspace.open(path)
  }

  const { listen } = await import('@tauri-apps/api/event')
  await listen<string[]>('nib://open-files', (event) => void openAll(event.payload))
}

async function openAll(paths: string[]) {
  for (const path of paths) await workspace.open(path)
}

/** Nothing with words in it is lost on the way out: closing asks first. */
async function guardClose() {
  const window = await currentWindow()
  // The handler answers at once and the questions happen after: preventing the
  // close is the only part that has to be synchronous.
  await window.onCloseRequested((event) => void onClose(event, window))
}

interface Closing {
  preventDefault(): void
}

interface Closable {
  destroy(): Promise<void>
}

async function onClose(event: Closing, window: Closable) {
  // A tab gets no chance to ask its own question - `beforeunload` runs to
  // completion before anything is painted. Preventing it is the whole
  // signal, and the browser puts up its own leave-page dialog.
  if (!isDesktop) {
    if (workspace.unsaved.length) event.preventDefault()
    return
  }

  // Nothing to ask about, but there may still be an update to put in place.
  if (!workspace.unsaved.length) {
    if (!ready()) return

    event.preventDefault()
    await installStaged()
    await window.destroy()
    return
  }

  event.preventDefault()

  const answer = await prompt.choose({
    title: t('Save your changes?'),
    detail: t('{count} of your notes have unsaved changes.', {
      count: workspace.unsaved.length,
    }),
    options: [
      { id: 'save', label: t('Save'), primary: true },
      { id: 'discard', label: t('Discard'), danger: true },
      { id: 'cancel', label: t('Cancel') },
    ],
  })

  if (answer === 'save') await workspace.saveAll()
  else if (answer !== 'discard') return

  // Everything is either written or deliberately given up on.
  await installStaged()
  await window.destroy()
}
