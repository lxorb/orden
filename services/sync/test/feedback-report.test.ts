/** What a report is answered with (#1087): the address of its own page, given only once
 *  the report is kept, which says how it stands to whoever holds its key; and the
 *  pictures it carried, kept without what was written beside them, served by a name
 *  only the issue and the page know, and gone with the account. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { eraseAccount } from '../src/erase'
import { jpegWithout, MOST_IMAGES, pictureOf, pngWithout, sniffed } from '../src/feedback-images'
import { issueBody } from '../src/feedback-issues'
import { reportPage, standing } from '../src/feedback-page'
import { sweepLeftovers } from '../src/leftovers'
import { call, signIn, type TestEnv, testEnv } from './harness'

let env: TestEnv

beforeEach(() => {
  env = testEnv()
})

afterEach(() => env.close())

const REPORT = { text: 'The tab strip <b>lost</b> its line.', version: '0.17.0', platform: 'linux' }

function bytes(...parts: (number[] | Uint8Array | string)[]): Uint8Array {
  const all: number[] = []
  for (const part of parts) {
    if (typeof part === 'string') {
      for (let at = 0; at < part.length; at++) all.push(part.charCodeAt(at))
    } else all.push(...part)
  }
  return Uint8Array.from(all)
}

function chunk(type: string, data: string | number[]): Uint8Array {
  const body = typeof data === 'string' ? bytes(data) : Uint8Array.from(data)
  const length = body.length
  return bytes(
    [length >>> 24, (length >>> 16) & 255, (length >>> 8) & 255, length & 255],
    type,
    body,
    [0, 0, 0, 0],
  )
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** A PNG that carries a camera's place in an EXIF chunk and words in a text chunk. */
const PNG = bytes(
  SIGNATURE,
  chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
  chunk('eXIf', 'GPSLatitude 47.37'),
  chunk('tEXt', 'Comment\0taken at home'),
  chunk('IDAT', [1, 2, 3]),
  chunk('IEND', []),
)

function segment(marker: number, data: string): Uint8Array {
  const length = data.length + 2
  return bytes([0xff, marker, length >> 8, length & 255], data)
}

/** A JPEG with JFIF's header, EXIF with a place, and a comment before its scan. */
const JPEG = bytes(
  [0xff, 0xd8],
  segment(0xe0, 'JFIF\0\x01\x01\0\0\x01\0\x01\0\0'),
  segment(0xe1, 'Exif\0\0GPSLatitude 47.37'),
  segment(0xfe, 'taken at home'),
  segment(0xdb, 'quant'),
  segment(0xda, 'scan'),
  [9, 9, 9, 0xff, 0xd9],
)

function text(picture: Uint8Array): string {
  let said = ''
  for (const byte of picture) said += String.fromCharCode(byte)
  return said
}

function dataUrl(type: string, picture: Uint8Array): string {
  return `data:${type};base64,${btoa(text(picture))}`
}

describe('the answer to a report', () => {
  test('is the address of its page, which says it arrived and what it said', async () => {
    const answer = await call<{ ok: boolean; id: string; url: string }>(env, '/v1/feedback', {
      body: REPORT,
    })
    expect(answer.status).toBe(200)
    const { id, url } = answer.json
    expect(url).toMatch(new RegExp(`^https://orden\\.so/v1/feedback/${id}/[0-9a-f]{64}$`))

    const page = await call(env, new URL(url).pathname)
    expect(page.status).toBe(200)
    expect(page.text).toContain('Received. It is waiting to be filed')
    expect(page.text).toContain('The tab strip &lt;b&gt;lost&lt;/b&gt; its line.')
    expect(page.text).not.toContain('<b>lost</b>')
    expect(page.headers.get('referrer-policy')).toBe('no-referrer')
    expect(page.headers.get('cache-control')).toBe('no-store')
  })

  test('opens to nobody without its key, and the database keeps only its hash', async () => {
    const { id, url } = (
      await call<{ id: string; url: string }>(env, '/v1/feedback', {
        body: REPORT,
      })
    ).json
    const key = url.split('/').at(-1) ?? ''

    const wrong = await call(env, `/v1/feedback/${id}/${'0'.repeat(64)}`)
    expect(wrong.status).toBe(404)
    expect(wrong.text).not.toContain('tab strip')
    expect((await call(env, `/v1/feedback/${id}/short`)).status).toBe(404)

    const row = env.db.prepare('select status_hash from feedback where id = ?').get(id) as {
      status_hash: string
    }
    expect(row.status_hash).not.toBe(key)
    expect(row.status_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('is no address where the report was refused', async () => {
    const answer = await call<{ error: string; url?: string }>(env, '/v1/feedback', {
      body: { ...REPORT, text: '  ' },
    })
    expect(answer.status).toBe(400)
    expect(answer.json.url).toBeUndefined()
  })
})

describe('how a report stands', () => {
  test('from waiting to be filed to closed', () => {
    expect(standing({ filed: false, state: null })).toMatch(/waiting to be filed/)
    expect(standing({ filed: true, state: 'open' })).toMatch(/open and in the queue/)
    expect(standing({ filed: true, state: 'done' })).toMatch(/dealt with/)
    expect(standing({ filed: true, state: 'not planned' })).toMatch(/not planned/)
    expect(standing({ filed: true, state: null })).toMatch(/filed/)
  })

  test('a page that names nothing says so and nothing more', () => {
    expect(reportPage(null)).toContain('No report here')
  })
})

describe('the pictures of a report', () => {
  test('are kept without the place and the words written beside them', () => {
    const png = pngWithout(PNG)
    expect(png).not.toBeNull()
    expect(text(png ?? new Uint8Array())).not.toMatch(/GPS|taken at home|eXIf|tEXt/)
    expect(text(png ?? new Uint8Array())).toMatch(/IHDR[\s\S]*IDAT[\s\S]*IEND/)

    const jpeg = jpegWithout(JPEG)
    expect(jpeg).not.toBeNull()
    expect(text(jpeg ?? new Uint8Array())).not.toMatch(/Exif|GPS|taken at home/)
    expect(text(jpeg ?? new Uint8Array())).toMatch(/JFIF[\s\S]*quant[\s\S]*scan/)
  })

  test('are read for what they are, not what they say', () => {
    expect(sniffed(PNG)).toBe('image/png')
    expect(sniffed(JPEG)).toBe('image/jpeg')
    expect(pictureOf(dataUrl('image/png', JPEG))).toBe('an image is not what it says it is')
    expect(pictureOf(dataUrl('image/gif', PNG))).toBe('an image must be a PNG or a JPEG')
    expect(pictureOf(dataUrl('image/png', PNG.subarray(0, 40)))).toBe('an image could not be read')
    expect(pictureOf(dataUrl('image/png', new Uint8Array(1_000_001)))).toBe(
      'an image may be at most 1 MB',
    )
  })

  test('are served by their names, stripped, and drawn in the issue and on the page', async () => {
    const answer = await call<{ id: string; url: string }>(env, '/v1/feedback', {
      body: { ...REPORT, images: [dataUrl('image/png', PNG), dataUrl('image/jpeg', JPEG)] },
    })
    expect(answer.status).toBe(200)
    const rows = env.db
      .prepare('select name, position, type from feedback_images order by position')
      .all() as { name: string; position: number; type: string }[]
    expect(rows.map((one) => one.type)).toEqual(['image/png', 'image/jpeg'])

    const served = await call(env, `/v1/feedback/images/${rows[0]?.name ?? ''}`)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')
    expect(served.headers.get('x-content-type-options')).toBe('nosniff')
    expect(served.text).not.toContain('GPS')
    expect((await call(env, `/v1/feedback/images/${'a'.repeat(64)}`)).status).toBe(404)

    const page = await call(env, new URL(answer.json.url).pathname)
    for (const row of rows) {
      expect(page.text).toContain(`https://orden.so/v1/feedback/images/${row.name}`)
    }

    const body = issueBody({
      id: answer.json.id,
      ...REPORT,
      log: '',
      createdAt: 0,
      account: null,
      images: rows.map((one) => `https://orden.so/v1/feedback/images/${one.name}`),
    })
    expect(body).toContain(`![Image 1](https://orden.so/v1/feedback/images/${rows[0]?.name ?? ''})`)
    expect(body).toContain(`![Image 2](https://orden.so/v1/feedback/images/${rows[1]?.name ?? ''})`)
  })

  test('are refused past the count, and the report with them', async () => {
    const images = Array.from({ length: MOST_IMAGES + 1 }, () => dataUrl('image/png', PNG))
    const answer = await call(env, '/v1/feedback', { body: { ...REPORT, images } })
    expect(answer.status).toBe(400)
    expect(env.db.prepare('select count(*) as n from feedback').get()).toEqual({ n: 0 })
    expect(env.keys().filter((key) => key.startsWith('feedback/'))).toEqual([])
  })

  test('go with the account they came from', async () => {
    const token = await signIn(env, 'reader@example.com')
    const me = (await call<{ user: { id: string; email: string } }>(env, '/v1/me', { token })).json
      .user
    await call(env, '/v1/feedback', {
      token,
      body: { ...REPORT, images: [dataUrl('image/png', PNG)] },
    })
    expect(env.keys().filter((key) => key.startsWith('feedback/'))).toHaveLength(1)

    await eraseAccount(env, { id: me.id, email: me.email, name: null, created_at: 1 })
    await sweepLeftovers(env)

    expect(env.db.prepare('select count(*) as n from feedback_images').get()).toEqual({ n: 0 })
    expect(env.keys().filter((key) => key.startsWith('feedback/'))).toEqual([])
  })
})
