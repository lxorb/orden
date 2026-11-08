import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

interface Asked {
  name: string
  answer: (vaults: { name: string; items: unknown[] }[]) => void
  fail: (error: Error) => void
}

const asked: Asked[] = []

vi.mock('../../src/lib/pass/import-file', () => ({
  isSealed: () => false,
  importedFrom: (_source: string, name: string) =>
    new Promise((resolve, reject) => {
      asked.push({
        name,
        answer: (vaults) => resolve({ vaults, skipped: [] }),
        fail: reject,
      })
    }),
}))

vi.mock('../../src/lib/pass/store.svelte', () => ({
  pass: { vaults: [], importItems: async () => ({ added: 0 }) },
}))

const { default: SettingsImport } = await import('../../src/lib/pass/SettingsImport.svelte')

let shown: ReturnType<typeof mount> | undefined

afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
  asked.length = 0
  document.body.innerHTML = ''
})

async function choose(name: string) {
  const input = document.querySelector<HTMLInputElement>('input[type=file]')
  if (!input) throw new Error('no file input')
  const bytes = new TextEncoder().encode('name,url,username,password\n')
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [{ name, arrayBuffer: async () => bytes.buffer }],
  })
  input.dispatchEvent(new Event('change', { bubbles: true }))
  for (let turn = 0; turn < 5; turn++) await tick()
}

const settled = async () => {
  for (let turn = 0; turn < 5; turn++) await tick()
  flushSync()
}

test('a file read after another was chosen does not stand in for the one chosen last', async () => {
  shown = mount(SettingsImport, { target: document.body })
  flushSync()

  await choose('old.csv')
  await choose('new.csv')
  expect(asked.map((one) => one.name)).toEqual(['old.csv', 'new.csv'])

  asked[1]?.answer([{ name: 'New', items: [{}] }])
  await settled()
  asked[0]?.answer([{ name: 'Old', items: [{}, {}, {}] }])
  await settled()

  expect(document.body.textContent).toContain('new.csv')
  expect(document.body.textContent).toContain('New')
  expect(document.body.textContent).not.toContain('Old')
})

test('a read that fails after another file was chosen says nothing over it, and leaves it pressable', async () => {
  shown = mount(SettingsImport, { target: document.body })
  flushSync()

  await choose('old.csv')
  document.querySelector<HTMLButtonElement>('button.source')?.click()
  flushSync()
  asked[0]?.fail(new Error('This file could not be read.'))
  await settled()

  expect(document.querySelector('[role=alert]')).toBeNull()

  await choose('new.csv')
  asked[1]?.answer([{ name: 'New', items: [{}] }])
  await settled()
  const button = [...document.querySelectorAll<HTMLButtonElement>('.orden-button')].find((one) =>
    one.textContent.includes('Import'),
  )
  expect(button?.disabled).toBe(false)
})
