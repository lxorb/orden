import { answer, type Base, cellValue, readBase, type Row } from '@orden/bases'
import { render } from 'svelte/server'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../collab/src/api', () => ({ rooms: { present: {}, following: null } }))
vi.mock('../rows/home.svelte', () => ({ homeRoot: () => '/s/Home' }))
vi.mock('../rows/rows.svelte', () => ({
  rows: {
    get shown() {
      return this.of
    },
    of: () => [],
    at: () => [],
    watch: () => () => undefined,
    write: () => Promise.resolve(true),
    inbox: () => Promise.resolve(null),
    inboxes: () => [],
  },
}))

const { contextFor } = await import('./context')
const { columnsOf, editorOf } = await import('./columns')
const { noteRow, taskRow } = await import('./fixture')
const { kitFor } = await import('./kit')
const TableLayout = (await import('./TableLayout.svelte')).default
const CardsLayout = (await import('./CardsLayout.svelte')).default
const BoardLayout = (await import('./BoardLayout.svelte')).default
const TimelineLayout = (await import('./TimelineLayout.svelte')).default
const ChartLayout = (await import('./ChartLayout.svelte')).default
const FormLayout = (await import('./FormLayout.svelte')).default
const { toneColour } = await import('./chips')
const Cell = (await import('./Cell.svelte')).default

const TODAY = '2026-10-04'

function kitOf(base: Base, rows: readonly Row[], spec = {}) {
  const context = contextFor({ rows, today: TODAY, now: `${TODAY}T10:00:00` })
  const live = {
    base,
    at: 0,
    view: base.views[0] ?? null,
    rows,
    context,
    today: TODAY,
    typed: '',
    failed: false,
    answer: answer(base, 0, rows, context),
    columns: columnsOf(base, 0, rows),
    search: () => undefined,
    change: () => Promise.resolve(),
    reload: () => Promise.resolve(),
    builder: null,
    refused: 0,
    locked: base.orden.locked === true || base.views[0]?.orden.locked === true,
    colourOf: (row: Row) => {
      const expression = base.views[0]?.orden.colour
      const tone = expression ? cellValue(base, expression, row, context) : null
      return typeof tone === 'string' ? toneColour(tone) : null
    },
  }
  return kitFor(live as unknown as Parameters<typeof kitFor>[0], spec, null, false)
}

const TASKS = [
  taskRow('Errands.md', '- [ ] Call the bank [time:: 16:00] [deadline:: 2026-10-01] ⏫', 2, {
    section: ['Errands'],
  }),
  taskRow('Errands.md', '  - [ ] Find the card', 3, { section: ['Errands'], parent: 2, indent: 2 }),
  taskRow('Errands.md', '- [ ] Milk #shop 📅 2026-10-04', 5, { section: ['Shop'] }),
  taskRow('Thesis.md', '- [/] Draft the talk [duration:: 2h] 📅 2026-10-08', 1),
]

const BUGS = readBase(`orden:
  properties:
    status:
      options:
        - { value: To do, tone: neutral }
        - { value: Doing, tone: info }
        - { value: Done, tone: success }
views:
  - type: kanban
    name: Board
    groupBy: { property: note.status, direction: ASC }
    order: [file.name, note.status, note.due]
`)
const NOTES = [
  noteRow('Bugs/Sync.md', 'status: Doing\ndue: 2026-10-06\npoints: 3'),
  noteRow('Bugs/Glass.md', 'status: To do\ndue: 2026-10-09\npoints: 5'),
]

describe('the table', () => {
  test('has a column per property and a cell per row', () => {
    const base = readBase(
      'views:\n  - type: table\n    order: [file.name, note.status, note.points]\n    summaries: { note.points: Sum }\n',
    )
    const html = render(TableLayout, { props: { kit: kitOf(base, NOTES) } }).body
    expect(html.match(/role="columnheader"/g)).toHaveLength(3)
    expect(html).toContain('Sync.md')
    expect(html).toContain('Doing')
    expect(html).toContain('8')
  })

  test('is one tab stop on its first cell before any is pressed, its header row in the grid', () => {
    const base = readBase('views:\n  - type: table\n    order: [file.name, note.status]\n')
    const html = render(TableLayout, { props: { kit: kitOf(base, NOTES) } }).body
    const stops = [...html.matchAll(/role="gridcell" tabindex="(-?\d)"/g)].map((one) => one[1])
    expect(stops).toEqual(['0', '-1', '-1', '-1'])
    expect(html).toMatch(/^(?:<!--[^>]*-->)?<div class="table[^>]*role="grid"/)
  })
})

describe('the table, as lane 7 left it', () => {
  const base = readBase(`orden:
  buttons:
    Ship:
      set: { status: Done }
  properties:
    status:
      options:
        - { value: To do, tone: '1' }
        - { value: Doing, tone: '5' }
    points:
      format: percent
views:
  - type: table
    order: [file.name, note.status, note.points, button.Ship]
    orden:
      lines: 2
      freeze: 1
      colour: 'if(status == "Doing", "4", null)'
`)
  const html = render(TableLayout, { props: { kit: kitOf(base, NOTES) } }).body

  test('wraps its rows within the lines asked for, and freezes its first column', () => {
    expect(html).toMatch(/class="table [^"]*wraps/)
    expect(html).toContain('--lines: 2')
    expect(html.match(/class="head [^"]*stuck/g)).toHaveLength(1)
  })

  test('tints a row in its conditional colour, and only that row', () => {
    expect(html.match(/class="line [^"]*toned/g)).toHaveLength(1)
    expect(html).toContain('--row-tone: var(--canvas-4)')
  })

  test('shows choices as chips in their tones, a format as itself, a button to press', () => {
    expect(html).toContain('--tone: var(--canvas-5)')
    expect(html).toContain('300%')
    expect(html.match(/class="orden-chip press/g)).toHaveLength(2)
  })
})

describe('a cell being edited', () => {
  const TAGGED = readBase(`orden:
  properties:
    tags:
      options:
        - { value: a }
        - { value: b }
        - { value: c }
views:
  - type: table
    order: [file.name, note.tags]
`)

  test('keeps a list with options a list: its chips, and the options offered to add', () => {
    const row = noteRow('One.md', 'tags: [a, c]')
    const rows = [row]
    const kit = kitOf(TAGGED, rows)
    const editor = editorOf(TAGGED, 'note.tags', rows)
    const html = render(Cell, {
      props: { row, property: 'note.tags', editor, kit, editing: true },
    }).body
    expect(html).not.toContain('<select')
    expect(html.match(/class="chip[ "]/g)).toHaveLength(2)
    const offered = /<datalist[^>]*>(.*)<\/datalist>/s.exec(html)?.[1] ?? ''
    expect([...offered.matchAll(/value="([^"]*)"/g)].map(([, one]) => one)).toEqual(['b'])
  })

  test('keeps a single choice a menu', () => {
    const row = noteRow('One.md', 'tags: a')
    const html = render(Cell, {
      props: {
        row,
        property: 'note.tags',
        editor: 'select',
        kit: kitOf(TAGGED, [row]),
        editing: true,
      },
    }).body
    expect(html).toContain('<select')
  })
})

describe('the form', () => {
  test('is a field per property under a name, and a button that sends it', () => {
    const base = readBase(`views:
  - type: form
    order: [file.name, note.status, note.due]
    orden:
      required: [status]
`)
    const html = render(FormLayout, { props: { kit: kitOf(base, NOTES) } }).body
    expect(html.match(/class="field/g)).toHaveLength(2)
    expect(html).toMatch(/class="needed/)
    expect(html).toContain('type="date"')
    expect(html).toContain('Send')
  })

  test('offers no Send where the note would land in a space shared to be read', () => {
    const base = readBase('views:\n  - type: form\n')
    const kit = Object.create(kitOf(base, NOTES), { adds: { value: false } }) as ReturnType<
      typeof kitOf
    >
    const html = render(FormLayout, { props: { kit } }).body
    expect(html).toMatch(/<button type="submit"[^>]*disabled/)
  })
})

describe('the cards', () => {
  test('are a card per row with its other properties under it', () => {
    const html = render(CardsLayout, { props: { kit: kitOf(BUGS, NOTES) } }).body
    expect(html.match(/class="card /g)).toHaveLength(2)
    expect(html).toContain('Glass')
  })
})

describe('the board', () => {
  test('keeps a column for every option, in the options’ order, empty ones too', () => {
    const html = render(BoardLayout, { props: { kit: kitOf(BUGS, NOTES) } }).body
    const heads = [
      ...html.matchAll(/class="tag[^"]*"[^>]*>\s*<span class="name[^"]*">([^<]+)</g),
    ].map(([, name]) => name)
    expect(heads).toEqual(['To do', 'Doing', 'Done'])
    expect(html).toContain('Sync')
  })
})

describe('the timeline', () => {
  test('is a bar per dated row beside its name', () => {
    const base = readBase('views:\n  - type: timeline\n    orden: { rows: tasks }\n')
    const html = render(TimelineLayout, { props: { kit: kitOf(base, TASKS) } }).body
    expect(html.match(/class="span/g)).toHaveLength(3)
    expect(html).toContain('Draft the talk')
  })
})

describe('the chart', () => {
  test('is a bar per group', () => {
    const base = readBase(
      'views:\n  - type: chart\n    groupBy: { property: note.status, direction: ASC }\n',
    )
    const html = render(ChartLayout, { props: { kit: kitOf(base, NOTES) } }).body
    expect(html.match(/<rect/g)).toHaveLength(2)
  })
})
