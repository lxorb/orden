import { flushSync } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

const shown = vi.hoisted(() => ({
  notices: [] as { title: string; body: string; tag?: string; opened?: () => void }[],
  taken: [] as string[],
  revealed: [] as string[],
}))

vi.mock('../../../notify', () => ({
  notify: (title: string, body: string, tag?: string, opened?: () => void) => {
    shown.notices.push({ title, body, ...(tag ? { tag } : {}), ...(opened ? { opened } : {}) })
  },
  unshow: (tag: string) => shown.taken.push(tag),
}))

vi.mock('../../../focus', () => ({
  revealPanel: (panel: string) => shown.revealed.push(panel),
}))

const { agentOpen } = await import('../../../ai/sidebar/agent-open.svelte')
const { FakeCrate } = await import('./fake')
const { ended, start } = await import('./live.svelte')

afterEach(() => {
  ended()
  shown.notices = []
  shown.taken = []
  shown.revealed = []
  agentOpen.id = null
})

describe("an agent's question", () => {
  test('is a notification, once, with the agent and what it asks', async () => {
    const fake = new FakeCrate()
    fake.listen(start(fake))
    fake.connect('claude-code', 'Claude Code')
    await Promise.resolve()

    const asked = fake.ask('claude-code', 'paying', 'Place order on shop.example')
    flushSync()
    flushSync()

    expect(shown.notices.map(({ title, body, tag }) => ({ title, body, tag }))).toEqual([
      {
        title: 'Claude Code',
        body: 'Place order on shop.example',
        tag: `agent-question-${asked.id}`,
      },
    ])
  })

  test('opens the agent session in the Ask panel when pressed', () => {
    const fake = new FakeCrate()
    fake.listen(start(fake))
    fake.connect('claude-code', 'Claude Code')
    fake.ask('claude-code', 'paying', 'Place order')
    flushSync()

    shown.notices[0]?.opened?.()
    expect(agentOpen.id).toBe('claude-code')
    expect(shown.revealed).toEqual(['ask'])
  })

  test('is taken back once it has been answered', async () => {
    const fake = new FakeCrate()
    fake.listen(start(fake))
    fake.connect('claude-code', 'Claude Code')
    const asked = fake.ask('claude-code', 'paying', 'Place order')
    flushSync()

    await fake.answer(asked.id, true, false)
    flushSync()
    expect(shown.taken).toEqual([`agent-question-${asked.id}`])
  })

  test('is no notification when it is a client asking to pair, which has a bubble', () => {
    const fake = new FakeCrate()
    fake.listen(start(fake))
    fake.pair('Codex')
    flushSync()
    expect(shown.notices).toEqual([])
  })
})
