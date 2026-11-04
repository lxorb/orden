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
