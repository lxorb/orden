import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { settings } = await import('./settings.svelte')
const { reservedName } = await import('./reserved-name.svelte')
const NameField = (await import('./NameField.svelte')).default

const flushed = () => new Promise((resolve) => setTimeout(resolve))

let target: HTMLElement
let close: (() => void) | undefined
const oncommit = vi.fn()
const oncancel = vi.fn()

function field(props: Record<string, unknown> = {}) {
  const made = mount(NameField, {
    target,
    props: { value: 'Plan', extension: '.md', space: '/space', oncommit, oncancel, ...props },
  })
  close = () => void unmount(made)
  flushSync()
  const input = target.querySelector('input')
  if (!input) throw new Error('no field')
  return input
}

function bubble(inside?: string): HTMLElement | null {
  const reason = document.querySelector<HTMLElement>('.orden-bubble.reason')
  return inside ? (reason?.querySelector<HTMLElement>(inside) ?? null) : reason
}

function typed(input: HTMLInputElement, words: string) {
  input.value = words
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

beforeEach(() => {
  oncommit.mockClear()
  oncancel.mockClear()
  settings.open = false
  settings.landsOnField = false
  reservedName.dismiss()
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
  reservedName.dismiss()
  for (const one of document.querySelectorAll('.orden-bubble')) one.remove()
})

describe('a row named AGENTS', () => {
  test('says so in a bubble that is announced and can be pressed', () => {
    const input = field()
    expect(bubble('button')).toBeNull()

    typed(input, 'agents')
    const hint = bubble('button')
    expect(hint?.textContent).toContain('agent instructions')
    expect(hint?.closest('[aria-live="polite"]')).not.toBeNull()
    expect(input.getAttribute('aria-invalid')).toBe('true')
  })

  test('another fault keeps its plain sentence', () => {
    const input = field()
    typed(input, 'a/b')
    expect(bubble('button')).toBeNull()
    expect(bubble()?.textContent).toContain('slash')
  })

  test('pressed, the bubble opens the space’s pane on its field, and the row writes nothing', async () => {
    const input = field()
    typed(input, 'AGENTS')
    bubble('button')?.click()
    await flushed()

    expect(settings.open).toBe(true)
    expect(settings.section).toBe('space')
    expect(settings.space).toBe('/space')
    expect(settings.landsOnField).toBe(true)
    expect(oncommit).not.toHaveBeenCalled()
    expect(oncancel).toHaveBeenCalledTimes(1)
  })

  test('Tab goes to the bubble and keeps the field up, and Tab comes back', () => {
    const input = field()
    typed(input, 'AGENTS')
    input.focus()

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    const hint = bubble('button')
    expect(document.activeElement).toBe(hint)
    expect(oncancel).not.toHaveBeenCalled()

    hint?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(input)
    expect(oncancel).not.toHaveBeenCalled()
  })

  test('Enter on the bubble goes where a press does', async () => {
    const input = field()
    typed(input, 'AGENTS')
    bubble('button')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushed()

    expect(settings.section).toBe('space')
    expect(oncancel).toHaveBeenCalledTimes(1)
  })

  test('Escape on the bubble lets the name go', () => {
    const input = field()
    typed(input, 'AGENTS')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    bubble('button')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(oncancel).toHaveBeenCalledTimes(1)
    expect(settings.open).toBe(false)
  })

  test('Enter writes nothing, and the toast takes the way over', async () => {
    const input = field()
    typed(input, 'AGENTS')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushed()

    expect(oncommit).not.toHaveBeenCalled()
    expect(oncancel).toHaveBeenCalledTimes(1)
    expect(reservedName.root).toBe('/space')
  })

  test('Escape tells nobody', async () => {
    const input = field()
    typed(input, 'AGENTS')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushed()
    expect(reservedName.root).toBeNull()
  })

  test('a note in a folder already called it renames with no hint in the way', () => {
    const input = field({ value: 'AGENTS', current: 'AGENTS.md' })
    expect(bubble('button')).toBeNull()
    typed(input, 'Rules')
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(oncommit).toHaveBeenCalledWith('Rules.md')
  })

  test('a folder may have the name', () => {
    const input = field({ extension: '', value: 'Plan' })
    typed(input, 'AGENTS')
    expect(bubble('button')).toBeNull()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(oncommit).toHaveBeenCalledWith('AGENTS')
  })
})

describe('the toast’s way to the setting', () => {
  test('goes to the space it was told about, and goes away', () => {
    reservedName.tell('/other')
    reservedName.open()
    expect(reservedName.root).toBeNull()
    expect(settings.section).toBe('space')
    expect(settings.space).toBe('/other')
    expect(settings.landsOnField).toBe(true)
  })

  test('any other way into Settings is about the space in front', () => {
    settings.show('space', '/other')
    settings.show('general')
    expect(settings.space).toBeNull()
  })

  test('the caret asked for is not left waiting for a pane that was never drawn', () => {
    reservedName.tell('/other')
    reservedName.open()
    expect(settings.landsOnField).toBe(true)
    settings.show('general')
    expect(settings.landsOnField).toBe(false)
  })
})
