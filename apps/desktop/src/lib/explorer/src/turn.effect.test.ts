import { mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { settle } from '../../../../test/effects/settle'

const gate = { on: false }
vi.mock('../../gates/src/api', async (actual) => ({
  ...(await actual<typeof import('../../gates/src/api')>()),
  explorerOn: () => gate.on,
}))
const { workspace } = await import('../../workspace/src/api')
const ExplorerBar = (await import('./ExplorerBar.svelte')).default
const { viewOf } = await import('./view.svelte')
let close: (() => void) | undefined
afterEach(() => {
  close?.()
  close = undefined
  document.body.replaceChildren()
})
async function bar(on: boolean): Promise<HTMLElement> {
  gate.on = on
  const target = document.createElement('div')
  document.body.append(target)
  const tab = workspace.openUnsaved('explorer', '{"folder":"/home/me"}', 'me')
  const made = mount(ExplorerBar, { target, props: { view: viewOf(tab), onleave: () => undefined } })
  close = () => void unmount(made)
  await settle()
  return target
}
test('the turn to a terminal sits in the bar only while the Orden file explorer is turned on', async () => {
  expect((await bar(false)).querySelector('[title^="Terminal here"]')).toBeNull()
  close?.()
  expect((await bar(true)).querySelector('[title^="Terminal here"]')).not.toBeNull()
})
