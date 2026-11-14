export { accountName, vendorName } from './account-words'
export { type Account, repeatable, vendorOf } from './accounts'
export type { Adding } from './add-paths'
export { READER_TABS } from './chat/choices'
export type {
  Api,
  Attachment,
  AutoCompact,
  Command,
  Compaction,
  Draft,
  Effort,
  Engine,
  EngineEvent,
  Goal,
  GoalState,
  ModelInfo,
  NoticeCode,
  Part,
  Stop,
  Thread,
  ThreadHead,
  ToolOutput,
  ToolState,
  Turn,
  Usage,
} from './chat/types'
export { complete, listModels, wasStopped } from './complete'
export { canTranscribe, transcriberNow } from './hears'
export {
  forgetKey,
  hasKey,
  keysAreGuarded,
  keysInFile,
  keysMoved as onKeysMoved,
  readKey,
  readSecret,
  writeKey,
  writeSecret,
} from './keys'
export type { Heard as LocalRead, Limit } from './local/heard'
export type { Heard, Level, Say, Session } from './local/session'
export type { LocalAccount, LocalPlans } from './local/status.svelte'
export {
  actsAlone,
  FIRST_MODE,
  type Mode,
  modeIn,
  modeOfGrant,
  MODES,
  modeWord,
  nextMode,
  noMoreThan,
} from './modes'
export { providerBrand } from './provider-brand'
export {
  compactUrl,
  conversationUrl,
  firstModel,
  geminiUrl,
  headersFor,
  headersWithoutType,
  heardUrl,
  isLocal,
  KIND_NAMES,
  type LocalKind,
  type Message,
  modelsUrl,
  NOT_CHAT,
  offeredKinds,
  type Provider,
  type ProviderKind,
  reachable,
  talkable,
  troubleIn,
  usable,
} from './providers'
export {
  beside,
  FIRST_STATE,
  isSessionState,
  next,
  ordered,
  type SessionEvent,
  type SessionState,
  STATE_COLOURS,
  STATE_MARKS,
  STATE_WORDS,
  stateOf,
  statesOf,
} from './session-state'
export { ai, FEATURES } from './store.svelte'
export { sseEvents, sseJson, sseLines } from './stream'
export { switchableAccounts, switchAccount } from './switching'
export { usage, USAGE_EVERY, type Weekly } from './usage.svelte'
export { signOut } from './vault/leaving'
export { browserVault, keepBrowserInVault, vault } from './vault/start.svelte'
export { default as AddAccount } from './AddAccount.svelte'
export { default as ProviderMark } from './ProviderMark.svelte'

export const loadKeysMoved = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no AI keys in the Even Realities plugin'))
    : import('./KeysMoved.svelte')

export const localCli = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no local AI programs in the Even Realities plugin'))
    : import('./local/cli')

export const chatgptPlan = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no ChatGPT plan in the Even Realities plugin'))
    : import('./chatgpt')

export const checkKeysMoved = () =>
  __EVEN_PLUGIN__
    ? Promise.resolve(false)
    : import('./keys-moved.svelte').then((one) => one.keysMoved.check())

export const loadPlanRows = () =>
  __EVEN_PLUGIN__
    ? Promise.reject(new Error('no AI plans in the Even Realities plugin'))
    : import('./PlanRows.svelte')
