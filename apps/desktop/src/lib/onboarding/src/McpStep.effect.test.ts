import { providePort } from '@orden/contracts'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

interface Server {
  name: string
  already: boolean
  orden: boolean
}
let scanned: () => Promise<unknown[]> = () => Promise.resolve([])
const unprovide = providePort('import.mcp', {
  scan: () => scanned(),
  importable: (found) =>
    (found as { servers: Server[] }[]).some((one) => one.servers.some((server) => !server.already && !server.orden)),
  picker: () => import('../test/FakeMcpImport.svelte'),
})
const { setup } = await import('./setup-state.svelte')
const { stepAfter } = await import('./flow')
const McpStep = (await import('./McpStep.svelte')).default

const server = (change: Partial<Server> = {}): Server => ({ name: 'files', already: false, orden: false, ...change })
const found = (...servers: Server[]) => [{ source: 'claude-desktop', sourceName: 'Claude Desktop', servers }]
let close: (() => void) | undefined
afterEach(() => {
  close?.()
  close = undefined
  document.body.innerHTML = ''
  setup.showing = false
  setup.mcp = []
  setup.mcpFound = false
  localStorage.clear()
})
describe('the MCP servers of other apps during setup', () => {
  test('come right after the AI when another app has one Orden can bring', async () => {
    scanned = () => Promise.resolve(found(server()))
    setup.begin(true)
    await setup.look()
    await vi.waitFor(() => expect(setup.reach.mcpFound).toBe(true))
    expect(stepAfter('ai', setup.answers, setup.reach)).toBe('mcp')
  })
  test('are skipped when each one found is in Orden already or is Orden itself', async () => {
    setup.mcpFound = true
    scanned = () => Promise.resolve(found(server({ already: true }), server({ name: 'orden', orden: true })))
    await setup.look()
    await vi.waitFor(() => expect(setup.reach.mcpFound).toBe(false))
    expect(stepAfter('ai', setup.answers, setup.reach)).toBe('welcome')
  })
  test('are skipped when the apps cannot be looked through', async () => {
    setup.mcpFound = true
    scanned = () => Promise.reject(new Error('no config'))
    await setup.look()
    await vi.waitFor(() => expect(setup.reach.mcpFound).toBe(false))
  })
})
describe('the MCP step', () => {
  async function shown() {
    scanned = () => Promise.resolve(found(server()))
    setup.begin(true)
    await setup.look()
    await vi.waitFor(() => expect(setup.reach.mcpFound).toBe(true))
    for (let left = 20; setup.step !== 'mcp' && left > 0; left--) setup.next(setup.step)
    expect(setup.step).toBe('mcp')
    const target = document.createElement('div')
    document.body.append(target)
    const made = mount(McpStep, { target, intro: false })
    close = () => void unmount(made)
    flushSync()
    const button = (label: string) =>
      [...target.querySelectorAll('button')].find((one) => one.textContent.trim().startsWith(label))
    await vi.waitFor(() => expect(button('Import 1')).toBeDefined())
    return { target, button }
  }
  test('says what the servers are for and moves on when skipped', async () => {
    const { target, button } = await shown()
    expect(target.querySelector('h1')?.textContent).toBe('Bring your MCP servers')
    expect(button('Continue')?.disabled).toBe(true)
    button('Skip')?.click()
    flushSync()
    expect(setup.step).toBe('welcome')
  })
  test('lets the setup go on once servers were brought', async () => {
    const { button } = await shown()
    button('Import 1')?.click()
    flushSync()
    expect(button('Skip')).toBeUndefined()
    expect(button('Continue')?.disabled).toBe(false)
    button('Continue')?.click()
    flushSync()
    expect(setup.step).toBe('welcome')
  })
})
test('the setup finds no MCP servers while no module lends them', async () => {
  unprovide()
  setup.mcpFound = true
  await setup.look()
  await vi.waitFor(() => expect(setup.reach.mcpFound).toBe(false))
})
