import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { account } from '../../src/lib/accounts/src/account.svelte'
import { menu, type MenuItem } from '../../src/lib/ui-kit/src/api'
import { providePort } from '@orden/contracts'
import { settings } from '../../src/lib/settings/src/api'
import SidebarFoot from '../../src/lib/sidebar/src/SidebarFoot.svelte'
import { workspace } from '../../src/lib/workspace/src/api'

providePort('settings.window', settings)
afterEach(() => {
  account.user = null
  menu.hide()
  settings.open = false
})
test('a press on the account opens its menu, and Settings in it opens the settings tab', async () => {
  workspace.restored = true
  account.user = { id: 'me', email: 'me@example.com', name: 'Emil' }
  const target = document.createElement('div')
  document.body.append(target)
  const foot = mount(SidebarFoot, { target })
  flushSync()
  target.querySelector<HTMLElement>('[aria-label="Emil"]')?.click()
  await vi.waitFor(() => expect(menu.open).toBe(true))
  expect(settings.open).toBe(false)
  expect(menu.up).toBe(true)
  const rows = menu.items.filter((one): one is MenuItem => one !== null)
  expect(rows.map((one) => one.label)).toEqual(['Account', 'Settings', 'Themes', 'Learn more', 'Sign out'])
  expect(rows.filter((one) => !one.icon).map((one) => one.label)).toEqual([])
  rows.find((one) => one.label === 'Settings')?.run()
  expect(settings.open).toBe(true)
  expect(workspace.active?.kind).toBe('settings')
  void unmount(foot, { outro: false })
  target.remove()
})
test('Learn more holds the source code, the keyboard shortcuts, the privacy choices and the licence, each with its icon, and no page that does not exist yet', async () => {
  workspace.restored = true
  account.user = { id: 'me', email: 'me@example.com', name: 'Emil' }
  const target = document.createElement('div')
  document.body.append(target)
  const foot = mount(SidebarFoot, { target })
  flushSync()
  target.querySelector<HTMLElement>('[aria-label="Emil"]')?.click()
  await vi.waitFor(() => expect(menu.open).toBe(true))
  const learn = menu.items.find((one): one is MenuItem => one?.label === 'Learn more')
  const more = (await learn?.more?.()) ?? []
  expect(more.map((one) => one?.label ?? null)).toEqual([
    'Source code',
    'Keyboard shortcuts',
    null,
    'Your privacy choices',
    'Licence',
  ])
  const items = more.filter((one): one is MenuItem => one !== null)
  expect(items.filter((one) => !one.icon).map((one) => one.label)).toEqual([])
  expect(items.filter((one) => one.more).map((one) => one.label)).toEqual([])
  more.find((one): one is MenuItem => one?.label === 'Keyboard shortcuts')?.run()
  expect(settings.open).toBe(true)
  learn?.run()
  expect(menu.title).toBe('Learn more')
  expect(menu.items.map((one) => one?.label ?? null)).toEqual(more.map((one) => one?.label ?? null))
  void unmount(foot, { outro: false })
  target.remove()
})
