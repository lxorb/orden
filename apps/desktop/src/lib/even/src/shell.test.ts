import { BODY_INNER, BODY_ROWS } from '@orden/glasses'
import { beforeEach, describe, expect, test } from 'vitest'
import { Session } from './session'
import {
  type Option,
  type Row,
  type SettingRow,
  type Settings,
  Shell,
  type Words,
  type World,
} from './shell'

const WORDS: Words = {
  spaces: 'Spaces',
  notes: 'Notes',
  switchSpace: 'Switch space',
  changeNote: 'Change note',
  voiceOn: 'Voice on',
  voiceOff: 'Voice off',
  thinking: 'Thinking',
  nothingHere: 'Nothing here',
  noAnswer: 'No answer',
  settings: 'Settings',
  reset: 'Reset glasses settings',
  done: 'Done',
  today: 'Today',
}

class FakeSettings implements Settings {
  numbers = true
  breakAt = '2'
  readonly resets: number[] = []

  rows = (): SettingRow[] => [
    { id: 'lineNumbers', label: 'Line numbers', value: this.numbers ? 'On' : 'Off' },
    { id: 'break', label: 'New page at', value: this.breakAt === '2' ? 'H2 and above' : 'Never' },
  ]

  tap = (id: string): readonly Option[] | null => {
    if (id === 'lineNumbers') {
      this.numbers = !this.numbers
      return null
    }

    return [
      { value: '2', label: 'H2 and above' },
      { value: '0', label: 'Never' },
    ]
  }

  pick = (id: string, value: string) => {
    if (id === 'break') this.breakAt = value
  }

  reset = () => void this.resets.push(1)
}

const paging = { breakAt: 2, gutter: 0, inner: BODY_INNER, rows: BODY_ROWS }

const NOTE = [
  '# The title',
  '',
  'Words under the title, enough of them to run past one line of the panel.',
  '',
  '## A section',
  '',
  'More words in the section.',
  '',
].join('\n')

function row(label: string, over: Partial<Row> = {}): Row {
  return { label, depth: 0, folder: false, open: false, pick: true, id: label, ...over }
}

class Fake implements World {
  spaceName = 'Work'
  contentRows: Row[] = [
    row('Inbox', { folder: true, open: true }),
    row('Monday standup', { depth: 1 }),
    row('Meeting notes', { depth: 1 }),
    row('Reading list'),
  ]
  spaceRows: Row[] = [row('Work'), row('Home'), row('Orden')]
  treeRows: Row[] = [row('Inbox', { folder: true, open: false }), row('Reading list')]
  on = false
  readonly opened: string[] = []
  readonly folded: string[] = []
  readonly entered: string[] = []

  space = () => this.spaceName
  contents = () => this.contentRows
  spaces = () => this.spaceRows
  tree = () => this.treeRows
  open = (id: string) => void this.opened.push(id)
  fold = (id: string) => void this.folded.push(id)
  enter = (id: string) => void this.entered.push(id)
  listen = (on: boolean) => {
    this.on = on
  }
  listening = () => this.on
  space_ = ''
  note_ = ''
  atSpace = () => this.space_
  atNote = () => this.note_
  todayRows: Row[] = [row('□ Call Mum'), row('□ Pay rent')]
  readonly ticked: string[] = []
  fresh = 0
  today = () => this.todayRows
  freshToday = () => {
    this.fresh += 1
  }
  tick = (id: string) => void this.ticked.push(id)
}

let world: Fake
let session: Session
let shell: Shell
let settings: FakeSettings

beforeEach(() => {
  world = new Fake()
  session = new Session()
  settings = new FakeSettings()
  session.follow({ key: 'a', name: 'A note', text: NOTE }, paging)
  shell = new Shell(world, () => WORDS, session, settings)
})

describe('what a gesture does', () => {
  test('a tap on the note opens the sidebar', () => {
    expect(shell.handle('tap')).toBe('draw')
    expect(shell.screen.kind).toBe('sidebar')
  })

  test('a tap on the sidebar opens the row under the cursor and closes it', () => {
    shell.handle('tap')
    shell.handle('down')
    shell.handle('tap')

    expect(world.opened).toEqual(['Monday standup'])
    expect(shell.screen.kind).toBe('note')
  })

  test('a hold opens the modal, from anywhere', () => {
    expect(shell.handle('hold')).toBe('draw')
    expect(shell.screen.kind).toBe('modal')

    shell.handle('tap')
    expect(shell.screen.kind).toBe('spaces')
    shell.handle('hold')
    expect(shell.screen.kind).toBe('modal')
  })

  test('choosing a space goes straight into that space’s notes', () => {
    shell.show('spaces')
    expect(shell.handle('tap')).toBe('draw')

    expect(world.entered).toEqual(['Work'])
    expect(shell.screen.kind).toBe('tree')
    expect(shell.handle('double')).toBe('draw')
    expect(shell.screen.kind).toBe('note')
  })

  test('a list of spaces opens on the space the reader is in', () => {
    world.space_ = 'Orden'
    shell.show('spaces')

    expect(shell.screen).toEqual({ kind: 'spaces', at: 2 })
    expect(shell.view().head.trimEnd()).toMatch(/^Spaces {2,}3\/3$/)
  })

  test('a list of notes opens on the note the reader is in', () => {
    world.note_ = 'Reading list'
    shell.show('tree')
    expect(shell.screen).toEqual({ kind: 'tree', at: 1 })

    shell.show('sidebar')
    expect(shell.screen).toEqual({ kind: 'sidebar', at: 3 })
  })

  test('and on the first row it can land on when that note is not in the list', () => {
    world.note_ = 'Somewhere else'
    shell.show('sidebar')

    expect(shell.screen).toEqual({ kind: 'sidebar', at: 0 })
  })

  test('a double tap on the note asks the system to leave the app', () => {
    expect(shell.handle('double')).toBe('leave')
    expect(shell.screen.kind).toBe('note')
  })

  test('a double tap closes whatever is open instead of leaving', () => {
    shell.handle('hold')
    shell.handle('tap')
    expect(shell.screen.kind).toBe('spaces')

    expect(shell.handle('double')).toBe('draw')
    expect(shell.screen.kind).toBe('modal')
    expect(shell.handle('double')).toBe('draw')
    expect(shell.screen.kind).toBe('note')
    expect(shell.handle('double')).toBe('leave')
  })

  test('a scroll on the note turns a page', () => {
    const before = session.showing?.page ?? 0

    shell.handle('down')
    expect(session.showing?.page).toBe(before + 1)
    shell.handle('up')
    expect(session.showing?.page).toBe(before)
  })

  test('a scroll on a list moves the cursor a row', () => {
    shell.handle('tap')

    shell.handle('down')
    shell.handle('down')
    expect(shell.screen).toMatchObject({ kind: 'sidebar', at: 2 })
    shell.handle('up')
    expect(shell.screen).toMatchObject({ kind: 'sidebar', at: 1 })
  })

  test('a cursor stops at each end rather than wrapping round', () => {
    shell.handle('tap')

    shell.handle('up')
    expect(shell.screen).toMatchObject({ at: 0 })
    for (let n = 0; n < 20; n++) shell.handle('down')
    expect(shell.screen).toMatchObject({ at: world.contentRows.length - 1 })
    expect(shell.handle('down')).toBe('none')
  })
})

describe('the note picker', () => {
  beforeEach(() => {
    shell.handle('hold')
    shell.handle('down')
    shell.handle('tap')
  })

  test('opens on the tree', () => {
    expect(shell.screen.kind).toBe('tree')
  })

  test('a tap on a folder opens it and keeps the reader where they are', () => {
    shell.handle('tap')

    expect(world.folded).toEqual(['Inbox'])
    expect(shell.screen.kind).toBe('tree')
  })

  test('a tap on a note opens it and puts the tree away', () => {
    shell.handle('down')
    shell.handle('tap')

    expect(world.opened).toEqual(['Reading list'])
    expect(shell.screen.kind).toBe('note')
  })

  test('draws a folder open or shut', () => {
    expect(shell.view().body).toContain('▶ Inbox')
    world.treeRows = [row('Inbox', { folder: true, open: true }), row('Reading list')]
    expect(shell.view().body).toContain('▼ Inbox')
  })
})

describe('the modal', () => {
  test('offers switch space, change note, the microphone and the settings', () => {
    shell.handle('hold')
    const body = shell.view().body

    expect(body).toContain('Switch space')
    expect(body).toContain('Change note')
    expect(body).toContain('Voice on')
    expect(body).toContain('Settings')
  })

  test('turns the microphone on, and the head keeps the heading', () => {
    shell.handle('hold')
    shell.handle('down')
    shell.handle('down')
    shell.handle('tap')

    expect(world.on).toBe(true)
    expect(shell.screen.kind).toBe('note')
    expect(shell.view().head).toContain('THE TITLE')
    expect(shell.view().head).not.toContain('Voice')
    expect(shell.view().mic).toBe('●')
  })

  test('offers to turn it off once it is on', () => {
    world.on = true
    shell.handle('hold')

    expect(shell.view().body).toContain('Voice off')
  })
})

describe('the view', () => {
  test('never puts more rows in the body than the panel holds', () => {
    for (const open of [() => undefined, () => shell.handle('tap'), () => shell.handle('hold')]) {
      open()
      expect(shell.view().body.split('\n').length).toBeLessThanOrEqual(BODY_ROWS)
      shell.close()
    }
  })

  test('says the section in the head, and the note and the page in the foot', () => {
    const view = shell.view()

    expect(view.rule).toMatch(/^═+$/)
    expect(view.head.trimEnd()).toMatch(/^THE TITLE {2,}1\/\d+$/)
  })

  test('and the number is there on every page, because the app turns them all', () => {
    expect(shell.view().head.trimEnd()).toMatch(/\d+\/\d+$/)

    session.turn(1)
    expect(shell.view().head.trimEnd()).toMatch(/2\/\d+$/)
  })

  test('falls back to the note name when a note opens without a heading', () => {
    session.follow({ key: 'b', name: 'Plain', text: 'Just words.\n' }, paging)

    expect(shell.view().head.trimEnd()).toMatch(/^Plain {2,}1\/1$/)
  })

  test('marks the row under the cursor, and only that one', () => {
    shell.handle('tap')
    const rows = shell.view().body.split('\n')

    expect(rows[0]?.startsWith('▶ ')).toBe(true)
    for (const row_ of rows.slice(1)) expect(row_.startsWith('▶ ')).toBe(false)
  })

  test('keeps every row of a list starting at the same pixel', () => {
    shell.handle('tap')
    const rows = shell.view().body.split('\n')

    for (const row_ of rows) expect(row_.slice(0, 2)).toMatch(/^(▶ | {2})$/)
  })

  test('says where in a list the cursor is', () => {
    shell.handle('tap')
    shell.handle('down')

    expect(shell.view().head.trimEnd()).toMatch(/^Work {2,}2\/4$/)
  })

  test('steps the cursor over a folder in the sidebar, so every tap opens a note', () => {
    world.contentRows = [
      row('Inbox', { folder: true, open: true, pick: false }),
      row('Monday standup', { depth: 1 }),
      row('Archive', { folder: true, open: true, pick: false }),
      row('Older', { depth: 1 }),
    ]
    shell.handle('tap')

    expect(shell.view().head.trimEnd()).toMatch(/ 2\/4$/)
    shell.handle('down')
    expect(shell.view().head.trimEnd()).toMatch(/ 4\/4$/)

    shell.handle('tap')
    expect(world.opened).toEqual(['Older'])
  })

  test('scrolls the window only when the cursor would leave it', () => {
    world.contentRows = Array.from({ length: 30 }, (_one, at) => row(`note ${at}`))
    shell.handle('tap')

    expect(shell.view().body.split('\n')[0]).toContain('note 0')
    for (let n = 0; n < 20; n++) shell.handle('down')
    const rows = shell.view().body.split('\n')
    expect(rows).toHaveLength(BODY_ROWS)
    expect(rows.some((one) => one.includes('▶ note 20'))).toBe(true)
  })

  test('says so when a space has nothing in it', () => {
    world.contentRows = []
    shell.handle('tap')

    expect(shell.view().body).toBe('Nothing here')
    expect(shell.view().head).toBe('Work')
  })

  test('lights the corner while the microphone is open', () => {
    expect(shell.view().mic).toBe(' ')
    world.on = true
    expect(shell.view().mic).toBe('●')
  })

  test('cuts a name too long for the panel rather than wrapping it', () => {
    world.contentRows = [row('a note with a name far longer than the panel is wide '.repeat(3))]
    shell.handle('tap')

    expect(shell.view().body.split('\n')).toHaveLength(1)
    expect(shell.view().body).toContain('…')
  })
})

describe('an answer from the model', () => {
  const answer = [
    'The short answer.',
    '',
    ...Array.from(
      { length: 10 },
      (_one, at) => `Paragraph ${at} of the detail, with enough words in it to wrap the panel.`,
    ),
  ].join('\n\n')

  test('shows the question over the answer', () => {
    shell.answered('what did I decide', answer)
    const view = shell.view()

    expect(view.head.startsWith('what did I decide')).toBe(true)
    expect(view.body.split('\n')[0]).toBe('The short answer.')
  })

  test('scrolls a line at a time rather than a page', () => {
    shell.answered('q', answer)
    const first = shell.view().body.split('\n')[0]

    shell.handle('down')
    const second = shell.view().body.split('\n')[0]
    expect(second).not.toBe(first)
    expect(second).toBe('')
  })

  test('stops at the end of the answer', () => {
    shell.answered('q', answer)
    for (let n = 0; n < 100; n++) shell.handle('down')

    expect(shell.handle('down')).toBe('none')
    expect(shell.view().body.split('\n')).toHaveLength(BODY_ROWS)
  })

  test('says how far down the answer the reader is', () => {
    shell.answered('q', answer)
    const rows = shell.answerRows

    const where = ` ${String(BODY_ROWS)}/${String(rows)}`
    expect(shell.view().head.trimEnd().endsWith(where)).toBe(true)
    expect(rows).toBeGreaterThan(BODY_ROWS)
  })

  test('a double tap closes it, back to the note', () => {
    shell.answered('q', answer)

    expect(shell.handle('double')).toBe('draw')
    expect(shell.screen.kind).toBe('note')
  })

  test('flows the model’s own line breaks, and keeps its paragraphs', () => {
    shell.answered('q', 'One short\nsentence first.\n\nThen a second\nparagraph.')
    const rows = shell.view().body.split('\n')

    expect(rows[0]).toBe('One short sentence first.')
    expect(rows[1]).toBe('')
    expect(rows[2]).toBe('Then a second paragraph.')
  })

  test('says it is thinking while the model is', () => {
    shell.asking('what did I decide')

    expect(shell.view().head).toBe('what did I decide')
    expect(shell.view().body).toBe('Thinking')
  })

  test('says so when the model answered with nothing', () => {
    shell.answered('q', '')

    expect(shell.view().body).toBe('No answer')
  })

  test('wraps an answer too wide for the panel', () => {
    shell.answered('q', 'a '.repeat(300))

    for (const row_ of shell.view().body.split('\n')) {
      expect(row_.length).toBeLessThan(120)
    }
  })
})

describe('what a command asks for', () => {
  test('puts a screen up by name', () => {
    shell.show('spaces')
    expect(shell.screen.kind).toBe('spaces')
    shell.show('tree')
    expect(shell.screen.kind).toBe('tree')
  })

  test('closes everything at once, however deep', () => {
    shell.handle('hold')
    shell.handle('tap')

    shell.close()
    expect(shell.screen.kind).toBe('note')
    expect(shell.open).toBe(false)
  })

  test('says whether anything is open, which is what "back" asks', () => {
    expect(shell.open).toBe(false)
    shell.handle('tap')
    expect(shell.open).toBe(true)
  })

  test('goes to a page', () => {
    shell.goToPage(2)
    expect(session.showing?.page).toBe(1)
  })

  test('goes to a line of the note', () => {
    shell.goToLine(7)
    const showing = session.showing

    expect(showing).not.toBeNull()
    expect(showing?.firstLine).toBeLessThanOrEqual(7)
    expect(showing?.lastLine).toBeGreaterThanOrEqual(7)
  })

  test('flashes what it heard in the head, and forgets it', () => {
    shell.flash('Next')
    expect(shell.view().head.trimEnd()).toMatch(/^Next {2,}1\/\d+$/)

    shell.clearFlash()
    expect(shell.view().head).toContain('THE TITLE')
  })
})

describe('a catalogue that lands after the glasses did', () => {
  test('reaches the panel, with nothing rebuilt and no screen reopened', () => {
    const said = { ...WORDS }
    const session = new Session()
    session.follow({ key: 'a', name: 'A note', text: NOTE }, paging)
    const late = new Shell(new Fake(), () => said, session, new FakeSettings())

    late.handle('hold')
    expect(late.view().body).toContain(WORDS.switchSpace)

    said.switchSpace = 'Raum wechseln'
    said.settings = 'Einstellungen'
    expect(late.view().body).toContain('Raum wechseln')

    late.handle('down')
    late.handle('down')
    late.handle('down')
    late.handle('tap')
    expect(late.view().head).toContain('Einstellungen')
  })
})

describe('today', () => {
  test('is the fifth row of the modal, and read afresh when it is put up', () => {
    shell.handle('hold')
    expect(shell.view().body).toContain('Today')
    for (let at = 0; at < 4; at++) shell.handle('down')
    shell.handle('tap')

    expect(shell.screen.kind).toBe('today')
    expect(world.fresh).toBe(1)
    expect(shell.view().head).toContain('Today')
    expect(shell.view().body).toContain('▶ □ Call Mum')
  })

  test('a tap ticks the row under the cursor and stays on the list', () => {
    shell.show('today')
    shell.handle('down')
    shell.handle('tap')

    expect(world.ticked).toEqual(['□ Pay rent'])
    expect(shell.screen.kind).toBe('today')
  })

  test('a double tap closes it, one level, and an empty Today says so', () => {
    world.todayRows = []
    shell.show('today')
    expect(shell.view().body).toBe('Nothing here')
    shell.handle('double')
    expect(shell.screen.kind).toBe('note')
  })
})
