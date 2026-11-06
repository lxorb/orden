import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import Select from '../../src/lib/Select.svelte'
import { viewport } from '../../src/lib/viewport.svelte'

Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

const SAID = 'Machine-translated. Corrections welcome.'

const OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'yue', label: '粵語', note: SAID },
]

let target: HTMLElement
let was: 'phone' | 'tablet' | 'desktop'

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  was = viewport.device
})

afterEach(() => {
  viewport.device = was
  target.remove()
})

function picker(device: 'desktop' | 'phone') {
  viewport.device = device

  const made = mount(Select, {
    target,
    props: { value: 'en', options: OPTIONS, onchange: () => undefined, label: 'Language' },
  })
  flushSync()

  target.querySelector<HTMLButtonElement>('button.trigger')?.click()
  flushSync()

  return () => void unmount(made, { outro: false })
}

function rows(): { label: string; marked: boolean; tooltip: string; said: string }[] {
  return [...target.querySelectorAll('[role="option"]')].map((one) => {
    const mark = one.querySelector('.mark')

    return {
      label: one.querySelector('.text')?.textContent ?? '',
      marked: !!mark,
      tooltip: mark?.getAttribute('title') ?? '',
      said: one.querySelector('.nib-said')?.textContent ?? '',
    }
  })
}

test('a dropdown marks the row that was written in one pass, and only that one', () => {
  const close = picker('desktop')

  try {
    const [plain, marked] = rows()

    expect(plain?.label).toBe('English')
    expect(plain?.marked).toBe(false)

    expect(marked?.label).toBe('粵語*')
    expect(marked?.marked).toBe(true)
    expect(marked?.tooltip).toBe(SAID)
    expect(marked?.said).toBe(SAID)
  } finally {
    close()
  }
})

test('and the phone’s sheet draws the same mark, saying the same thing', () => {
  const close = picker('phone')

  try {
    expect(target.querySelector('.sheet')).not.toBe(null)

    expect(rows()).toEqual([
      { label: 'English', marked: false, tooltip: '', said: '' },
      { label: '粵語*', marked: true, tooltip: SAID, said: SAID },
    ])
  } finally {
    close()
  }
})

test('the closed control shows the name and nothing else', () => {
  viewport.device = 'desktop'
  const made = mount(Select, {
    target,
    props: { value: 'yue', options: OPTIONS, onchange: () => undefined, label: 'Language' },
  })
  flushSync()

  try {
    expect(target.querySelector('.trigger .text')?.textContent).toBe('粵語')
    expect(target.querySelector('.trigger .mark')).toBe(null)
  } finally {
    void unmount(made, { outro: false })
  }
})
