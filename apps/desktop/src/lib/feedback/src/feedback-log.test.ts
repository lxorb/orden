import { expect, test } from 'vitest'
import { scrubbedLog } from './feedback-log'

const TIME = '2026-11-04T08:27:36.000Z'

test('a note’s path goes, name, home and all; what went wrong stays', () => {
  const said = scrubbedLog(
    `${TIME} error save: /home/anna/Notes/Divorce lawyer.md - Error: disk full`,
  )
  expect(said).toBe(`${TIME} error save: <path 1>.md - Error: disk full`)
})

test('as the native log writes it, and on Windows and a Mac', () => {
  expect(scrubbedLog(String.raw`12:00 WARN  C:\Users\anna\Notes\Tax 2026.pdf not read`)).toBe(
    '12:00 WARN  <path 1>.pdf not read',
  )
  expect(scrubbedLog('12:00 WARN  /Users/anna/Notes/Bank.canvas was given up on')).toBe(
    '12:00 WARN  <path 1>.canvas was given up on',
  )
  expect(scrubbedLog(String.raw`12:00 INFO  \\nas\anna\Notes\x.md gone`)).toBe(
    '12:00 INFO  <path 1>.md gone',
  )
})

test('one path is one number all through a report, and two are two', () => {
  const said = scrubbedLog(
    [
      '12:00 WARN  sync: /home/anna/a b.md not moved to /home/anna/c.md - nope',
      '12:01 WARN  sync: /home/anna/a b.md not moved to /home/anna/c.md - nope',
    ].join('\n'),
  )
  expect(said).not.toContain('anna')
  expect(said).not.toContain('a b')
  const [one, two] = said.split('\n')
  expect(one?.slice(5)).toBe(two?.slice(5))
})

test('a folder with no extension goes, up to the words about it', () => {
  expect(scrubbedLog('12:00 WARN  /home/anna/Notes/Old stuff could not be read')).toBe(
    '12:00 WARN  <path 1> could not be read',
  )
  expect(scrubbedLog('12:00 WARN  file:///home/anna/x failed')).toBe('12:00 WARN  <path 1> failed')
})

test('a note’s path in its space goes too, as a sync line has it', () => {
  const said = scrubbedLog('12:00 WARN  sync: Private/Divorce lawyer.md not written - offline')
  expect(said).toBe('12:00 WARN  sync: <path 1>.md not written - offline')
  expect(scrubbedLog('12:00 WARN  sync: Private/Kids not moved - offline')).toBe(
    '12:00 WARN  sync: <path 1> not moved - offline',
  )
  expect(scrubbedLog('12:00 INFO  Divorce lawyer.md could not be read')).toBe(
    '12:00 INFO  <path 1>.md could not be read',
  )
})

test('a draft’s name goes, as earlier versions wrote it', () => {
  expect(scrubbedLog('12:00 ERROR save: Letter to my lawyer - Error: full')).toBe(
    '12:00 ERROR save: <a draft> - Error: full',
  )
})

test('what is not the reader’s stays', () => {
  for (const line of [
    `${TIME} info page loaded`,
    '12:00 WARN  a request to https://api.orden.example/v1/sync/pull failed: 503',
    '12:00 ERROR TypeError: x is null at f (tauri://localhost/assets/index-abc.js:12:3)',
    '12:00 ERROR panicked at src/web_tabs.rs:12:3',
    '12:00 WARN  answered with text/plain',
  ]) {
    expect(scrubbedLog(line)).toBe(line)
  }
})

test('a name in capitals, or with spaces and no extension, goes all the same', () => {
  expect(scrubbedLog('12:00 WARN  sync: Anna Schmidt.MD not sent')).toBe(
    '12:00 WARN  sync: <path 1>.MD not sent',
  )
  expect(scrubbedLog('12:00 WARN  sync: Clients/Anna Schmidt not sent')).toBe(
    '12:00 WARN  sync: <path 1> not sent',
  )
  const said = scrubbedLog('12:00 WARN  /home/anna/Notes/Ana and Bob/Divorce plan not sent')
  expect(said).not.toMatch(/anna|Ana|Bob|Divorce|plan/)
  expect(said).toMatch(/not sent$/)
})

test('an address keeps where it goes, not who or what it carries', () => {
  expect(
    scrubbedLog('12:00 WARN  https://anna:hunter2@example.org/a/b?token=SECRET&x=1#y failed'),
  ).toBe('12:00 WARN  https://example.org/… failed')
  expect(scrubbedLog('12:00 WARN  https://api.orden.example/v1/push?token=SECRET failed')).toBe(
    '12:00 WARN  https://api.orden.example/v1/push failed',
  )
  for (const line of [
    '12:00 WARN  http://asset.localhost/home/anna/Notes/Divorce.png not drawn',
    '12:00 WARN  asset://localhost/%2Fhome%2Fanna%2FDivorce.png not drawn',
  ]) {
    expect(scrubbedLog(line)).toBe('12:00 WARN  <path 1> not drawn')
  }
  expect(scrubbedLog('12:00 WARN  invited anna.schmidt+x@mail.de - no')).toBe(
    '12:00 WARN  invited <email> - no',
  )
})

test('an error quoting words has them taken out', () => {
  expect(
    scrubbedLog(
      `12:00 ERROR SyntaxError: Unexpected token 'D', "Dear lawyer, I"... is not valid JSON`,
    ),
  ).toBe(`12:00 ERROR SyntaxError: Unexpected token <quoted>, <quoted>... is not valid JSON`)
})

test('what is said around a path stays', () => {
  for (const [line, want] of [
    [
      '12:00 WARN  POST /v1/push failed - conflict with /home/anna/a.md and status 409',
      '12:00 WARN  POST /v1/push failed - conflict with <path 1>.md and status 409',
    ],
    [
      '12:00 WARN  could not parse settings.json: expected',
      '12:00 WARN  could not parse <path 1>.json: expected',
    ],
    ['12:00 WARN  GET /api/notes/42 503 in 20ms', '12:00 WARN  GET /api/notes/42 503 in 20ms'],
    ['12:00 INFO  read/write and/or 11/04/2026', '12:00 INFO  read/write and/or 11/04/2026'],
    [
      '12:00 WARN  sync: the rename of Foo bar.md to Baz.md is given up on',
      '12:00 WARN  sync: the rename of <path 1>.md to <path 2>.md is given up on',
    ],
  ] as const) {
    expect(scrubbedLog(line)).toBe(want)
  }
})

test('an app script named in a stack keeps its place, a page keeps its host', () => {
  expect(scrubbedLog('    at parse (http://tauri.localhost/assets/index-BKq9x8Yz.js:12:345)')).toBe(
    '    at parse (http://tauri.localhost/assets/index-BKq9x8Yz.js:12:345)',
  )
  expect(scrubbedLog('    at go (https://bank.example.com/app/x.html:5:6)')).toBe(
    '    at go (https://bank.example.com/…',
  )
})
