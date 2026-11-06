import { describe, expect, test } from 'vitest'
import { geminiReader } from './gemini'
import type { Heard } from './heard'

const SAID = [
  '{"type":"init","timestamp":"t","session_id":"5a7c-91","model":"gemini-3.8-flash"}',
  '{"type":"message","timestamp":"t","role":"user","content":"What is in Birds.md?"}',
  '{"type":"tool_use","timestamp":"t","tool_name":"mcp_orden_read_note","tool_id":"read-1","parameters":{"path":"Birds.md"}}',
  '{"type":"tool_result","timestamp":"t","tool_id":"read-1","status":"success","output":"Herons."}',
  '{"type":"message","timestamp":"t","role":"assistant","content":"It says ","delta":true}',
  '{"type":"message","timestamp":"t","role":"assistant","content":"herons.","delta":true}',
  '{"type":"message","timestamp":"t","role":"assistant","content":"It says herons."}',
  '{"type":"error","timestamp":"t","severity":"warning","message":"Loop detected, carrying on"}',
  '{"type":"result","timestamp":"t","status":"success","stats":{"total_tokens":180,"input_tokens":170,"output_tokens":10,"cached":120,"input":50,"duration_ms":900,"tool_calls":1,"models":{}}}',
]

function readAll(lines: readonly string[]): Heard[] {
  const read = geminiReader()
  return lines.map(read)
}

describe('a Gemini CLI turn', () => {
  test('names the model, streams the words once and ends with what it spent', () => {
    const heard = readAll(SAID)
    expect(heard[0]).toEqual({ model: 'gemini-3.8-flash' })
    expect(heard.map((one) => one.text ?? '').join('')).toBe('It says herons.')
    expect(heard.some((one) => one.trouble)).toBe(false)
    expect(heard.at(-1)).toEqual({ usage: { input: 170, cached: 120, output: 10 }, ended: 'end' })
  })

  test('shows Orden’s call by its bare name, then its answer', () => {
    const heard = readAll(SAID)
    expect(heard[2]?.tool).toEqual({ id: 'read-1', name: 'read_note', args: { path: 'Birds.md' } })
    expect(heard[3]?.tool).toEqual({
      id: 'read-1',
      name: '',
      done: { text: 'Herons.', error: false },
    })
    const failed = geminiReader()(
      '{"type":"tool_result","tool_id":"r","status":"error","error":{"type":"x","message":"No such note"}}',
    )
    expect(failed.tool?.done).toEqual({ text: 'No such note', error: true })
  })

  test('is the whole message where a version printed no deltas', () => {
    const plain = SAID.filter((line) => !line.includes('"delta"'))
    expect(
      readAll(plain)
        .map((one) => one.text ?? '')
        .join(''),
    ).toBe('It says herons.')
  })

  test('a failed turn says why, and whether it wants a sign-in or hit its quota', () => {
    const read = geminiReader()
    const out = read(
      '{"type":"result","status":"error","error":{"type":"Error","message":"401 Unauthorized"}}',
    )
    expect(out).toMatchObject({ ended: 'error', trouble: '401 Unauthorized', signedOut: true })
    const quota = read(
      '{"type":"result","status":"error","error":{"type":"Error","message":"RESOURCE_EXHAUSTED: Quota exceeded"}}',
    )
    expect(quota.limit).toEqual({ state: 'reached', until: null, untilWords: null })
    expect(read('{"type":"error","severity":"error","message":"boom"}')).toEqual({
      trouble: 'boom',
    })
    expect(read('not json')).toEqual({})
  })
})
