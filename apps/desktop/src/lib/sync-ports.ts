import './sync-base-ports'
import { protection } from './protect/src/api'
import { providePort } from '@orden/contracts'
import { folderOf, forget, within } from './platform/src/api'
import { workspace, howFor } from './workspace/src/api'
import { ROOTS_MOVED, rootsMoved } from './workspace/src/roots-moved'
import { hearWrites } from './file-writes/src/api'

protection.seesFiles((path) =>
  workspace.files.filter((one) => within(folderOf(path), one.path) !== null).map((one) => one.path),
)
providePort('sync.workspace', {
  get spaces() {
    return workspace.spaces
  },
  get shownSpaces() {
    return workspace.shownSpaces
  },
  get tree() {
    return workspace.tree
  },
  get activeSpace() {
    return workspace.activeSpace
  },
  get activePath() {
    return workspace.active?.path ?? null
  },
  get documents() {
    return workspace.documents
  },
  get openNotes() {
    return workspace.openNotes
  },
  entryAt: (path) => workspace.entryAt(path),
  rootHolding: (path) => workspace.rootHolding(path),
  locked: (path) => protection.locked(path),
  copied: (from, to, root, into) => protection.copied(from, to, root, into),
  open: (path) => workspace.open(path),
  openBehind: (path) => workspace.openRow(path, howFor('behind')),
  dropSpace: (id) => workspace.dropSpace(id),
  loadTree: () => workspace.loadTree(),
  writeNow: () => workspace.writeNow(),
  writesSettled: () => workspace.writesSettled(),
  arrived: (path) => workspace.arrived(path),
  fileCame: (path, kind) => workspace.fileCame(path, kind),
  fileWritten: (path) => {
    void import('./pdf/src/api').then((pdf) => pdf.sheetArrived(path))
  },
  fileMoved: (from, to, kind) => workspace.fileMoved(from, to, kind),
  fileGone: (path, kind, back) => workspace.fileGone(path, kind, back),
  heardMove: (from, to) => workspace.heardMove(from, to),
  heardGone: (path) => workspace.heardGone(path),
  undoneMoved: (from, to) => workspace.undone.moved(from, to),
  holdingWrites: (path, run, stalled) => workspace.holdingWrites(path, run, stalled),
  doneBy: (doer) => workspace.fileOps.doneBy(doer),
  placeBy: (positioned) => workspace.arranged.placeBy(positioned),
  placesFrom: (root) => workspace.arranged.fromPlaces(root),
  repositioned: () => workspace.arranged.repositioned(),
  describeBy: (describing) => workspace.itemMeta.describeBy(describing),
  describes: (root) => workspace.itemMeta.describes(root),
  metaFromEngine: (root) => workspace.itemMeta.fromEngine(root),
  notesDescribed: async (root) => {
    const { moveOwnKeysSoon } = await import('./workspace/src/own-keys-moved')
    void moveOwnKeysSoon(root, workspace, true)
    const { keepSetextMarked } = await import('./workspace/src/setext')
    keepSetextMarked(workspace, root)
  },
  spaceUnpaired: async (root) => {
    const { moveOwnKeysSoon } = await import('./workspace/src/own-keys-moved')
    void moveOwnKeysSoon(root, workspace, false)
  },
  hearWrites: (hearing) => hearWrites(hearing),
  rootMoves: () => rootsMoved(),
  forgetRootMoves: () => forget(ROOTS_MOVED),
  bookmarksOf: (root) => workspace.bookmarks.of(root),
  bookmarksSaid: (root, landed, list) => workspace.bookmarks.said(root, landed, list),
  archivedIn: (root, path) => workspace.archive.holdsIn(root, path),
  shownText: (path) => {
    const note = workspace.openNotes.find((one) => one.path === path)?.note
    return note && !note.dirty ? note.text : null
  },
  reload: (path, text) => workspace.reload(path, text),
  leaveTheWelcomeNote: () => workspace.leaveTheWelcomeNote(),
})
