import { hinting } from './hints/src/api'
import { oneWindow } from './web-tab/src/api'
import { door } from '@orden/markdown/door'
import { account, connectors } from './accounts/src/api'
import { busy, guardDrops, outsideDrops, reloading, viewport } from './ui-kit/src/api'
import { installAiRunner } from './ai-chat/src/api'
import { joining } from './sharing/src/api'
import {
  collectErrors,
  log,
  isDesktop,
  platform,
  onTheActivity,
  factsOfLaunch,
  mark,
  stallWatch,
} from './platform/src/api'
import { startup, Stops } from './launch/src/api'
import { choices, modes } from './modes/src/api'
import { warmDoors } from './features'
import { recovery } from './history/src/api'
import { record } from './sync-mirror/src/api'
import { settings } from './settings/src/api'
import { hiddenKinds } from './gates/src/api'
import { gate } from './onboarding/src/api'
import { shortcuts, toolbar } from './shortcuts/src/api'
import { theme } from './theme/src/api'
import { convertAll, keepWorking } from './web-backend/src/api'
import { trash } from './trash/src/api'
import { updates } from './updates/src/api'
import { startRunner } from './views/src/api'
import {
  acrossStarting,
  type Across,
  blankTabs,
  closing,
  featureGates,
  outsideHearing,
  pull,
  workspace,
} from './workspace/src/api'
import { providePort } from '@orden/contracts'

if (!__EVEN_PLUGIN__) {
  providePort('quit.ask', { mayStop: async (why) => (await import('./quit-ports')).mayStop(why) })
}

const DAY = 24 * 60 * 60 * 1000

async function openPdfs(paths: readonly string[]) {
  const { showPdfs } = await (await import('./pdf/src/api')).handed()
  await showPdfs(paths)
}

async function listenForAgents(): Promise<() => void> {
  if (__EVEN_PLUGIN__ || !isDesktop) return () => undefined

  const { listen } = await import('@tauri-apps/api/event')
  const heard = door(() => import('./agents/src/api').then((one) => one.agentsUi()).then(({ start }) => start()))

  return listen<unknown>('orden://agent', ({ payload }) => {
    void heard().then((hear) => hear(payload))
  })
}

export function start(): () => void {
  mark('start')
  collectErrors()
  void startup.turn('doors').then(async () => (await stallWatch()).watchStalls())
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
  connectors.restore()
  choices.restore()
  if (!__EVEN_PLUGIN__) gate.restore()
  const settling = setTimeout(() => {
    startup.settled = true
    if (!__EVEN_PLUGIN__) void hinting().then(({ hints }) => hints.settle())
  }, 20_000)
  installAiRunner()
  recovery.restore()
  record.restore()
  account.forgetWithSession(() => record.forgetEverything())

  mark('stores restored')

  if (theme.offerContrast) settings.show('appearance')

  const stops = new Stops()

  void workspace
    .restore()
    .then(async () => {
      mark('space restored')
      if (!__EVEN_PLUGIN__) {
        const { startAutomation } = await (await import('./automation/src/api')).automationStart()
        stops.keep(await startAutomation())
        stops.keep(await listenForAgents())
      }
      if (onTheActivity()) {
        const { startHanded } = await import('./mobile/src/api')
        stops.keep(startHanded())
      }
    })
    .catch((error: unknown) => {
      log('error', `restore: ${error instanceof Error ? error.message : String(error)}`)
    })

  void trash.sweep()
  const sweeper = setInterval(() => void trash.sweep(), DAY)

  const stopRecovery = recovery.start()

  const stopStrayDrops = guardDrops((paths) => void openPdfs(paths))

  void (async () => (await closing()).guardClose(() => import('./quit-ports')))()

  const stopReloading = reloading.watch(async () => {
    ;(await closing()).settle()
    await workspace.writesSettled()
    return !workspace.writing && !busy.active
  })

  const stopLooking = updates.start()

  void account.restore().then(() => joining.start())

  void warmDoors().catch(() => {
    // Answered by reloading.svelte.ts.
  })

  if (!__EVEN_PLUGIN__) {
    void startup
      .turn('right')
      .then(() => import('./rows/src/api'))
      .then(() => startRunner())
    void startup
      .turn('right')
      .then(featureGates)
      .then(({ whenAppsOn, whenChatsOn, whenExplorerOn, whenPassOn, whenTimeOn }) => {
        whenPassOn(
          () => void import('./pass-sync/src/api').then((one) => one.startPassSync()),
          () => void import('./pass-sync/src/api').then((one) => one.quietPass()),
        )
        whenChatsOn(() => void import('./chats-client/src/api').then((one) => one.wakeChats()))
        whenTimeOn(() => void import('./time/src/api').then((one) => one.wakeTime()))
        whenAppsOn()
        whenExplorerOn()
      })
    void startup
      .turn('right')
      .then(() => import('./chats-client/src/api'))
      .then((one) => one.retireChats())
      .then((one) => one.forgetRetiredChatsHere())
      .catch(() => undefined)
    void startup
      .turn('right')
      .then(() => import('./tasks-model/src/api'))
      .then(({ startTodos }) => startTodos())
    void startup.turn('right').then(() => import('./scratchpad/src/api').then((one) => one.wakeScratchpad()))
    void startup.turn('right').then(blankTabs)
    void startup
      .turn('right')
      .then(() => import('./overview/src/api'))
      .then((one) => one.wakeFaces())
    void startup.turn('rooms').then(() =>
      import('./sync-client/src/api').then(({ connect }) => {
        connect()
      }),
    )
    if (isDesktop) {
      void (async () => {
        await startup.turn('right')
        await convertAll(workspace)
        await keepWorking()
        if (platform() !== 'macos') return
        const { quickShortcuts } = await import('./quick-add/src/api')
        await (await quickShortcuts()).hearShortcuts()
      })().catch((error: unknown) => log('warn', `after the spaces moved in: ${String(error)}`))
      void startup.turn('rooms').then(() => oneWindow())
    }
    let fetched: Promise<Across> | null = null
    const across = () => (fetched ??= acrossStarting().then(({ startAcross }) => startAcross()))
    workspace.acrossWhenWriting(across)
    void startup.turn('rooms').then(across)
    const reporting = !import.meta.env.DEV && !__DRIVEABLE__
    if (isDesktop) {
      void startup.turn('rooms').then(() => outsideHearing().then(({ hearOutside }) => hearOutside()))
      void startup
        .turn('right')
        .then(() => import('./quick-add/src/api'))
        .then((one) => one.quickAnywhere())
        .then((one) => stops.keep(one.listen()))
      void outsideDrops()
        .then(({ hearOutsideDrops }) => hearOutsideDrops())
        .then(stops.keep)
        .catch((error: unknown) => log('warn', `outside drops: ${String(error)}`))
      void startup
        .turn('rooms')
        .then(() => import('./crash-reports/src/api'))
        .then((one) => one.watchCrashes(reporting))
        .then(stops.keep)
    }
    void startup
      .turn('rooms')
      .then(() => import('./usage/src/api'))
      .then((one) => one.watchUsage(reporting))
      .then(stops.keep)
    void import('./ui-controls/src/api').then((one) => stops.keep(one.hidePointerWhileTyping()))
  }

  return () => {
    stops.end()
    clearInterval(sweeper)
    clearTimeout(settling)
    stopRecovery()
    stopReloading()
    stopStrayDrops()
    stopLooking()
  }
}
