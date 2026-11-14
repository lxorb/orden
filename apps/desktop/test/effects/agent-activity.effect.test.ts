import { flushSync, mount, unmount } from 'svelte'
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { agentMarks } from '../../src/lib/agent-marks.svelte'
import AgentSession from '../../src/lib/agents/src/ui/AgentSession.svelte'
import { FakeCrate } from '../../src/lib/agents/src/ui/fake'
import { ended, start, started } from '../../src/lib/agents/src/ui/index'

Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
    set onfinish(then: (() => void) | null) {
      queueMicrotask(() => then?.())
    },
  }) as unknown as Animation

let fake: FakeCrate

async function settled(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve()
  flushSync()
}

beforeEach(async () => {
  fake = new FakeCrate()
  const hear = start(fake)
  fake.listen(hear)
  await settled()
})

afterAll(async () => {
  await import('../../src/lib/agent-host/editor')
})

afterEach(() => {
  ended()
  document.body.replaceChildren()
})

describe('the frame and the mark', () => {
  test('are worn by a reader tab while an agent acts in it, in the agent colour', async () => {
    fake.connect('claude', 'Claude Code')
    fake.act('claude', 't1', 'browser_click')
    await settled()

    const worn = agentMarks.on.t1
    expect(worn?.agent).toBe('claude')
    expect(worn?.stopped).toBe(false)
    expect(worn?.colour).toMatch(/^#/)
    expect(agentMarks.heard).toBe(true)
  })

  test('stay on whatever the reader does in the tab: nothing hands it over', async () => {
    fake.connect('claude', 'Claude Code')
    fake.act('claude', 't1', 'browser_click')
    await settled()

    fake.act('claude', 't1', 'browser_type')
    await settled()
    expect(agentMarks.on.t1?.stopped).toBe(false)
    expect(fake.asked.some((one) => one.command === 'pause')).toBe(false)
  })

  test('Stop in the tab menu stops that agent, and a press on its mark resumes it', async () => {
    fake.connect('claude', 'Claude Code')
    fake.connect('codex', 'Codex')
    fake.act('claude', 't1', 'browser_click')
    fake.act('codex', 't2', 'browser_type')
    await settled()

    agentMarks.act?.('t1', 'stop')
    await settled()
    expect(fake.asked.at(-1)).toEqual({ command: 'stop', args: ['claude'] })
    expect(agentMarks.on.t1?.stopped).toBe(true)
    expect(agentMarks.on.t2?.stopped).toBe(false)

    agentMarks.act?.('t1', 'resume')
    await settled()
    expect(fake.asked.at(-1)).toEqual({ command: 'resume', args: ['claude'] })
    expect(agentMarks.on.t1?.stopped).toBe(false)
  })

  test('the stop mutes them all, and lifting it lets them act again', async () => {
    fake.connect('claude', 'Claude Code')
    fake.act('claude', 't1', 'browser_click')
    await settled()

    await started().stop()
    await settled()
    expect(agentMarks.on.t1?.stopped).toBe(true)

    agentMarks.act?.('t1', 'resume')
    await settled()
    expect(fake.asked.at(-1)).toEqual({ command: 'resume', args: [undefined] })
    expect(agentMarks.on.t1?.stopped).toBe(false)
  })
})

describe('the shell while an agent is connected', () => {
  test('hands the stop key to the system and holds the window', async () => {
    expect(agentMarks.holding).toBe(false)

    fake.connect('claude', 'Claude Code')
    await settled()

    expect(fake.told?.key).toBe('Control+Alt+Shift+K')
    expect(fake.told?.words.stop).toBe('Stop agents')
    expect(agentMarks.holding).toBe(true)

    await agentMarks.hide?.()
    await settled()
    expect(fake.hidden).toBe(true)
  })
})

describe("an agent's session", () => {
  let panel: ReturnType<typeof mount> | null = null

  afterEach(() => {
    if (panel) void unmount(panel, { outro: false })
    panel = null
  })

  function open(): HTMLElement {
    const target = document.createElement('div')
    document.body.append(target)
    panel = mount(AgentSession, { target, props: { agent: 'claude' } })
    return target
  }

  test('shows the agent, what it is doing, and its own tabs by name', async () => {
    fake.connect('claude', 'Claude Code')
    const tab = fake.open('claude', 'https://shop.example/', 'Shop')
    fake.act('claude', tab.id, 'browser_click')
    const target = open()
    await settled()

    expect(target.querySelector('.name')?.textContent).toBe('Claude Code')
    expect([...target.querySelectorAll('.doing .fact')].map((one) => one.textContent)).toEqual([
      'Pressing',
      'Shop',
    ])
    const pages = [...target.querySelectorAll('.tabs .orden-row-label')].map(
      (one) => one.textContent,
    )
    expect(pages).toEqual(['Shop'])
    expect(target.querySelector('img, .picture')).toBeNull()
  })

  test('asks a question and sends the answer, and the question goes', async () => {
    fake.connect('claude', 'Claude Code')
    const asked = fake.ask('claude', 'paying', 'Place order on shop.example', 'shop.example', 't1')
    const target = open()
    await settled()

    expect(agentMarks.waiting).toBe(1)
    const question = target.querySelector('.question')
    expect(question?.textContent).toContain('Place order on shop.example')
    const answers = [...(question?.querySelectorAll('button') ?? [])].map((one) =>
      one.textContent.trim(),
    )
    expect(answers).toEqual(['Don’t allow', 'Allow', 'Always on this site'])

    question?.querySelector<HTMLButtonElement>('.always')?.click()
    await settled()

    expect(fake.asked.find((one) => one.command === 'answer')).toEqual({
      command: 'answer',
      args: [asked.id, true, true],
    })
    expect(target.querySelector('.question')).toBeNull()
    expect(agentMarks.waiting).toBe(0)
  })

  test('shows the session from the audit log, and Stop stops that agent', async () => {
    fake.connect('claude', 'Claude Code')
    fake.act('claude', 't1', 'browser_open', { url: 'https://shop.example/' })
    fake.act('claude', 't1', 'browser_click')
    const target = open()
    await settled()
    await started().readLog()
    await settled()

    const rows = [...target.querySelectorAll('.call .word')].map((one) => one.textContent)
    expect(rows).toEqual(['Pressing', 'Opening'])

    target.querySelector<HTMLButtonElement>('.head .orden-glyph')?.click()
    await settled()
    expect(fake.asked.at(-1)).toEqual({ command: 'stop', args: ['claude'] })
    expect(target.querySelector('.head .orden-glyph')?.getAttribute('aria-label')).toBe('Continue')
  })
})

describe('Full permissions', () => {
  test('an agent that asks nothing has its tab shown without a question, behind the reader', async () => {
    const { workspace } = await import('../../src/lib/workspace.svelte')
    workspace.openBlank('Reading', '# Reading')
    const reading = workspace.activeTabId
    fake.connect('claude', 'Claude Code')
    const tab = fake.open('claude', 'https://shop.example/', 'Shop')
    await settled()
    fake.granted('claude', 'showing', 'Show Shop', tab.id)
    await settled()

    expect(agentMarks.waiting).toBe(0)
    await vi.waitFor(() =>
      expect(fake.asked.find((one) => one.command === 'adopt')?.args[0]).toBe(tab.id),
    )
    expect(fake.asked.some((one) => one.command === 'answer')).toBe(false)
    expect(workspace.activeTabId).toBe(reading)
    expect(workspace.tabs.some((one) => one.kind === 'web' && one.id !== reading)).toBe(true)
  })
})

describe('questions outside the session', () => {
  test('a pairing is asked in a bubble of its own, and allowing it answers', async () => {
    const asked = fake.pair('Codex')
    await settled()

    const bubble = document.body.querySelector('.pairing')
    expect(bubble?.textContent).toContain('Codex wants to connect')
    expect(agentMarks.waiting).toBe(0)

    ;[...(bubble?.querySelectorAll('button') ?? [])].at(-1)?.click()
    await settled()

    expect(fake.asked.find((one) => one.command === 'answer')?.args).toEqual([
      asked.id,
      true,
      false,
    ])
    await settled()
    expect(document.body.querySelector('.pairing')).toBeNull()
  })

  test('a step asked of the reader is put under the bar of its tab, and takes nothing', async () => {
    fake.connect('claude', 'Claude Code')
    fake.act('claude', 't1', 'browser_click')
    const asked = fake.ask(
      'claude',
      'takeover',
      'Sign in to the bank',
      'https://bank.example/',
      't1',
    )
    await settled()

    expect(agentMarks.takeovers.t1).toEqual({ id: asked.id, reason: 'Sign in to the bank' })
    expect(agentMarks.on.t1?.stopped).toBe(false)

    await started().answer(asked, true)
    await settled()
    expect(agentMarks.takeovers.t1).toBeUndefined()
    expect(agentMarks.on.t1?.stopped).toBe(false)
  })
})
