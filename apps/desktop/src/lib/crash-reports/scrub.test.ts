import { describe, expect, test } from 'vitest'
import { type CrashReport, scrubbedReport, scrubbedText } from './scrub'

const PRIVATE = [
  'Diary',
  'someone',
  'anna',
  'Divorce lawyer',
  'hunter2',
  'account=42',
  'anna@example.org',
  'eyJhbGciOiJIUzI1NiJ9',
  'sk-proj-abcdefghijklmnop1234',
  'Kiss me under the stars',
]

function base(kind: string): CrashReport {
  return {
    v: 1,
    id: '0123456789abcdef0123456789abcdef',
    kind,
    at: 1_791_065_463_685,
    app: { version: '0.20.1-1184', channel: '', build: 'desktop' },
    system: { os: 'windows', osVersion: '10.0.26100', arch: 'x86_64', engine: 'WebView2 131.0' },
    summary: '',
    breadcrumbs: [
      { at: 1, what: 'web_open' },
      { at: 2, what: 'read_note' },
    ],
    log: [
      String.raw`2026-10-03T22:11:00.000Z WARN  save: C:\Users\anna\Notes\Divorce lawyer.md - Error: disk full`,
      '2026-10-03T22:11:01.000Z INFO  opened https://secret-bank.example.com/login?account=42',
      '2026-10-03T22:11:02.000Z ERROR sync: token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl failed',
      '2026-10-03T22:11:03.000Z WARN  mail from anna@example.org: password: hunter2',
      '2026-10-03T22:11:04.000Z WARN  ai: key sk-proj-abcdefghijklmnop1234 refused',
    ],
    open: { windows: 2, kinds: { note: 3, web: 1 } },
    resources: { memory: 300_000_000, cpu: 5000, uptime: 60_000 },
  }
}

const FRAMES = [
  { module: 'nib.exe', offset: '0x1a2b3c' },
  { module: String.raw`C:\Users\anna\AppData\Local\Orden\WebView2Loader.dll`, offset: '0x10' },
  { module: 'ntdll.dll', offset: '0x9f0e4', symbol: 'NtWaitForSingleObject' },
]

const REPORTS: CrashReport[] = [
  {
    ...base('panic'),
    summary: 'called `Result::unwrap()` on an `Err` value: "Kiss me under the stars"',
    where: 'src/web_tabs.rs:120:9',
    doing: 'web_open < web_place',
    threads: [{ name: 'main', main: true, crashed: true, frames: FRAMES }],
  },
  {
    ...base('crash'),
    summary: 'EXCEPTION_ACCESS_VIOLATION at 0x10 in nib.exe',
    threads: [{ name: 'main', main: true, crashed: true, frames: FRAMES }],
  },
  {
    ...base('freeze'),
    summary: 'The window did not answer for 41 s (read_note), 98% of a core busy',
    doing: 'read_note, in a nested loop',
    held: 41_000,
    killed: true,
    threads: [
      { name: 'main', main: true, frames: FRAMES },
      { name: 'tokio-runtime-worker', frames: FRAMES },
    ],
  },
  {
    ...base('engine'),
    summary: 'The window’s page did not answer for 12 s',
    process: 'renderer',
    reason: 'unresponsive',
    held: 12_000,
  },
  {
    ...base('js'),
    summary: `SyntaxError: Unexpected token in JSON at "Kiss me under the stars"`,
    stack: [
      'SyntaxError: Unexpected token',
      '    at parse (http://tauri.localhost/assets/index-BKq9x8Yz.js:12:345)',
      '    at open (file:///Users/anna/Notes/Diary.md:1:1)',
      '    at https://secret-bank.example.com/app.html?account=42:5:6',
    ].join('\n'),
  },
  { ...base('exit'), summary: 'Orden ended without quitting, 89 s after it started' },
]

function sample(kind: string): CrashReport {
  const found = REPORTS.find((one) => one.kind === kind)
  if (!found) throw new Error(`no ${kind} report`)
  return found
}

describe('every kind of report is sent scrubbed', () => {
  for (const report of REPORTS) {
    test(report.kind, () => {
      const sent = JSON.stringify(scrubbedReport(report))
      for (const word of PRIVATE) expect(sent).not.toContain(word)
      expect(sent).toContain(report.id)
      expect(sent).toContain('0.20.1-1184')
    })
  }
})

test('what helps to debug stays', () => {
  const panic = scrubbedReport(sample('panic'))
  expect(panic.where).toBe('src/web_tabs.rs:120:9')
  expect(panic.doing).toBe('web_open < web_place')
  expect(panic.threads?.[0]?.frames.map((one) => one.module)).toEqual([
    'nib.exe',
    'WebView2Loader.dll',
    'ntdll.dll',
  ])
  expect(panic.threads?.[0]?.frames[2]?.symbol).toBe('NtWaitForSingleObject')
  expect(panic.breadcrumbs?.map((one) => one.what)).toEqual(['web_open', 'read_note'])
  expect(panic.open).toEqual({ windows: 2, kinds: { note: 3, web: 1 } })
  expect(panic.log?.[1]).toBe(
    '2026-10-03T22:11:01.000Z INFO  opened https://secret-bank.example.com/…',
  )

  const freeze = scrubbedReport(sample('freeze'))
  expect(freeze.summary).toBe('The window did not answer for 41 s (read_note), 98% of a core busy')
  expect(freeze.doing).toBe('read_note, in a nested loop')
  expect(freeze.held).toBe(41_000)
  expect(freeze.killed).toBe(true)

  const js = scrubbedReport(sample('js'))
  expect(js.stack).toContain('index-BKq9x8Yz.js:12:345')
})

test('a page keeps only its host', () => {
  expect(scrubbedText('opened https://www.example.com/private/path?q=1#x')).toBe(
    'opened https://www.example.com/…',
  )
})

test('secrets go whatever they are called', () => {
  expect(scrubbedText('Authorization: Bearer abc.def-ghi_jkl')).not.toContain('abc.def')
  expect(scrubbedText('api_key=AKIA1234567890ABCDEF')).toBe('api_key=<hidden>')
  expect(scrubbedText('ghp_abcdefghijklmnopqrstuvwxyz0123456789 leaked')).toBe('<token> leaked')
  expect(scrubbedText('a 0123456789abcdef0123456789abcdef id')).toBe('a <token> id')
})

test('a module keeps its file name alone and a frame its offset', () => {
  const report = scrubbedReport({
    ...base('crash'),
    threads: [
      {
        name: 'C:\\Users\\anna\\x',
        frames: [{ module: '/home/anna/.local/lib/libx.so', offset: 'not hex', symbol: 'a b"c' }],
      },
    ],
  })
  const thread = report.threads?.[0]
  expect(thread?.name).not.toContain('anna')
  expect(thread?.frames[0]).toEqual({ module: 'libx.so', offset: '0x0' })
})
