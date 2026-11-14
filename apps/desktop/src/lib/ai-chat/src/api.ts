export type { Listed } from './commands/todos'
export type { Panel, PanelCommand } from './commands/types'
export type { ContextKind } from './quick'
export type { Change, Edit, NoteChanges } from './review/changes'
export type { FileChange } from './review/files'
export type { Choice } from './review/plan'
export type { ReviewPanel } from './review/review.svelte'
export type { ChatHost } from './store/chat.svelte'
export type { Source } from './store/citations'
export type { Front } from './store/gather'
export type { Mention, MentionKind, Row } from './store/mentions'
export type { TaskTool } from './store/prefs'
export { askQuickly } from './quick-door'
export { installAiRunner } from './ask'
export { chatsUnread, lookAtLaunch } from './unread.svelte'

const away = <T>(): Promise<T> => new Promise<never>(() => undefined)

export const chatStore = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./store/chat.svelte')>() : import('./store/chat.svelte')

export const chatSends = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./chat/sends')>() : import('./chat/sends')

export const chatReveal = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./store/reveal')>() : import('./store/reveal')

export const chatQuoting = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./store/quote')>() : import('./store/quote')

export const chatReplies = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./commands/chats')>() : import('./commands/chats')

export const helperRun = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./helpers/run')>() : import('./helpers/run')

export const chatCommands = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./commands/index')>() : import('./commands/index')

export const sidebarParts = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./parts')>() : import('./parts')

export const rewritingStore = () => import('./rewriting.svelte')

export const loadRewriteSheet = () => import('./RewriteSheet.svelte')
