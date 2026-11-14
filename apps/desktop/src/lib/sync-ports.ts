import { providePort } from '@orden/contracts'
import { account } from './account.svelte'
import { api, ApiError, BASE, BYTES_WITHIN, fetchInTime, fromServer, request } from './api'
import { howFor } from './new-tab'
import { forget, keep, keepJson, stored, storedText } from './stored'
import { invoke, isDesktop, isNative, joinPath, platform } from './tauri'
import { waited } from './timing'
import { workspace } from './workspace.svelte'
import { ROOTS_MOVED, rootsMoved } from './workspace/roots-moved'
import { hearWrites } from './workspace/write-file'

providePort('sync.host', {
  get isNative() {
    return isNative
  },
  get isDesktop() {
    return isDesktop
  },
  platform: () => platform(),
  invoke: (command, args) => invoke(command, args),
  joinPath: (dir, relative) => joinPath(dir, relative),
})

providePort('sync.storage', {
  text: (name) => storedText(name),
  json: (key) => stored(key),
  keepText: (name, value) => keep(name, value),
  keepJson: (key, value) => keepJson(key, value),
  forget: (name) => forget(name),
})

providePort('sync.clock', {
  now: () => Date.now(),
  waited: (ms) => waited(ms),
})

providePort('sync.account', {
  get token() {
    return account.token
  },
  get user() {
    return account.user
  },
  get spaces() {
    return account.spaces
  },
  get signedIn() {
    return account.signedIn
  },
  loadSpaces: () => account.loadSpaces(),
  recheck: () => account.recheck(),
  signedOutBy: (error) => account.signedOutBy(error),
  forgetWithSession: (clear) => account.forgetWithSession(clear),
  askBeforeLeaving: (ask) => account.askBeforeLeaving(ask),
})

providePort('sync.api', {
  get base() {
    return BASE
  },
  get bytesWithin() {
    return BYTES_WITHIN
  },
  fetchInTime: (input, init, within) => fetchInTime(input, init, within),
  listSpaces: (token) => api.listSpaces(token),
  changes: (token, spaceId, since) => api.changes(token, spaceId, since),
  noteVersions: (token, id) => api.noteVersions(token, id),
  noteVersion: (token, id, at) => api.noteVersion(token, id, at),
  devices: (token) => request('/v2/devices', { token }),
  statusOf: (error) => (error instanceof ApiError ? error.status : null),
  saidByServer: (error) => fromServer(error),
})

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
  locked: (path) => workspace.protection.locked(path),
  copied: (from, to, root, into) => workspace.protection.copied(from, to, root, into),
  open: (path) => workspace.open(path),
  openBehind: (path) => workspace.openRow(path, howFor('behind')),
  dropSpace: (id) => workspace.dropSpace(id),
  loadTree: () => workspace.loadTree(),
  writeNow: () => workspace.writeNow(),
  writesSettled: () => workspace.writesSettled(),
  arrived: (path) => workspace.arrived(path),
  fileCame: (path, kind) => workspace.fileCame(path, kind),
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
    const { moveOwnKeysSoon } = await import('./workspace/own-keys-moved')
    moveOwnKeysSoon(root, workspace, true)
    const { keepSetextMarked } = await import('./workspace/setext')
    keepSetextMarked(workspace, root)
  },
  spaceUnpaired: async (root) => {
    const { moveOwnKeysSoon } = await import('./workspace/own-keys-moved')
    moveOwnKeysSoon(root, workspace, false)
  },
  hearWrites: (hearing) => hearWrites(hearing),
  rootMoves: () => rootsMoved(),
  forgetRootMoves: () => forget(ROOTS_MOVED),
})
