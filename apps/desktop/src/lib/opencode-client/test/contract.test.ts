import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const CRATE = join(import.meta.dirname, '../../../../src-tauri/crates/opencode/src')
const schema = JSON.parse(readFileSync(join(CRATE, 'drive/schema.json'), 'utf8')) as {
  routes: Record<string, unknown>
  schemas: Record<string, { properties?: Record<string, unknown> }>
}
const proxied = readFileSync(join(CRATE, 'proxy.rs'), 'utf8')
describe('the opencode-client module (#2470)', () => {
  test('offers the client, the event follower and the translation', async () => {
    expect(Object.keys(await import('../src/api')).sort()).toEqual([
      'Feed',
      'OpenCode',
      'asksOf',
      'engine',
      'followEvents',
      'isEvent',
      'openCodeStatus',
      'opencode',
      'partOf',
      'restartOpenCode',
      'startOpenCode',
      'stopOpenCode',
      'stoppedLine',
      'turnOf',
      'usageOf',
      'verbOf',
    ])
  })
  test('calls only routes the pinned OpenCode has and Orden’s proxy lets through', () => {
    const client = readFileSync(join(import.meta.dirname, '../src/client.ts'), 'utf8')
    const calls = [...client.matchAll(/this\.asked\(\s*'(\w+)',\s*[`'](\/[^`']*)[`']/g)].map(
      ([, method = '', path = '']) => `${method} ${path.replace(/\$\{\w+\}/g, '{id}')}`,
    )
    expect(calls.length).toBeGreaterThan(8)
    for (const one of calls) {
      expect(Object.keys(schema.routes), one).toContain(one)
      const [method, path] = one.split(' ')
      expect(proxied, one).toContain(`("${method ?? ''}", "${path ?? ''}")`)
    }
  })
  test('reads only fields the pinned OpenCode sends', () => {
    const fields: Record<string, string[]> = {
      Session: ['id', 'title', 'parentID', 'time'],
      AssistantMessage: [
        'id',
        'sessionID',
        'role',
        'time',
        'agent',
        'providerID',
        'modelID',
        'cost',
        'tokens',
        'error',
      ],
      UserMessage: ['id', 'sessionID', 'role', 'time', 'agent', 'model'],
      TextPart: ['id', 'messageID', 'sessionID', 'text', 'synthetic'],
      ReasoningPart: ['text', 'time'],
      ToolPart: ['callID', 'tool', 'state'],
      ToolStateCompleted: ['input', 'output', 'title', 'metadata'],
      ToolStateError: ['input', 'error'],
      StepFinishPart: ['cost', 'tokens'],
      PermissionRequest: ['id', 'sessionID', 'permission', 'patterns', 'metadata', 'always', 'tool'],
      Agent: ['name', 'mode', 'description', 'hidden', 'native'],
      Provider: ['id', 'name', 'models'],
      Model: ['id', 'name', 'limit'],
    }
    for (const [name, wanted] of Object.entries(fields)) {
      const known = Object.keys(schema.schemas[name]?.properties ?? {})
      for (const field of wanted) expect(known, `${name}.${field}`).toContain(field)
    }
  })
})
