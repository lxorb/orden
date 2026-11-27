import { describe, expect, test } from 'vitest'
import { OpenCode } from './client'

function recorded(status = 200, body: unknown = true) {
  const asked: [string, string, unknown][] = []
  const client = new OpenCode((method, path, sent) => {
    asked.push([method, path, sent])
    return Promise.resolve({ status, body })
  })
  return { client, asked }
}
describe('the OpenCode client (#2470)', () => {
  test('answers a permission once, always or with a refusal and its reason', async () => {
    const { client, asked } = recorded()
    await client.reply('per_1', 'once')
    await client.reply('per_1', 'reject', 'not now')
    expect(asked).toEqual([
      ['POST', '/permission/per_1/reply', { reply: 'once' }],
      ['POST', '/permission/per_1/reply', { reply: 'reject', message: 'not now' }],
    ])
  })
  test('asks with the chosen agent and model', async () => {
    const { client, asked } = recorded(204, null)
    await client.prompt('ses_1', 'Plan a week', { agent: 'plan', providerID: 'anthropic', modelID: 'claude' })
    expect(asked[0]).toEqual([
      'POST',
      '/session/ses_1/prompt_async',
      {
        parts: [{ type: 'text', text: 'Plan a week' }],
        agent: 'plan',
        model: { providerID: 'anthropic', modelID: 'claude' },
      },
    ])
  })
  test('throws what OpenCode said when a call fails', async () => {
    const { client } = recorded(400, { data: { message: 'no such session' } })
    await expect(client.messages('ses_x')).rejects.toThrow('OpenCode 400: no such session')
  })
})
