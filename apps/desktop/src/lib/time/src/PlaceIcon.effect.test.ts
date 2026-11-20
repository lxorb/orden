import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test } from 'vitest'

const PlaceIcon = (await import('./PlaceIcon.svelte')).default
let target: HTMLElement
let close: (() => void) | undefined
afterEach(() => {
  close?.()
  target.remove()
})
function shown(props: Record<string, unknown>): Element {
  target = document.createElement('div')
  document.body.append(target)
  const made = mount(PlaceIcon, { target, props: props as never })
  close = () => void unmount(made)
  flushSync()
  const icon = target.querySelector('[data-time-place-icon]')
  if (!icon) throw new Error('no icon')
  return icon
}
const visible = (icon: Element) => icon.textContent.trim() !== '' || icon.querySelector('svg, img') !== null
test('a website is never shown without an icon: its brand once the brands are in, else its first letter', () => {
  const brand = shown({ lane: 'site', place: 'github.com', name: 'github.com' })
  expect(visible(brand)).toBe(true)
  close?.()
  target.remove()
  const unknown = shown({ lane: 'site', place: 'quiet-place.example', name: 'quiet-place.example' })
  expect(unknown.querySelector('.tile')?.textContent.trim()).toBe('Q')
})
test('an app nobody made a brand for shows its first letter', () => {
  const app = shown({ lane: 'app', place: 'xterm', name: 'xterm' })
  expect(app.textContent.trim()).toBe('X')
})
test('every row of the four lists draws the icon its source gives it', async () => {
  const { workspace } = await import('../../workspace/src/api')
  const { APP_ICONS } = await import('./app-icons.svelte')
  const { OWN_ICON } = await import('./places')
  const was = workspace.spaces
  workspace.spaces = [{ id: 'orga', name: 'Orga', root: '/spaces/orga' }]
  try {
    const space = shown({ lane: 'space', place: 'name:Orga', name: 'Orga' })
    expect(space.querySelector('[data-time-space-mark]')).not.toBeNull()
    expect(visible(space)).toBe(true)
    close?.()
    target.remove()
    const own = shown({ lane: 'app', place: 'Orden', name: 'Orden' })
    expect(own.querySelector('img')?.getAttribute('src')).toBe(OWN_ICON)
    close?.()
    target.remove()
    const picture = 'data:image/png;base64,iVBORw0KGgo='
    localStorage.setItem(APP_ICONS, JSON.stringify({ Notepad: picture }))
    const { appIcons } = await import('./app-icons.svelte')
    appIcons.pictures = { Notepad: picture }
    const app = shown({ lane: 'app', place: 'notepad', name: 'notepad' })
    expect(app.querySelector('img')?.getAttribute('src')).toBe(picture)
    close?.()
    target.remove()
    const tracker = shown({ lane: 'tab', place: 'time:Time tracker', name: 'Time tracker' })
    expect(tracker.querySelector('[data-time-kind-mark]')?.getAttribute('data-time-kind-mark')).toBe('time')
    close?.()
    target.remove()
    const unsaved = shown({ lane: 'tab', place: 'terminal:Terminal', name: 'Terminal' })
    expect(unsaved.querySelector('[data-time-kind-mark]')?.getAttribute('data-time-kind-mark')).toBe('terminal')
  } finally {
    workspace.spaces = was
    localStorage.removeItem(APP_ICONS)
  }
})
test('a website shows the picture Orden keeps for it before trying the network', async () => {
  const { providePort } = await import('@orden/contracts')
  const kept = 'data:image/png;base64,iVBORw0KGgoK'
  const stop = providePort('web.siteIcons', {
    held: () =>
      Promise.resolve({
        lacking: false,
        list: [],
        picture: (site: string) => (site === 'flowable.vseth.ethz.ch' ? kept : null),
        refresh: () => Promise.resolve(),
      }),
  })
  try {
    const site = shown({ lane: 'site', place: 'flowable.vseth.ethz.ch', name: 'flowable.vseth.ethz.ch' })
    await new Promise((done) => setTimeout(done, 0))
    flushSync()
    expect(site.querySelector('img')?.getAttribute('src')).toBe(kept)
  } finally {
    stop()
  }
})
