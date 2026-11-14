import { beforeEach, describe, expect, test, vi } from 'vitest'

const sent = vi.hoisted(() => [] as { command: string; args: Record<string, unknown> }[])
const answers = vi.hoisted(() => [] as (string | null)[])
const asked = vi.hoisted(() => ({ count: 0 }))

vi.mock('../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/src/tauri')>()),
  isDesktop: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    sent.push({ command, args: args ?? {} })
    return Promise.resolve(undefined)
  },
}))

vi.mock('../prompt.svelte', () => ({
  prompt: {
    choose: () => {
      asked.count += 1
      return Promise.resolve(answers.shift() ?? null)
    },
  },
}))

const { memoryStorage } = await import('../../../test/disk')
vi.stubGlobal('localStorage', memoryStorage())

const { hiddenTabs } = await import('./hidden-tabs.svelte')
const { pages } = await import('../web-tab/pages.svelte')
const { agentMarks } = await import('../agent-marks.svelte')
await import('../web-tab/sleeping')
type Tab = import('../workspace.svelte').Tab

function webTab(id: string, live = true): Tab {
  pages.of(id).live = live
  return { id, kind: 'web', paneId: 'aside' } as Tab
}

const sending = () => new Promise<void>((go) => setTimeout(go, 0))

async function paused() {
  await sending()
  return sent
    .filter((one) => one.command === 'web_pause')
    .map((one) => [one.args.tab, one.args.paused])
}

beforeEach(async () => {
  hiddenTabs.set('run')
  await sending()
  sent.length = 0
  answers.length = 0
  asked.count = 0
  localStorage.clear()
  hiddenTabs.choice = 'ask'
  agentMarks.on = {}
})

describe('until somebody has answered', () => {
  test('the first switch away from a running page asks, and Pause pauses it', async () => {
    answers.push('pause')
    await hiddenTabs.left([webTab('a')])

    expect(asked.count).toBe(1)
    expect(hiddenTabs.choice).toBe('pause')
    expect(await paused()).toEqual([['a', true]])
    expect(localStorage.getItem('orden:hidden-tabs')).toBe('"pause"')
  })

  test('a question dismissed lets the pages run, and the next switch asks again', async () => {
    answers.push(null)
    await hiddenTabs.left([webTab('a')])
    expect(hiddenTabs.choice).toBe('ask')
    expect(await paused()).toEqual([])

    answers.push(null)
    await hiddenTabs.left([webTab('a')])
    expect(asked.count).toBe(2)
  })

  test('Keep running is kept, and nothing is asked again', async () => {
    answers.push('run')
    await hiddenTabs.left([webTab('a')])
    await hiddenTabs.left([webTab('b')])

    expect(asked.count).toBe(1)
    expect(hiddenTabs.choice).toBe('run')
    expect(await paused()).toEqual([])
  })

  test('a set with no page running asks nothing', async () => {
    await hiddenTabs.left([webTab('a', false), { id: 'n', kind: 'note', paneId: 'aside' } as Tab])
    expect(asked.count).toBe(0)
  })
})

describe('pausing', () => {
  test('the set coming back lets run what was paused in it, and nothing else', async () => {
    hiddenTabs.set('pause')
    await hiddenTabs.left([webTab('a'), webTab('b')])
    await sending()
    sent.length = 0

    hiddenTabs.came([webTab('a'), webTab('c')])
    expect(await paused()).toEqual([['a', false]])
  })

  test('a tab an agent is acting in is left running', async () => {
    hiddenTabs.set('pause')
    agentMarks.on = { a: { agent: 'claude', colour: '#000', stopped: false } }
    await hiddenTabs.left([webTab('a'), webTab('b')])
    expect(await paused()).toEqual([['b', true]])
  })

  test('choosing Keep running lets every paused page run again', async () => {
    hiddenTabs.set('pause')
    await hiddenTabs.left([webTab('a')])
    await sending()
    sent.length = 0

    hiddenTabs.set('run')
    expect(await paused()).toEqual([['a', false]])
  })
})
