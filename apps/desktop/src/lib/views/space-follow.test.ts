import { readBase, writeBase, builtinView } from '@orden/bases'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const { memoryStorage } = await import('../../../test/disk')
vi.stubGlobal('localStorage', memoryStorage())

const tabs = vi.hoisted(() => [] as ReturnType<typeof tabOf>[])
const place = vi.hoisted(
  (): { spaces: { id: string; name: string; root: string }[]; active: string | null } => ({
    spaces: [{ id: 'j', name: 'Job', root: '/s/Job' }],
    active: 'Job',
  }),
)
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

const {
  foldsOf,
  forgetSpaceViews,
  keepFolds,
  keepProjectView,
  keepTodosView,
  projectView,
  renamedTo,
  spaceRenamed,
  todosView,
} = await import('./kept-views')
const { followSpaceName, forgetSpaceTabs } = await import('./space-follow')
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

describe('a tab about a space no space is called', () => {
  const lost = () =>
    tabOf(
      writeSpec({ builtin: 'project', space: 'Work', path: 'Plan.md', yaml: projectIn('Work') }),
    )
  const planIn = (space: string) =>
    builtinView('project', { note: { space, path: 'Plan.md' } }).views[0]?.filters

  test('with a record of the rename, comes to the name it has now', async () => {
    keepProjectView('Work', 'Plan.md', projectIn('Work'))
    spaceRenamed('Work', 'Mid')
    spaceRenamed('Mid', 'Job')
    const tab = lost()
    tabs.push(tab)
    const base = await tabSource(tab as never).load()
    expect(readSpec(tab.doc)?.space).toBe('Job')
    expect(base.views[0]?.filters).toEqual(planIn('Job'))
    expect(projectView('Job', 'Plan.md')).toBeUndefined()
  })

  test('with none, says it cannot be read, and touches nothing of the open space', async () => {
    keepProjectView('Work', 'Plan.md', projectIn('Work'))
    keepProjectView('Job', 'Plan.md', projectIn('Job'))
    const tab = lost()
    const words = tab.doc
    tabs.push(tab)
    await expect(tabSource(tab as never).load()).rejects.toThrow()
    expect(tab.doc).toBe(words)
    expect(projectView('Job', 'Plan.md')).toBe(projectIn('Job'))
    expect(projectView('Work', 'Plan.md')).toBe(projectIn('Work'))
  })

  test('with a record of a space since gone, likewise', async () => {
    spaceRenamed('Work', 'Gone')
    await expect(tabSource(lost() as never).load()).rejects.toThrow()
    forgetSpaceViews('Gone')
    expect(renamedTo('Work')).toBeUndefined()
  })

  test('of a space that is there is left alone', async () => {
    const words = writeSpec({ builtin: 'project', space: 'Job', path: 'Plan.md' })
    const tab = tabOf(words)
    await tabSource(tab as never).load()
    expect(tab.doc).toBe(words)
    expect(builtinBase(readSpec(words) ?? {}).views[0]?.filters).toEqual(planIn('Job'))
  })

  test('with no list of spaces yet, waits', async () => {
    place.spaces = []
    const words = writeSpec({ builtin: 'project', space: 'Work', path: 'Plan.md' })
    const tab = tabOf(words)
    await tabSource(tab as never).load()
    expect(tab.doc).toBe(words)
    place.spaces = [{ id: 'j', name: 'Job', root: '/s/Job' }]
  })
})

describe('Todos, one list of every space (#1153)', () => {
  const every = builtinView('todos').views[0]?.filters

  test('a tab an older build kept for one space becomes every space’s', async () => {
    const tab = tabOf(writeSpec({ builtin: 'todos', space: 'Work', yaml: todosIn('Work') }))
    tabs.push(tab)
    const base = await tabSource(tab as never).load()
    expect(readSpec(tab.doc)).toEqual({ builtin: 'todos' })
    expect(base.views[0]?.filters).toEqual(every)
  })

  test('starts as the open space’s was left, with that space taken out of it, kept once', () => {
    keepTodosView('Job', todosIn('Job'))
    const base = builtinBase({ builtin: 'todos' })
    expect(base.views[0]?.type).toBe('kanban')
    expect(base.views[0]?.filters).toEqual(every)
    place.active = null
    expect(builtinBase({ builtin: 'todos' }).views[0]?.type).toBe('kanban')
  })

  test('put back as Orden ships it, stays so, and takes no space’s old layout again', async () => {
    keepTodosView('Job', todosIn('Job'))
    expect(builtinBase({ builtin: 'todos' }).views[0]?.type).toBe('kanban')
    const tab = tabOf(writeSpec({ builtin: 'todos' }))
    await tabSource(tab as never).save(builtinView('todos'))
    expect(builtinBase({ builtin: 'todos' }).views[0]?.type).toBe(
      builtinView('todos').views[0]?.type,
    )
  })

  test('is the same list whatever space is open', async () => {
    const tab = tabOf(writeSpec({ builtin: 'todos' }))
    await tabSource(tab as never).save(readBase(narrowed(builtinView('todos'))))
    place.active = null
    expect(builtinBase({ builtin: 'todos' }).views[0]?.type).toBe('kanban')
    expect(todosView('Job')).toBeUndefined()
  })

  test('narrowed to a space, follows it when it is renamed', () => {
    const base = builtinView('todos')
    const [view] = base.views
    const yaml = writeBase({
      ...base,
      views: view ? [{ ...view, nib: { ...view.nib, kept: { only: { space: 'Work' } } } }] : [],
    })
    const tab = tabOf(writeSpec({ builtin: 'todos', yaml }))
    keepTodosView('', yaml)
    followSpaceName('Work', 'Job', [tab], [])
    const only = (words: string | undefined) =>
      readBase(words ?? '').views[0]?.nib.kept.only as { space?: string } | undefined
    expect(only(readSpec(tab.doc)?.yaml)?.space).toBe('Job')
    expect(only(todosView(''))?.space).toBe('Job')
  })

  test('narrowed to a note of a space, follows it when the space is renamed or goes', () => {
    const base = builtinView('todos')
    const [view] = base.views
    const yaml = writeBase({
      ...base,
      views: view
        ? [{ ...view, nib: { ...view.nib, kept: { only: { project: 'Work//Plan.md' } } } }]
        : [],
    })
    keepTodosView('', yaml)
    const only = () => builtinBase({ builtin: 'todos' }).views[0]?.nib.kept.only
    followSpaceName('Work', 'Job', [], [])
    expect(only()).toEqual({ project: 'Job//Plan.md' })
    forgetSpaceViews('Job')
    expect(only()).toBeUndefined()
  })
})

describe('what a deleted space kept', () => {
  test('goes with it, so a space named so later starts as Orden ships it', () => {
    keepTodosView('Old', todosIn('Old'))
    keepProjectView('Old', 'Plan.md', projectIn('Old'))
    keepFolds('todos:Old', new Set(['later']))
    keepFolds('project:Old/Plan.md', new Set(['Shop']))
    forgetSpaceViews('Old')
    expect(todosView('Old')).toBeUndefined()
    expect(projectView('Old', 'Plan.md')).toBeUndefined()
    expect([...foldsOf('todos:Old')]).toEqual([])
    expect([...foldsOf('project:Old/Plan.md')]).toEqual([])
  })

  test('and every space’s Todos narrowed to it is narrowed no more', () => {
    const base = builtinView('todos')
    const [view] = base.views
    keepTodosView(
      '',
      writeBase({
        ...base,
        views: view ? [{ ...view, nib: { ...view.nib, kept: { only: { space: 'Old' } } } }] : [],
      }),
    )
    forgetSpaceViews('Old')
    expect(builtinBase({ builtin: 'todos' }).views[0]?.nib.kept.only).toBeUndefined()
  })

  test('and a tab of every space narrowed to it keeps the rest of its narrowing', () => {
    const base = builtinView('todos')
    const [view] = base.views
    const only = { space: 'Old', priority: 1 }
    const yaml = writeBase({
      ...base,
      views: view ? [{ ...view, nib: { ...view.nib, kept: { only } } }] : [],
    })
    const tab = tabOf(writeSpec({ builtin: 'todos', yaml }))
    forgetSpaceTabs('Old', [tab])
    expect(readBase(readSpec(tab.doc)?.yaml ?? '').views[0]?.nib.kept.only).toEqual({
      priority: 1,
    })
  })

  test('and a rename onto a name left behind brings its own, not what stood there', () => {
    keepTodosView('Old', todosIn('Old'))
    keepProjectView('Old', 'Plan.md', projectIn('Old'))
    keepProjectView('Fresh', 'Plan.md', projectIn('Fresh'))
    keepFolds('todos:Old', new Set(['stale']))
    keepFolds('project:Old/Plan.md', new Set(['stale']))
    keepFolds('project:Fresh/Plan.md', new Set(['mine']))
    followSpaceName('Fresh', 'Old', [], [])
    expect(todosView('Old')).toBeUndefined()
    expect(readBase(projectView('Old', 'Plan.md') ?? '').views[0]?.filters).toEqual(
      builtinView('project', { note: { space: 'Old', path: 'Plan.md' } }).views[0]?.filters,
    )
    expect([...foldsOf('todos:Old')]).toEqual([])
    expect([...foldsOf('project:Old/Plan.md')]).toEqual(['mine'])
  })
})

describe('two spaces of one name', () => {
  test('a rename of one cannot say whose a tab is, and moves nothing', () => {
    const words = writeSpec({ builtin: 'todos', space: 'Work' })
    const tab = tabOf(words)
    followSpaceName('Work', 'Job', [tab], [{ name: 'Work' }])
    expect(tab.doc).toBe(words)
    expect(renamedTo('Work')).toBeUndefined()
  })
})
