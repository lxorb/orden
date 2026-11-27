import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const panel = vi.hoisted(() => ({
  text: '',
  chips: [] as unknown[],
  popover: null as string | null,
  host: 'side',
  head: { id: 'c1', mode: 'approve', model: 'anthropic/claude', effort: 'auto', kept: true, usage: {} },
  turns: [] as unknown[],
  heads: [] as unknown[],
  busy: false,
  canSteer: false,
  changing: true,
  thread: null,
  provider: { id: 'p', kind: 'compatible', model: 'm', name: 'Fake' },
  model: null,
  models: {
    p: [
      { id: 'anthropic/claude', name: 'Claude', window: 200000, efforts: ['auto'], images: false, fast: false },
      { id: 'anthropic/haiku', name: 'Haiku', window: 200000, efforts: ['auto'], images: false, fast: false },
      { id: 'openai/gpt', name: 'GPT', window: 128000, efforts: ['auto'], images: false, fast: false },
    ],
  },
  root: null,
  queue: [] as unknown[],
  focusAsked: 0,
  trouble: null,
  taken: vi.fn(),
  submit: vi.fn(),
  steer: vi.fn(),
  focus: vi.fn(),
  nextMode: vi.fn(),
  setMode: vi.fn((mode: string) => (panel.head.mode = mode)),
  loadModels: vi.fn(() => Promise.resolve()),
  chooseModel: vi.fn(() => Promise.resolve(true)),
}))
vi.mock('../../ai-chat/src/store/chat.svelte', () => ({ chat: panel }))
vi.mock('../../gates/src/api', async (actual) => ({
  ...(await actual<typeof import('../../gates/src/api')>()),
  opencodeOn: () => true,
}))
vi.mock('../../opencode-client/src/api', async (actual) => ({
  ...(await actual<typeof import('../../opencode-client/src/api')>()),
  opencode: {
    agents: () =>
      Promise.resolve([
        { name: 'build', mode: 'primary', description: 'Builds' },
        { name: 'plan', mode: 'primary', description: 'Plans' },
        { name: 'explore', mode: 'subagent' },
        { name: 'notes', mode: 'primary', description: 'Tidies notes' },
        { name: 'title', mode: 'primary', hidden: true },
      ]),
    providers: () =>
      Promise.resolve({
        all: [
          { id: 'anthropic', name: 'Anthropic', models: {} },
          { id: 'openai', name: 'OpenAI', models: {} },
        ],
        connected: ['anthropic', 'openai'],
        default: {},
      }),
  },
}))
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation
const { menu } = await import('../../ui-kit/src/api')
const { openCodeAgents } = await import('../../ai-chat/src/opencode/agents.svelte')
const Composer = (await import('./Composer.svelte')).default
const ModelPicker = (await import('./ModelPicker.svelte')).default
let target: HTMLElement
let close: (() => void) | undefined
let menus: string[][] = []
beforeEach(() => {
  menus = []
  panel.head.mode = 'approve'
  panel.popover = null
  vi.spyOn(menu, 'show').mockImplementation((_event, items) => {
    menus.push(items.flatMap((one) => (one ? [one.label] : [])))
    const chosen = items.find((one) => one?.label === 'Notes')
    chosen?.run()
    return 0
  })
  target = document.createElement('div')
  document.body.append(target)
})
afterEach(() => {
  close?.()
  close = undefined
  target.remove()
  vi.restoreAllMocks()
})
function drawn(component: typeof Composer) {
  const shown = mount(component, { target })
  close = () => void unmount(shown)
  flushSync()
}
describe('the composer with the OpenCode engine (#2470)', () => {
  test('offers the three permission presets, and no Plan among them', () => {
    drawn(Composer)
    target.querySelector<HTMLButtonElement>('.controls .mode:not(.agent)')?.click()
    expect(menus[0]).toEqual(['Approve', 'Auto', 'Full permissions'])
  })
  test('chooses the chat’s agent from OpenCode’s, leaving out helpers and hidden ones', async () => {
    drawn(Composer)
    const chip = () => target.querySelector<HTMLButtonElement>('.controls .agent')
    expect(chip()?.textContent.trim()).toBe('Build')
    chip()?.click()
    await vi.waitFor(() => expect(menus).toHaveLength(1))
    expect(menus[0]).toEqual(['Build', 'Plan', 'Notes'])
    flushSync()
    expect(openCodeAgents.of('c1')).toBe('notes')
    expect(chip()?.textContent.trim()).toBe('Notes')
  })
  test('steps between Approve and Auto with the mode key, never into Plan or Full permissions', () => {
    drawn(Composer)
    const field = target.querySelector('textarea')
    field?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    expect(panel.setMode).toHaveBeenLastCalledWith('auto')
    expect(panel.nextMode).not.toHaveBeenCalled()
  })
  test('picks a model under each OpenCode provider', async () => {
    panel.popover = 'model'
    drawn(ModelPicker)
    await vi.waitFor(() => {
      flushSync()
      expect([...target.querySelectorAll('.provider')].map((one) => one.textContent.trim())).toEqual([
        'Anthropic',
        'OpenAI',
      ])
    })
    const models = () => [...target.querySelectorAll('.model .orden-row-label')].map((one) => one.textContent.trim())
    expect(models()).toEqual(['Claude', 'Haiku'])
    target.querySelectorAll<HTMLButtonElement>('.provider')[1]?.click()
    flushSync()
    expect(models()).toEqual(['GPT'])
  })
})
