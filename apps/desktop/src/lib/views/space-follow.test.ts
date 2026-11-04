import { readBase, writeBase, builtinView } from '@orden/bases'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const { memoryStorage } = await import('../../../test/disk')
vi.stubGlobal('localStorage', memoryStorage())

const tabs = vi.hoisted(() => [] as ReturnType<typeof tabOf>[])
const place = vi.hoisted(() => ({
  spaces: [{ id: 'j', name: 'Job', root: '/s/Job' }],
  active: 'Job' as string | null,
}))
function tabOf(doc: string) {
  const tab = {
    kind: 'view',
    path: null as string | null,
    doc,
    note: {
      replace: (words: string) => {
        tab.doc = words
      },
    },
  }
  return tab
}
vi.mock('../workspace.svelte', () => ({
  workspace: {
    get spaces() {
      return place.spaces
    },
    get activeSpace() {
      return place.spaces.find((one) => one.name === place.active)
    },
    get tabs() {
      return tabs
    },
    scheduleSession: () => undefined,
    fileOps: { follow: () => undefined },
  },
}))
vi.mock('../rows/rows.svelte', () => ({ rows: { inboxes: () => [], of: () => [] } }))
vi.mock('../link-index.svelte', () => ({ links: {} }))

const { foldsOf, keepFolds, keepProjectView, keepTodosView, projectView, todosView } =
  await import('./kept-views')
const { followSpaceName } = await import('./space-follow')
const { builtinBase, tabSource } = await import('./source')
const { readSpec, writeSpec } = await import('./spec')

const narrowed = (base: ReturnType<typeof builtinView>) => {
  const [view] = base.views
  return writeBase({ ...base, views: view ? [{ ...view, type: 'kanban' }] : [] })
}
const todosIn = (space: string) => narrowed(builtinView('todos', { space }))
const projectIn = (space: string) =>
  narrowed(builtinView('project', { note: { space, path: 'Plan.md' } }))

beforeEach(() => {
  localStorage.clear()
  tabs.length = 0
  place.active = 'Job'
})

describe('a space renamed', () => {
  test('takes a Todos tab with it, what it was changed to and the filter in it', () => {
    const tab = tabOf(writeSpec({ builtin: 'todos', space: 'Work', yaml: todosIn('Work') }))
    tabs.push(tab)
    followSpaceName('Work', 'Job', tabs, [])
    const spec = readSpec(tab.doc)
    expect(spec?.space).toBe('Job')
    const view = readBase(spec?.yaml ?? '').views[0]
    expect(view?.type).toBe('kanban')
    expect(view?.filters).toEqual(builtinView('todos', { space: 'Job' }).views[0]?.filters)
  })

  test('and a project tab, as a label tab, and leaves other spaces’ alone', () => {
    const project = tabOf(
      writeSpec({ builtin: 'project', space: 'Work', path: 'Plan.md', yaml: projectIn('Work') }),
    )
    const label = tabOf(writeSpec({ builtin: 'label', space: 'Work', tag: 'x' }))
    const other = tabOf(writeSpec({ builtin: 'todos', space: 'Home', yaml: todosIn('Home') }))
    const before = other.doc
    tabs.push(project, label, other)
    followSpaceName('Work', 'Job', tabs, [])
    const spec = readSpec(project.doc)
    expect(spec).toMatchObject({ space: 'Job', path: 'Plan.md' })
    expect(readBase(spec?.yaml ?? '').views[0]?.filters).toEqual(
      builtinView('project', { note: { space: 'Job', path: 'Plan.md' } }).views[0]?.filters,
    )
    expect(readSpec(label.doc)?.space).toBe('Job')
    expect(other.doc).toBe(before)
  })

  test('and what is kept on this device for it, and no other space’s', () => {
    keepTodosView('Work', todosIn('Work'))
    keepTodosView('Home', todosIn('Home'))
    keepProjectView('Work', 'Plan.md', projectIn('Work'))
    keepProjectView('Home', 'Plan.md', projectIn('Home'))
    keepFolds('todos:Work', new Set(['later']))
    keepFolds('project:Work/Plan.md', new Set(['Shop']))
    keepFolds('todos:Home', new Set(['today']))

    followSpaceName('Work', 'Job', [], [])

    expect(todosView('Work')).toBeUndefined()
    expect(readBase(todosView('Job') ?? '').views[0]?.filters).toEqual(
      builtinView('todos', { space: 'Job' }).views[0]?.filters,
    )
    expect(projectView('Work', 'Plan.md')).toBeUndefined()
    expect(projectView('Job', 'Plan.md')).toContain('Job')
    expect(todosView('Home')).toBe(todosIn('Home'))
    expect(projectView('Home', 'Plan.md')).toBe(projectIn('Home'))
    expect([...foldsOf('todos:Job')]).toEqual(['later'])
    expect([...foldsOf('project:Job/Plan.md')]).toEqual(['Shop'])
    expect([...foldsOf('todos:Home')]).toEqual(['today'])
    expect([...foldsOf('todos:Work')]).toEqual([])
  })

  test('narrowed by hand, a filter that names the space follows at any depth', () => {
    const base = builtinView('todos', { space: 'Work' })
    const [view] = base.views
    const yaml = writeBase({
      ...base,
      views: view
        ? [{ ...view, filters: { or: ['file.space == "Work" && task.done', 'task.started'] } }]
        : [],
    })
    const tab = tabOf(writeSpec({ builtin: 'todos', space: 'Work', yaml }))
    followSpaceName('Work', 'Job', [tab], [])
    expect(readBase(readSpec(tab.doc)?.yaml ?? '').views[0]?.filters).toEqual({
      or: ['file.space == "Job" && task.done', 'task.started'],
    })
  })

  test('with another space still of that name, nothing kept under it moves', () => {
    keepTodosView('Work', todosIn('Work'))
    followSpaceName('Work', 'Job', [], [{ name: 'Work' }])
    expect(todosView('Work')).toBe(todosIn('Work'))
    expect(todosView('Job')).toBeUndefined()
  })
})

describe('a tab of a space renamed before it followed', () => {
  test('comes to the open space when it is read, what was kept with it', async () => {
    keepTodosView('Work', todosIn('Work'))
    const tab = tabOf(writeSpec({ builtin: 'todos', space: 'Work', yaml: todosIn('Work') }))
    tabs.push(tab)
    const base = await tabSource(tab as never).load()
    expect(readSpec(tab.doc)?.space).toBe('Job')
    expect(base.views[0]?.filters).toEqual(builtinView('todos', { space: 'Job' }).views[0]?.filters)
    expect(todosView('Job')).toBeDefined()
    expect(todosView('Work')).toBeUndefined()
  })

  test('of a space that is there is left alone', async () => {
    const words = writeSpec({ builtin: 'todos', space: 'Job' })
    const tab = tabOf(words)
    await tabSource(tab as never).load()
    expect(tab.doc).toBe(words)
    expect(builtinBase(readSpec(words) ?? {}).views[0]?.filters).toEqual(
      builtinView('todos', { space: 'Job' }).views[0]?.filters,
    )
  })

  test('with no space open, waits', async () => {
    place.active = null
    const words = writeSpec({ builtin: 'todos', space: 'Work' })
    const tab = tabOf(words)
    await tabSource(tab as never).load()
    expect(tab.doc).toBe(words)
  })
})
