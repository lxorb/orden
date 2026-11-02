import { afterEach, describe, expect, test } from 'vitest'
import { readTask } from './task-line'
import { momentOf, plainWords, reminderId, remindTimes } from './task-reminders'

const task = (line: string) => {
  const read = readTask(line)
  if (!read) throw new Error(`not a task: ${line}`)
  return read
}

describe('remindTimes', () => {
  test('a task with a time rings at it, less the automatic offset', () => {
    const one = task('- [ ] Call the bank [time:: 16:00] 📅 2026-10-06')
    expect(remindTimes(one, 0)).toEqual([{ date: '2026-10-06', time: '16:00' }])
    expect(remindTimes(one, 15)).toEqual([
      {
        date: '2026-10-06',
        time: '15:45',
        before: { date: '2026-10-06', time: '16:00', minutes: 15 },
      },
    ])
    expect(remindTimes(one, null)).toEqual([])
  })

  test('every written reminder rings, each once, earliest first', () => {
    const one = task(
      '- [ ] Call the bank [time:: 16:00] [remind:: 15m, 2026-10-05 09:00, 8:30] 📅 2026-10-06',
    )
    expect(remindTimes(one, 15)).toEqual([
      { date: '2026-10-05', time: '09:00' },
      { date: '2026-10-06', time: '08:30' },
      {
        date: '2026-10-06',
        time: '15:45',
        before: { date: '2026-10-06', time: '16:00', minutes: 15 },
      },
    ])
  })

  test('counting back crosses midnight on the wall clock', () => {
    const one = task('- [ ] Night train [time:: 00:10] [remind:: 1h] 📅 2026-10-06')
    expect(remindTimes(one, null)).toEqual([
      {
        date: '2026-10-05',
        time: '23:10',
        before: { date: '2026-10-06', time: '00:10', minutes: 60 },
      },
    ])
  })

  test('the scheduled day stands in for a due one', () => {
    const one = task('- [ ] Draft [remind:: 9:00] ⏳ 2026-10-08')
    expect(remindTimes(one, 0)).toEqual([{ date: '2026-10-08', time: '09:00' }])
  })

  test('no day and no time is no relative reminder, and no automatic one', () => {
    expect(remindTimes(task('- [ ] Someday [remind:: 15m, 9:00]'), 0)).toEqual([])
    expect(remindTimes(task('- [ ] All day 📅 2026-10-06'), 0)).toEqual([])
    expect(remindTimes(task('- [ ] Fixed [remind:: 2026-10-06 09:00]'), 0)).toEqual([
      { date: '2026-10-06', time: '09:00' },
    ])
  })

  test('a done or cancelled task rings nothing', () => {
    expect(remindTimes(task('- [x] Done [time:: 16:00] 📅 2026-10-06 ✅ 2026-10-06'), 0)).toEqual(
      [],
    )
    expect(remindTimes(task('- [-] Dropped [time:: 16:00] 📅 2026-10-06'), 0)).toEqual([])
  })

  test('a zone on the line stays with every reminder of it', () => {
    const one = task('- [ ] Standup [time:: 09:00 America/New_York] [remind:: 10m] 📅 2026-10-06')
    expect(remindTimes(one, null)).toEqual([
      {
        date: '2026-10-06',
        time: '08:50',
        zone: 'America/New_York',
        before: { date: '2026-10-06', time: '09:00', minutes: 10 },
      },
    ])
  })
})

describe('momentOf', () => {
  test('a zone is read on its own clock, summer time included', () => {
    expect(momentOf({ date: '2026-10-06', time: '09:00', zone: 'Europe/Zurich' })).toBe(
      Date.UTC(2026, 9, 6, 7, 0),
    )
    expect(momentOf({ date: '2026-12-06', time: '09:00', zone: 'Europe/Zurich' })).toBe(
      Date.UTC(2026, 11, 6, 8, 0),
    )
    expect(momentOf({ date: '2026-10-06', time: '09:00' }, 'UTC')).toBe(Date.UTC(2026, 9, 6, 9))
  })

  test('the zone on the line wins over the one asked in', () => {
    expect(
      momentOf({ date: '2026-10-06', time: '09:00', zone: 'Asia/Tokyo' }, 'Europe/Zurich'),
    ).toBe(Date.UTC(2026, 9, 6, 0, 0))
  })

  test('a floating time is this machine\u2019s clock', () => {
    expect(momentOf({ date: '2026-10-06', time: '09:00' })).toBe(
      new Date(2026, 9, 6, 9, 0).getTime(),
    )
  })

  test('a zone nobody knows is no moment', () => {
    expect(momentOf({ date: '2026-10-06', time: '09:00', zone: 'Mars/Olympus' })).toBeNaN()
  })
})

// The app reads a floating time on the machine's clock and the Worker in the reader's
// zone, so the two have to say the same moment for every wall time, the ones a clock
// change skips or repeats above all.
describe('a clock change', () => {
  const machine = process.env.TZ
  afterEach(() => {
    if (machine === undefined) delete process.env.TZ
    else process.env.TZ = machine
  })

  const ZONES = [
    'America/New_York',
    'America/St_Johns',
    'America/Sao_Paulo',
    'Europe/Zurich',
    'Africa/Casablanca',
    'Asia/Tehran',
    'Asia/Kathmandu',
    'Australia/Lord_Howe',
    'Pacific/Apia',
    'Etc/GMT+5',
    'UTC',
  ]

  const iso = (moment: number) => new Date(moment).toISOString().slice(0, 10)
  const DAY = 86_400_000

  /** The days of two years whose clock changes on this machine, with the day either side. */
  function daysAroundChanges(): string[] {
    const days = new Set<string>()
    for (let day = Date.UTC(2026, 0, 1); day < Date.UTC(2028, 0, 1); day += DAY) {
      const [year = 0, month = 1, date = 1] = iso(day).split('-').map(Number)
      const start = new Date(year, month - 1, date).getTimezoneOffset()
      if (start === new Date(year, month - 1, date + 1).getTimezoneOffset()) continue
      for (const one of [day - DAY, day, day + DAY]) days.add(iso(one))
    }
    return [...days]
  }

  const quarters = Array.from({ length: 96 }, (_one, at) => {
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${pad(Math.floor(at / 4))}:${pad((at % 4) * 15)}`
  })

  test.each(ZONES)('%s reads the same on the machine and on the Worker', (zone) => {
    process.env.TZ = zone
    for (const date of ['2026-07-01', ...daysAroundChanges()]) {
      for (const time of quarters) {
        const wall = { date, time }
        expect(`${date} ${time} ${momentOf(wall, zone)}`).toBe(`${date} ${time} ${momentOf(wall)}`)
      }
    }
  })

  test.each(ZONES)('%s rings a relative reminder that long before the task', (zone) => {
    process.env.TZ = zone
    for (const date of ['2026-07-01', ...daysAroundChanges()]) {
      for (const time of quarters) {
        for (const line of [`[time:: ${time}]`, `[time:: ${time} ${zone}]`]) {
          const walls = remindTimes(task(`- [ ] a ${line} [remind:: 30m] 🛫 ${date}`), null)
          const at = momentOf({ date, time }, zone)
          for (const wall of walls) {
            expect(`${date} ${time} ${momentOf(wall, zone)}`).toBe(
              `${date} ${time} ${at - 1_800_000}`,
            )
            expect(`${date} ${time} ${momentOf(wall)}`).toBe(`${date} ${time} ${at - 1_800_000}`)
          }
        }
      }
    }
  })

  test('a wall time it skips is read at the offset before it', () => {
    const wall = { date: '2026-03-08', time: '02:30' }
    expect(momentOf(wall, 'America/New_York')).toBe(Date.UTC(2026, 2, 8, 7, 30))
  })

  test('a wall time it repeats is read the first time round', () => {
    const wall = { date: '2026-10-25', time: '02:30' }
    expect(momentOf(wall, 'Europe/Zurich')).toBe(Date.UTC(2026, 9, 25, 0, 30))
  })

  test('a reminder counted back over it still rings before the task', () => {
    const one = task('- [ ] a [time:: 03:15 Europe/Zurich] [remind:: 30m] 🛫 2026-03-29')
    const [wall] = remindTimes(one, null)
    expect(wall && momentOf(wall)).toBe(Date.UTC(2026, 2, 29, 0, 45))
    // The id stays the wall minute it always was, on every device.
    expect(wall).toMatchObject({ date: '2026-03-29', time: '02:45' })
  })
})

test('reminderId is sixteen hex digits, the same for the same reminder', () => {
  const wall = { date: '2026-10-06', time: '16:00' }
  const id = reminderId('Work', 'Plan.md', 'abc', wall)
  expect(id).toMatch(/^[0-9a-f]{16}$/)
  expect(reminderId('Work', 'Plan.md', 'abc', wall)).toBe(id)
  expect(reminderId('Work', 'Plan.md', 'abc', { ...wall, time: '16:01' })).not.toBe(id)
  expect(reminderId('Home', 'Plan.md', 'abc', wall)).not.toBe(id)
})

test('plainWords says a task the way a person reads it', () => {
  expect(plainWords('Read **the** [paper](https://x.org) about [[Notes/Rust#Traits]] `now`')).toBe(
    'Read the paper about Notes/Rust now',
  )
  expect(plainWords('_Call_ mum')).toBe('Call mum')
})

test('plainWords takes the escapes off, so a reminder says the characters', () => {
  expect(plainWords('Prices \\$5-\\$10 \\~5 min a=\\=b and \\*not em\\* `a\\$b`')).toBe(
    'Prices $5-$10 ~5 min a==b and *not em* a\\$b',
  )
})

test('plainWords keeps a backslash at the end of code', () => {
  expect(plainWords('open `C:\\` now')).toBe('open C:\\ now')
})
