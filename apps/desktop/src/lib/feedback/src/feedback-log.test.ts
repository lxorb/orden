import { expect, test } from 'vitest'
import { scrubbedLog } from './feedback-log'

const TIME = '2026-11-04T08:27:36.000Z'
test.each([
  [
    `${TIME} error save: /home/anna/Notes/Divorce lawyer.md - Error: disk full`,
    `${TIME} error save: <path 1>.md - Error: disk full`,
  ],
  [String.raw`12:00 WARN  C:\Users\anna\Notes\Tax 2026.pdf not read`, '12:00 WARN  <path 1>.pdf not read'],
  ['12:00 WARN  /Users/anna/Notes/Bank.canvas was given up on', '12:00 WARN  <path 1>.canvas was given up on'],
  [String.raw`12:00 INFO  \\nas\anna\Notes\x.md gone`, '12:00 INFO  <path 1>.md gone'],
  ['12:00 WARN  /home/anna/Notes/Old stuff could not be read', '12:00 WARN  <path 1> could not be read'],
  ['12:00 WARN  file:///home/anna/x failed', '12:00 WARN  <path 1> failed'],
  [
    '12:00 WARN  sync: Private/Divorce lawyer.md not written - offline',
    '12:00 WARN  sync: <path 1>.md not written - offline',
  ],
  ['12:00 WARN  sync: Private/Kids not moved - offline', '12:00 WARN  sync: <path 1> not moved - offline'],
  ['12:00 INFO  Divorce lawyer.md could not be read', '12:00 INFO  <path 1>.md could not be read'],
  ['12:00 ERROR save: Letter to my lawyer - Error: full', '12:00 ERROR save: <a draft> - Error: full'],
  ['12:00 WARN  sync: Anna Schmidt.MD not sent', '12:00 WARN  sync: <path 1>.MD not sent'],
  ['12:00 WARN  sync: Clients/Anna Schmidt not sent', '12:00 WARN  sync: <path 1> not sent'],
  [
    '12:00 WARN  https://anna:hunter2@example.org/a/b?token=SECRET&x=1#y failed',
    '12:00 WARN  https://example.org/… failed',
  ],
  [
    '12:00 WARN  https://api.orden.example/v1/push?token=SECRET failed',
    '12:00 WARN  https://api.orden.example/v1/push failed',
  ],
  ['12:00 WARN  http://asset.localhost/home/anna/Notes/Divorce.png not drawn', '12:00 WARN  <path 1> not drawn'],
  ['12:00 WARN  asset://localhost/%2Fhome%2Fanna%2FDivorce.png not drawn', '12:00 WARN  <path 1> not drawn'],
  ['12:00 WARN  invited anna.schmidt+x@mail.de - no', '12:00 WARN  invited <email> - no'],
  [
    `12:00 ERROR SyntaxError: Unexpected token 'D', "Dear lawyer, I"... is not valid JSON`,
    `12:00 ERROR SyntaxError: Unexpected token <quoted>, <quoted>... is not valid JSON`,
  ],
  [
    '12:00 WARN  POST /v1/push failed - conflict with /home/anna/a.md and status 409',
    '12:00 WARN  POST /v1/push failed - conflict with <path 1>.md and status 409',
  ],
  ['12:00 WARN  could not parse settings.json: expected', '12:00 WARN  could not parse <path 1>.json: expected'],
  [
    '12:00 WARN  sync: the rename of Foo bar.md to Baz.md is given up on',
    '12:00 WARN  sync: the rename of <path 1>.md to <path 2>.md is given up on',
  ],
  ['    at go (https://bank.example.com/app/x.html:5:6)', '    at go (https://bank.example.com/…'],
])('the reader’s paths, drafts, addresses and words go; what went wrong stays: %s', (line, want) => {
  expect(scrubbedLog(line)).toBe(want)
})
test.each([
  `${TIME} info page loaded`,
  '12:00 WARN  a request to https://api.orden.example/v1/sync/pull failed: 503',
  '12:00 ERROR TypeError: x is null at f (tauri://localhost/assets/index-abc.js:12:3)',
  '12:00 ERROR panicked at src/web_tabs.rs:12:3',
  '12:00 WARN  answered with text/plain',
  '12:00 WARN  GET /api/notes/42 503 in 20ms',
  '12:00 INFO  read/write and/or 11/04/2026',
  '    at parse (http://tauri.localhost/assets/index-BKq9x8Yz.js:12:345)',
])('what is not the reader’s stays: %s', (line) => {
  expect(scrubbedLog(line)).toBe(line)
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
test('a name with spaces and no extension in a folder goes all the same', () => {
  const said = scrubbedLog('12:00 WARN  /home/anna/Notes/Ana and Bob/Divorce plan not sent')
  expect(said).not.toMatch(/anna|Ana|Bob|Divorce|plan/)
  expect(said).toMatch(/not sent$/)
})
