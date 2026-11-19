import { describe, expect, test } from 'vitest'
import { callbackKind, isFileUri, isOrdenUri, readUri, withOutcome } from './uri'

describe('reading a link', () => {
  test('takes the action and the arguments', () => {
    const link = readUri('orden://open?path=notes/Plan.md&heading=Later')
    expect(link?.action).toBe('open')
    expect(link?.args).toEqual({ path: 'notes/Plan.md', heading: 'Later' })
  })
  test.each([
    ['orden:open?path=A.md', 'open'],
    ['orden:///open?path=A.md', 'open'],
    ['web+orden://open?path=A.md', 'open'],
    ['ORDEN://Open?path=A.md', 'open'],
    ['orden://x-callback-url/new?name=Idea', 'new'],
    ['orden://files.delete?path=A.md', 'files.delete'],
  ])('reads %s, in any spelling of the scheme, as %s', (uri, action) => {
    expect(readUri(uri)?.action).toBe(action)
  })
  test('undoes the encoding a path with a space in it needs', () => {
    expect(readUri('orden://open?path=day%20job%2FPlan.md')?.args.path).toBe('day job/Plan.md')
  })
  test('takes the callbacks out of the arguments', () => {
    const link = readUri('orden://new?name=Idea&x-success=https://example.com/done&x-error=orden://open')
    expect(link?.args).toEqual({ name: 'Idea' })
    expect(link?.callbacks).toEqual({
      success: 'https://example.com/done',
      error: 'orden://open',
      cancel: null,
    })
  })
  test('keeps the first of two arguments that say the same thing', () => {
    expect(readUri('orden://open?path=A.md&path=B.md')?.args.path).toBe('A.md')
  })
  test.each([
    'https://example.com',
    'obsidian://open?vault=x',
    'javascript:alert(1)',
    'nibble://open',
    'orden://?path=A.md',
    'orden://../../etc?x=1',
    'orden://open files',
  ])('is nothing for %s, not ours or not a word', (uri) => {
    expect(readUri(uri)).toBeNull()
  })
  test('says which strings are ours at all', () => {
    expect(isOrdenUri('orden://open')).toBe(true)
    expect(isOrdenUri(' web+orden://open ')).toBe(true)
    expect(isOrdenUri('file:///etc/passwd')).toBe(false)
  })
})
describe('where a link may go afterwards', () => {
  test.each([
    ['https://example.com/done', 'external'],
    ['http://127.0.0.1/done', 'external'],
    ['orden://open?path=A.md', 'orden'],
    ['file:///etc/passwd', null],
    ['javascript:alert(1)', null],
    ['smb://server/share', null],
    ['shortcuts://x-callback-url/run', null],
    ['mailto:someone@example.com', null],
    ['data:text/html,<script>', null],
    ['//example.com', null],
    ['', null],
    [null, null],
  ])('%j is %j', (url, kind) => {
    expect(callbackKind(url)).toBe(kind)
  })
})
describe('writing the outcome onto a callback', () => {
  test.each<[string, Record<string, string>, string]>([
    ['https://example.com/done', { path: 'A.md' }, 'https://example.com/done?path=A.md'],
    [
      'https://example.com/done?tag=weekly',
      { path: 'day job/A.md' },
      'https://example.com/done?tag=weekly&path=day+job%2FA.md',
    ],
    ['https://example.com/done?path=old', { path: 'new' }, 'https://example.com/done?path=new'],
    ['https://example.com/done', {}, 'https://example.com/done'],
  ])('%s with %j is %s', (url, said, written) => {
    expect(withOutcome(url, said)).toBe(written)
  })
})
describe('a file the Finder opened', () => {
  test('is a file, not a link', () => {
    expect(isFileUri('file:///Users/me/Notes/Idea.md')).toBe(true)
    expect(isFileUri(' FILE:///Users/me/Idea.md')).toBe(true)
    expect(isFileUri('orden://open?path=Idea.md')).toBe(false)
    expect(isOrdenUri('file:///Users/me/Notes/Idea.md')).toBe(false)
  })
})
