import { foldName } from '@orden/markdown/links'
import type { Command } from '../commands'
import { fileMark } from '../file-mark'
import {
  shownName,
  rowName,
  folderOf,
  insideSpace,
  relativeTo,
  withinSpace,
} from '../platform/src/api'
import { frecency as visitWeight, shownAddress } from '../web-tab/src/omnibox'
import type { Visit } from '../web-tab/src/api'
import type { Host } from '../terminal/src/api'
import type { Bookmark } from '../workspace/bookmarks.svelte'
import type { TabKind } from '../workspace/documents.svelte'
import type { Entry } from '../workspace.svelte'
import type { Candidate, Kind } from './rank'
import type { OpenTab, Row } from './rows'
import type { Setting } from './settings'

export interface World {
  root: string
  files: readonly Entry[]
  tabs: readonly OpenTab[]
  active: string | null
  focused: TabKind | null
  recent: readonly string[]
  bookmarks: readonly Bookmark[]
  commands: readonly Command[]
  pages: readonly Visit[]
  settings: readonly Setting[]
  hosts: readonly Host[]
  worth: (key: string) => number
  now: number
  addressOf?: (path: string) => string | null
}

const LIFT = {
  bookmarked: 6,
  recent: 8,
  here: -24,
  unavailable: -30,
  about: 12,
}

const noteKey = (path: string) => `note:${path}`
const pageKey = (url: string) => `page:${url}`

function addressOf(url: string): string {
  try {
    return shownAddress(url)
  } catch {
    return url
  }
}

function tabKey(tab: OpenTab): string {
  return tab.path ? noteKey(tab.path) : tab.url ? pageKey(tab.url) : `tab:${tab.id}`
}

export function rowKey(row: Row): string | null {
  switch (row.kind) {
    case 'note':
      return noteKey(row.entry.path)
    case 'tab':
      return tabKey(row.tab)
    case 'command':
      return `command:${row.command.id}`
    case 'page':
      return pageKey(row.url)
    case 'setting':
      return `setting:${row.setting.section}/${row.setting.label}`
    case 'bookmark':
      return `bookmark:${row.mark.kind}:${row.mark.path}#${row.mark.text}`
    case 'host':
      return `host:${row.host.id}`
    case 'group':
      return `hosts:${row.group}`
    case 'place':
    case 'make':
    case 'agents':
    case 'address':
    case 'connect':
    case 'message':
      return null
  }
}

interface Readings {
  names?: readonly string[]
  also?: readonly string[]
  lift?: number
  more?: number
}

function candidate(
  kind: Kind,
  name: string,
  item: Row,
  world: World,
  { names = [], also = [], lift = 0, more = 0 }: Readings = {},
): Candidate<Row> {
  const key = rowKey(item)
  const fold = (list: readonly string[]) => list.filter(Boolean).map(foldName)

  return {
    key,
    kind,
    name: foldName(name),
    names: fold(names),
    also: fold(also),
    lift,
    use: (key ? world.worth(key) : 0) + more,
    item,
  }
}

const hostOf = (address: string) => address.split('/')[0] ?? address

interface Reading {
  root: string
  key: string
  alike: string
  folder: string | null
  name: string
  also: string[]
}

const readings = new WeakMap<Entry, Reading>()

function readingOf(entry: Entry, root: string): Reading {
  const kept = readings.get(entry)
  if (kept?.root === root) return kept

  const shown = shownName(entry.name)
  const relative = relativeTo(root, entry.path)
  const reading: Reading = {
    root,
    key: noteKey(entry.path),
    alike: shown.toLowerCase(),
    folder: folderOf(relative) || null,
    name: foldName(shown),
    also: [shownName(relative)].filter(Boolean).map(foldName),
  }
  readings.set(entry, reading)
  return reading
}

function sharing(files: readonly Entry[], root: string): (alike: string) => boolean {
  const named = new Map<string, number>()
  for (const one of files) {
    const { alike } = readingOf(one, root)
    named.set(alike, (named.get(alike) ?? 0) + 1)
  }

  return (alike) => (named.get(alike) ?? 0) > 1
}

function recentFirst(files: readonly Entry[], place: ReadonlyMap<string, number>): Entry[] {
  const lately: Entry[] = []
  const rest: Entry[] = []
  for (const entry of files) (place.has(entry.path) ? lately : rest).push(entry)

  lately.sort((a, b) => (place.get(a.path) ?? 0) - (place.get(b.path) ?? 0))
  return [...lately, ...rest]
}

export function candidates(world: World): Candidate<Row>[] {
  const out: Candidate<Row>[] = []
  const shared = sharing(world.files, world.root)
  const place = new Map(world.recent.map((path, index) => [path, index]))
  const recency = (path: string) => {
    const at = place.get(path)
    return at === undefined ? 0 : LIFT.recent * (1 - at / Math.max(world.recent.length, 1))
  }

  const marked = new Set(
    world.bookmarks
      .filter((one) => one.kind === 'note')
      .map((one) => insideSpace(world.root, one.path)),
  )
  const lifted = (path: string) => recency(path) + (marked.has(path) ? LIFT.bookmarked : 0)

  const open = new Set<string>()
  const openPages = new Set<string>()
  for (const tab of world.tabs) {
    const key = tabKey(tab)
    if (open.has(key)) continue
    open.add(key)
    if (tab.url) openPages.add(tab.url)

    const relative = tab.path ? withinSpace(world.root, tab.path) : null
    const folder = relative ? folderOf(relative) || null : null
    out.push(
      candidate(
        'tab',
        tab.shown,
        { kind: 'tab', tab, folder, shared: shared(shownName(tab.shown).toLowerCase()) },
        world,
        {
          names: tab.url ? [hostOf(addressOf(tab.url))] : [],
          also: [relative ? shownName(relative) : '', tab.url ? addressOf(tab.url) : ''],
          lift: (tab.id === world.active ? LIFT.here : 0) + (tab.path ? lifted(tab.path) : 0),
        },
      ),
    )
  }

  for (const entry of recentFirst(world.files, place)) {
    const reading = readingOf(entry, world.root)
    if (open.has(reading.key)) continue

    const url = world.addressOf?.(entry.path) ?? null
    const address = url ? foldName(addressOf(url)) : null

    out.push({
      key: reading.key,
      kind: 'note',
      name: reading.name,
      names: address ? [hostOf(address)] : [],
      also: address ? [...reading.also, address] : reading.also,
      lift: lifted(entry.path),
      use: world.worth(reading.key),
      item: { kind: 'note', entry, folder: reading.folder, shared: shared(reading.alike) },
    })
  }

  out.push(...bookmarkCandidates(world))

  for (const command of world.commands) {
    const lift =
      (command.disabled ? LIFT.unavailable : 0) +
      (world.focused && command.id.startsWith(`${world.focused}-`) ? LIFT.about : 0)
    out.push(
      candidate('command', command.label, { kind: 'command', command }, world, {
        lift,
        also: command.also ?? [],
      }),
    )
  }

  for (const visit of world.pages) {
    if (openPages.has(visit.url)) continue

    const address = addressOf(visit.url)
    out.push(
      candidate(
        'page',
        visit.title || address,
        { kind: 'page', url: visit.url, title: visit.title || address, address },
        world,
        { names: [hostOf(address)], also: [address], more: visitWeight(visit, world.now) / 4 },
      ),
    )
  }

  for (const host of world.hosts) {
    out.push(
      candidate('host', host.name, { kind: 'host', host }, world, {
        names: host.also,
        also: [host.detail ?? '', host.group ?? ''],
      }),
    )
  }

  const groups = __EVEN_PLUGIN__
    ? []
    : [...new Set(world.hosts.flatMap((host) => (host.group ? [host.group] : [])))]
  for (const group of groups) {
    const hosts = world.hosts.filter((host) => host.group === group)
    out.push(
      candidate('host', group, { kind: 'group', group, hosts }, world, {
        also: hosts.map((host) => host.name),
      }),
    )
  }

  const commanded = new Set(world.commands.map((one) => foldName(one.label)))
  for (const setting of world.settings) {
    if (commanded.has(foldName(setting.label))) continue

    out.push(
      candidate('setting', setting.label, { kind: 'setting', setting }, world, {
        names: setting.names,
        also: [setting.where, ...setting.words],
      }),
    )
  }

  return out
}

function bookmarkCandidates(world: World): Candidate<Row>[] {
  const out: Candidate<Row>[] = []
  const files = new Map(world.files.map((one) => [one.path, one]))

  for (const mark of world.bookmarks) {
    if (mark.kind === 'note' || mark.kind === 'group') continue

    if (mark.kind === 'search' || mark.kind === 'graph') {
      out.push(
        candidate(
          'bookmark',
          mark.text,
          { kind: 'bookmark', mark, label: mark.text, note: null, path: null, file: null },
          world,
        ),
      )
      continue
    }

    const inside = mark.kind === 'block' ? (mark.path.split('#')[0] ?? '') : mark.path
    const path = insideSpace(world.root, inside)
    const folder = mark.kind === 'folder'
    const entry = files.get(path)
    if (!entry && !folder) continue

    const name = entry ? shownName(entry.name) : rowName(inside.split('/').at(-1) ?? inside, true)
    const label = folder ? name : mark.text
    out.push(
      candidate(
        'bookmark',
        label,
        {
          kind: 'bookmark',
          mark,
          label,
          note: folder ? null : name,
          path,
          file: folder ? 'file' : fileMark(entry?.name ?? ''),
        },
        world,
        { also: [folder ? inside : name] },
      ),
    )
  }

  return out
}

export function headingCandidates(
  headings: readonly { line: number; text: string; level: number }[],
  nested: boolean,
): Candidate<Row>[] {
  const top = headings.reduce((least, one) => Math.min(least, one.level), Infinity)

  return headings.map((one) => ({
    key: null,
    kind: 'heading',
    name: foldName(one.text),
    names: [],
    also: [],
    lift: 0,
    use: 0,
    item: {
      kind: 'place',
      line: one.line,
      text: one.text,
      depth: nested ? one.level - top : 0,
      hint: null,
    },
  }))
}

export function resting(
  all: readonly Candidate<Row>[],
  world: Pick<World, 'recent' | 'active'>,
  last: (key: string) => number | null,
  most: number,
): Row[] {
  const here = (one: Candidate<Row>) => one.item.kind === 'tab' && one.item.tab.id === world.active

  const byKey = new Map<string, Candidate<Row>>()
  for (const one of all) {
    if (one.key && !here(one) && !byKey.has(one.key)) byKey.set(one.key, one)
  }

  const timed: { one: Candidate<Row>; at: number }[] = []
  for (const [key, one] of byKey) {
    const at = last(key)
    if (at !== null) timed.push({ one, at })
  }

  const out = new Set(timed.sort((a, b) => b.at - a.at).map(({ one }) => one))
  for (const path of world.recent) {
    const one = byKey.get(noteKey(path))
    if (one) out.add(one)
  }
  for (const one of all) {
    if (out.size >= most) break
    if (one.item.kind === 'note') out.add(one)
  }

  return [...out].slice(0, most).map((one) => one.item)
}
