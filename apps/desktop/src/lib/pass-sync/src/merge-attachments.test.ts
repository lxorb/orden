import type { Attachment } from '@orden/pass/types'
import { describe, expect, test } from 'vitest'
import { mergedAttachments } from './merge'

const file = (id: string): Attachment => ({ id, name: id, type: 'text/plain', size: 1, key: id })

describe('attachments met from two devices', () => {
  test('keep what either side added', () => {
    const base = [file('a')]
    expect(mergedAttachments(base, [file('a'), file('b')], [file('a'), file('c')])).toEqual([
      file('a'),
      file('b'),
      file('c'),
    ])
  })

  test('lose what either side took off', () => {
    const base = [file('a'), file('b')]
    expect(mergedAttachments(base, [file('b')], [file('a'), file('b'), file('c')])).toEqual([
      file('b'),
      file('c'),
    ])
  })

  test('without a base keep both sides', () => {
    expect(mergedAttachments(null, [file('a')], [file('b')])).toEqual([file('a'), file('b')])
  })
})
