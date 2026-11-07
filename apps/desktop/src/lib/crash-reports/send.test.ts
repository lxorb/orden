import { describe, expect, test } from 'vitest'
import { ApiError } from '../api'
import type { CrashReport } from './scrub'
import { type Sending, sendWaiting } from './send'

function report(id: string): CrashReport {
  return {
    v: 1,
    id,
    kind: 'panic',
    at: 1,
    app: { version: '1.0.0', channel: '', build: 'desktop' },
    system: { os: 'windows', osVersion: '10', arch: 'x86_64', engine: 'WebView2' },
    summary: String.raw`could not read C:\Users\anna\Notes\Diary.md`,
  }
}

function sending(on: boolean, answer: (report: CrashReport) => unknown = () => ({ ok: true })) {
  const kept = [report('a'.repeat(32)), report('b'.repeat(32))]
  const posted: CrashReport[] = []
  const sent: string[] = []
  const unsent: string[] = []
  const how: Sending = {
    on: () => on,
    channel: () => 'unstable',
    waiting: () => Promise.resolve(kept),
    sent: (id) => {
      sent.push(id)
      return Promise.resolve()
    },
    unsent: (id) => {
      unsent.push(id)
      return Promise.resolve()
    },
    post: (one) => {
      posted.push(one)
      const said = answer(one)
      return said instanceof Error ? Promise.reject(said) : Promise.resolve(said)
    },
  }
  return { how, posted, sent, unsent }
}

describe('crash reports go to Orden', () => {
  test('scrubbed, with the channel, and are dropped once kept', async () => {
    const { how, posted, sent } = sending(true)
    expect(await sendWaiting(how)).toBe('done')
    expect(posted).toHaveLength(2)
    expect(posted[0]?.app.channel).toBe('unstable')
    expect(JSON.stringify(posted)).not.toContain('anna')
    expect(JSON.stringify(posted)).not.toContain('Diary')
    expect(sent).toEqual(['a'.repeat(32), 'b'.repeat(32)])
  })

  test('with the setting off, nothing is sent and nothing is kept', async () => {
    const { how, posted, sent } = sending(false)
    expect(await sendWaiting(how)).toBe('off')
    expect(posted).toHaveLength(0)
    expect(sent).toEqual(['a'.repeat(32), 'b'.repeat(32)])
  })

  test('a server without the route keeps them here for later', async () => {
    const { how, posted, sent, unsent } = sending(true, () => new ApiError(404, 'not found'))
    expect(await sendWaiting(how)).toBe('later')
    expect(posted).toHaveLength(1)
    expect(sent).toHaveLength(0)
    expect(unsent).toEqual(['a'.repeat(32), 'b'.repeat(32)])
  })

  test('offline or turned away for now, they wait', async () => {
    for (const error of [
      new TypeError('Failed to fetch'),
      new ApiError(429, 'later'),
      new ApiError(401, 'sign in first'),
      new ApiError(405, 'not allowed'),
    ]) {
      const { how, sent } = sending(true, () => error)
      expect(await sendWaiting(how)).toBe('later')
      expect(sent).toHaveLength(0)
    }
  })

  test('a report the server refuses outright is not sent again', async () => {
    const { how, sent } = sending(true, (one) =>
      one.id.startsWith('a') ? new ApiError(400, 'bad') : { ok: true },
    )
    expect(await sendWaiting(how)).toBe('done')
    expect(sent).toEqual(['a'.repeat(32), 'b'.repeat(32)])
  })
})
