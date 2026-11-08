import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { accountDouble } from './account-double'
import type { Face } from './people/face'

const SMALL = 'a'.repeat(64)
const LARGE = 'b'.repeat(64)

const held = vi.hoisted((): { account: unknown } => ({ account: null }))
vi.mock('./account.svelte', () => ({
  get account() {
    return held.account
  },
}))

const { BASE } = await import('./api')
const AccountBadge = (await import('./AccountBadge.svelte')).default
const Avatar = (await import('./people/Avatar.svelte')).default

let shown: ReturnType<typeof mount> | undefined

function signedInWith(avatar: { s: string; l: string } | null) {
  const double = accountDouble('emil')
  held.account = Object.assign(double, {
    name: 'Emil Vinu',
    user: { ...double.user, name: 'Emil Vinu', avatar },
  })
}

function into(): HTMLElement {
  const target = document.createElement('div')
  document.body.append(target)
  return target
}

function drawnBadge(): HTMLElement {
  const target = into()
  shown = mount(AccountBadge, { target })
  flushSync()
  return target
}

function drawnAvatar(face: Face): HTMLElement {
  const target = into()
  shown = mount(Avatar, { target, props: { face } })
  flushSync()
  return target
}

afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
  document.body.replaceChildren()
})

describe('the account picture in the sidebar foot', () => {
  test('asks the server for the small picture by its hash', () => {
    signedInWith({ s: SMALL, l: LARGE })
    const img = drawnBadge().querySelector('img')
    expect(img?.getAttribute('src')).toBe(`${BASE}/i/${SMALL}.webp`)
  })

  test('shows the initial while the picture loads and after it fails, never a broken picture', () => {
    signedInWith({ s: SMALL, l: LARGE })
    const badge = drawnBadge()
    expect(badge.textContent.trim()).toBe('E')

    badge.querySelector('img')?.dispatchEvent(new Event('error'))
    flushSync()
    expect(badge.querySelector('img')).toBeNull()
    expect(badge.textContent.trim()).toBe('E')
  })

  test('hides the initial once the picture is in', () => {
    signedInWith({ s: SMALL, l: LARGE })
    const badge = drawnBadge()
    badge.querySelector('img')?.dispatchEvent(new Event('load'))
    flushSync()
    expect(badge.querySelector('img.shown')).not.toBeNull()
    expect(badge.textContent.trim()).toBe('')
  })

  test('never builds an address from a hash it cannot trust', () => {
    signedInWith({ s: 'undefined', l: LARGE })
    const badge = drawnBadge()
    expect(badge.querySelector('img')).toBeNull()
    expect(badge.textContent.trim()).toBe('E')
  })
})

describe('a person picture elsewhere', () => {
  test('falls back to the initial circle when the picture fails', () => {
    const face = drawnAvatar({ name: 'Ada', avatar: { s: SMALL, l: LARGE } })
    face.querySelector('img')?.dispatchEvent(new Event('error'))
    flushSync()
    expect(face.querySelector('img')).toBeNull()
    expect(face.textContent.trim()).toBe('A')
  })
})
