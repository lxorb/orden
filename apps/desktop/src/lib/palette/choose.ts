import type { OpenHow, Press, TabAsk } from '../new-tab'
import type { Destination } from '../remote/hosts'
import { howFor, linkAsk, tabAsk } from '../new-tab'
import type { Section } from '../settings.svelte'
import type { NoteToMake } from './new-note'
import type { Row } from './rows'

export interface Hands {
  openEntry(path: string, how: OpenHow): void
  openAside(path: string): void
  openPage(url: string, ask: TabAsk): void
  activate(tab: string): void
  openAtHeading(path: string, heading: string, how: OpenHow): void
  openAtBlock(target: string, how: OpenHow): void
  revealFolder(path: string): void
  searchFor(words: string): void
  openGraph(view: string | undefined): void
  showSetting(section: Section, landing: string | null): void
  make(note: NoteToMake): void
  agents(): void
  goto(line: number): void
  openHost(id: string): void
  connect(wanted: Destination): void
  openMessage(path: string, message: string, how: OpenHow): void
}

export type Chosen = 'close' | 'stay' | 'nothing'

function openFile(path: string, press: Press | undefined, hands: Hands) {
  const ask = press ? linkAsk(press) : 'plain'
  if (ask === 'aside') hands.openAside(path)
  else hands.openEntry(path, howFor(ask))
}

export function choose(row: Row, press: Press | undefined, hands: Hands): Chosen {
  const ask = press ? tabAsk(press) : 'plain'

  switch (row.kind) {
    case 'command':
      if (row.command.disabled) return 'nothing'
      row.command.run()
      return 'close'
    case 'note':
      openFile(row.entry.path, press, hands)
      return 'close'
    case 'tab':
      if (press && linkAsk(press) !== 'plain' && row.tab.path) openFile(row.tab.path, press, hands)
      else if (ask !== 'plain' && row.tab.url) hands.openPage(row.tab.url, ask)
      else hands.activate(row.tab.id)
      return 'close'
    case 'page':
    case 'address':
      hands.openPage(row.url, ask)
      return 'close'
    case 'setting': {
      const field = row.setting.field
      if (field?.kind === 'switch') {
        field.set(!field.get())
        return 'stay'
      }
      if (field?.kind === 'value') {
        field.press()
        return 'stay'
      }
      hands.showSetting(row.setting.section, row.setting.row ? row.setting.label : null)
      return 'close'
    }
    case 'bookmark':
      return openBookmark(row, ask, hands)
    case 'make':
      hands.make(row.make)
      return 'close'
    case 'agents':
      hands.agents()
      return 'close'
    case 'place':
      hands.goto(row.line)
      return 'close'
    case 'host':
      hands.openHost(row.host.id)
      return 'close'
    case 'connect':
      hands.connect(row.wanted)
      return 'close'
    case 'message':
      hands.openMessage(row.path, row.id, howFor(ask))
      return 'close'
  }
}

function openBookmark(row: Extract<Row, { kind: 'bookmark' }>, ask: TabAsk, hands: Hands): Chosen {
  const mark = row.mark
  const how = howFor(ask)

  switch (mark.kind) {
    case 'folder':
      if (row.path) hands.revealFolder(row.path)
      break
    case 'heading':
      hands.openAtHeading(mark.path, mark.text, how)
      break
    case 'block':
      hands.openAtBlock(mark.path, how)
      break
    case 'search':
      hands.searchFor(mark.text)
      break
    case 'graph':
      hands.openGraph(mark.view)
      break
    case 'note':
      if (row.path) hands.openEntry(row.path, how)
      break
    case 'group':
      return 'nothing'
  }

  return 'close'
}
