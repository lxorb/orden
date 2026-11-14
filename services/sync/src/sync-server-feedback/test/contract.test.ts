import { describe, expect, test } from 'vitest'
import { crashReportOf, scriptFrames, titleOf } from '../src/crash-shape'
import { feedbackMail, feedbackSubject } from '../src/feedback'
import { pictureOf, sniffed } from '../src/feedback-images'
import { issueTitle, markOf, platformLabel } from '../src/feedback-issues'
import { standing } from '../src/feedback-page'

describe('a feedback report', () => {
  test('its subject is the first line, cut short, and its mail escapes what was typed', () => {
    expect(feedbackSubject('Sync  stalls\nafter sleep')).toBe(
      'Orden feedback: Sync stalls after sleep',
    )
    expect(feedbackSubject('x'.repeat(80))).toBe(`Orden feedback: ${'x'.repeat(59)}…`)
    const mail = feedbackMail({
      from: 'a@b.dev',
      text: '<b>bold</b>',
      version: '1.2.3',
      platform: 'macos',
      log: '',
    })
    expect(mail.text).toContain('From a@b.dev, Orden 1.2.3, macos')
    expect(mail.text).toContain('(no log)')
    expect(mail.html).toContain('&lt;b&gt;bold&lt;/b&gt;')
    expect(mail.html).not.toContain('<b>bold</b>')
  })

  test('the issue title is the first sentence with mentions defused', () => {
    expect(issueTitle('It broke. Then it did not.')).toBe('Feedback: It broke.')
    expect(issueTitle('ping @someone please')).toBe('Feedback: ping @​someone please')
    expect(issueTitle('y'.repeat(100))).toBe(`Feedback: ${'y'.repeat(79)}…`)
    expect(markOf('r1')).toBe('<!-- orden-feedback:r1 -->')
  })

  test('platforms are labelled by system, the web as web, anything else not at all', () => {
    expect(platformLabel('macOS 15.1 arm64')).toBe('macos')
    expect(platformLabel('web (Chrome)')).toBe('web')
    expect(platformLabel('Android 14')).toBe('android')
    expect(platformLabel('BeOS')).toBeNull()
  })

  test('its standing is told from whether and how it was filed', () => {
    expect(standing({ filed: false, state: null })).toMatch(/waiting to be filed/)
    expect(standing({ filed: true, state: 'open' })).toMatch(/open/)
    expect(standing({ filed: true, state: 'done' })).toMatch(/dealt with/)
    expect(standing({ filed: true, state: 'not planned' })).toMatch(/not planned/)
    expect(standing({ filed: true, state: null })).toMatch(/filed for the team/)
  })
})

describe('pictures on a report', () => {
  const chunk = (type: string, body: number[]) => [
    0,
    0,
    0,
    body.length,
    ...[0, 1, 2, 3].map((at) => type.charCodeAt(at)),
    ...body,
    0,
    0,
    0,
    0,
  ]
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

  test('only a PNG or a JPEG data url is a picture, and its text chunks are dropped', () => {
    const png = Uint8Array.from([...SIGNATURE, ...chunk('tEXt', [1]), ...chunk('IEND', [])])
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])
    expect(sniffed(png)).toBe('image/png')
    expect(sniffed(jpeg)).toBe('image/jpeg')
    expect(sniffed(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(typeof pictureOf('data:image/gif;base64,AAAA')).toBe('string')
    expect(typeof pictureOf('data:image/png;base64,AAAA')).toBe('string')
    const picture = pictureOf(`data:image/png;base64,${btoa(String.fromCharCode(...png))}`)
    if (typeof picture === 'string') throw new Error(picture)
    expect(picture.type).toBe('image/png')
    expect(picture.bytes.length).toBe(SIGNATURE.length + chunk('IEND', []).length)
  })
})

describe('a crash report', () => {
  test('is refused unless it is an object the shape expects', () => {
    expect(typeof crashReportOf('nope')).toBe('string')
    expect(typeof crashReportOf({})).toBe('string')
  })

  test('script frames read V8 and WebKit stacks, three deep', () => {
    const v8 = [
      'Error: boom',
      '    at open (https://orden.so/assets/app-1234.js:10:5)',
      '    at https://orden.so/assets/app-1234.js:20:1',
      '    at a (x.js:1:1)',
      '    at b (y.js:1:1)',
    ].join('\n')
    expect(scriptFrames(v8)).toHaveLength(3)
    expect(scriptFrames(v8)[0]).toMatch(/^open /)
    expect(scriptFrames(v8)[1]).toMatch(/^<anonymous> /)
    const webkit = 'open@https://orden.so/assets/app-1234.js:10:5\n@https://orden.so/x.js:1:1'
    expect(scriptFrames(webkit)).toHaveLength(2)
  })

  test('a title names the kind and strips the numbers that would split one crash into many', () => {
    const report = crashReportOf({
      v: 1,
      id: '0123456789abcdef0123456789abcdef',
      kind: 'panic',
      at: 1,
      app: { version: '1.0.0', channel: 'stable', build: 'b1' },
      system: { os: 'linux', osVersion: '6.8', arch: 'x86_64', engine: 'webkit' },
      summary: 'index out of bounds',
      where: 'src/lib.rs:42:7',
    })
    if (typeof report === 'string') throw new Error(report)
    expect(titleOf(report)).toBe('index out of bounds at src/lib.rs')
  })
})
