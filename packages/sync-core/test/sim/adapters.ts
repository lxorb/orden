import type { Times } from '../../src/diverge'
import type { EntryKind } from '../../src/wire'

export type Route = 'ops' | 'feed' | 'pull' | 'push' | 'keep'

export interface EntryView {
  id: string
  kind: EntryKind
  parent: string | null
  name: string
  pos?: string
}

export interface View {
  entries: EntryView[]
  texts: Record<string, string>
}

export interface AccountView extends View {
  versions: string[]
}

export interface AccountAdapter {
  handle(device: string, route: Route, body: Uint8Array): Promise<Uint8Array>
  view(): Promise<AccountView>
}

export type Link = (route: Route, body: Uint8Array) => Promise<Uint8Array | null>

export type Pick = number

export type Action =
  | { t: 'type'; note: Pick; at: number; words: string }
  | { t: 'cut'; note: Pick; at: number; length: number }
  | { t: 'drop-paragraph'; note: Pick; at: number }
  | { t: 'create'; folder: Pick | null; name: string; words: string }
  | { t: 'mkdir'; folder: Pick | null; name: string }
  | { t: 'rename'; target: Pick; name: string }
  | { t: 'move'; target: Pick; folder: Pick | null }
  | { t: 'delete'; target: Pick }
  | { t: 'restore'; id: string }
  | { t: 'place'; target: Pick; at: number }
  | { t: 'append-day'; name: string; words: string }
  | { t: 'edit-file'; note: Pick; at: number; words: string; cut: number }
  | { t: 'save' }

export interface Held {
  id: string
  base: string
  local: string
  remote: string
  times: Times
}

export interface Classification {
  id: string
  base: string
  local: string
  remote: string
  times: Times
  merged?: string
  held: boolean
}

export type Answer = 'mine' | 'theirs' | 'both'

export interface DeviceAdapter {
  readonly id: string
  readonly running: boolean
  act(action: Action): Promise<void>
  pass(link: Link): Promise<void>
  held(): readonly Held[]
  answer(id: string, choice: Answer): Promise<void>
  quit(): Promise<void>
  crash(): Promise<void>
  launch(): Promise<void>
  view(): Promise<View>
  classified(): Classification[]
}
