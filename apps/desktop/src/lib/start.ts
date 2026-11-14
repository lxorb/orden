import { agentMarks, listenForAgents } from './agent-marks.svelte'
import { account } from './accounts/src/api'
import { busy, viewport } from './ui-kit/src/api'
import { installAiRunner } from './ai/ask'
import { guardDrops } from './drops'
import { joining } from './sharing/src/api'
import {
  collectErrors,
  log,
  currentWindow,
  internal,
  isDesktop,
  isMobile,
  platform,
  waited,
  onTheActivity,
} from './platform/src/api'
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
import { gate } from './onboarding/gate.svelte'
import { startup } from './startup.svelte'
import { shortcuts } from './shortcuts.svelte'
import { factsOfLaunch, mark } from './trace'
import { theme } from './theme/src/api'
import { pull } from './pull.svelte'
import { toolbar } from './toolbar.svelte'
import { trash } from './trash.svelte'
import { installStaged, ready, settledForInstaller } from './updater'
import { updates } from './updates.svelte'
import { workspace } from './workspace.svelte'

const DAY = 24 * 60 * 60 * 1000

export function start(): () => void {
  mark('start')
  collectErrors()
  void startup.turn('doors').then(async () => (await import('./stalls')).watchStalls())
  if (!__EVEN_PLUGIN__) {
    void startup
      .turn('doors')
      .then(async () => (await import('./theme-looks/src/api')).store.keepUp())
      .catch((error: unknown) => log('warn', `themes: ${String(error)}`))
  }
  factsOfLaunch(() => `${workspace.spaces.length} spaces, ${workspace.tabs.length} tabs`)
  viewport.start()
  theme.init()
  if (!__EVEN_PLUGIN__) void import('./theme-looks/src/api').then((one) => one.syncLook())
  modes.restore()
  shortcuts.restore()
  toolbar.restore()
  pull.restore()
  hiddenKinds.restore()
  settings.restore()
  if (!__EVEN_PLUGIN__) gate.restore()
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
    void startup
      .turn('right')
      .then(() => import('./feature-gate.svelte'))
      .then(({ whenPassOn }) =>
        whenPassOn(
          () => void import('./pass-sync/src/api').then((one) => one.startPassSync()),
          () => void import('./pass-sync/src/api').then((one) => one.quietPass()),
        ),
      )
  }

  if (!__EVEN_PLUGIN__) {
    void startup
      .turn('right')
      .then(() => import('./feature-gate.svelte'))
      .then(({ whenChatsOn }) =>
        whenChatsOn(() => void import('./chats-client/src/api').then((one) => one.wakeChats())),
      )
    void startup
      .turn('right')
      .then(() => import('./chats-client/src/api'))
      .then((one) => one.retireChats())
      .then((one) => one.forgetRetiredChatsHere())
      .catch(() => undefined)
  }

  if (!__EVEN_PLUGIN__) {
    void startup
      .turn('right')
      .then(() => import('./feature-gate.svelte'))
      .then(({ whenTimeOn }) =>
        whenTimeOn(() => void import('./time/src/api').then((one) => one.wakeTime())),
      )
  }

  if (!__EVEN_PLUGIN__) {
    void startup
      .turn('right')
      .then(() => import('./tasks-model/src/api'))
      .then(({ startTodos }) => startTodos())
  }

  if (!__EVEN_PLUGIN__) {
    void startup
      .turn('right')
      .then(() => import('./feature-gate.svelte'))
      .then(({ whenAppsOn, whenExplorerOn }) => {
        whenAppsOn()
        whenExplorerOn()
      })
  }

  if (!__EVEN_PLUGIN__) {
    void startup
      .turn('right')
      .then(() => import('./scratchpad/src/api').then((one) => one.wakeScratchpad()))
  }

  if (!__EVEN_PLUGIN__) {
    void startup.turn('right').then(() => import('./workspace/blank-tabs.svelte'))
  }

  if (!__EVEN_PLUGIN__)
    void startup
      .turn('right')
      .then(() => import('./overview/src/api'))
      .then((one) => one.wakeFaces())

  if (!__EVEN_PLUGIN__) {
    void startup.turn('rooms').then(() =>
      import('./sync-client/src/api').then(({ connect }) => {
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

  let stopCrashes: (() => void) | null = null
  if (!__EVEN_PLUGIN__ && isDesktop) {
    void startup
      .turn('rooms')
      .then(() => import('./crash-reports/src/api'))
      .then((one) => one.watchCrashes(!import.meta.env.DEV))
      .then((stop) => (stopCrashes = stop))
  }

  let stopUsage: (() => void) | null = null
  if (!__EVEN_PLUGIN__) {
    void startup
      .turn('rooms')
      .then(() => import('./usage/src/api'))
      .then((one) => one.watchUsage(!import.meta.env.DEV))
      .then((stop) => (stopUsage = stop))
  }

  let stopPointer: (() => void) | null = null
  if (!__EVEN_PLUGIN__) {
    void import('./typing-pointer').then((one) => (stopPointer = one.hidePointerWhileTyping()))
  }

  return () => {
    stopCrashes?.()
    stopUsage?.()
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
    await own.listen('orden://quit', () => void onQuit(window))
    await own.listen('orden://update-settle', () => {
      settle()
      void settledForInstaller(owed)
    })
    await own.listen(
      'orden://quit-ask',
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
