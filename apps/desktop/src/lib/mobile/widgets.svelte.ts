import { shownWords } from '@orden/markdown/escapes'
import {
  shownName,
  insideSpace,
  afterQuiet,
  frameWord,
  method,
  wordSaid,
} from '../platform/src/api'
import { todos } from '../tasks-model/src/api'
import { type Entry, workspace } from '../workspace.svelte'
import { isTile } from '../workspace/bookmarks.svelte'

const MOST = 5

export interface WidgetRow {
  name: string
  path: string
}

export interface TodayRow {
  text: string
  at: string
  space: string
  path: string
}

interface WidgetState {
  title: string
  empty: string
  notes: WidgetRow[]
  today: { title: string; empty: string; tasks: TodayRow[] }
}

export function todayRows(
  tasks: readonly { text: string; at: string; space: string }[],
  rootOf: (space: string) => string | undefined,
  most = MOST,
): TodayRow[] {
  return tasks.slice(0, most).map((one) => {
    const root = rootOf(one.space)
    const relative = one.at.replace(/#\d+:[0-9a-z]+$/, '')
    return {
      text: shownWords(one.text),
      at: one.at,
      space: one.space,
      path: root ? insideSpace(root, relative) : '',
    }
  })
}

export function widgetRows(
  notes: readonly Entry[],
  kept: readonly string[],
  most = MOST,
): WidgetRow[] {
  const rows: WidgetRow[] = []

  const add = (entry: Entry) => {
    if (rows.length >= most || rows.some((one) => one.path === entry.path)) return
    rows.push({ name: shownName(entry.name), path: entry.path })
  }

  for (const path of kept) {
    const found = notes.find((one) => one.path === path)
    if (found) add(found)
  }

  for (const one of [...notes].sort((a, b) => b.modified - a.modified)) add(one)

  return rows
}

function widgetState(today: TodayRow[]): WidgetState {
  const root = workspace.activeSpace?.root
  const kept = root
    ? workspace.bookmarks.list.filter(isTile).map((one) => insideSpace(root, one.path))
    : []

  return {
    title: workspace.activeSpace?.name ?? 'Notes',
    empty: 'Nothing here',
    notes: widgetRows(
      workspace.notes.filter((one) => !workspace.archive.has(one.path)),
      kept,
    ),
    today: { title: 'Today', empty: '', tasks: today },
  }
}

export function watchWidgets(): () => void {
  const push = method('widgets')
  if (!push) return () => undefined

  let last = ''
  let gone = false
  let today = $state<TodayRow[]>([])

  const read = async () => {
    const { listed } = await import('../task-actions')
    const tasks = listed().tasks
    today = todayRows(tasks, (space) => workspace.spaces.find((one) => one.id === space)?.root)
  }
  const reread = afterQuiet(() => void read(), 600)
  void read()

  const stop = $effect.root(() => {
    $effect(() => {
      const held = todos.todos.length
      if (!workspace.protection.seen || held < 0) return
      reread()
    })
    $effect(() => {
      const said = JSON.stringify(widgetState(today))
      if (said === last) return

      last = said
      void frameWord().then((word) => {
        if (word) {
          push(word, said)
          return
        }
        if (last === said) last = ''
        void wordSaid().then((known) => {
          if (gone || last) return
          last = JSON.stringify(widgetState(today))
          push(known, last)
        })
      })
    })
  })
  return () => {
    gone = true
    reread.cancel()
    stop()
  }
}
