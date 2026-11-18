import { providePort } from '@orden/contracts'
import { account, api, ApiError, BASE, fromServer, request } from './accounts/src/api'
import {
  forget,
  keep,
  keepJson,
  BYTES_WITHIN,
  fetchInTime,
  stored,
  storedText,
  invoke,
  isDesktop,
  isNative,
  joinPath,
  platform,
  waited,
} from './platform/src/api'

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

providePort('sync.pairing', {
  pairSpaces: async (token, pairing) =>
    (await import('./space-pairing/src/api')).pairSpaces(token, pairing),
})
