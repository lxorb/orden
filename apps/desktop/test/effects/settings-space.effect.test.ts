import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { providePort, registerSettingsPart } from '@orden/contracts'

vi.mock('../../src/lib/settings/src/SpacePane.svelte', async () => ({
  default: (await import('./Drawn.svelte')).default,
}))
const SettingsPanel = (await import('../../src/lib/settings/src/SettingsPanel.svelte')).default
const { settings } = await import('../../src/lib/settings/src/api')
const { workspace } = await import('../../src/lib/workspace/src/api')

providePort('settings.window', settings)
Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel: () => undefined }) as unknown as Animation
let shown: ReturnType<typeof mount> | undefined
const gone: (() => void)[] = []
afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
  for (const off of gone.splice(0)) off()
  document.body.replaceChildren()
})
function part(title: string, order: number) {
  gone.push(
    registerSettingsPart({
      section: 'space',
      title,
      card: true,
      order,
      shown: () => true,
      load: () =>
        Promise.resolve({
          show: (target) => {
            ;(target as HTMLElement).textContent = `${title} part`
            return () => undefined
          },
        }),
    }),
  )
}
async function open() {
  workspace.spaces = [{ id: 's', name: 'Plans', root: '/s/Plans' }] as typeof workspace.spaces
  settings.space = '/s/Plans'
  settings.section = 'space'
  settings.listing = false
  shown = mount(SettingsPanel, { target: document.body })
  flushSync()
  await vi.waitFor(() => {
    flushSync()
    expect(document.querySelector('.drawn')).not.toBeNull()
  })
  return document.querySelector<HTMLElement>('[role="region"][aria-label="Settings"] .pane')
}
test('the space section is headed by the space, shows its parts in their order, and the agent instructions after', async () => {
  part('Members', 1)
  part('General', 0)
  const pane = await open()
  await vi.waitFor(() => {
    flushSync()
    expect(pane?.querySelectorAll('.part')).toHaveLength(2)
    expect([...(pane?.querySelectorAll('.part') ?? [])].map((one) => one.textContent)).toEqual([
      'General part',
      'Members part',
    ])
  })
  expect(pane?.querySelector('h2')?.textContent).toBe('Plans')
  expect([...(pane?.querySelectorAll('h3') ?? [])].map((one) => one.textContent)).toEqual(['General', 'Members'])
  const last = pane?.querySelectorAll('.part')[1]
  const drawn = pane?.querySelector('.drawn')
  expect(last && drawn && last.compareDocumentPosition(drawn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})
test('with no part registered, the space section still shows the agent instructions', async () => {
  const pane = await open()
  expect(pane?.querySelector('.drawn')).not.toBeNull()
  expect(pane?.querySelectorAll('.part')).toHaveLength(0)
})
