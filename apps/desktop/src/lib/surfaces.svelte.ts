import { loadPrivateMark, loadWebTab } from './web-tab/src/api'
import { loadFind, loadLineCommands, setBlocks } from '@orden/editor'
import { door } from '@orden/markdown/door'
import { warmCalls } from './accounts/src/api'
import { breathe } from './breathe'
import { startup } from './startup.svelte'
import { storedText } from './platform/src/api'

export function held<T>(load: () => Promise<{ default: T }>): () => Promise<T> {
  return door(() => load().then((one) => one.default))
}

const never = new Promise<never>(() => undefined)

export function latched<T>(load: () => Promise<{ default: T }>): {
  ask: () => Promise<T>
  readonly asked: Promise<T> | null
} {
  const fetch = held(load)
  let asking: Promise<T> | null = null
  let answer: Promise<T> = never
  let asked = $state<Promise<T> | null>(null)

  return {
    ask: () => {
      const fetching = fetch()
      if (fetching === asking) return answer

      asking = fetching
      answer = fetching.catch(() => never)
      asked = answer
      fetching.catch(() => {
        if (asking !== fetching) return
        asking = null
        asked = null
      })

      return answer
    },
    get asked() {
      return asked
    },
  }
}

export const canvasSurface = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no canvas in the Even Realities plugin'))
    : import('./Canvas.svelte'),
)

export const graphSurface = held(() => import('./Graph.svelte'))

export const viewSurface = held(() => import('./views/src/api').then((one) => one.loadViewTab()))
export const tasksPanel = held(() =>
  __EVEN_PLUGIN__
    ? new Promise<never>(() => undefined)
    : import('./tasks-views/src/api').then((api) => ({ default: api.TodosPanel })),
)
export const todosBoard = held(() =>
  __EVEN_PLUGIN__
    ? new Promise<never>(() => undefined)
    : import('./tasks-views/src/api').then((api) => ({ default: api.TodosBoard })),
)
export const chatSurface = held(() =>
  __EVEN_PLUGIN__
    ? new Promise<never>(() => undefined)
    : import('./chats-client/src/api').then((one) => one.loadChatTab()),
)
export const chatsPanel = held(() =>
  __EVEN_PLUGIN__
    ? new Promise<never>(() => undefined)
    : import('./chats-client/src/api').then((one) => one.loadChatsPanel()),
)
export const timePanel = held(() =>
  __EVEN_PLUGIN__
    ? new Promise<never>(() => undefined)
    : import('./time/src/api').then((one) => one.loadTimePanel()),
)
export const timeSurface = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no time tracker in the Even Realities plugin'))
    : import('./time/src/api').then((one) => one.loadTimeTab()),
)

export const pagesSurface = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no page notes in the Even Realities plugin'))
    : import('./Pages.svelte'),
)

export const webSurface = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no web tab in the Even Realities plugin'))
    : loadWebTab(),
)

export const terminalSurface = held(() =>
  import('./terminal/src/api').then((one) => one.loadTerminalTab()),
)

export const applicationSurface = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no application in the Even Realities plugin'))
    : import('./apps/src/api').then((one) => one.loadApplicationTab()),
)

export const explorerSurface = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no file explorer in the Even Realities plugin'))
    : import('./explorer/src/api').then((one) => one.loadExplorerTab()),
)

export const passSurface = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no Pass in the Even Realities plugin'))
    : import('./pass-ui/src/api').then((one) => one.loadPassTab()),
)

export const passFill = held(() =>
  __EVEN_PLUGIN__
    ? new Promise<never>(() => undefined)
    : import('./pass-ui/src/api').then((one) => one.loadPassFill()),
)

export const emptySurface = held(() => import('./NewHere.svelte'))

export const readingSurface = held(() => import('./Reading.svelte'))

export const lockScreen = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('nothing is protected in the Even Realities plugin'))
    : import('./sharing/src/api').then((one) => one.loadLockScreen()),
)

export const findBar = held(() => import('./FindBar.svelte'))

const agentsApi = () => (__EVEN_PLUGIN__ ? never : import('./agents/src/api'))

export const takeoverBar = held(() => agentsApi().then((one) => one.loadTakeoverBar()))

export const agentRows = held(() => agentsApi().then((one) => one.loadAgentRows()))

export const agentSession = held(() => agentsApi().then((one) => one.loadAgentSession()))

export const searchPanel = held(() => import('./SearchPanel.svelte'))

const phone = () =>
  __EVEN_PLUGIN__ ? new Promise<never>(() => undefined) : import('./phone/src/api')

export const phoneTabsBar = held(() => phone().then((one) => one.loadPhoneTabs()))

export const phoneYou = held(() => phone().then((one) => one.loadPhoneYou()))

export const settingsSurface = held(() => import('./SettingsPanel.svelte'))

export const pagesNavigator = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no page notes in the Even Realities plugin'))
    : import('./PagesNavigator.svelte'),
)

export const linksPanel = held(() => import('./Links.svelte'))
export const askPanel = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('desktop only'))
    : import('./ai/sidebar/ChatPanel.svelte'),
)

export const archiveSection = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no archive list in the Even Realities plugin'))
    : import('./Archive.svelte'),
)

export const archivedStrip = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no archive strip in the Even Realities plugin'))
    : import('./ArchivedStrip.svelte'),
)

export const historySheet = latched(() => import('./History.svelte'))

export const shareSheet = latched(() => import('./ShareSheet.svelte'))

export const publishSheet = latched(() =>
  import('./publishing/src/api').then((one) => one.loadPublishSheet()),
)

export const exportSheet = latched(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no export in the Even Realities plugin'))
    : import('./export/src/api').then((one) => one.loadExportSheet()),
)

export const importSheet = latched(() =>
  import('./import/src/api').then((one) => one.loadImportSheet()),
)

export const iconPicker = latched(() => import('./IconPicker.svelte'))

export const rewriteSheet = latched(() => import('./RewriteSheet.svelte'))

export const quickSheet = latched(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no quick question in the Even Realities plugin'))
    : import('./QuickQuestion.svelte'),
)

export const scratchpadCard = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('not in the plugin'))
    : import('./scratchpad/src/api').then((one) => one.loadScratchpadCard()),
)

export const recordingPill = latched(() =>
  import('./dictation/src/api').then((one) => one.loadRecordingPill()),
)

export const joinPending = latched(() => import('./JoinPending.svelte'))

export const renameNotice = latched(() => import('./RenameNotice.svelte'))

export const keysMovedNotice = latched(() => {
  if (__EVEN_PLUGIN__) throw new Error('no AI keys in the Even Realities plugin')
  return import('./ai-providers/src/api').then((one) => one.loadKeysMoved())
})

export const OUTSIDE = 'orden:outside-folder'

export const outsideNotice = latched(() => {
  if (__EVEN_PLUGIN__) throw new Error('no spaces folder in the Even Realities plugin')
  return import('./OutsideFolder.svelte')
})

export const CRASH_REPORTS = 'orden:crash-reports'

export const CRASHES_ASKED = 'orden:crash-reports-told'

export const crashAskDue = (): boolean =>
  storedText(CRASHES_ASKED) === null && storedText(CRASH_REPORTS) === null

export const crashAsk = latched(() => {
  if (__EVEN_PLUGIN__) throw new Error('no crash reports in the Even Realities plugin')
  return import('./crash-reports/src/api').then((one) => one.loadCrashAsk())
})

export const appMenuRows = held(async () => ({ default: (await import('./app-menu')).appMenu }))

export const undoToastNotice = latched(() => {
  if (__EVEN_PLUGIN__) throw new Error('no undo toast in the Even Realities plugin')
  return import('./UndoToast.svelte')
})

export const spaceSound = latched(() => import('./SpaceSound.svelte'))

export const soundMark = held(() => import('./SoundMark.svelte'))

export const privateMark = held(() => loadPrivateMark())

export const sparkMark = door(() => agentsApi().then((one) => one.Spark))

export const terminalMark = held(() =>
  import('./terminal/src/api').then((one) => one.loadTerminalMark()),
)

export const tabNameField = held(() => import('./tab-strip/TabNameField.svelte'))

export const syncMark = latched(() =>
  __EVEN_PLUGIN__ ? Promise.reject(new Error('v1 only')) : import('./SyncMark.svelte'),
)

export const spacePickerDialog = latched(() => import('./SpacePicker.svelte'))

export const tabOverviewLayer = latched(() =>
  import('./overview/src/api').then((one) => one.loadOverview()),
)
export const tabOverview = $state<{ open: boolean; out: string[]; lifted: string[] }>({
  open: false,
  out: [],
  lifted: [],
})

export function toggleTabOverview(): void {
  void tabOverviewLayer.ask()
  tabOverview.open = !tabOverview.open
}

export const hostPickerDialog = latched(() =>
  import('./terminal/src/api').then((one) => one.loadHostPicker()),
)

export const spacesMenu = held(() => import('./SpaceMenu.svelte'))

export const promptSheet = latched(() => import('./PromptSheet.svelte'))

export const paletteDoor = latched(() => import('./Palette.svelte'))

export const paletteWords = $state<{ words: string | null }>({ words: null })

export const contextMenu = latched(() => import('./ContextMenu.svelte'))

export const formatBar = latched(() => import('./FormatBar.svelte'))

export const signInSheet = latched(() =>
  import('./accounts-ui/src/api').then((one) => ({ default: one.SignIn })),
)

export const joinSheet = latched(() => import('./JoinSheet.svelte'))

export const feedbackSheet = latched(() => import('./FeedbackSheet.svelte'))

export function showFeedback(): void {
  void import('./feedback.svelte').then(({ feedback }) => {
    feedback.show()
    void feedbackSheet.ask()
  })
}

export const quickAddSheet = latched(() =>
  import('./quick-add/src/api').then((one) => one.loadQuickAddSheet()),
)

export function showQuickAdd(prefill: import('./quick-add/src/api').Prefill = {}): void {
  if (!__EVEN_PLUGIN__) {
    void quickAddSheet.ask()
    void import('./quick-add/src/api').then(({ quickAdd }) => quickAdd.show(prefill))
  }
}

export const fillBar = held(() => import('./tab-fill/src/api').then((one) => one.loadFillBar()))
export const fullscreenWayOut = held(() => import('./FullscreenLeave.svelte'))

export const guestCorner = held(() => import('./GuestCorner.svelte'))

export const menuBarDoor = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no menu bar in the Even Realities plugin'))
    : import('./native-menu-bar.svelte')

export const firstSpaceDoor = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no fresh start in the Even Realities plugin'))
    : import('./first-space.svelte')

export async function warmDoors(): Promise<void> {
  await startup.turn('doors')
  await knock([
    () => findBar(),
    () => searchPanel(),
    () => linksPanel(),
    () => appMenuRows(),
    () => readingSurface(),
    () => loadFind(),
    () => loadLineCommands(),
    () => import('./commands').then(({ blockRows }) => setBlocks(blockRows)),
    () => spacePickerDialog.ask(),
    () => spacesMenu(),
    () => paletteDoor.ask(),
    () => promptSheet.ask(),
    () => contextMenu.ask(),
    () => formatBar.ask(),
    () => signInSheet.ask(),
    () => joinSheet.ask(),
    __EVEN_PLUGIN__ ? undefined : () => undoToastNotice.ask(),
    __EVEN_PLUGIN__ ? undefined : () => import('./field-menu'),
    () => import('./ai-providers/src/api'),
    () => import('./tab-strip/menu'),
    () => import('./tab-strip/strip-menu'),
    () => import('./row-menu'),
    () => import('./editor-menu'),
    () => import('./tab-cycle.svelte'),
    __EVEN_PLUGIN__ ? undefined : () => import('./tab-strip/numbers.svelte'),
    __EVEN_PLUGIN__ ? undefined : () => import('./pane-moves').then((one) => one.followPointer()),
    __EVEN_PLUGIN__ ? undefined : () => fillBar(),
    () => import('./preview-card'),
    () => import('./note-cover'),
    () => warmCalls(),
    __EVEN_PLUGIN__
      ? undefined
      : () => import('./first-screen/src/api').then((one) => one.keepFirstScreens()),
    () => import('./reload-when'),
    () => import('./keyboard-home'),
    __EVEN_PLUGIN__
      ? undefined
      : () => import('./back-swipe/src/api').then((one) => one.listenSwipes()),
  ])
}

async function knock(doors: readonly ((() => unknown) | undefined)[]): Promise<void> {
  const asked: Promise<unknown>[] = []
  for (const open of doors) {
    if (!open) continue
    const one = Promise.resolve().then(open)
    one.catch(() => undefined)
    asked.push(one)
    await breathe()
  }
  await Promise.all(asked)
}
