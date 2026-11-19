import { describe, expect, test } from 'vitest'
import { type Importer, providePort } from '@orden/contracts'
import { beginSetup, gate, loadGuide, loadSetup } from '../src/api'
import { bringing, mcpImporting } from '../src/bring'
import { BROWSERS } from '../src/catalog'
import { type Reach, stepAfter } from '../src/flow'

describe('the module stands on its own', () => {
  test('the setup and the guide open, and the setup begins, through doors', () => {
    for (const one of [loadSetup, loadGuide, beginSetup]) expect(typeof one).toBe('function')
    expect(gate.showing).toBe(false)
    expect(gate.guiding).toBe(false)
  })
})
const reach = (here: ReadonlySet<Importer>): Reach => ({
  signedIn: true,
  importable: (id) => {
    const importer = BROWSERS.find((one) => one.id === id)?.importer ?? null
    return importer !== null && here.has(importer)
  },
  signIns: true,
  phone: false,
  heard: true,
  connected: false,
  mcpFound: false,
})
const answers = { browser: 'chrome', notes: null, code: null }
describe('what the setup asks of import', () => {
  test('finds and brings nothing while no module lends the import', async () => {
    expect([...(await bringing().here())]).toEqual([])
    expect(await bringing().browser('chrome')).toEqual([])
    expect(await bringing().notes('folder')).toEqual({ picked: false, trouble: null })
    expect(stepAfter('browser', answers, reach(await bringing().here()))).not.toBe('import')
  })
  test('offers to import a browser the port finds here, and tells what the port brought', async () => {
    const brought: string[] = []
    const unbind = providePort('import.bring', {
      here: () => Promise.resolve(new Set<Importer>(['chrome'])),
      browser: (importer) => {
        brought.push(importer)
        return Promise.resolve(['1 bookmark could not be read'])
      },
      notes: () => Promise.resolve({ picked: true, trouble: null }),
      shared: () => Promise.resolve(null),
      landShared: () => Promise.resolve(null),
    })
    expect(stepAfter('browser', answers, reach(await bringing().here()))).toBe('import')
    expect(await bringing().browser('chrome')).toEqual(['1 bookmark could not be read'])
    expect(brought).toEqual(['chrome'])
    expect(await bringing().notes('vault')).toEqual({ picked: true, trouble: null })
    unbind()
    expect(await bringing().notes('vault')).toEqual({ picked: false, trouble: null })
  })
})
describe('what the setup asks of the MCP import', () => {
  test('finds nothing to bring while no module lends the port', async () => {
    expect(await mcpImporting().scan()).toEqual([])
    expect(mcpImporting().importable([{ servers: [{ already: false, orden: false }] }])).toBe(false)
    await expect(mcpImporting().picker()).rejects.toThrow()
  })
  test('asks the port that lends it', async () => {
    const unbind = providePort('import.mcp', {
      scan: () => Promise.resolve(['found']),
      importable: (found) => found.length > 0,
      picker: () => Promise.resolve({ default: 'picker' }),
    })
    expect(await mcpImporting().scan()).toEqual(['found'])
    expect(mcpImporting().importable(['found'])).toBe(true)
    expect(await mcpImporting().picker()).toEqual({ default: 'picker' })
    unbind()
  })
})
