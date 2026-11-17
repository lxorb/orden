import { describe, expect, test } from 'vitest'
import * as frame from '../src/api'

describe('the frame', () => {
  test('hands the app the parts it draws around the panes', () => {
    expect(Object.keys(frame).sort()).toEqual([
      'FirstScreen',
      'FirstSync',
      'PadColumn',
      'Progress',
      'PullMark',
      'SizeBadge',
      'StatusBar',
      'StorageWarning',
    ])
    for (const part of Object.values(frame)) expect(typeof part).toBe('function')
  })
})
