/** The account's row in the sidebar's foot opens a menu, as a sidebar's owner does in
 *  every app that has one, rather than going straight to the settings (#308).
 *
 *  In the jsdom project because it mounts a component into a document. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test } from 'vitest'
import { account } from '../../src/lib/account.svelte'
import { menu, type MenuItem } from '../../src/lib/menu.svelte'
import { settings } from '../../src/lib/settings.svelte'
import SidebarFoot from '../../src/lib/SidebarFoot.svelte'

afterEach(() => {
  account.user = null
  menu.hide()
  settings.open = false
})

test('a press on the account opens its menu, and Settings in it opens the settings', () => {
  account.user = { id: 'me', email: 'me@example.com', name: 'Emil' }
  const target = document.createElement('div')
  document.body.append(target)
  const foot = mount(SidebarFoot, { target })
  flushSync()

  target.querySelector<HTMLElement>('[aria-label="Emil"]')?.click()
  expect(menu.open).toBe(true)
  expect(settings.open).toBe(false)
  expect(menu.up).toBe(true)

  const rows = menu.items.filter((one): one is MenuItem => one !== null)
  expect(rows.map((one) => one.label)).toEqual(['Account', 'Settings', 'Sign out'])

  rows.find((one) => one.label === 'Settings')?.run()
  expect(settings.open).toBe(true)

  void unmount(foot, { outro: false })
  target.remove()
})
