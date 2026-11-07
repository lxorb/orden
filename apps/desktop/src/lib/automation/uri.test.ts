import { describe, expect, test } from 'vitest'
import { callbackKind, isFileUri, isOrdenUri, readUri, withOutcome } from './uri'

describe('reading a link', () => {
  test('takes the action and the arguments', () => {
    const link = readUri('orden://open?path=notes/Plan.md&heading=Later')

    expect(link?.action).toBe('open')
    expect(link?.args).toEqual({ path: 'notes/Plan.md', heading: 'Later' })
  })

  test('reads both ways of writing the scheme, and the browser one', () => {
    expect(readUri('nib:open?path=A.md')?.action).toBe('open')
    expect(readUri('orden:///open?path=A.md')?.action).toBe('open')
    expect(readUri('web+orden://open?path=A.md')?.action).toBe('open')
    expect(readUri('ORDEN://Open?path=A.md')?.action).toBe('open')
  })

  test('still reads a link written before the rename, for one release', () => {
    expect(readUri('nib://open?path=A.md')?.action).toBe('open')
    expect(readUri('web+nib://open?path=A.md')?.action).toBe('open')
    expect(isOrdenUri('NIB://Open')).toBe(true)
  })

  test('reads the x-callback-url spelling as the plain action', () => {
    expect(readUri('orden://x-callback-url/new?name=Idea')?.action).toBe('new')
  })

  test('undoes the encoding a path with a space in it needs', () => {
    expect(readUri('orden://open?path=day%20job%2FPlan.md')?.args.path).toBe('day job/Plan.md')
  })

  test('takes the callbacks out of the arguments', () => {
    const link = readUri(
      'orden://new?name=Idea&x-success=https://example.com/done&x-error=orden://open',
    )

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

  test('is nothing at all for an address that is not ours', () => {
    expect(readUri('https://example.com')).toBeNull()
    expect(readUri('obsidian://open?vault=x')).toBeNull()
    expect(readUri('javascript:alert(1)')).toBeNull()
    expect(readUri('nibble://open')).toBeNull()
  })

  test('reads an action written with a dot in it', () => {
    expect(readUri('orden://files.delete?path=A.md')?.action).toBe('files.delete')
  })

  test('is nothing for an action that is not a word', () => {
    expect(readUri('orden://?path=A.md')).toBeNull()
    expect(readUri('orden://../../etc?x=1')).toBeNull()
    expect(readUri('orden://open files')).toBeNull()
  })

  test('says which strings are ours at all', () => {
    expect(isOrdenUri('orden://open')).toBe(true)
    expect(isOrdenUri(' web+orden://open ')).toBe(true)
    expect(isOrdenUri('file:///etc/passwd')).toBe(false)
  })
})

describe('where a link may go afterwards', () => {
  test('the web, and this app itself', () => {
    expect(callbackKind('https://example.com/done')).toBe('external')
    expect(callbackKind('http://127.0.0.1/done')).toBe('external')
    expect(callbackKind('orden://open?path=A.md')).toBe('orden')
  })

  test('and nowhere else, whatever it is', () => {
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'smb://server/share',
      'shortcuts://x-callback-url/run',
      'mailto:someone@example.com',
      'data:text/html,<script>',
      '//example.com',
      '',
    ]) {
      expect(callbackKind(url), url).toBeNull()
    }

    expect(callbackKind(null)).toBeNull()
  })
})

describe('writing the outcome onto a callback', () => {
  test('adds what the app has to say', () => {
    expect(withOutcome('https://example.com/done', { path: 'A.md' })).toBe(
      'https://example.com/done?path=A.md',
    )
  })

  test('keeps what the caller already put there', () => {
    expect(withOutcome('https://example.com/done?tag=weekly', { path: 'day job/A.md' })).toBe(
      'https://example.com/done?tag=weekly&path=day+job%2FA.md',
    )
  })

  test('replaces its own name rather than saying it twice', () => {
    expect(withOutcome('https://example.com/done?path=old', { path: 'new' })).toBe(
      'https://example.com/done?path=new',
    )
  })

  test('leaves an address with nothing to add alone', () => {
    expect(withOutcome('https://example.com/done', {})).toBe('https://example.com/done')
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
