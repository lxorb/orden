import { describe, expect, test } from 'vitest'
import { portOf, providePort, settingsPartsIn } from '@orden/contracts'
import { type Found, loadMcpImport, scanMcp } from '../src/api'

const server = (name: string, orden = false, already = false) => ({
  name,
  transport: { kind: 'stdio' as const, command: orden ? 'orden' : 'node', args: orden ? ['mcp'] : [], env: [] },
  already,
  orden,
  needsInput: [],
})
async function scanned(found: Found[]) {
  const before = portOf('backend.web')
  const asked: string[] = []
  providePort('backend.web', {
    invoke: <T>(command: string) => {
      asked.push(command)
      return Promise.resolve(found as T)
    },
  })
  try {
    return { found: await scanMcp(), asked }
  } finally {
    if (before.ok) providePort('backend.web', before.value)
  }
}
describe('the MCP servers module', () => {
  test('hold a Settings part of its own in the AI section, shown only on the desktop', () => {
    const part = settingsPartsIn('ai').find((one) => one.title === 'MCP servers')
    expect(part?.card).toBe(false)
    expect(part?.shown()).toBe(false)
    expect(part?.places?.()).toEqual([])
  })
  test('scan other apps without Orden’s own server, and find nothing when nothing is new', async () => {
    const claude = { source: 'claude-code', sourceName: 'Claude Code', path: '/a', servers: [server('orden', true)] }
    const cursor = { source: 'cursor', sourceName: 'Cursor', path: '/b', servers: [server('old', false, true)] }
    expect(await scanned([claude, cursor])).toEqual({ found: [], asked: ['mcp_import_scan'] })
    const fresh = { ...cursor, servers: [server('old', false, true), server('new')] }
    const { found } = await scanned([claude, fresh])
    expect(found.map((one) => [one.source, one.servers.map((each) => each.name)])).toEqual([['cursor', ['old', 'new']]])
  })
  test('open the import picker through a door', () => {
    expect(typeof loadMcpImport).toBe('function')
  })
})
