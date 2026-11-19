import { type Component, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { settle } from '../../../../test/effects/settle'
import type { Found, Server, ServerView } from './mcp'

const back = vi.hoisted(() => {
  const state = {
    calls: [] as { command: string; args: Record<string, unknown> }[],
    servers: [] as ServerView[],
    found: [] as Found[],
    missing: false,
    heard: null as ((event: { payload: unknown }) => void) | null,
    listened: '',
    answer(command: string, args: Record<string, unknown>): unknown {
      const at = (id: unknown) => state.servers.find((one) => one.id === id)
      const swap = (view: ServerView) => {
        state.servers = state.servers.some((one) => one.id === view.id)
          ? state.servers.map((one) => (one.id === view.id ? view : one))
          : [...state.servers, view]
        return structuredClone(view)
      }
      switch (command) {
        case 'mcp_servers':
          return structuredClone(state.servers)
        case 'mcp_server_save': {
          const server = args.server as Server
          const secrets = args.secrets as { env: Record<string, string>; headers: Record<string, string> } | undefined
          const old = at(server.id)
          const names = server.transport.kind === 'stdio' ? server.transport.env : server.transport.headers
          const set = new Set([
            ...(old?.secretsSet ?? []),
            ...Object.keys(secrets?.env ?? {}),
            ...Object.keys(secrets?.headers ?? {}),
          ])
          return swap({
            ...server,
            id: server.id || 'made',
            state: 'starting',
            error: null,
            listed: old?.listed ?? [],
            secretsSet: names.filter((one) => set.has(one)),
          })
        }
        case 'mcp_server_switch': {
          const view = at(args.id)
          return view && swap({ ...view, on: args.on as boolean, state: args.on ? 'starting' : 'off' })
        }
        case 'mcp_tool_permission': {
          const view = at(args.id)
          if (!view) return null
          const permission = args.permission as ServerView['listed'][number]['permission']
          return swap({
            ...view,
            tools: { ...view.tools, [args.tool as string]: permission },
            listed: view.listed.map((one) => (one.name === args.tool ? { ...one, permission } : one)),
          })
        }
        case 'mcp_server_restart': {
          const view = at(args.id)
          return view && swap({ ...view, state: 'ready', error: null })
        }
        case 'mcp_server_remove':
          state.servers = state.servers.filter((one) => one.id !== args.id)
          return null
        case 'mcp_import_scan':
          return structuredClone(state.found)
        case 'mcp_import':
          return (args.picks as { name: string }[]).map((one) => ({
            id: one.name,
            name: one.name,
            on: true,
            transport: { kind: 'stdio', command: 'node', args: [], env: [] },
            tools: {},
            state: 'starting',
            listed: [],
            secretsSet: [],
          }))
      }
      return null
    },
  }
  return state
})
vi.mock('../../platform/src/tauri', async (original) => ({
  ...(await original<typeof import('../../platform/src/tauri')>()),
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    back.calls.push({ command, args: structuredClone(args) })
    if (back.missing) return Promise.reject(new Error(`Command ${command} not found`))
    return Promise.resolve(back.answer(command, args))
  },
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => {
    back.listened = name
    back.heard = handler
    return Promise.resolve(() => {
      back.heard = null
    })
  },
}))
const { prompt } = await import('../../ui-kit/src/api')
const { scanMcp } = await import('./mcp')
const McpServers = (await import('./McpServers.svelte')).default
const McpImport = (await import('./McpImport.svelte')).default

const FILES: ServerView = {
  id: 'files',
  name: 'Files',
  on: true,
  transport: { kind: 'stdio', command: 'npx', args: ['-y', 'files'], cwd: null, env: ['TOKEN'] },
  tools: { shout: 'off' },
  state: 'ready',
  error: null,
  listed: [
    { name: 'echo', description: 'Says it back', inputSchema: {}, readOnly: true, permission: 'allow' },
    { name: 'shout', description: 'Says it loud', inputSchema: {}, readOnly: false, permission: 'off' },
  ],
  secretsSet: ['TOKEN'],
}
let target: HTMLElement
let close: (() => void) | undefined
async function shown<Props extends Record<string, unknown>>(component: Component<Props>, props: Props) {
  const made = mount(component, { target, props })
  close = () => void unmount(made)
  await settle()
}
function button(text: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('button, [role="tab"]')].find(
    (one) => one.textContent.trim() === text,
  )
  if (!found) throw new Error(`no button ${text}`)
  return found
}
async function press(text: string) {
  button(text).click()
  await settle()
}
async function openServer(name: string) {
  target.querySelector<HTMLElement>(`[role="button"][aria-label="${name}"]`)?.click()
  await settle()
}
async function type(label: string, value: string, at = 0) {
  const field = [...target.querySelectorAll<HTMLInputElement>(`input[aria-label="${label}"]`)][at]
  if (!field) throw new Error(`no field ${label}`)
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await settle()
}
const asked = (command: string) => back.calls.filter((one) => one.command === command).map((one) => one.args)
beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  back.calls = []
  back.servers = [structuredClone(FILES)]
  back.found = []
  back.missing = false
})
afterEach(async () => {
  close?.()
  close = undefined
  if (prompt.open) prompt.dismiss()
  await settle()
  document.body.replaceChildren()
})
describe('the MCP servers settings', () => {
  test('list each server with its state and say first that these are outside tools for Orden’s AI', async () => {
    await shown(McpServers, {})
    expect(target.querySelector('.hint')?.textContent).toMatch(/^\s*Tools from outside MCP servers that Orden's AI/)
    expect(target.textContent).toContain('Files')
    expect(target.textContent).toContain('Connected, 2 tools')
    expect(back.listened).toBe('orden://mcp')
  })
  test('show the error, and do not break, while the backend has no such command', async () => {
    back.missing = true
    await shown(McpServers, {})
    expect(target.textContent).toContain('Command mcp_servers not found')
    expect(target.textContent).toContain('Add server')
  })
  test('add a server run by a command, with an env value that never shows again', async () => {
    back.servers = []
    await shown(McpServers, {})
    await press('Add server')
    await type('Name', 'Files')
    await type('Command', 'npx')
    await type('Arguments', '-y "a b"')
    await type('Working folder', '/tmp/work')
    await press('Add variable')
    await type('Variable name', 'TOKEN')
    await type('Value', 's3cret')
    await press('Add')
    expect(asked('mcp_server_save')).toEqual([
      {
        server: {
          id: '',
          name: 'Files',
          on: true,
          transport: { kind: 'stdio', command: 'npx', args: ['-y', 'a b'], cwd: '/tmp/work', env: ['TOKEN'] },
          tools: {},
          from: null,
        },
        secrets: { env: { TOKEN: 's3cret' }, headers: {} },
      },
    ])
    expect(target.textContent).toContain('Starting')
    await press('Edit')
    expect(target.textContent).toContain('Saved')
    expect(target.innerHTML).not.toContain('s3cret')
  })
  test('add a server at a URL with a header, and refuse an address that is no URL', async () => {
    back.servers = []
    await shown(McpServers, {})
    await press('Add server')
    await press('At a URL')
    await type('Name', 'Remote')
    await type('URL', 'example.com')
    await press('Add')
    expect(asked('mcp_server_save')).toEqual([])
    expect(target.textContent).toContain('Type a URL that starts with http:// or https://')
    await type('URL', 'https://example.com/mcp')
    await press('Add header')
    await type('Header name', 'Authorization')
    await type('Value', 'Bearer t')
    await press('Add')
    expect(asked('mcp_server_save')).toEqual([
      {
        server: {
          id: '',
          name: 'Remote',
          on: true,
          transport: { kind: 'http', url: 'https://example.com/mcp', headers: ['Authorization'] },
          tools: {},
          from: null,
        },
        secrets: { env: {}, headers: { Authorization: 'Bearer t' } },
      },
    ])
  })
  test('send no secrets on an edit that leaves the saved values alone, and keep the tool permissions', async () => {
    await shown(McpServers, {})
    await openServer('Files')
    await press('Edit')
    expect(target.querySelector('input[aria-label="Value"]')).toBeNull()
    await type('Name', 'My files')
    await press('Save')
    const [first] = asked('mcp_server_save')
    expect(first).not.toHaveProperty('secrets')
    expect(first?.server).toMatchObject({ id: 'files', name: 'My files', tools: { shout: 'off' } })
    await press('Edit')
    await press('Replace')
    await type('Value', 'fresh')
    await press('Save')
    expect(asked('mcp_server_save')[1]?.secrets).toEqual({ env: { TOKEN: 'fresh' }, headers: {} })
  })
  test('switch a server off and on from the list', async () => {
    await shown(McpServers, {})
    target.querySelector<HTMLElement>('[role="switch"][aria-label="Use Files"]')?.click()
    await settle()
    expect(asked('mcp_server_switch')).toEqual([{ id: 'files', on: false }])
    expect(target.textContent).toContain('Off')
    target.querySelector<HTMLElement>('[role="switch"][aria-label="Use Files"]')?.click()
    await settle()
    expect(asked('mcp_server_switch')[1]).toEqual({ id: 'files', on: true })
  })
  test('give each tool its own permission', async () => {
    await shown(McpServers, {})
    await openServer('Files')
    expect(target.textContent).toContain('Says it back')
    target.querySelector<HTMLElement>('[aria-label="Permission for echo"]')?.click()
    await settle()
    const ask = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (one) => one.textContent.trim() === 'Ask',
    )
    ask?.click()
    await settle()
    expect(asked('mcp_tool_permission')).toEqual([{ id: 'files', tool: 'echo', permission: 'ask' }])
    expect(target.querySelector('[aria-label="Permission for echo"]')?.textContent.trim()).toBe('Ask')
  })
  test('remove a server only once the reader confirms', async () => {
    await shown(McpServers, {})
    await openServer('Files')
    await press('Remove')
    expect(prompt.open).toBe(true)
    expect(prompt.title).toBe('Remove Files?')
    prompt.dismiss()
    await settle()
    expect(asked('mcp_server_remove')).toEqual([])
    await press('Remove')
    prompt.submit()
    await settle()
    expect(asked('mcp_server_remove')).toEqual([{ id: 'files' }])
    expect(target.textContent).not.toContain('Files')
    expect(target.textContent).toContain('Add server')
  })
  test('follow the state the backend reports', async () => {
    await shown(McpServers, {})
    await openServer('Files')
    back.servers = [{ ...FILES, state: 'failed', error: 'spawn npx ENOENT' }]
    back.heard?.({ payload: { id: 'files', state: 'failed' } })
    await settle()
    expect(target.textContent).toContain('Failed')
    expect(target.textContent).toContain('spawn npx ENOENT')
    await press('Restart')
    expect(asked('mcp_server_restart')).toEqual([{ id: 'files' }])
    expect(target.textContent).toContain('Connected')
  })
})
describe('the MCP import', () => {
  const FOUND: Found[] = [
    {
      source: 'claude-code',
      sourceName: 'Claude Code',
      path: '/home/a/.claude.json',
      servers: [
        {
          name: 'orden',
          transport: { kind: 'stdio', command: 'orden', args: ['mcp'], env: [] },
          already: false,
          orden: true,
          needsInput: [],
        },
        {
          name: 'files',
          transport: { kind: 'stdio', command: 'npx', args: ['files'], env: [] },
          already: true,
          orden: false,
          needsInput: [],
        },
        {
          name: 'github',
          transport: { kind: 'http', url: 'https://gh.example/mcp', headers: ['Authorization'] },
          already: false,
          orden: false,
          needsInput: ['Authorization'],
        },
        {
          name: 'shell',
          transport: { kind: 'stdio', command: 'node', args: ['shell.js'], env: [] },
          already: false,
          orden: false,
          needsInput: [],
        },
      ],
    },
    {
      source: 'cursor',
      sourceName: 'Cursor',
      path: '/home/a/.cursor/mcp.json',
      servers: [
        {
          name: 'orden',
          transport: { kind: 'stdio', command: 'Orden', args: ['mcp'], env: [] },
          already: false,
          orden: true,
          needsInput: [],
        },
      ],
    },
  ]
  test('skip Orden itself, grey what is already added, flag what needs input and import the ticked ones', async () => {
    const counts: number[] = []
    await shown(McpImport, { found: FOUND, onimported: (count: number) => counts.push(count) })
    expect(target.textContent).toContain('Claude Code')
    expect(target.textContent).not.toContain('Cursor')
    expect(target.textContent).not.toContain('orden')
    expect(target.querySelectorAll('input[type="checkbox"]')).toHaveLength(2)
    expect(target.querySelector('.already')?.textContent).toContain('Already added')
    expect(target.textContent).toContain('Fill in after import: Authorization')
    const shell = [...target.querySelectorAll<HTMLInputElement>('label')].find((one) =>
      one.textContent.includes('shell'),
    )
    const box = shell?.querySelector('input')
    if (!box) throw new Error('no box')
    box.checked = false
    box.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    await press('Import')
    expect(asked('mcp_import')).toEqual([{ picks: [{ source: 'claude-code', name: 'github' }] }])
    expect(counts).toEqual([1])
  })
  test('find nothing to import when every server found is Orden or already added', async () => {
    back.found = [FOUND[1]!, { ...FOUND[0]!, servers: FOUND[0]!.servers.slice(0, 2) }]
    expect(await scanMcp()).toEqual([])
    back.found = FOUND
    expect((await scanMcp()).map((one) => one.source)).toEqual(['claude-code'])
  })
  test('open from Settings and say so when other apps hold nothing new', async () => {
    await shown(McpServers, {})
    await press('Import from other apps')
    expect(document.body.textContent).toContain('No new servers in other apps.')
    expect(asked('mcp_import_scan')).toHaveLength(1)
  })
})
