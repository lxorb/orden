import { whenPortProvided } from '@orden/contracts'
import { archiveAgain, showArchive } from './archive/src/api'
import { beginSetup } from './onboarding/src/api'
import { pdfTabs } from './pages/src/api'
import { askPlace } from './save-place/src/api'
import { mayCarryBetween } from './sharing/src/api'
import { isScratchpad, pad, shown } from './scratchpad/src/api'
import { searchWarmth } from './search/src/api'
import { rowsCopied } from './views/src/api'
import {
  oneWindow,
  pageAiming,
  pages,
  pageZoom,
  siteMaking,
  webDataStores,
  webNotes,
  websiteConverting,
} from './web-tab/src/api'
import { serveWorkspace } from './workspace/src/services'

serveWorkspace({
  scratchpad: {
    get on() {
      return shown.on
    },
    holds: isScratchpad,
    open: async () => (await pad()).show(),
    show: (take) => shown.show(take),
    hide: () => shown.hide(),
  },
  askPlace,
  beginSetup,
  warmSearch: async (root) => (await searchWarmth()).forSpace(root),
  showArchive: (path) => void showArchive(path),
  archiveAgain,
  rowsCopied,
  mayCarryBetween,
  papers: async () => (await import('./pdf/src/api')).papers(),
  readPapers: async (root, files, tree) =>
    (await import('./pdf/src/api')).readPapers(root, files, tree),
  sheets: () => import('./pdf/src/api'),
  pdfPages: pdfTabs,
  sites: {
    heldElsewhere: async (path) => (await oneWindow()).heldElsewhere(path),
    showElsewhere: async (path) => (await oneWindow()).showElsewhere(path),
    asShortcut: async (ws, path) => (await websiteConverting()).asShortcut(ws, path),
    convertWebsites: async (ws) => (await websiteConverting()).convertWebsites(ws),
    webUrlOf: async (text) => (await webNotes()).webUrlOf(text),
    newSite: async (ws, dir, named) => (await siteMaking()).newSite(ws, dir, named),
    aimed: async (ws, tab, url) => (await pageAiming()).aimed(ws, tab, url),
    zoomStep: async (tab, step) => {
      const { zoomStep } = await pageZoom()
      zoomStep(tab, pages.of(tab), step)
    },
  },
  webData: webDataStores,
})

if (!__EVEN_PLUGIN__) {
  serveWorkspace({
    undoOutside: async (action) => (await import('./explorer/src/api')).undoOutside(action),
    redoOutside: async (action) => (await import('./explorer/src/api')).redoOutside(action),
    explorerStep: async (tab, by) => {
      const view = (await import('./explorer/src/api')).viewOf(tab)
      await (by < 0 ? view.back() : view.forward())
    },
    mayEnd: async (closing, every) => (await import('./terminal/src/api')).mayEnd(closing, every),
    terminalMoved: async (doc, from, to) => {
      const { moveHistory, readSpec } = await import('./terminal/src/api')
      const key = readSpec(doc)?.key ?? ''
      moveHistory({ space: from, key }, { space: to, key })
    },
    chatsCarried: async (path, folder) =>
      (await import('./chats-client/src/api')).chatsCarried(path, folder),
  })
  whenPortProvided('workspace.view', (view) =>
    view.follow((op) => {
      if (op.op !== 'moved') return
      return import('./explorer/src/api').then(
        ({ moved }) => moved(op.from, op.to),
        () => undefined,
      )
    }),
  )
}
