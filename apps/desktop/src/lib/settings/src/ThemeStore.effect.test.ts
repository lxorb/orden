import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { viewport } from '../../ui-kit/src/viewport.svelte'
import { store } from '../../theme-looks/src/api'
import ThemeStore from './ThemeStore.svelte'

const OCEAN = {
  id: 'ocean',
  name: 'Ocean',
  author: 'Someone',
  version: '1.0.0',
  description: '',
  tags: [],
  licence: '',
  variants: ['light' as const],
  updated: '2026-11-01',
  palettes: { light: { '--bg': '#fff' }, dark: {} },
}

let close: (() => void) | undefined

afterEach(() => {
  close?.()
  store.close()
  store.themes = []
  viewport.device = 'desktop'
  document.body.innerHTML = ''
})

function backPressed(): Promise<void> {
  const heard = new Promise<void>((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true })
  })
  history.back()
  return heard
}

describe('a theme opened in the theme store on a phone', () => {
  test("goes back to the list on the phone's Back, like its own Back", async () => {
    viewport.device = 'phone'
    store.themes = [OCEAN]
    store.open = true
    const target = document.createElement('div')
    document.body.append(target)
    const made = mount(ThemeStore, { target })
    close = () => void unmount(made)
    flushSync()
    store.opened = 'ocean'
    flushSync()
    expect(store.chosen?.id).toBe('ocean')
    await backPressed()
    flushSync()
    expect(store.opened).toBeNull()
    expect(store.open).toBe(true)
  })
})
