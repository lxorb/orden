import type { Command } from '../commands'
import type { FileMark } from '../file-mark'
import type { Destination, Host } from '../remote/hosts'
import type { Bookmark } from '../workspace/bookmarks.svelte'
import type { TabKind } from '../workspace/documents.svelte'
import type { Entry } from '../workspace.svelte'
import type { NoteToMake } from './new-note'
import type { Setting } from './settings'

export interface OpenTab {
  id: string
  kind: TabKind
  path: string | null
  shown: string
  url: string | null
}

export type Row =
  | { kind: 'note'; entry: Entry; folder: string | null; shared: boolean }
  | { kind: 'tab'; tab: OpenTab; folder: string | null; shared: boolean }
  | { kind: 'command'; command: Command }
  | {
      kind: 'bookmark'
      mark: Bookmark
      label: string
      note: string | null
      path: string | null
      file: FileMark | null
    }
  | { kind: 'page'; url: string; title: string; address: string }
  | { kind: 'setting'; setting: Setting }
  | { kind: 'place'; line: number; text: string; depth: number; hint: string | null }
  | { kind: 'make'; make: NoteToMake }
  | { kind: 'agents' }
  | { kind: 'address'; url: string; address: string }
  | { kind: 'host'; host: Host }
  | { kind: 'group'; group: string; hosts: readonly Host[] }
  | { kind: 'connect'; wanted: Destination; said: string }
  | {
      kind: 'message'
      chat: string
      id: string
      path: string
      line: string
      where: readonly string[]
    }
