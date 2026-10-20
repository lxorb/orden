/** Todoist, from a recorded API answer and from its documented CSV: never the real API
 *  with anybody's account. The answer's shapes are the API's own (`/api/v1`, its OpenAPI
 *  examples: `{results, next_cursor}` pages, `due {date, string, is_recurring,
 *  timezone}`, `deadline {date}`, `duration {amount, unit}`, priority 4 as p1). */

import { describe, expect, test } from 'vitest'
import { sourceOf } from './sources'
import {
  clockOf,
  csvProject,
  type Fetch,
  isTodoistCsv,
  planOf,
  readTodoistAccount,
  readTodoistFiles,
  ruleOf,
  tagOf,
} from './todoist'

/** The account, as the API answered it, page by page. */
const RECORDED: Record<string, unknown[]> = {
  '/projects': [
    {
      results: [
        { id: 'p-in', name: 'Inbox', inbox_project: true, parent_id: null, is_shared: false },
        { id: 'p-work', name: 'Work', inbox_project: false, parent_id: null, is_shared: true },
      ],
      next_cursor: 'c1',
    },
    {
      results: [
        { id: 'p-thesis', name: 'Thesis', parent_id: 'p-work', is_shared: false },
        { id: 'p-old', name: 'Old', is_archived: true },
      ],
      next_cursor: null,
    },
  ],
  '/sections': [
    {
      results: [{ id: 's-1', project_id: 'p-work', name: 'Errands', section_order: 1 }],
      next_cursor: null,
    },
  ],
  '/tasks': [
    {
      results: [
        {
          id: 't-1',
          project_id: 'p-work',
          section_id: null,
          parent_id: null,
          content: 'Call the bank',
          description: 'Their number is on the card.',
          priority: 4,
          due: {
            date: '2026-10-06T16:00:00',
            string: 'Oct 6 4pm',
            is_recurring: false,
            lang: 'en',
          },
          deadline: { date: '2026-10-10', lang: 'en' },
          duration: { amount: 30, unit: 'minute' },
          labels: ['admin', 'phone calls'],
          child_order: 1,
          checked: false,
          note_count: 1,
          responsible_uid: 'u-2',
        },
        {
          id: 't-2',
          project_id: 'p-work',
          parent_id: 't-1',
          content: 'Find the card',
          description: '',
          priority: 1,
          labels: [],
          child_order: 1,
          checked: false,
          note_count: 0,
        },
        {
          id: 't-3',
          project_id: 'p-work',
          section_id: 's-1',
          content: 'Water the plants',
          description: '',
          priority: 2,
          due: { date: '2026-10-04', string: 'every! 3 days', is_recurring: true, lang: 'en' },
          labels: [],
          child_order: 2,
          checked: false,
          note_count: 0,
        },
        {
          id: 't-4',
          project_id: 'p-in',
          content: 'Renew the gym',
          description: '',
          priority: 3,
          due: {
            date: '2026-10-08T07:00:00Z',
            string: 'every other tuesday starting oct 8',
            is_recurring: true,
            timezone: 'Europe/Zurich',
          },
          labels: [],
          child_order: 1,
          checked: false,
          note_count: 0,
        },
      ],
      next_cursor: null,
    },
  ],
  '/reminders': [
    {
      results: [
        { id: 'r-1', item_id: 't-1', type: 'relative', minute_offset: 15 },
        { id: 'r-2', item_id: 't-1', type: 'absolute', due: { date: '2026-10-06T09:00:00' } },
      ],
      next_cursor: null,
    },
  ],
  '/projects/p-work/collaborators': [
    { results: [{ id: 'u-2', name: 'Lucile', email: 'l@example.com' }], next_cursor: null },
  ],
  '/comments?task_id=t-1': [
    {
      results: [
        {
          id: 'n-1',
          content: 'Asked at the counter',
          posted_at: '2026-10-01T10:00:00Z',
          file_attachment: {
            file_name: 'card.png',
            file_url: 'https://files.todoist.com/card.png',
          },
        },
      ],
      next_cursor: null,
    },
  ],
  '/tasks/completed/by_completion_date': [
    {
      items: [
        {
          id: 't-5',
          project_id: 'p-in',
          content: 'Pay rent',
          description: '',
          priority: 1,
          labels: [],
          child_order: 2,
          checked: true,
          completed_at: '2026-10-01T08:00:00Z',
          note_count: 0,
        },
      ],
      next_cursor: null,
    },
  ],
}

/** A fetch that answers from the recording, and says what it was asked with. */
function recorded() {
  const asked: { url: string; auth: string }[] = []
  const served = new Map<string, number>()
  const get: Fetch = (url, init) => {
    asked.push({ url, auth: init.headers.Authorization ?? '' })
    const path = url
      .replace('https://api.todoist.com/api/v1', '')
      .replace(/[?&](limit|cursor|since|until)=[^&]*/g, '')
    const key = Object.keys(RECORDED).find((one) => one === path || one === path.replace(/\?$/, ''))
    const pages = key ? RECORDED[key] : undefined
    const at = served.get(path) ?? 0
    served.set(path, at + 1)
    const page = pages?.[at]
    return Promise.resolve({
      ok: !!page,
      status: init.headers.Authorization === 'Bearer wrong' ? 401 : page ? 200 : 404,
      json: () => Promise.resolve(page),
    })
  }
  return { get, asked }
}

const NOW = new Date('2026-10-04T12:00:00Z')

describe('from the account', () => {
  test('every project a note, in its parent', async () => {
    const { get, asked } = recorded()
    const plan = planOf(await readTodoistAccount(get, 'secret', { completed: true, now: NOW }))
    expect(plan.files.map((one) => one.path)).toEqual([
      'Inbox.md',
      'Projects/Work/Work.md',
      'Projects/Work/Thesis.md',
    ])
    expect(plan.inbox).toBe('Inbox.md')
    // Every request carried the token, and nothing else was told it.
    expect(asked.every((one) => one.auth === 'Bearer secret')).toBe(true)
    expect(asked.some((one) => one.url.includes('cursor=c1'))).toBe(true)
  })

  test('a task with all it carries, priority turned round, sub-task under it', async () => {
    const { get } = recorded()
    const plan = planOf(await readTodoistAccount(get, 'secret', { now: NOW }))
    const work = plan.files.find((one) => one.path === 'Projects/Work/Work.md')
    expect(work?.kind === 'note' ? work.text : '').toBe(
      [
        // Todoist's date is the day it starts, `🛫`; its deadline a deadline (#371).
        '- [ ] Call the bank [time:: 16:00] [duration:: 30m] [deadline:: 2026-10-10] [remind:: 15m, 2026-10-06 09:00] [assignee:: Lucile] #admin #phone-calls 🔺 🛫 2026-10-06',
        '  Their number is on the card.',
        '  2026-10-01: Asked at the counter [card.png](https://files.todoist.com/card.png)',
        '  - [ ] Find the card',
        '',
        '## Errands',
        '',
        '- [ ] Water the plants 🔼 🔁 every 3 days when done 🛫 2026-10-04',
        '',
      ].join('\n'),
    )
  })

  test('a fixed time in its zone, a rule with a start, done tasks if asked', async () => {
    const { get } = recorded()
    const plan = planOf(await readTodoistAccount(get, 'secret', { completed: true, now: NOW }))
    const inbox = plan.files.find((one) => one.path === 'Inbox.md')
    const text = inbox?.kind === 'note' ? inbox.text : ''
    expect(text).toContain(
      '- [ ] Renew the gym [time:: 09:00 Europe/Zurich] ⏫ 🔁 every 2 weeks on Tuesday 🛫 2026-10-08',
    )
    expect(text).toContain('- [x] Pay rent ✅ 2026-10-01')
    expect(plan.lost).toEqual([])
  })

  test('a token Todoist does not take says so, and nothing is planned', async () => {
    const { get } = recorded()
    await expect(readTodoistAccount(get, 'wrong')).rejects.toThrow(
      'Todoist did not take that token.',
    )
  })

  /** A second account, in the shapes the API's own SDKs record. */
  const ANSWERED: Record<string, unknown> = {
    '/projects': {
      results: [{ id: 'p-1', name: 'Home', description: 'Everything about the flat.' }],
      next_cursor: null,
    },
    '/sections': { results: [], next_cursor: null },
    '/tasks': {
      results: [
        {
          id: 't-1',
          project_id: 'p-1',
          content: 'Fix the tap',
          priority: 1,
          labels: [],
          child_order: 1,
          checked: false,
          note_count: 1,
        },
      ],
      next_cursor: null,
    },
    '/reminders': {
      results: [
        { item_id: 't-1', type: 'relative', minute_offset: 30, is_deleted: false },
        { item_id: 't-1', type: 'relative', minute_offset: 45, is_deleted: true },
        {
          item_id: 't-1',
          type: 'absolute',
          due: { date: '2026-10-05T07:00:00.000000Z', timezone: 'Europe/Zurich' },
          is_deleted: false,
        },
      ],
      next_cursor: null,
    },
    '/comments?task_id=t-1': {
      results: [
        {
          content: 'The plumber said',
          posted_at: '2026-10-02T10:00:00Z',
          file_attachment: { resource_type: 'url', url: 'https://example.com/taps', title: 'Taps' },
        },
      ],
      next_cursor: null,
    },
    '/tasks/completed/by_completion_date': {
      items: [
        {
          id: 't-2',
          project_id: 'p-gone',
          content: 'Pack the boxes',
          priority: 1,
          labels: [],
          child_order: 1,
          completed_at: '2026-10-01T08:00:00Z',
        },
      ],
      next_cursor: null,
    },
  }
  const answering: Fetch = (url) => {
    const path = url
      .replace('https://api.todoist.com/api/v1', '')
      .replace(/[?&](limit|since|until)=[^&]*/g, '')
      .replace(/\?$/, '')
    const page = ANSWERED[path]
    return Promise.resolve({
      ok: !!page,
      status: page ? 200 : 404,
      json: () => Promise.resolve(page),
    })
  }

  test("a project's description over its tasks, a link a comment points to, reminders that are still set at their zone's time", async () => {
    const plan = planOf(await readTodoistAccount(answering, 'secret'))
    const home = plan.files.find((one) => one.path === 'Projects/Home.md')
    expect(home?.kind === 'note' ? home.text : '').toBe(
      [
        'Everything about the flat.',
        '',
        '- [ ] Fix the tap [remind:: 30m, 2026-10-05 09:00]',
        '  2026-10-02: The plumber said [Taps](https://example.com/taps)',
        '',
      ].join('\n'),
    )
  })

  test('a done task is done though it does not say checked, and kept though its project was not read', async () => {
    const plan = planOf(
      await readTodoistAccount(answering, 'secret', { completed: true, now: NOW }),
    )
    const kept = plan.files.find((one) => one.path === 'Projects/Todoist.md')
    expect(kept?.kind === 'note' ? kept.text : '').toBe('- [x] Pack the boxes ✅ 2026-10-01\n')
  })
})

/** Todoist's documented CSV, as a project export writes it. */
const CSV = [
  'TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT,DEADLINE,DEADLINE_LANG',
  'task,Plan the launch @work,Everything for Monday,1,1,Evan (14781400),,2026-10-06,en,Europe/Zurich,60,minute,2026-10-09,en',
  'note,Remember the slides,,,,Evan (14781400),,,,,,,,',
  'task,Book the room,,4,2,Evan (14781400),Lucile (14781401),,en,,,,,',
  'section,Later,,,,,,,,,,,,',
  'task,Water the plants,,3,1,Evan (14781400),,every monday,en,,,,,',
  'task,Clean up,,4,1,Evan (14781400),,every other fortnight-ish,en,,,,,',
].join('\n')

describe('from a CSV', () => {
  test('is known by its header', () => {
    expect(isTodoistCsv(CSV)).toBe(true)
    expect(isTodoistCsv('Name,Status\nA,B\n')).toBe(false)
  })

  test('nests by indent, a section a heading, a note a comment, priorities as people count', () => {
    const plan = planOf(csvProject('Launch', CSV, 0))
    expect(plan.lost).toEqual([{ text: 'Some repeating dates stay as words under their tasks' }])
    const note = plan.files[0]
    expect(note?.path).toBe('Projects/Launch.md')
    expect(note?.kind === 'note' ? note.text : '').toBe(
      [
        '- [ ] Plan the launch #work [duration:: 1h] [deadline:: 2026-10-09] 🔺 🛫 2026-10-06',
        '  Everything for Monday',
        '  Remember the slides',
        '  - [ ] Book the room [assignee:: Lucile]',
        '',
        '## Later',
        '',
        '- [ ] Water the plants 🔼 🔁 every week on Monday',
        '- [ ] Clean up',
        '  Todoist: every other fortnight-ish',
        '',
      ].join('\n'),
    )
  })

  test('a backup zip of them: a project a file, the Inbox the inbox', async () => {
    const encoded = (text: string) => new TextEncoder().encode(text)
    const plan = await readTodoistFiles([
      sourceOf('Inbox [2203306140].csv', encoded(CSV)),
      sourceOf('Work [2203306141].csv', encoded(CSV)),
      sourceOf('readme.txt', encoded('not a project')),
    ])
    expect(plan.files.map((one) => one.path)).toEqual(['Inbox.md', 'Projects/Work.md'])
    expect(plan.inbox).toBe('Inbox.md')
  })

  test("keeps what is said about the project and its sections, an attachment as a link, a duration in days, a rule's time", () => {
    const csv = [
      'TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE,DURATION,DURATION_UNIT,meta,DEADLINE,DEADLINE_LANG,IS_COLLAPSED',
      'meta,view_style=list,,,,,,,,,,,,,,',
      'note,A comment on the project,,,,,,,,,,,,,,',
      'section,Doing,What we are on now,,,,,,,,,,,,,FALSE',
      'note,A comment on the section,,,,,,,,,,,,,,',
      'task,Move the piano,,4,1,,,2026-10-06,en,,2,day,,,,',
      'note,"Quote: [[file {""file_name"":""quote (1).pdf"",""file_url"":""https://files.todoist.com/a/quote (1).pdf""}]]",,,,,,,,,,,,,,',
      'task,Clean the house,,4,1,,,every month @ 13:00,en,,,,,,,',
      'task,Take out the trash,,4,1,,,every friday at 7pm,en,,,,,,,',
      'task,Book it,,4,1,,,2026-02-30,en,,,,,,,',
    ].join('\r\n')
    const plan = planOf(csvProject('Moving', csv, 0))
    const note = plan.files[0]
    expect(note?.kind === 'note' ? note.text : '').toBe(
      [
        'A comment on the project',
        '',
        '## Doing',
        '',
        'What we are on now',
        '',
        'A comment on the section',
        '',
        '- [ ] Move the piano [duration:: 48h] 🛫 2026-10-06',
        '  Quote: [quote (1).pdf](<https://files.todoist.com/a/quote (1).pdf>)',
        '- [ ] Clean the house [time:: 13:00] 🔁 every month',
        '- [ ] Take out the trash [time:: 19:00] 🔁 every week on Friday',
        // A day the calendar does not have stays as it was written.
        '- [ ] Book it',
        '  Todoist: 2026-02-30',
        '',
      ].join('\n'),
    )
  })
})

describe('a broken answer', () => {
  test('tasks whose parents go round in a circle are each written once, not lost', () => {
    const task = (id: string, parent: string) => ({
      id,
      project: 'p',
      parent,
      text: id,
      description: '',
      priority: 4 as const,
      labels: [],
      order: 1,
      remind: [],
      comments: [],
    })
    const plan = planOf({
      projects: [{ id: 'p', name: 'Loop', inbox: false }],
      sections: [],
      tasks: [task('A', 'B'), task('B', 'A'), task('C', 'C'), task('D', 'A')],
    })
    const note = plan.files[0]
    expect(note?.kind === 'note' ? note.text : '').toBe(
      ['- [ ] A', '  - [ ] B', '  - [ ] D', '- [ ] C', ''].join('\n'),
    )
  })

  test('an answer that is not JSON is Todoist not being reached', async () => {
    const page: Fetch = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token <')),
      })
    await expect(readTodoistAccount(page, 'secret')).rejects.toThrow(
      'Todoist could not be reached.',
    )
  })
})

describe('words that look like something else', () => {
  test('a checkbox in a description or a comment is no task, and a description opening with --- no properties', () => {
    const plan = planOf({
      projects: [{ id: 'p', name: 'Lists', inbox: false, about: ['---\nfrom the old list\n---'] }],
      sections: [],
      tasks: [
        {
          id: 't',
          project: 'p',
          text: 'Shop',
          description: '- [ ] milk\n* [x] bread',
          priority: 4,
          labels: [],
          order: 1,
          remind: [],
          comments: [{ text: '1. [ ] eggs' }],
        },
      ],
    })
    const note = plan.files[0]
    expect(note?.kind === 'note' ? note.text : '').toBe(
      [
        '',
        '---',
        'from the old list',
        '---',
        '',
        '- [ ] Shop',
        '  - \\[ ] milk',
        '  * \\[x] bread',
        '  1. \\[ ] eggs',
        '',
      ].join('\n'),
    )
  })
})

describe('the words', () => {
  test("Todoist's rules in the Tasks plugin's words", () => {
    expect(ruleOf('every day')).toBe('every day')
    expect(ruleOf('every! 2 weeks')).toBe('every 2 weeks when done')
    expect(ruleOf('every other week')).toBe('every 2 weeks')
    expect(ruleOf('every workday')).toBe('every weekday')
    expect(ruleOf('every 3rd friday')).toBeNull()
  })

  test('a rule said at a time, the time apart', () => {
    expect(clockOf('every day at 9am')).toEqual({ time: '09:00', rest: 'every day' })
    expect(clockOf('every mon @ 13:30')).toEqual({ time: '13:30', rest: 'every mon' })
    expect(clockOf('every day at 12am')).toEqual({ time: '00:00', rest: 'every day' })
    expect(clockOf('every 3 days')).toEqual({ rest: 'every 3 days' })
    expect(ruleOf('every weekday at 10:00')).toBe('every weekday')
  })

  test('a label as a tag', () => {
    expect(tagOf('phone calls')).toBe('phone-calls')
    expect(tagOf('@urgent!')).toBe('urgent')
  })
})
