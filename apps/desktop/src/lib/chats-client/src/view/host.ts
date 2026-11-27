import type { Message } from '@orden/chats'
import type { OpenHow } from '@orden/contracts'
import type { LinkPress, LinkWrite, ModeSettings, NoteIndex, NoteOpener } from '@orden/editor'
import type { ChatEntry } from '../shapes'
import type { ChatPage } from './chat.svelte'

export interface MembersWidth {
  readonly narrowest: number
  readonly widest: number
  readonly pixels: number | null
  readonly dragging: boolean
  step(key: string, panel: HTMLElement | undefined): boolean
  start(event: PointerEvent, panel: HTMLElement | undefined): void
  reset(): void
}
export interface ChatsView {
  here(chats: readonly ChatEntry[]): ChatEntry[]
  opens(entry: ChatEntry): boolean
  isOpen(entry: ChatEntry): boolean
  openEntry(entry: ChatEntry, message?: string, how?: OpenHow): void
  showChat(path: string, name: string, how: OpenHow): boolean
  showChats(): void
  activeRoot(): string | null
  makesIn(): string | null
  freeName(dir: string, name: string): string
  loadTree(): void
  canWrite(path: string): boolean
  remove(path: string): Promise<void>
  rename(path: string, name: string): Promise<void>
  carried(transfer: DataTransfer | null): { notes: readonly string[]; address: string | null }
  followHref(href: string, press: LinkPress): void
  openRelative(relative: string, from: string | null): void
  rootHolding(path: string | null): string | null
  linkTarget(from: string | null, target: string): string | null
  linksVersion(): number
  locksSeen(): string
  noteIndex(path: string | null): NoteIndex | undefined
  noteOpener(from: string | null): NoteOpener | undefined
  writeLink(): ((target: LinkWrite) => string) | undefined
  editorModes(): ModeSettings | null
  noteLocked(path: string): boolean
  noteText(path: string): Promise<string | null>
  openNote(path: string): void
  retired(chat: string): boolean
  membersWidth(): MembersWidth
  keeps(entry: ChatEntry | null): boolean
  saveAsNote: ((page: ChatPage, message: Message, space: string | null) => Promise<void>) | null
  addAsTask: ((page: ChatPage, message: Message, space: string | null) => void) | null
  askOrden: ((chat: string, question: string, parent?: string) => Promise<void>) | null
}
const FIXED: MembersWidth = {
  narrowest: 0,
  widest: 0,
  pixels: null,
  dragging: false,
  step: () => false,
  start: () => undefined,
  reset: () => undefined,
}
const NOWHERE: ChatsView = {
  here: (chats) => [...chats],
  opens: () => false,
  isOpen: () => false,
  openEntry: () => undefined,
  showChat: () => false,
  showChats: () => undefined,
  activeRoot: () => null,
  makesIn: () => null,
  freeName: (_dir, name) => name,
  loadTree: () => undefined,
  canWrite: () => false,
  remove: () => Promise.resolve(),
  rename: () => Promise.resolve(),
  carried: () => ({ notes: [], address: null }),
  followHref: () => undefined,
  openRelative: () => undefined,
  rootHolding: () => null,
  linkTarget: () => null,
  linksVersion: () => 0,
  locksSeen: () => '',
  noteIndex: () => undefined,
  noteOpener: () => undefined,
  writeLink: () => undefined,
  editorModes: () => null,
  noteLocked: () => false,
  noteText: () => Promise.resolve(null),
  openNote: () => undefined,
  retired: () => false,
  membersWidth: () => FIXED,
  keeps: () => false,
  saveAsNote: null,
  addAsTask: null,
  askOrden: null,
}
let held: ChatsView = NOWHERE
export const host = (): ChatsView => held
export function hostChats(view: Partial<ChatsView>): () => void {
  const before = held
  held = { ...NOWHERE, ...view }
  return () => {
    held = before
  }
}
