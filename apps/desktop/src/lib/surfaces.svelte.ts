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

export const viewSurface = held(() =>
  __EVEN_PLUGIN__ ? new Promise<never>(() => undefined) : import('./views/ViewTab.svelte'),
)
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
  __EVEN_PLUGIN__ ? new Promise<never>(() => undefined) : import('./chats/view/ChatTab.svelte'),
)
export const chatsPanel = held(() =>
  __EVEN_PLUGIN__ ? new Promise<never>(() => undefined) : import('./chats/view/ChatsPanel.svelte'),
)
export const timePanel = held(() =>
  __EVEN_PLUGIN__ ? new Promise<never>(() => undefined) : import('./time/TimePanel.svelte'),
)
export const timeSurface = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no time tracker in the Even Realities plugin'))
    : import('./time/TimeTab.svelte'),
)

export const pagesSurface = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no page notes in the Even Realities plugin'))
    : import('./Pages.svelte'),
)

export const webSurface = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no web tab in the Even Realities plugin'))
    : import('./web-tab/WebTab.svelte'),
)

export const terminalSurface = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no terminal in the Even Realities plugin'))
    : import('./terminal/TerminalTab.svelte'),
)

export const applicationSurface = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no application in the Even Realities plugin'))
    : import('./apps/ApplicationTab.svelte'),
)

export const explorerSurface = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no file explorer in the Even Realities plugin'))
    : import('./explorer/ExplorerTab.svelte'),
)

export const passSurface = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no Pass in the Even Realities plugin'))
    : import('./pass/PassTab.svelte'),
)

export const passFill = held(() =>
  __EVEN_PLUGIN__ ? new Promise<never>(() => undefined) : import('./pass/PassFill.svelte'),
)

export const emptySurface = held(() => import('./NewHere.svelte'))

export const readingSurface = held(() => import('./Reading.svelte'))

export const lockScreen = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('nothing is protected in the Even Realities plugin'))
    : import('./sharing/src/api').then((one) => one.loadLockScreen()),
)

export const findBar = held(() => import('./FindBar.svelte'))

export const searchPanel = held(() => import('./SearchPanel.svelte'))

export const phoneTabsBar = held(() =>
  __EVEN_PLUGIN__ ? new Promise<never>(() => undefined) : import('./phone/PhoneTabs.svelte'),
)

export const phoneYou = held(() =>
  __EVEN_PLUGIN__ ? new Promise<never>(() => undefined) : import('./phone/PhoneYou.svelte'),
)

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
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no import in the Even Realities plugin'))
    : import('./ImportSheet.svelte'),
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
    : import('./scratchpad/ScratchpadCard.svelte'),
)

export const recordingPill = latched(() => import('./RecordingPill.svelte'))

export const joinPending = latched(() => import('./JoinPending.svelte'))

export const renameNotice = latched(() => import('./RenameNotice.svelte'))

export const keysMovedNotice = latched(() => {
  if (__EVEN_PLUGIN__) throw new Error('no AI keys in the Even Realities plugin')
  return import('./ai/KeysMoved.svelte')
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
  return import('./crash-reports/CrashAsk.svelte')
})

export const appMenuRows = held(async () => ({ default: (await import('./app-menu')).appMenu }))

export const undoToastNotice = latched(() => {
  if (__EVEN_PLUGIN__) throw new Error('no undo toast in the Even Realities plugin')
  return import('./UndoToast.svelte')
})

export const spaceSound = latched(() => import('./SpaceSound.svelte'))

export const soundMark = held(() => import('./SoundMark.svelte'))

export const privateMark = held(() => import('./web-tab/PrivateMark.svelte'))

export const terminalMark = held(() =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no terminal in the Even Realities plugin'))
    : import('./terminal/TerminalMark.svelte'),
)

export const tabNameField = held(() => import('./tab-strip/TabNameField.svelte'))

export const syncMark = latched(() =>
  __EVEN_PLUGIN__ ? Promise.reject(new Error('v1 only')) : import('./SyncMark.svelte'),
)

export const spacePickerDialog = latched(() => import('./SpacePicker.svelte'))

export const tabOverviewLayer = latched(() => import('./overview/Overview.svelte'))
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
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no remote in the Even Realities plugin'))
    : import('./remote/HostPicker.svelte'),
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
  __EVEN_PLUGIN__
    ? new Promise<never>(() => undefined)
    : import('./quick-add/QuickAddSheet.svelte'),
)

export function showQuickAdd(prefill: import('./quick-add/entry').Prefill = {}): void {
  if (!__EVEN_PLUGIN__) {
    void quickAddSheet.ask()
    void import('./quick-add/asked.svelte').then(({ quickAdd }) => quickAdd.show(prefill))
  }
}

export const fillBar = held(() => import('./tab-fill/FillBar.svelte'))
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
    () => import('./ai/store.svelte'),
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
      : () => import('./first-screen/keep.svelte').then((one) => one.keepFirstScreens()),
    () => import('./reload-when'),
    () => import('./keyboard-home'),
    __EVEN_PLUGIN__ ? undefined : () => import('./back-swipe/swipes').then((one) => one.listen()),
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
