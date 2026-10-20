/** Send feedback (#548): anybody may send a report, a session says whose it is, it is
 *  kept and mailed to the owner where an address is set, and it is counted. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { feedbackMail, feedbackSubject } from '../src/feedback'
import { call, mail, signIn, type TestEnv, testEnv } from './harness'

interface Row {
  user_id: string | null
  text: string
  version: string
  platform: string
  log: string
}

const OWNER = 'owner@example.com'
const REPORT = {
  text: 'The tab strip lost its line.',
  version: '0.17.0',
  platform: 'Windows',
  log: 'a line',
}

let env: TestEnv

beforeEach(() => {
  env = testEnv({ FEEDBACK_TO: OWNER })
})

afterEach(() => env.close())

async function rows(): Promise<Row[]> {
  const read = await env.DB.prepare(
    'select user_id, text, version, platform, log from feedback',
  ).all<Row>()
  return read.results
}

describe('a report', () => {
  test('from nobody signed in is kept, and mailed to the owner', async () => {
    let answer = { status: 0 }
    const mailed = await mail(async () => {
      answer = await call(env, '/v1/feedback', { body: REPORT })
    })

    expect(answer.status).toBe(200)
    expect(await rows()).toEqual([{ user_id: null, ...REPORT }])
    expect(mailed).toContain(`[mail] ${OWNER} - Orden feedback: The tab strip lost its line.`)
    expect(mailed).toContain('From somebody signed out · Orden 0.17.0 · Windows')
    expect(mailed).toContain('a line')
  })

  test('from somebody signed in says whose it is', async () => {
    const token = await signIn(env, 'reader@example.com')
    const answer = await call(env, '/v1/feedback', { token, body: REPORT })

    expect(answer.status).toBe(200)
    const [row] = await rows()
    expect(row?.user_id).toBeTruthy()
  })

  test('with nothing written is refused', async () => {
    const answer = await call<{ error?: string }>(env, '/v1/feedback', {
      body: { ...REPORT, text: '  ' },
    })
    expect(answer.status).toBe(400)
    expect(await rows()).toEqual([])
  })

  test('past what a part may be is refused', async () => {
    const answer = await call(env, '/v1/feedback', {
      body: { ...REPORT, text: 'x'.repeat(10_001) },
    })
    expect(answer.status).toBe(400)
  })

  test('is counted per machine', async () => {
    const from = { 'cf-connecting-ip': '203.0.113.9' }
    const answers: number[] = []
    for (let one = 0; one < 11; one++) {
      answers.push((await call(env, '/v1/feedback', { body: REPORT, headers: from })).status)
    }
    expect(answers.slice(0, 10).every((status) => status === 200)).toBe(true)
    expect(answers[10]).toBe(429)
  })

  test('is kept and not mailed where no address is set', async () => {
    const quiet = testEnv()
    const mailed = await mail(() => call(quiet, '/v1/feedback', { body: REPORT }))
    expect(mailed).not.toContain('Orden feedback')
    quiet.close()
  })
})

describe('the mail', () => {
  test('makes no markup of what a person wrote', () => {
    const made = feedbackMail({
      from: 'a@b.c',
      text: '<script>x</script>',
      version: '1',
      platform: 'p',
      log: '<b>',
    })
    expect(made.html).not.toContain('<script>')
    expect(made.html).toContain('&lt;script&gt;')
  })

  test('is named by the first words', () => {
    expect(feedbackSubject('Short one\nand more')).toBe('Orden feedback: Short one and more')
    expect(feedbackSubject('x'.repeat(100)).length).toBeLessThan(80)
  })
})
