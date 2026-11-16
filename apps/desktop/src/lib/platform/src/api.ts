export { carryKeys } from './former-keys'
export { assetType } from './asset-route'
export { serveAssets } from './serve-assets'
export {
  BEAT_EVERY,
  IDLE_AFTER,
  INPUT_EVERY,
  linkDelay,
  nudgeDelay,
  passing,
  pollDelay,
  PRESENCE_EVERY,
  RECONCILE_INTERVAL,
  roomDelay,
  SAVE_AT_MOST,
  SAVE_DELAY,
  saveRetryDelay,
} from './backoff'
export { breathe, idle, nextTask } from './breathe'
export { decoded, fileBytes, fromBase64, pageBytes, parseDataUri, sha256, toBase64 } from './bytes'
export { appleHandheld, deviceName, speechRecogniser } from './device'
export { insideOnly } from './inside'
export { heldForLife, holdIfFree, ifFree, inTurn, locksHere, locksWork } from './locks'
export { collectErrors, log, recentLog, tokensOut } from './log'
export { MIME_TYPES, mimeOfPath, UNKNOWN_TYPE } from './mime'
export { calm, dur, fade, fly, LAYER, scale, slide, stillness } from './motion'
export { extensionOf, nameFault, nameToCommit, nameToWrite } from './naming'
export type { NameFault } from './naming'
export {
  AGENTS_NAME,
  copyName,
  draftName,
  endingOf,
  isAgentsName,
  isReserved,
  nameFromContent,
  nameFromTitle,
  rowName,
  shownName,
  TITLE_CHARS,
} from '@orden/markdown/note-name'
export { isVault, onDisk } from './on-disk'
export { filledIn, meet, readSpaces, withOrWithout, without } from './records'
export type { Folded, Folding } from './records'
export {
  askCase,
  coveredBy,
  folderOf,
  foldsIn,
  insideAnyOf,
  insideItsSpace,
  insideSpace,
  isHiddenPath,
  isMarkdownPath,
  isPicturePath,
  KEPT_HOME,
  keptShaped,
  movedTo,
  nameOf,
  noteName,
  notePath,
  pathKey,
  pathKeyAs,
  pathKeys,
  placesOf,
  relativePath,
  relativeTo,
  rootedAt,
  samePath,
  sameSpelling,
  within,
  withinSpace,
  withoutExtension,
} from './space-paths'
export { spaceRelative } from './space-relative'
export {
  forget,
  isBoolean,
  isNumber,
  isRecord,
  isString,
  keep,
  keepJson,
  parsed,
  recordOf,
  Shared,
  stored,
  storedText,
  stringList,
} from './stored'
export {
  assetPath,
  assetUrl,
  closeWindow,
  currentWindow,
  internal,
  invoke,
  isDesktop,
  isMobile,
  isNative,
  isOpenable,
  joinPath,
  openExternal,
  platform,
  whenScreenGivenBack,
} from './tauri'
export { afterQuiet, BYTES_WITHIN, fetchInTime, onceAFrame, waited } from './timing'
export type { Later } from './timing'
export {
  basename,
  hiddenUnder,
  isCanvas,
  isMarkdown,
  isPages,
  isPdf,
  join,
  normalise,
  parent,
  safeName,
  spaceOf,
  under,
} from './web-paths'
export { answerNextDialog, dialogAnswer } from './dialog-answer'
export { keepVersion, readText, writeInTurn, writeTaking } from './note-files'
export { oneWriteAt, windows } from './windows'
export type { Said, Windows } from './windows'
export { localDate, localNumber, region, systemLocale } from './region'
export { answer, frameWord, method, NoWord, onTheActivity, wordSaid } from './mobile-bridge'
export { startInsets, tintSystemBars } from './insets'
export { identifier } from './identifier'
export { factsOfLaunch, mark, markPainted, sendTrace, watchFirstInput } from './trace'
export const iCloud = () => import('./icloud-placeholder')
export const droppedPaths = async (files: readonly File[]): Promise<string[]> =>
  (await import('./dropped-paths')).droppedPaths(files)
export { imagePath, imageUrl } from './images'
export { takeKeyboard } from './take-keyboard'
export { isPlugin, markPlugin } from './plugin'

export const stallWatch = () => import('./stalls')
