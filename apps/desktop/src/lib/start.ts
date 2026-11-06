import { agentMarks, listenForAgents } from './agent-marks.svelte'
import { account } from './account.svelte'
import { busy } from './busy.svelte'
import { installAiRunner } from './ai/ask'
import { guardDrops } from './drops'
import { i18n } from './i18n.svelte'
import { joining } from './joining.svelte'
import { collectErrors, log } from './log'
import { onTheActivity } from './mobile/bridge'
import { modes } from './modes.svelte'
import {
  anythingRuns,
  GIVE_UP,
  settleUp,
  stillWriting,
  trayKeeper,
  writeOwed,
  written,
} from './parting'
import { warmDoors } from './surfaces.svelte'
import type { Across } from './workspace/across'
import { recovery } from './recovery.svelte'
import { reloading } from './reloading.svelte'
import { record } from './sync/record.svelte'
import { hiddenKinds, settings } from './settings.svelte'
import { startup } from './startup.svelte'
import { shortcuts } from './shortcuts.svelte'
import { currentWindow, internal, isDesktop, isMobile, platform } from './tauri'
import { waited } from './timing'
import { factsOfLaunch, mark } from './trace'
import { theme } from './theme.svelte'
import { pull } from './pull.svelte'
import { toolbar } from './toolbar.svelte'
import { trash } from './trash.svelte'
import { installStaged, ready, settledForInstaller } from './updater'
import { updates } from './updates.svelte'
import { viewport } from './viewport.svelte'
import { workspace } from './workspace.svelte'

const DAY = 24 * 60 * 60 * 1000

export function start(): () => void {
  mark('start')
  collectErrors()
  void startup.turn('doors').then(async () => (await import('./stalls')).watchStalls())
  if (!__EVEN_PLUGIN__) {
    void startup
      .turn('doors')
      .then(async () => (await import('./themes/store.svelte')).store.keepUp())
      .catch((error: unknown) => log('warn', `themes: ${String(error)}`))
  }
  factsOfLaunch(() => `${workspace.spaces.length} spaces, ${workspace.tabs.length} tabs`)
  viewport.start()
  i18n.restore()
  theme.init()
  modes.restore()
  shortcuts.restore()
  toolbar.restore()
  pull.restore()
  hiddenKinds.restore()
  settings.restore()
  if (isDesktop && !__EVEN_PLUGIN__) {
    void import('./settings/file').then((file) => file.declare(() => settings.show('general')))
  }
  const settling = setTimeout(() => {
    startup.settled = true
    if (!__EVEN_PLUGIN__) void import('./hints.svelte').then(({ hints }) => hints.settle())
  }, 20_000)
  installAiRunner()
  recovery.restore()
  record.restore()
  account.forgetWithSession(() => record.forgetEverything())

  mark('stores restored')

  if (theme.offerContrast) settings.show('appearance')

  let stopAutomation: (() => void) | null = null

  let stopHanded: (() => void) | null = null

  let stopAgents: (() => void) | null = null

  void workspace
    .restore()
    .then(async () => {
      mark('space restored')
      if (!__EVEN_PLUGIN__) {
        const { startAutomation } = await import('./automation/start')
        stopAutomation = await startAutomation()
        stopAgents = await listenForAgents()
      }
      if (onTheActivity()) {
        const { startHanded } = await import('./mobile/handed')
        stopHanded = startHanded()
      }
    })
    .catch((error: unknown) => {
      log('error', `restore: ${error instanceof Error ? error.message : String(error)}`)
    })

  void trash.sweep()
  const sweeper = setInterval(() => void trash.sweep(), DAY)

  const stopRecovery = recovery.start()

  const stopStrayDrops = guardDrops()

  void guardClose()

  const stopReloading = reloading.watch(async () => {
    settle()
    await workspace.writesSettled()
    return !workspace.writing && !busy.active
  })

  const stopLooking = updates.start()

  void account.restore().then(() => joining.start())

  void warmDoors().catch(() => {
    // Answered by reloading.svelte.ts.
  })

  if (!__EVEN_PLUGIN__) void startup.turn('right').then(() => import('./rows/rows.svelte'))

  if (!__EVEN_PLUGIN__) {
    void startup.turn('right').then(() => import('./reminders/start.svelte'))
  }

  if (!__EVEN_PLUGIN__) void startup.turn('right').then(() => import('./chats/start.svelte'))

  if (!__EVEN_PLUGIN__) {
    void startup.turn('right').then(() => import('./workspace/blank-tabs.svelte'))
  }

  if (!__EVEN_PLUGIN__) void startup.turn('right').then(() => import('./overview/faces.svelte'))

  if (!__EVEN_PLUGIN__) {
    void startup.turn('rooms').then(() =>
      import('./sync2/connect.svelte').then(({ connect }) => {
        connect()
      }),
    )
  }

  if (!__EVEN_PLUGIN__ && isDesktop) {
    void startup
      .turn('right')
      .then(() => import('./internal/convert'))
      .then(({ convertAll }) => convertAll(workspace))
      .then(() => import('./internal/work'))
      .then(({ keepWorking }) => keepWorking())
      .then(() => (platform() === 'macos' ? import('./quick-add/shortcuts') : null))
      .then((one) => one?.hearShortcuts())
      .catch((error: unknown) => log('warn', `after the spaces moved in: ${String(error)}`))
  }

  if (!__EVEN_PLUGIN__ && isDesktop) {
    void startup.turn('rooms').then(() => import('./web-tab/one-window.svelte'))
  }

  if (!__EVEN_PLUGIN__) {
    let fetched: Promise<Across> | null = null
    const across = () =>
      (fetched ??= import('./workspace/across').then(({ startAcross }) => startAcross()))
    workspace.acrossWhenWriting(across)
    void startup.turn('rooms').then(across)
  }

  if (!__EVEN_PLUGIN__ && isDesktop) {
    void startup
      .turn('rooms')
      .then(() => import('./workspace/outside.svelte').then(({ hearOutside }) => hearOutside()))
  }

  let stopAnywhere: (() => void) | null = null
  if (!__EVEN_PLUGIN__ && isDesktop) {
    void startup
      .turn('right')
      .then(() => import('./quick-add/anywhere.svelte'))
      .then((one) => (stopAnywhere = one.listen()))
  }

  let stopOutsideDrops: (() => void) | null = null
  if (!__EVEN_PLUGIN__ && isDesktop) {
    void import('./outside-drops')
      .then(({ hearOutsideDrops }) => hearOutsideDrops())
      .then((stop) => (stopOutsideDrops = stop))
      .catch((error: unknown) => log('warn', `outside drops: ${String(error)}`))
  }

  let stopPointer: (() => void) | null = null
  if (!__EVEN_PLUGIN__) {
    void import('./typing-pointer').then((one) => (stopPointer = one.hidePointerWhileTyping()))
  }

  return () => {
    stopPointer?.()
    stopAnywhere?.()
    clearInterval(sweeper)
    clearTimeout(settling)
    stopRecovery()
    stopReloading()
    stopStrayDrops()
    stopOutsideDrops?.()
    stopLooking()
    stopAutomation?.()
    stopHanded?.()
    stopAgents?.()
  }
}

async function guardClose() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (isMobile) settle()
      else save()
    } else if (isMobile) void workspace.loadTree()
  })
  addEventListener('pagehide', () => settle())

  const window = await currentWindow()
  await window.onCloseRequested((event) => void onClose(event, window))

  if (!__EVEN_PLUGIN__ && isDesktop) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const own = getCurrentWindow()
    await own.listen('nib://quit', () => void onQuit(window))
    await own.listen('nib://update-settle', () => {
      settle()
      void settledForInstaller(owed)
    })
    await own.listen(
      'nib://quit-ask',
      () => void import('./quitting/ask').then((one) => one.quitAsked()),
    )
    void startup
      .turn('right')
      .then(async () => (await import('./quitting/windows')).answer(own.label))
  }
}

interface Closing {
  preventDefault(): void
}

interface Closable {
  destroy(): Promise<void>
}

let going = false

async function onClose(event: Closing, window: Closable) {
  save()

  const hide = agentMarks.holding ? agentMarks.hide : trayKeeper()
  if (hide) {
    event.preventDefault()
    if ((await hide()) || going) return
    await go()
    await window.destroy()
    return
  }

  if (!isDesktop) return

  const runs = anythingRuns()
  if (!runs) settle()
  if (!runs && !workspace.writing && !stillWriting() && !ready() && !going) return

  event.preventDefault()
  if (going) return
  if (!__EVEN_PLUGIN__ && runs && !(await (await import('./quitting/ask')).mayStop('window')))
    return
  await go()
  await window.destroy()
}

async function onQuit(window: Closable) {
  if (going) return

  await go()
  await window.destroy()
}

function settle() {
  settleUp()
  workspace.graphSettings.flush()
}

function save() {
  writeOwed()
  workspace.graphSettings.flush()
}

function owed() {
  return Promise.all([workspace.writesSettled(), written(), internal.flush?.()])
}

async function go(): Promise<void> {
  settle()
  going = true
  try {
    await Promise.race([owed(), waited(GIVE_UP)])
    await installStaged(true)
  } finally {
    going = false
  }
}
