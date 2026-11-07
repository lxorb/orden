import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const opened = vi.hoisted(() => ({ pages: [] as string[] }))

vi.mock('../../web-tab/pages.svelte', () => ({
  pages: { adopt: (_id: string, handing: () => Promise<void>) => handing() },
}))

const { workspace } = await import('../../workspace.svelte')
vi.spyOn(workspace, 'openPage').mockImplementation((url: string) => {
  opened.pages.push(url)
  return `reader-${String(opened.pages.length)}`
})
const { FakeCrate } = await import('./fake')
const { ended, start, started } = await import('./live.svelte')
const AgentSession = (await import('./AgentSession.svelte')).default

afterEach(() => {
  ended()
  opened.pages = []
  document.body.innerHTML = ''
})

async function settle() {
  for (let round = 0; round < 4; round += 1) {
    await Promise.resolve()
    await tick()
  }
  flushSync()
}

async function drawn(holding = true) {
  const fake = new FakeCrate()
  fake.holding = holding
  fake.listen(start(fake))
  fake.connect('claude-code', 'Claude Code')
  const tab = fake.open('claude-code', 'https://shop.example/cart', 'Cart')
  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(AgentSession, { target, props: { agent: 'claude-code' } })
  await settle()
  return { fake, tab, target, close: () => void unmount(shown) }
}

const row = (id: string) =>
  document.querySelector<HTMLButtonElement>(`button[data-agent-tab="${id}"]`)
const sheet = () => document.querySelector<HTMLElement>('[role="dialog"]')

test("an agent's tab opens large, with the page as the agent sees it", async () => {
  const { fake, tab, close } = await drawn()
  expect(row(tab.id)?.disabled).toBe(false)

  row(tab.id)?.click()
  await settle()

  expect(sheet()?.getAttribute('aria-label')).toBe('Cart')
  const picture = sheet()?.querySelector('img')
  expect(picture?.getAttribute('src')).toBe(`data:image/png;base64,${btoa(`${tab.url}#1`)}`)
  expect(fake.asked.filter((one) => one.command === 'peek')).toHaveLength(1)

  fake.act('claude-code', tab.id, 'browser_click')
  await settle()
  expect(sheet()?.querySelector('img')?.getAttribute('src')).toBe(
    `data:image/png;base64,${btoa(`${tab.url}#2`)}`,
  )
  close()
})

test("an agent's tab opens on a window that does not hold the agents' pages", async () => {
  const { tab, close } = await drawn(false)
  expect(row(tab.id)?.disabled).toBe(false)
  row(tab.id)?.click()
  await settle()
  expect(sheet()).not.toBeNull()
  close()
})

test('taking the tab over makes it a reader tab and closes the view', async () => {
  const { fake, tab, close } = await drawn()
  row(tab.id)?.click()
  await settle()

  const take = [...(sheet()?.querySelectorAll('button') ?? [])].find(
    (one) => one.textContent.trim() === 'Take over',
  )
  take?.click()
  await settle()

  expect(opened.pages).toEqual([tab.url])
  expect(fake.asked.some((one) => one.command === 'adopt')).toBe(true)
  expect(sheet()).toBeNull()
  close()
})

test('the view closes when the agent closes the tab', async () => {
  const { fake, tab, close } = await drawn()
  row(tab.id)?.click()
  await settle()
  expect(sheet()).not.toBeNull()

  fake.emit({ kind: 'closed', agent: 'claude-code', id: tab.id })
  await settle()
  expect(sheet()).toBeNull()
  close()
})

test("the day's log is read on from where the last read stopped, not whole each time", async () => {
  const { fake, tab, close } = await drawn()
  const activity = started(fake)
  fake.act('claude-code', tab.id, 'browser_click')
  await activity.readLog()
  fake.act('claude-code', tab.id, 'browser_type')
  fake.act('claude-code', tab.id, 'browser_snapshot')
  await activity.readLog()

  const from = fake.asked.filter((one) => one.command === 'log').map((one) => one.args[1])
  expect(from.at(-1)).toBe(fake.lines.length - 2)
  expect(activity.lines).toEqual(fake.lines)
  close()
})

test('an agent that never pauses still has its calls read in, about once a second', async () => {
  vi.useFakeTimers()
  try {
    const { fake, tab, close } = await drawn()
    const reads = () => fake.asked.filter((one) => one.command === 'log').length
    const before = reads()
    for (let at = 0; at < 12; at++) {
      fake.act('claude-code', tab.id, 'browser_click')
      flushSync()
      await vi.advanceTimersByTimeAsync(400)
    }
    expect(reads() - before).toBeGreaterThanOrEqual(4)
    close()
  } finally {
    vi.useRealTimers()
  }
})
