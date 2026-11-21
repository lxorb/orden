import { expect, test } from 'vitest'
import { failedLook } from './failed'

test('each way a page fails has its own face and line', () => {
  expect(failedLook('offline', 'a.test')).toEqual({ mood: 'offline', line: 'No internet' })
  expect(failedLook('unknown', 'a.test')).toEqual({ mood: 'lost', line: 'Can’t find a.test' })
  expect(failedLook(null, 'a.test').mood).toBe('dizzy')
  const failures = ['offline', 'unknown', 'unreachable', 'slow', 'certificate', 'blocked', 'other', null] as const
  expect(new Set(failures.map((one) => failedLook(one, 'a.test').mood)).size).toBe(failures.length)
})
