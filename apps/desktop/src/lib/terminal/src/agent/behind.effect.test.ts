import { afterEach, expect, test, vi } from 'vitest'

const none = () => undefined
window.matchMedia = () =>
  ({
    matches: false,
    addListener: none,
    removeListener: none,
    addEventListener: none,
    removeEventListener: none,
  }) as unknown as MediaQueryList
globalThis.ResizeObserver = class {
  observe = none
  unobserve = none
  disconnect = none
}
Object.defineProperty(document, 'fonts', { value: { load: () => Promise.resolve([]) } })
vi.mock('../../../platform/src/tauri', async (original) => ({
  ...(await original<typeof import('../../../platform/src/tauri')>()),
  invoke: () => Promise.resolve(null),
}))
const { agentMarks, workspace } = await import('../../../workspace/src/api')
const { onViewSlip, verbsOf, done } = await import('../../../agent-verbs/src/api')
const { shells } = await import('../shells.svelte')
const { remote } = await import('../remote/hosts.svelte')
const { held } = await import('../remote/held.svelte')
const { hostShell } = await import('../spec')
const { terminalTabs, terminalVerbs } = await import('./verbs')

const CALLER = {
  agent: {
    id: 'helper',
    builtIn: false,
    name: 'Helper',
    scopes: ['terminal'],
    spaces: 'all' as const,
    mode: 'autonomous' as const,
    programs: [],
    sites: {},
  },
}
const LIST = [
  { id: 'bash', name: 'Bash' },
  { id: hostShell('box'), name: 'Box' },
] as unknown as Awaited<ReturnType<typeof shells.ask>>
vi.spyOn(shells, 'ask').mockResolvedValue(LIST)
vi.spyOn(shells, 'chosen', 'get').mockReturnValue(LIST[0])
vi.spyOn(remote, 'ready').mockResolvedValue()
vi.spyOn(remote, 'byId').mockReturnValue({ id: 'box', name: 'Box' } as unknown as ReturnType<typeof remote.byId>)
vi.spyOn(remote, 'connected').mockImplementation(none)
vi.spyOn(held, 'refresh').mockResolvedValue()

const opening = verbsOf({
  workspace_tabs: async (call) => done({ tab: await terminalTabs.open?.(call.args, call.caller) }),
})
let slips: string[] = []
const unhear = onViewSlip((verb) => slips.push(verb))
afterEach(() => {
  slips = []
})
function seen() {
  return {
    space: workspace.activeSpace?.id ?? null,
    pane: workspace.panes.focusedId,
    shown: workspace.panes.all.map((pane) => pane.activeTabId),
    active: workspace.activeTabId,
  }
}
function writing() {
  workspace.openUnsaved('note', '# Plan', 'Plan')
  const field = document.createElement('textarea')
  document.body.append(field)
  field.focus()
  return field
}
test.each([
  ['a shell of this machine', { shell: 'Bash' }],
  ['a shell of another machine', { shell: 'Box' }],
])(
  'an agent opening %s opens it behind, marked as its own, and moves nothing the reader sees (#2402)',
  async (_, args) => {
    const field = writing()
    const before = seen()
    const had = new Set(workspace.tabs.map((one) => one.id))
    await opening.workspace_tabs?.('workspace_tabs', args, CALLER)
    const tab = workspace.tabs.find((one) => !had.has(one.id))
    expect(tab?.kind).toBe('terminal')
    expect(agentMarks.opened[tab?.id ?? '']).toBe('Helper')
    expect(slips).toEqual([])
    expect(seen()).toEqual(before)
    expect(document.activeElement).toBe(field)
    field.remove()
  },
)
test('an agent reading a terminal session no tab holds opens its tab behind and moves nothing the reader sees (#2402)', async () => {
  vi.spyOn(held, 'list', 'get').mockReturnValue([
    {
      key: 'kept-1',
      shell: 'bash',
      name: 'Build',
      folder: null,
      host: null,
      program: null,
      last: 0,
      open: false,
      watched: false,
      ended: false,
    },
  ])
  const field = writing()
  const before = seen()
  await terminalVerbs.read_terminal?.('read_terminal', { tab: 'session:kept-1' }, CALLER)
  expect(workspace.tabs.some((one) => one.kind === 'terminal' && one.shown === 'Build')).toBe(true)
  expect(slips).toEqual([])
  expect(seen()).toEqual(before)
  expect(document.activeElement).toBe(field)
  field.remove()
  unhear()
})
